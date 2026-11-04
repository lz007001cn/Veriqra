package io.github.lz007001cn.veriqra.service.ai;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.lz007001cn.veriqra.config.AiConfig;
import io.github.lz007001cn.veriqra.web.HttpFailure;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class AiSettingsManagerTest {
    @TempDir Path temporary;
    private final AiConfig config = new AiConfig("project-one", "global", "gemini-2.5-flash", "private-credentials-path.json");

    @Test void originalConfigurationIsCurrentWithoutCreatingSettingsAndSnapshotOmitsSecrets() throws Exception {
        Path path = temporary.resolve("config/ai-settings.local.properties");
        var manager = new AiSettingsManager(config, path);
        var result = manager.get();
        assertEquals("gemini-2.5-flash", result.model());
        assertEquals("configuration", result.source());
        assertEquals(0, result.revision());
        assertTrue(result.configured());
        assertTrue(result.writable());
        assertFalse(Files.exists(path));
        assertEquals(List.of("gemini-4-argon", "gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-2.5-flash"),
                result.models().stream().map(AiSettingsManager.ModelOption::id).toList());
        assertThrows(UnsupportedOperationException.class, () -> result.models().clear());
        String serialized = new ObjectMapper().writeValueAsString(result);
        assertFalse(serialized.contains("private-credentials"));
        assertFalse(serialized.contains(temporary.toString()));
    }

    @Test void savesOnlySelectionAndRevisionAtomicallyThenRestoresThemOnRestart() throws Exception {
        Path path = temporary.resolve("config/ai-settings.local.properties");
        var manager = new AiSettingsManager(config, path);
        var before = manager.get();
        var saved = manager.update("gemini-custom-model", before.revision());
        assertEquals("gemini-custom-model", saved.model());
        assertEquals("gemini-2.5-flash", before.model());
        assertEquals("local-settings", saved.source());
        assertEquals(1, saved.revision());
        assertEquals("gemini-2.5-flash", config.model());
        String contents = Files.readString(path);
        assertTrue(contents.contains("model=gemini-custom-model"));
        assertFalse(contents.contains("credentials"));
        assertFalse(contents.contains("project-one"));
        assertEquals(saved, new AiSettingsManager(config, path).get());
        try (var siblings = Files.list(path.getParent())) { assertEquals(1, siblings.count()); }
        assertEquals(2, manager.update("gemini-3.8-flash", saved.revision()).revision());
        assertEquals(1, manager.get().models().stream().filter(option -> option.id().equals("gemini-3.8-flash")).count());
    }

    @Test void staleSaveAndInvalidModelsLeaveSnapshotAndFileUnchanged() throws Exception {
        Path path = temporary.resolve("ai-settings.local.properties");
        var manager = new AiSettingsManager(config, path);
        var saved = manager.update("gemini-3.8-flash", 0);
        byte[] contents = Files.readAllBytes(path);
        var conflict = assertThrows(HttpFailure.class, () -> manager.update("gemini-3.5-flash", 0));
        assertEquals(409, conflict.status());
        assertEquals("AI_SETTINGS_CONFLICT", conflict.code());
        for (String invalid : new String[]{null, "", "gemini-", " gemini-flash", "gemini-FLASH", "gemini-x/y",
                "gemini-x:generateContent", "gemini-x\nsecret", "other-model", "gemini-" + "x".repeat(122)}) {
            assertEquals(400, assertThrows(HttpFailure.class, () -> manager.update(invalid, 1)).status());
        }
        assertEquals(saved, manager.get());
        assertArrayEquals(contents, Files.readAllBytes(path));
    }

    @Test void simultaneousUpdatesAllowOnlyOneWriterForARevision() throws Exception {
        var manager = new AiSettingsManager(config, temporary.resolve("ai-settings.local.properties"));
        CountDownLatch start = new CountDownLatch(1);
        try (var pool = Executors.newFixedThreadPool(2)) {
            var first = pool.submit(() -> updateAfter(start, manager, "gemini-first"));
            var second = pool.submit(() -> updateAfter(start, manager, "gemini-second"));
            start.countDown();
            assertEquals(List.of(200, 409), java.util.stream.Stream.of(first.get(5, TimeUnit.SECONDS), second.get(5, TimeUnit.SECONDS)).sorted().toList());
        }
        assertEquals(1, manager.get().revision());
    }

    @Test void failedPersistenceAndMalformedOverrideKeepOriginalModelAndDoNotOverwrite() throws Exception {
        Path path = temporary.resolve("ai-settings.local.properties");
        var manager = new AiSettingsManager(config, path);
        Files.createDirectory(path);
        assertEquals("AI_SETTINGS_NOT_WRITABLE", assertThrows(HttpFailure.class, () -> manager.update("gemini-new", 0)).code());
        assertEquals("gemini-2.5-flash", manager.get().model());
        assertEquals(0, manager.get().revision());
        assertFalse(manager.get().writable());
        Path malformed = temporary.resolve("malformed.properties");
        Files.writeString(malformed, "model=gemini-invalid/route\nrevision=2\n");
        var fallback = new AiSettingsManager(config, malformed);
        assertEquals("gemini-2.5-flash", fallback.get().model());
        assertFalse(fallback.get().writable());
        assertEquals(503, assertThrows(HttpFailure.class, () -> fallback.update("gemini-new", 0)).status());
        assertTrue(Files.readString(malformed).contains("gemini-invalid/route"));
    }

    private static int updateAfter(CountDownLatch start, AiSettingsManager manager, String model) throws InterruptedException {
        start.await();
        try { manager.update(model, 0); return 200; }
        catch (HttpFailure failure) { return failure.status(); }
    }
}
