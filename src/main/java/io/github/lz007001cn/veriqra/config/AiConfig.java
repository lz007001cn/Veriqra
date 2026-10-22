package io.github.lz007001cn.veriqra.config;

import java.nio.file.*;
import java.io.IOException;
import java.util.Properties;

public record AiConfig(String project, String location, String model, String credentials) {
    public static AiConfig load() {
        Properties p = new Properties();
        String selected = EnvironmentVariables.get("AI_CONFIG");
        if (selected == null) selected = System.getProperty("veriqra.ai.config", "config/ai.local.properties");
        Path path = Path.of(selected);
        if (Files.isRegularFile(path)) {
            try (var reader = Files.newBufferedReader(path)) { p.load(reader); }
            catch (IOException e) { return new AiConfig(null, "global", "gemini-2.5-flash", null); }
        }
        for (String key : new String[]{"project", "location", "model", "credentials"}) {
            String value = EnvironmentVariables.get("AI_" + key.toUpperCase(java.util.Locale.ROOT));
            if (value != null) p.setProperty(key, value);
        }
        return new AiConfig(p.getProperty("project"), p.getProperty("location", "global"),
                p.getProperty("model", "gemini-2.5-flash"), p.getProperty("credentials"));
    }
    public boolean configured() { return project != null && !project.isBlank() && credentials != null && !credentials.isBlank(); }
    @Override public String toString() { return "AiConfig[external configuration]"; }
}
