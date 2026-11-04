package io.github.lz007001cn.veriqra.service.ai;

import io.github.lz007001cn.veriqra.config.AiConfig;
import io.github.lz007001cn.veriqra.config.EnvironmentVariables;
import io.github.lz007001cn.veriqra.web.HttpFailure;
import java.io.IOException;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Properties;

/** Runtime model selection. Credentials and the original AI configuration remain external and unchanged. */
public final class AiSettingsManager {
    public record ModelOption(String id, String label) { }
    public record Settings(String project, String location, String model, boolean configured,
                           boolean writable, String source, long revision, List<ModelOption> models) {
        public Settings { models = List.copyOf(models); }
    }

    private record Selection(String model, String source, long revision) { }
    private static final List<ModelOption> PRESETS = List.of(
            new ModelOption("gemini-4-argon", "Gemini 4 Argon"),
            new ModelOption("gemini-3.8-flash", "Gemini 3.8 Flash"),
            new ModelOption("gemini-3.5-flash-lite", "Gemini 3.5 Flash-Lite"),
            new ModelOption("gemini-3.5-flash", "Gemini 3.5 Flash"));
    private final AiConfig config;
    private final Path settingsPath;
    private volatile Selection selection;
    private final boolean readable;

    public AiSettingsManager(AiConfig config) { this(config, defaultSettingsPath()); }

    /** Explicit path keeps tests and isolated deployments away from user configuration. */
    public AiSettingsManager(AiConfig config, Path settingsPath) {
        this.config = Objects.requireNonNull(config);
        this.settingsPath = Objects.requireNonNull(settingsPath).toAbsolutePath().normalize();
        selection = new Selection(config.model(), "configuration", 0);
        boolean loaded = true;
        if (Files.exists(this.settingsPath, LinkOption.NOFOLLOW_LINKS)) {
            try {
                if (!Files.isRegularFile(this.settingsPath, LinkOption.NOFOLLOW_LINKS)) throw new IOException();
                Properties properties = new Properties();
                try (var reader = Files.newBufferedReader(this.settingsPath)) { properties.load(reader); }
                String model = properties.getProperty("model");
                long revision = Long.parseLong(properties.getProperty("revision", "0"));
                if (!validModel(model) || revision < 0) throw new IllegalArgumentException();
                selection = new Selection(model, "local-settings", revision);
            } catch (IOException | IllegalArgumentException | SecurityException failure) {
                // Keep generation available from the original configuration, but do not overwrite an unreadable override.
                loaded = false;
            }
        }
        readable = loaded;
    }

    public Settings get() { return snapshot(selection); }

    public synchronized Settings update(String model, long expectedRevision) {
        if (!validModel(model) || expectedRevision < 0)
            throw new HttpFailure(400, "AI_MODEL_INVALID", "Select a valid Gemini model and settings revision");
        Selection before = selection;
        if (before.revision() != expectedRevision)
            throw new HttpFailure(409, "AI_SETTINGS_CONFLICT", "AI settings changed; reload before saving");
        if (!writable() || before.revision() == Long.MAX_VALUE) throw notWritable();
        Selection after = new Selection(model, "local-settings", before.revision() + 1);
        Path temporary = null;
        try {
            Files.createDirectories(settingsPath.getParent());
            temporary = Files.createTempFile(settingsPath.getParent(), ".ai-settings-", ".tmp");
            Properties properties = new Properties();
            properties.setProperty("model", after.model());
            properties.setProperty("revision", Long.toString(after.revision()));
            try (var writer = Files.newBufferedWriter(temporary)) {
                properties.store(writer, "Veriqra runtime AI model selection");
            }
            try (FileChannel channel = FileChannel.open(temporary, StandardOpenOption.WRITE)) { channel.force(true); }
            Files.move(temporary, settingsPath, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            selection = after;
            return snapshot(after);
        } catch (IOException | SecurityException failure) {
            throw notWritable();
        } finally {
            if (temporary != null) {
                try { Files.deleteIfExists(temporary); } catch (IOException | SecurityException ignored) { }
            }
        }
    }

    private Settings snapshot(Selection current) {
        List<ModelOption> models = new ArrayList<>(PRESETS);
        if (current.model() != null && models.stream().noneMatch(option -> option.id().equals(current.model())))
            models.add(new ModelOption(current.model(), current.model()));
        return new Settings(config.project(), config.location(), current.model(), config.configured(), writable(),
                current.source(), current.revision(), models);
    }

    private boolean writable() {
        if (!readable) return false;
        try {
            if (Files.exists(settingsPath, LinkOption.NOFOLLOW_LINKS)
                    && (!Files.isRegularFile(settingsPath, LinkOption.NOFOLLOW_LINKS) || !Files.isWritable(settingsPath))) return false;
            Path parent = settingsPath.getParent();
            while (parent != null && !Files.exists(parent, LinkOption.NOFOLLOW_LINKS)) parent = parent.getParent();
            return parent != null && Files.isDirectory(parent) && Files.isWritable(parent);
        } catch (SecurityException failure) { return false; }
    }

    private static boolean validModel(String model) {
        return model != null && model.length() <= 128 && model.matches("gemini-[a-z0-9][a-z0-9._-]*");
    }

    private static HttpFailure notWritable() {
        return new HttpFailure(503, "AI_SETTINGS_NOT_WRITABLE", "AI model settings could not be saved");
    }

    private static Path defaultSettingsPath() {
        String selected = EnvironmentVariables.get("AI_SETTINGS");
        if (selected == null) selected = System.getProperty("veriqra.ai.settings");
        if (selected != null) return Path.of(selected);
        String configuration = EnvironmentVariables.get("AI_CONFIG");
        if (configuration == null) configuration = System.getProperty("veriqra.ai.config", "config/ai.local.properties");
        return Path.of(configuration).toAbsolutePath().normalize().resolveSibling("ai-settings.local.properties");
    }
}
