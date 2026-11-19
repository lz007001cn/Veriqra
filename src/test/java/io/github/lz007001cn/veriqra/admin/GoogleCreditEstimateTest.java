package io.github.lz007001cn.veriqra.admin;

import java.math.BigDecimal;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Properties;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class GoogleCreditEstimateTest {
    private static final Instant AFTER_SNAPSHOT = Instant.parse("2026-11-16T17:05:00Z");

    @Test void pricesPostSnapshotTokensInTheSameProjectAndCurrency() {
        var requests = new ArrayList<java.net.URI>();
        var dashboard = new GoogleAiDashboard(uri -> {
            requests.add(uri);
            if (uri.getHost().equals("monitoring.googleapis.com")) return json("""
                    {"timeSeries":[
                       {"resource":{"labels":{"model_user_id":"gemini-4-argon"}},"metric":{"labels":{"type":"input"}},"points":[{"value":{"int64Value":"20000"}}]},
                       {"resource":{"labels":{"model_user_id":"gemini-4-argon"}},"metric":{"labels":{"type":"output"}},"points":[{"value":{"int64Value":"8000"}}]}
                    ]}
                    """);
            return uri.getPath().contains("3BAE-62B7-C9B9") ? price("5", 131000000) : price("25", 655000000);
        }, Clock.systemUTC());
        var actual = dashboard.estimateCredits("test-project", GoogleCreditEstimate.baseline(snapshot(), "test-project"), AFTER_SNAPSHOT);
        assertEquals("OK", actual.status());
        assertEquals(new BigDecimal("375.21"), actual.remaining());
        assertEquals(new BigDecimal("0.30786"), actual.estimatedSpend().stripTrailingZeros());
        assertEquals(20000L, actual.inputTokens());
        assertEquals(8000L, actual.outputTokens());
        assertEquals(Instant.parse("2026-11-16T16:00:00Z"), actual.usageStart());
        assertTrue(requests.getFirst().getQuery().contains("interval.startTime=2026-11-16T16:00:00Z"));
        assertTrue(requests.getFirst().getQuery().contains("metric.labels.source=\"global\""));
        assertFalse(requests.getFirst().getQuery().contains("resource.labels.model_user_id="));
        assertTrue(requests.stream().skip(1).allMatch(uri -> uri.getQuery().equals("currencyCode=SGD")));
    }

    @Test void emptyTelemetryShowsTheBaselineAndDoesNotInventTokenCounts() {
        var data = snapshot();
        assertNull(GoogleCreditEstimate.baseline(data, "another-project"));
        var baseline = GoogleCreditEstimate.baseline(data, "test-project");
        var dashboard = new GoogleAiDashboard(uri -> uri.getHost().equals("monitoring.googleapis.com")
                ? json("{}") : price("5", 131000000), Clock.systemUTC());
        var estimate = dashboard.estimateCredits("test-project", baseline, AFTER_SNAPSHOT);
        assertEquals("NO_DATA", estimate.status());
        assertEquals(new BigDecimal("375.52"), estimate.remaining());
        assertNull(estimate.inputTokens());
        assertNull(estimate.estimatedSpend());
        assertNull(baseline.reply("PARTIAL", AFTER_SNAPSHOT, java.util.List.of(
                GoogleCreditEstimate.ModelCharge.from("gemini-4-carbon", 50L, null, BigDecimal.ONE, null))).remaining());
        assertEquals(new BigDecimal("0.00"),
                baseline.reply("OK", AFTER_SNAPSHOT, java.util.List.of(GoogleCreditEstimate.ModelCharge.from(
                        "gemini-4-carbon", 1_000_000L, 1_000_000L, new BigDecimal("300.00"), new BigDecimal("300.00")))).remaining());
    }

    @Test void chargesCarbonAndHydrogenAtTheirOwnRatesAcrossPages() {
        var baseline = GoogleCreditEstimate.baseline(snapshot(), "test-project");
        var dashboard = new GoogleAiDashboard(uri -> {
            if (uri.getHost().equals("monitoring.googleapis.com")) {
                if (uri.getQuery().contains("pageToken=next")) {
                    return json("{\"timeSeries\":[" + series("gemini-4-carbon","output",1000) + ","
                            + series("gemini-4-hydrogen","input",2000) + "]}");
                }
                return json("{\"nextPageToken\":\"next\",\"timeSeries\":[" + series("gemini-4-carbon","input",1000) + ","
                        + series("gemini-4-hydrogen","output",1000) + "," + series("gemini-4-carbon","input",1000) + "]}");
            }
            return switch (uri.getPath().split("/")[3]) {
                case "C47F-BE66-1A4E" -> price("5",131000000);
                case "1B77-85A0-B300" -> price("25",655000000);
                case "F4D7-3BA1-107D" -> price("1",924125000);
                case "E576-C50D-41EF" -> price("9",620625000);
                default -> throw new AssertionError("Unexpected SKU " + uri.getPath());
            };
        }, Clock.systemUTC());
        var estimate = dashboard.estimateCredits("test-project", baseline, AFTER_SNAPSHOT);
        assertEquals("OK", estimate.status());
        assertEquals(2, estimate.models().size());
        assertEquals(4000L, estimate.inputTokens());
        assertEquals(2000L, estimate.outputTokens());
        assertEquals(new BigDecimal("0.049385875"), estimate.estimatedSpend().stripTrailingZeros());
        assertEquals(new BigDecimal("375.47"), estimate.remaining());
    }

    @Test void unknownModelOrMissingMeasurementsKeepTheBalanceUnavailable() {
        var baseline = GoogleCreditEstimate.baseline(snapshot(), "test-project");
        var unknown = new GoogleAiDashboard(uri -> json("{\"timeSeries\":[" + series("gemini-next","input",100)
                + "," + series("gemini-next","output",25) + "]}"), Clock.systemUTC());
        var estimate = unknown.estimateCredits("test-project", baseline, AFTER_SNAPSHOT);
        assertEquals("PRICING_UNAVAILABLE", estimate.status());
        assertEquals("gemini-next", estimate.models().getFirst().model());
        assertNull(estimate.remaining());
        var partial = new GoogleAiDashboard(uri -> uri.getHost().equals("monitoring.googleapis.com")
                ? json("{\"timeSeries\":[" + series("gemini-4-hydrogen","input",100) + "]}") : price("1",0), Clock.systemUTC());
        var result = partial.estimateCredits("test-project", baseline, AFTER_SNAPSHOT);
        assertEquals("PARTIAL", result.status());
        assertNull(result.outputTokens());
        assertNull(result.remaining());
    }

    @Test void audioAndCachedInputsAreNotPricedAsStandardText() {
        var baseline = GoogleCreditEstimate.baseline(snapshot(), "test-project");
        for (String labels : java.util.List.of("\"modality\":\"AUDIO\"", "\"explicit_caching\":\"true\"")) {
            String extra = series("gemini-4-carbon", "input", 40).replace("\"type\":", labels + ",\"type\":");
            var dashboard = new GoogleAiDashboard(uri -> uri.getHost().equals("monitoring.googleapis.com")
                    ? json("{\"timeSeries\":[" + series("gemini-4-carbon","input",100) + "," + extra + ","
                        + series("gemini-4-carbon","output",80) + "]}") : price("1", 0), Clock.systemUTC());
            var estimate = dashboard.estimateCredits("test-project", baseline, AFTER_SNAPSHOT);
            assertEquals("PARTIAL", estimate.status());
            assertNull(estimate.remaining());
        }
    }

    private static String series(String model, String type, int tokens) {
        return """
                {"resource":{"labels":{"model_user_id":"%s"}},"metric":{"labels":{"type":"%s"}},
                "points":[{"value":{"int64Value":"%d"}}]}
                """.formatted(model, type, tokens);
    }

    private static Properties snapshot() {
        var data = new Properties();
        data.setProperty("project", "test-project");
        data.setProperty("currency", "SGD");
        data.setProperty("total", "383.45");
        data.setProperty("balance", "375.52");
        data.setProperty("baselineDate", "2026-11-16");
        data.setProperty("zone", "Asia/Singapore");
        data.setProperty("model", "gemini-4-argon");
        data.setProperty("inputSku", "3BAE-62B7-C9B9");
        data.setProperty("outputSku", "1E84-F91D-8B95");
        return data;
    }

    private static com.fasterxml.jackson.databind.JsonNode price(String units, int nanos) {
        return json("""
                {"rate":{"tiers":[{"startAmount":{"value":"0"},"listPrice":{"currencyCode":"SGD","units":"%s","nanos":%d}}],
                "unitInfo":{"unit":"count","unitQuantity":{"value":"1000000"}}}}
                """.formatted(units, nanos));
    }

    private static com.fasterxml.jackson.databind.JsonNode json(String value) {
        try { return new ObjectMapper().readTree(value); }
        catch (com.fasterxml.jackson.core.JsonProcessingException e) { throw new AssertionError(e); }
    }
}
