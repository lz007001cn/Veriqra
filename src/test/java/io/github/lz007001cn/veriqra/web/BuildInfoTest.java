package io.github.lz007001cn.veriqra.web;

import org.junit.jupiter.api.Test;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import static org.junit.jupiter.api.Assertions.*;

class BuildInfoTest {
    @Test void filteredBuildMetadataIsSafeAndHasUtcTime() {
        BuildInfo info = BuildInfo.current();
        assertTrue(info.version().matches("[0-9]+\\.[0-9]+\\.[0-9]+(?:-SNAPSHOT)?"), info.version());
        assertTrue(info.commit().equals("unknown") || info.commit().matches("[0-9a-f]{40}"), info.commit());
        if (!info.buildTime().equals("unknown")) assertDoesNotThrow(() -> Instant.parse(info.buildTime()));
    }

    @Test void missingOrUnresolvedMetadataFallsBackWithoutLeakingArbitraryValues() throws Exception {
        assertEquals(new BuildInfo("unknown", "unknown", "unknown"), BuildInfo.load(null));
        var source = "version=${project.version}\ncommit=${git.commit.id.full}\nbuildTime=${maven.build.timestamp}\nsecret=never-expose\n";
        var info = BuildInfo.load(new ByteArrayInputStream(source.getBytes(StandardCharsets.UTF_8)));
        assertEquals("unknown", info.version());
        assertEquals("unknown", info.commit());
        assertEquals("unknown", info.buildTime());
        assertFalse(info.toString().contains("never-expose"));
        var valid = BuildInfo.load(new ByteArrayInputStream(("version=0.1.0-SNAPSHOT\ncommit="
                + "a".repeat(40) + "\nbuildTime=2026-09-29T03:12:43Z\n").getBytes(StandardCharsets.UTF_8)));
        assertEquals("a".repeat(40), valid.commit());
        assertEquals(Instant.parse("2026-09-29T03:12:43Z"), Instant.parse(valid.buildTime()));
    }
}
