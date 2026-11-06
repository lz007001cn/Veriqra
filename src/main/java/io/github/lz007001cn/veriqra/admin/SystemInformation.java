package io.github.lz007001cn.veriqra.admin;

import io.github.lz007001cn.veriqra.config.DatabaseConfig;
import io.github.lz007001cn.veriqra.config.EnvironmentVariables;
import io.github.lz007001cn.veriqra.exception.DataAccessException;
import io.github.lz007001cn.veriqra.service.ai.AiSettingsManager;
import io.github.lz007001cn.veriqra.web.BuildInfo;
import jakarta.servlet.ServletContext;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.IntSupplier;
import java.util.function.Supplier;

/** A startup snapshot of effective, allowlisted configuration, with live runtime measurements. */
public final class SystemInformation {
    public static final String ATTRIBUTE = SystemInformation.class.getName();
    private final Integer initialPoolSize;
    private final Integer maxPoolSize;
    private final Long acquireTimeoutMillis;
    private final String databaseSource;
    private final Boolean publicOriginConfigured;

    private SystemInformation(DatabaseConfig database, String source, Boolean publicOriginConfigured) {
        initialPoolSize = database == null ? null : database.initialPoolSize();
        maxPoolSize = database == null ? null : database.maxPoolSize();
        acquireTimeoutMillis = database == null ? null : database.acquireTimeout().toMillis();
        databaseSource = source;
        this.publicOriginConfigured = publicOriginConfigured;
    }

    public static SystemInformation capture(DatabaseConfig database) {
        return capture(database, System.getenv(), System.getProperty("veriqra.db.config"),
                Files.isRegularFile(Path.of("config/database.local.properties")));
    }

    /** Inputs are evaluated only during startup; files and environment are never reloaded by this page. */
    public static SystemInformation capture(DatabaseConfig database, Map<String, String> environment,
                                            String jvmDatabaseConfig, boolean defaultFilePresent) {
        String source;
        boolean overrides = java.util.List.of("JDBC_URL", "USERNAME", "PASSWORD", "INITIAL_POOL_SIZE", "MAX_POOL_SIZE", "ACQUIRE_TIMEOUT")
                .stream().anyMatch(key -> EnvironmentVariables.get(environment, "DB_" + key) != null);
        if (overrides) source = "ENVIRONMENT";
        else if (EnvironmentVariables.get(environment, "DB_CONFIG") != null) source = "EXTERNAL_FILE";
        else if (jvmDatabaseConfig != null) source = "JVM_PROPERTY";
        else source = defaultFilePresent ? "EXTERNAL_FILE" : "DEFAULTS";
        String origin = EnvironmentVariables.get(environment, "PUBLIC_ORIGIN");
        return new SystemInformation(database, source, origin != null && !origin.isBlank());
    }

    /** Preserves legacy system metadata when an isolated fixture has no startup snapshot. */
    public static SystemInformation unavailable() { return new SystemInformation(null, "UNAVAILABLE", null); }

    public Map<String, Object> snapshot(ServletContext context, long startedAtMillis,
                                        Supplier<String> databaseVersion, IntSupplier databaseTableCount) {
        BuildInfo build = BuildInfo.current();
        Map<String, Object> result = map("veriqraVersion", build.version(), "buildCommit", build.commit(),
                "buildTime", build.buildTime(), "applicationStatus", "UP",
                "databaseStatus", "UNAVAILABLE", "databaseVersion", null, "databaseTableCount", null);
        try {
            String version = databaseVersion.get();
            int tables = databaseTableCount.getAsInt();
            if (version != null && !version.isBlank() && tables >= 0) {
                result.put("databaseVersion", version);
                result.put("databaseTableCount", tables);
                result.put("databaseStatus", "UP");
            }
        } catch (DataAccessException unavailable) {
            // Driver and SQL failure messages may contain private configuration; expose only the status.
        }
        result.put("javaVersion", System.getProperty("java.version"));
        result.put("tomcatVersion", context.getServerInfo());
        result.put("uptimeSeconds", Math.max(0, (System.currentTimeMillis() - startedAtMillis) / 1000));
        result.put("serverTime", Instant.now().toString());
        // Frontend i18n.js formats application dates in this explicit zone, independently of the JVM.
        result.put("applicationTimeZone", "Asia/Shanghai (UTC+8)");
        Runtime runtime = Runtime.getRuntime();
        long committed = runtime.totalMemory();
        result.put("runtime", map("javaVendor", System.getProperty("java.vendor"),
                "osName", System.getProperty("os.name"), "osVersion", System.getProperty("os.version"),
                "osArch", System.getProperty("os.arch"), "availableProcessors", runtime.availableProcessors(),
                "heapUsedBytes", Math.max(0, committed - runtime.freeMemory()), "heapCommittedBytes", committed,
                "heapMaxBytes", runtime.maxMemory(), "jvmTimeZone", ZoneId.systemDefault().getId(),
                "fileEncoding", System.getProperty("file.encoding")));
        result.put("configuration", map("contextPath", context.getContextPath(),
                "sessionTimeoutMinutes", context.getSessionTimeout(),
                "sessionCookieSecure", context.getSessionCookieConfig().isSecure(),
                "publicOriginConfigured", publicOriginConfigured,
                "database", map("initialPoolSize", initialPoolSize, "maxPoolSize", maxPoolSize,
                        "acquireTimeoutMillis", acquireTimeoutMillis, "source", databaseSource)));
        AiSettingsManager manager = (AiSettingsManager) context.getAttribute(AiSettingsManager.class.getName());
        AiSettingsManager.Settings ai = manager == null ? null : manager.get();
        result.put("ai", map("provider", "Vertex AI", "configured", ai == null ? null : ai.configured(),
                "project", ai == null ? null : ai.project(), "location", ai == null ? null : ai.location(),
                "model", ai == null ? null : ai.model(), "settingsWritable", ai == null ? null : ai.writable(),
                "settingsSource", ai == null ? null : ai.source()));
        return result;
    }

    private static Map<String, Object> map(Object... pairs) {
        Map<String, Object> result = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) result.put((String) pairs[i], pairs[i + 1]);
        return result;
    }
}
