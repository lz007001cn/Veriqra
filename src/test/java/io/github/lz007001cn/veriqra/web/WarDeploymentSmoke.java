package io.github.lz007001cn.veriqra.web;

import org.apache.catalina.startup.Tomcat;
import java.net.*;
import java.net.http.*;
import java.nio.file.*;
import java.time.Duration;
import java.util.Properties;

/**
 * Run AFTER package, with ONLY tomcat-embed-core on launcher classpath.
 * Java source launcher: WarDeploymentSmoke.java <war> <test-config>.
 * Keeping application/JDBC classes out of the parent loader detects deployment-only driver issues.
 */
public final class WarDeploymentSmoke {
    public static void main(String[] args) throws Exception {
        if (args.length != 2) throw new IllegalArgumentException("Expected WAR and isolated test configuration");
        Properties properties = new Properties();
        Path config = Path.of(args[1]).toAbsolutePath();
        try (var reader = Files.newBufferedReader(config)) { properties.load(reader); }
        if (!properties.getProperty("jdbcUrl", "").matches(
                "jdbc:mysql://(?:localhost|127\\.0\\.0\\.1):[0-9]{1,5}/veriqra_test_[a-z0-9_]+")
                || properties.getProperty("username", "").isBlank()
                || "root".equalsIgnoreCase(properties.getProperty("username"))
                || System.getenv().keySet().stream().anyMatch(key -> key.startsWith("VERIQRA_DB_"))) {
            throw new IllegalArgumentException("WAR smoke requires an isolated local veriqra_test_* schema and no application DB overrides");
        }
        System.setProperty("veriqra.db.config", config.toString());
        // Replicate Tomcat-wide JDBC initialization before the webapp classloader exists.
        java.sql.DriverManager.getDrivers();
        for (String contextPath : new String[]{"", "/veriqra"}) {
            for (int round = 0; round < 2; round++) deploy(Path.of(args[0]).toAbsolutePath(), contextPath);
        }
        System.out.println("WAR_SMOKE_PASS: ROOT and /veriqra, two independent deployment/shutdown cycles each; static resources and protected API verified");
    }

    private static void deploy(Path war, String contextPath) throws Exception {
        Path directory = Files.createTempDirectory(Path.of("target"), "war-smoke-");
        Path appBase = Files.createDirectories(directory.resolve("webapps"));
        Path deployedWar = Files.copy(war, appBase.resolve(contextPath.isEmpty() ? "ROOT.war" : "veriqra.war"));
        Tomcat tomcat = new Tomcat();
        tomcat.setBaseDir(directory.toAbsolutePath().toString());
        tomcat.setAddDefaultWebXmlToWebapp(false); // API-only embedded runtime: no Jasper.
        tomcat.setPort(0);
        tomcat.getConnector().setProperty("address", "127.0.0.1");
        var context = tomcat.addWebapp(contextPath, deployedWar.toAbsolutePath().toString());
        try {
            tomcat.start();
            if (!context.getState().isAvailable()) throw new AssertionError("WAR deployment failed");
            try (var client = HttpClient.newHttpClient()) {
                var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + tomcat.getConnector().getLocalPort()
                        + contextPath + "/api/auth/me")).timeout(Duration.ofSeconds(10)).build();
                var response = client.send(request, HttpResponse.BodyHandlers.ofString());
                if (response.statusCode() != 401 || !response.body().contains("UNAUTHENTICATED")) {
                    throw new AssertionError("Unexpected protected response status: " + response.statusCode());
                }
                for (String path : new String[]{"/", "/index.html", "/login.html", "/assets/css/app.css",
                        "/assets/js/i18n.js", "/i18n/en.json", "/i18n/zh-CN.json",
                        "/assets/js/api.js", "/assets/js/app.js", "/assets/js/dashboard.js", "/assets/js/login.js", "/assets/js/test-assets.js", "/assets/js/execution.js",
                        "/assets/js/defects.js", "/assets/js/automation-imports.js",
                        "/admin/index.html", "/admin/users.html",
                        "/admin/admin.css", "/admin/admin.js",
                        "/assets/vendor/jquery-3.7.1.min.js", "/assets/vendor/bootstrap-5.3.8.min.css",
                        "/assets/vendor/bootstrap-5.3.8.bundle.min.js", "/assets/vendor/echarts-6.0.0.min.js",
                        "/assets/vendor/bootstrap-table-1.24.2.min.css", "/assets/vendor/bootstrap-table-1.24.2.min.js",
                        "/assets/vendor/bootstrap-table-1.24.2-zh-CN.min.js"}) {
                    var resource = client.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:"
                            + tomcat.getConnector().getLocalPort() + contextPath + path)).GET().build(),
                            HttpResponse.BodyHandlers.ofString());
                    if (resource.statusCode() != 200 || resource.body().isBlank()) {
                        throw new AssertionError("Resource failed in " + contextPath + ": " + path
                                + " status=" + resource.statusCode());
                    }
                    String type = resource.headers().firstValue("Content-Type").orElse("");
                    String expected = path.endsWith(".css") ? "text/css" : path.endsWith(".js")
                            ? "application/javascript" : path.endsWith(".json") ? "application/json" : "text/html";
                    if (!type.startsWith(expected)) throw new AssertionError("Wrong MIME type for " + path + ": " + type);
                }
                for (String path : new String[]{"/WEB-INF/web.xml", "/missing-resource.css"}) {
                    var resource = client.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:"
                            + tomcat.getConnector().getLocalPort() + contextPath + path)).GET().build(),
                            HttpResponse.BodyHandlers.ofString());
                    if (resource.statusCode() != 404) throw new AssertionError("Resource must not be exposed: " + path);
                }
            }
        } finally { try { tomcat.stop(); } finally { tomcat.destroy(); } }
    }
}
