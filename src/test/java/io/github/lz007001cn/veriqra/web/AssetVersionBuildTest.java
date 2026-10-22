package io.github.lz007001cn.veriqra.web;

import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.Properties;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.*;

class AssetVersionBuildTest {
    private static final Path ROOT = Path.of(System.getProperty("basedir", "."));
    private static final Path WEB = ROOT.resolve("src/main/webapp");
    private static final Path GENERATED = ROOT.resolve("target/versioned-webapp");
    private static final Pattern REFERENCE = Pattern.compile("\\b(?:src|href)=([\"'])([^\"']+)\\1");

    @Test void tokenUsesTheSameCommitAsSystemAndActualFirstPartyBytes() throws Exception {
        Properties values = assetProperties();
        List<Path> assets = assetFiles();
        assertEquals(20, assets.size(), "The inventory includes the AI editor and import history modules.");
        assertTrue(assets.contains(WEB.resolve("assets/js/workflow-context.js")));
        assertTrue(assets.contains(WEB.resolve("i18n/en.json")));
        assertTrue(assets.contains(WEB.resolve("i18n/zh-CN.json")));
        assertFalse(assets.stream().anyMatch(file -> relative(file).startsWith("assets/vendor/")));

        MessageDigest total = MessageDigest.getInstance("SHA-256");
        for (Path file : assets) {
            total.update(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(file)));
            total.update(relative(file).getBytes(StandardCharsets.UTF_8));
        }
        String digest = HexFormat.of().formatHex(total.digest());
        assertEquals(digest, values.getProperty("digest"));
        String commit = BuildInfo.current().commit();
        assertEquals((commit.equals("unknown") ? "dev" : commit) + "-" + digest, values.getProperty("token"));
        assertTrue(values.getProperty("token").matches("(?:[0-9a-f]{40}|dev)-[0-9a-f]{64}"));
    }

    @Test void allElevenGeneratedPagesChangeOnlyFirstPartyResourceUrls() throws Exception {
        String token = assetProperties().getProperty("token");
        List<Path> pages;
        try (var files = Files.walk(WEB)) {
            pages = files.filter(file -> file.toString().endsWith(".html")).sorted().toList();
        }
        assertEquals(11, pages.size());
        int firstParty = 0;
        int vendor = 0;
        for (Path page : pages) {
            String source = Files.readString(page);
            var references = REFERENCE.matcher(source);
            StringBuilder expected = new StringBuilder();
            while (references.find()) {
                String url = references.group(2);
                String replacement = references.group();
                if (isFirstParty(url)) {
                    firstParty++;
                    replacement = replacement.replace(url, versioned(url, token));
                } else if (url.startsWith("assets/vendor/")) {
                    vendor++;
                }
                references.appendReplacement(expected, java.util.regex.Matcher.quoteReplacement(replacement));
            }
            references.appendTail(expected);
            Path generated = GENERATED.resolve(WEB.relativize(page));
            assertEquals(expected.toString(), Files.readString(generated), page + ": unrelated markup changed or resource missed");
            assertFalse(source.contains("?v="), page + ": build must not modify source HTML");
        }
        assertEquals(84, firstParty, "Every first-party resource reference must be versioned.");
        assertEquals(32, vendor, "Vendor URL references must remain unchanged.");
    }

    private static Properties assetProperties() throws Exception {
        Properties values = new Properties();
        try (InputStream input = AssetVersionBuildTest.class.getResourceAsStream("/asset-version.properties")) {
            assertNotNull(input, "Maven generate-resources must generate asset metadata.");
            values.load(input);
        }
        return values;
    }

    private static List<Path> assetFiles() throws Exception {
        try (var files = Files.walk(WEB)) {
            return files.filter(Files::isRegularFile)
                    .filter(file -> relative(file).matches("(?:assets/js/.*\\.js|assets/css/.*\\.css|admin/[^/]+\\.(?:js|css)|i18n/[^/]+\\.json)"))
                    .sorted((a, b) -> relative(a).compareTo(relative(b))).toList();
        }
    }

    private static String relative(Path file) {
        return WEB.relativize(file).toString().replace('\\', '/');
    }

    private static boolean isFirstParty(String url) {
        return url.split("[?#]", 2)[0].matches("(?:assets/(?:js|css)/.*|admin/[^/]+)\\.(?:js|css)");
    }

    private static String versioned(String url, String token) {
        int fragment = url.indexOf('#');
        String resource = fragment < 0 ? url : url.substring(0, fragment);
        return resource + (resource.contains("?") ? "&amp;" : "?") + "v=" + token
                + (fragment < 0 ? "" : url.substring(fragment));
    }
}
