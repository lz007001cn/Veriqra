package io.github.lz007001cn.veriqra.web;

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.*;

class I18nResourcesTest {
    private static final Path WEB = Path.of("src/main/webapp");
    private static final Pattern PLACEHOLDER = Pattern.compile("\\{[A-Za-z][A-Za-z0-9]*}");
    private static final Pattern MARKER = Pattern.compile("data-i18n(?:-placeholder|-title|-aria-label)?=\"([^\"]+)\"");
    private static final Pattern SCRIPT_KEY = Pattern.compile("\\bt\\(['\"]([a-z][A-Za-z0-9.]+)['\"](?=\\s*[,\\)])");

    private Map<String, String> catalog(String name) throws IOException {
        ObjectMapper mapper = new ObjectMapper(new JsonFactory().enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION));
        return mapper.readValue(WEB.resolve("i18n/" + name + ".json").toFile(), new TypeReference<>() {});
    }

    @Test
    void catalogsHaveIdenticalKeysAndParameters() throws IOException {
        Map<String, String> english = catalog("en"), chinese = catalog("zh-CN");
        assertEquals(english.keySet(), chinese.keySet());
        assertTrue(english.size() > 400);
        for (String key : english.keySet()) {
            assertFalse(english.get(key).isBlank(), key);
            assertFalse(chinese.get(key).isBlank(), key);
            assertEquals(parameters(english.get(key)), parameters(chinese.get(key)), key);
        }
    }

    @Test
    void allPagesLoadSharedModuleBeforePageCodeAndUseValidMarkers() throws IOException {
        Map<String, String> english = catalog("en");
        try (Stream<Path> pages = Stream.concat(Files.list(WEB).filter(p -> p.toString().endsWith(".html")),
                Files.list(WEB.resolve("admin")).filter(p -> p.toString().endsWith(".html")))) {
            for (Path page : pages.toList()) {
                String html = Files.readString(page);
                if (page.equals(WEB.resolve("admin/index.html"))) {
                    assertTrue(html.contains("content=\"0;url=users.html\""));
                    assertTrue(html.contains("href=\"users.html\""));
                    continue;
                }
                assertTrue(html.contains("assets/js/i18n.js"), page.toString());
                assertTrue(html.contains("data-locale-switch"), page.toString());
                assertTrue(html.indexOf("assets/js/i18n.js") < html.indexOf("assets/js/api.js"), page.toString());
                Matcher markers = MARKER.matcher(html);
                int count = 0;
                while (markers.find()) {
                    assertTrue(english.containsKey(markers.group(1)), page + ": " + markers.group(1));
                    count++;
                }
                assertTrue(count >= 8, page.toString());
            }
        }
    }

    @Test
    void literalJavascriptKeysExistAndMachineValuesRemainStable() throws IOException {
        Map<String, String> english = catalog("en");
        try (Stream<Path> scripts = Stream.concat(Files.list(WEB.resolve("assets/js")), Stream.of(WEB.resolve("admin/admin.js")))) {
            for (Path script : scripts.filter(p -> p.toString().endsWith(".js")).toList()) {
                Matcher keys = SCRIPT_KEY.matcher(Files.readString(script));
                while (keys.find()) {
                    String key = keys.group(1);
                    if (script.getFileName().toString().equals("project-settings.js") && !key.contains("."))
                        key = "projectSettings." + key;
                    assertTrue(english.containsKey(key), script + ": " + key);
                }
            }
        }
        String html = Files.readString(WEB.resolve("index.html"));
        for (String code : new String[] {"PASS", "FAIL", "BLOCKED", "SKIPPED", "LOW", "MEDIUM", "HIGH", "CRITICAL"}) {
            assertTrue(html.contains("value=\"" + code + "\""), code);
        }
    }

    @Test
    void authenticationFeedbackHasDisplayLabels() throws IOException {
        Map<String, String> english = catalog("en"), chinese = catalog("zh-CN");
        for (String key : new String[] {"auth.loginRateLimited", "auth.loginRateLimitedGeneric", "auth.retryMinutesSeconds"}) {
            assertTrue(english.containsKey(key), key);
            assertTrue(chinese.containsKey(key), key);
        }
    }

    private Set<String> parameters(String value) {
        Set<String> result = new HashSet<>();
        Matcher matcher = PLACEHOLDER.matcher(value);
        while (matcher.find()) result.add(matcher.group());
        return result;
    }
}
