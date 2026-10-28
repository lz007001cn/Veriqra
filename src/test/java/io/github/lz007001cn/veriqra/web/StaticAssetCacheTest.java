package io.github.lz007001cn.veriqra.web;

import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.apache.catalina.Context;
import org.apache.catalina.filters.ExpiresFilter;
import org.apache.catalina.servlets.DefaultServlet;
import org.apache.catalina.startup.Tomcat;
import org.apache.tomcat.util.descriptor.web.FilterDef;
import org.apache.tomcat.util.descriptor.web.FilterMap;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

import javax.xml.parsers.DocumentBuilderFactory;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.time.Duration;
import java.time.Instant;

import static org.junit.jupiter.api.Assertions.*;

/** Real Tomcat cache semantics, using the cache filter configuration from the shipped descriptor. */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class StaticAssetCacheTest {
    @TempDir static Path directory;
    private Tomcat tomcat;
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    @BeforeAll void start() throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        Document descriptor = factory.newDocumentBuilder().parse(
                Path.of("src/main/webapp/WEB-INF/web.xml").toFile());
        Element definition = named(descriptor, "filter", "filter-name", "staticExpires");
        assertEquals(ExpiresFilter.class.getName(), text(definition, "filter-class"));
        Element mapping = named(descriptor, "filter-mapping", "filter-name", "staticExpires");
        assertEquals("default", text(mapping, "servlet-name"));
        assertEquals("REQUEST", text(mapping, "dispatcher"));
        assertEquals(0, mapping.getElementsByTagName("url-pattern").getLength(),
                "Cache policy belongs only to DefaultServlet, never to /api/*");

        tomcat = new Tomcat();
        tomcat.setBaseDir(directory.resolve("tomcat").toString());
        tomcat.setPort(0);
        tomcat.getConnector().setProperty("address", "127.0.0.1");
        for (String contextPath : new String[]{"", "/veriqra"}) {
            Path webroot = directory.resolve(contextPath.isEmpty() ? "root" : "veriqra");
            write(webroot, "index.html", "<!doctype html><title>Workspace</title>");
            write(webroot, "login.html", "<!doctype html><title>Login</title>");
            write(webroot, "admin/users.html", "<!doctype html><title>Users</title>");
            write(webroot, "assets/css/app.css", "body { color: black; }");
            write(webroot, "assets/js/app.js", "window.cachePolicyTest = true;");
            write(webroot, "i18n/zh-CN.json", "{\"title\":\"工作区\"}");
            Context context = tomcat.addContext(contextPath, webroot.toString());
            context.setParentClassLoader(getClass().getClassLoader());
            context.addMimeMapping("html", "text/html");
            context.addMimeMapping("css", "text/css");
            context.addMimeMapping("js", "application/javascript");
            context.addMimeMapping("json", "application/json");
            context.addWelcomeFile("index.html");
            Tomcat.addServlet(context, "default", new DefaultServlet());
            context.addServletMappingDecoded("/", "default");

            FilterDef staticFilter = new FilterDef();
            staticFilter.setFilterName("staticExpires");
            staticFilter.setFilter(new ExpiresFilter());
            NodeList params = definition.getElementsByTagName("init-param");
            for (int index = 0; index < params.getLength(); index++) {
                Element param = (Element) params.item(index);
                staticFilter.addInitParameter(text(param, "param-name"), text(param, "param-value"));
            }
            context.addFilterDef(staticFilter);
            FilterMap staticMapping = new FilterMap();
            staticMapping.setFilterName("staticExpires");
            staticMapping.addServletName(text(mapping, "servlet-name"));
            staticMapping.setDispatcher(text(mapping, "dispatcher"));
            context.addFilterMap(staticMapping);

            Tomcat.addServlet(context, "api", new HttpServlet() {
                @Override protected void doGet(HttpServletRequest request, HttpServletResponse response)
                        throws IOException {
                    response.setContentType("application/json");
                    response.getWriter().write("{\"ok\":true}");
                }
            });
            context.addServletMappingDecoded("/api/*", "api");
            FilterDef apiFilter = new FilterDef();
            apiFilter.setFilterName("apiErrors");
            apiFilter.setFilter(new ApiExceptionFilter());
            context.addFilterDef(apiFilter);
            FilterMap apiMapping = new FilterMap();
            apiMapping.setFilterName("apiErrors");
            apiMapping.addURLPattern("/api/*");
            context.addFilterMap(apiMapping);
        }
        tomcat.start();
    }

    @AfterAll void stop() throws Exception {
        if (tomcat != null) {
            try { tomcat.stop(); } finally { tomcat.destroy(); }
        }
    }

    @ParameterizedTest @ValueSource(strings = {"", "/veriqra"})
    void htmlIncludingWelcomeAndAdminPagesRevalidates(String contextPath) throws Exception {
        for (String path : new String[]{"/", "/index.html", "/login.html", "/admin/users.html"}) {
            HttpResponse<String> response = get(contextPath, path);
            assertEquals(200, response.statusCode(), path);
            assertEquals("max-age=0", header(response, "Cache-Control"), path);
            assertFalse(header(response, "Expires").isBlank());
            assertFalse(header(response, "ETag").isBlank());
            assertFalse(header(response, "Last-Modified").isBlank());
        }
    }

    @ParameterizedTest @ValueSource(strings = {"", "/veriqra"})
    void versionedCssJavaScriptAndI18nRemainCacheable(String contextPath) throws Exception {
        for (String path : new String[]{"/assets/css/app.css", "/assets/js/app.js", "/i18n/zh-CN.json"}) {
            HttpResponse<String> response = get(contextPath, path + "?v=release-cache-test");
            assertEquals(200, response.statusCode(), path);
            String cacheControl = header(response, "Cache-Control");
            assertTrue(cacheControl.matches("max-age=\\d+"), path + " " + cacheControl);
            long maxAge = Long.parseLong(cacheControl.substring("max-age=".length()));
            // ExpiresFilter rounds the remaining lifetime after request processing to seconds.
            assertTrue(maxAge >= 3598 && maxAge <= 3600, path + " " + cacheControl);
            assertFalse(header(response, "Expires").isBlank());
            assertFalse(header(response, "ETag").isBlank());
            assertFalse(header(response, "Last-Modified").isBlank());
        }
    }

    @ParameterizedTest @ValueSource(strings = {"", "/veriqra"})
    void validatorsStillAllowNotModifiedResponses(String contextPath) throws Exception {
        for (String path : new String[]{"/index.html", "/assets/js/app.js?v=release-cache-test"}) {
            HttpResponse<String> original = get(contextPath, path);
            for (String[] validator : new String[][]{
                    {"If-None-Match", "ETag"}, {"If-Modified-Since", "Last-Modified"}}) {
                HttpResponse<String> response = client.send(request(contextPath, path)
                        .header(validator[0], header(original, validator[1])).build(),
                        HttpResponse.BodyHandlers.ofString());
                assertEquals(304, response.statusCode(), path + " " + validator[0]);
                assertEquals("", response.body());
            }
        }
    }

    @ParameterizedTest @ValueSource(strings = {"", "/veriqra"})
    void apiJsonKeepsNoStoreAndDoesNotAcquireStaticExpiry(String contextPath) throws Exception {
        HttpResponse<String> response = get(contextPath, "/api/cache-policy-test");
        assertEquals(200, response.statusCode());
        assertEquals("{\"ok\":true}", response.body());
        assertEquals("no-store", header(response, "Cache-Control"));
        assertTrue(response.headers().firstValue("Expires").isEmpty());
    }

    private HttpRequest.Builder request(String contextPath, String path) {
        return HttpRequest.newBuilder(URI.create("http://127.0.0.1:"
                + tomcat.getConnector().getLocalPort() + contextPath + path)).timeout(Duration.ofSeconds(5));
    }
    private HttpResponse<String> get(String contextPath, String path) throws Exception {
        return client.send(request(contextPath, path).GET().build(), HttpResponse.BodyHandlers.ofString());
    }
    private static String header(HttpResponse<?> response, String name) {
        return response.headers().firstValue(name).orElseThrow();
    }
    private static void write(Path root, String relative, String content) throws IOException {
        Path file = root.resolve(relative);
        Files.createDirectories(file.getParent());
        Files.writeString(file, content);
        Files.setLastModifiedTime(file, FileTime.from(Instant.now().minusSeconds(60)));
    }
    private static Element named(Document document, String tag, String nameTag, String name) {
        NodeList elements = document.getElementsByTagName(tag);
        for (int index = 0; index < elements.getLength(); index++) {
            Element element = (Element) elements.item(index);
            if (name.equals(text(element, nameTag))) return element;
        }
        throw new AssertionError("Missing " + tag + " " + name);
    }
    private static String text(Element parent, String tag) {
        return parent.getElementsByTagName(tag).item(0).getTextContent().trim();
    }
}
