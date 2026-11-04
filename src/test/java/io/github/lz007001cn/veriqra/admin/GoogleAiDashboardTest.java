package io.github.lz007001cn.veriqra.admin;

import com.fasterxml.jackson.databind.*;
import io.github.lz007001cn.veriqra.config.AiConfig;
import io.github.lz007001cn.veriqra.service.ai.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.*;
import java.util.*;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class GoogleAiDashboardTest {
    @TempDir Path directory;
    private final ObjectMapper json = new ObjectMapper();
    private final Clock clock = Clock.fixed(Instant.parse("2026-11-03T00:00:00Z"), ZoneOffset.UTC);
    private AiSettingsManager settings() { return new AiSettingsManager(new AiConfig("demo-project", "global", "gemini-3.8-flash", "never-read.json"), directory.resolve("settings.properties")); }
    private JsonNode node(String text) { try { return json.readTree(text); } catch (Exception e) { throw new AssertionError(e); } }
    private JsonNode base(URI uri) {
        String host = uri.getHost(), path = uri.getPath();
        if (host.equals("cloudresourcemanager.googleapis.com")) return node("{\"projectNumber\":\"12345\"}");
        if (host.equals("cloudbilling.googleapis.com")) return node("{\"billingEnabled\":true}");
        if (host.equals("serviceusage.googleapis.com")) return node("{\"metrics\":[]}");
        throw new AssertionError("Unexpected request " + host + path);
    }
    @SuppressWarnings("unchecked") private static Map<String,Object> section(Map<String,Object> data, String name) { return (Map<String,Object>)data.get(name); }
    private static Map<String,String> query(URI uri) {
        Map<String,String> values = new HashMap<>();
        for (String pair : uri.getRawQuery().split("&")) {
            String[] parts = pair.split("=",2);
            values.put(URLDecoder.decode(parts[0],StandardCharsets.UTF_8),URLDecoder.decode(parts[1],StandardCharsets.UTF_8));
        }
        return values;
    }

    @Test void monitoringSumsAllPagesAndKeepsTokenGroupsWithoutInventingRemainingBalance() {
        var seen = new ConcurrentLinkedQueue<URI>();
        var dashboard = new GoogleAiDashboard(uri -> {
            seen.add(uri);
            if (!uri.getHost().equals("monitoring.googleapis.com")) return base(uri);
            Map<String,String> q = query(uri);
            assertTrue(q.get("filter").contains("resource.labels.model_user_id=\"gemini-3.8-flash\""));
            assertFalse(q.get("filter").contains("location=\"global\""));
            assertEquals("2026-11-02T00:00:00Z",q.get("interval.startTime"));
            assertEquals("ALIGN_SUM",q.get("aggregation.perSeriesAligner"));
            if (q.get("filter").contains("model_invocation_count")) {
                if (q.containsKey("pageToken")) return node("{\"timeSeries\":[{\"points\":[{\"value\":{\"int64Value\":\"3\"}}]}]}");
                return node("{\"timeSeries\":[{\"points\":[{\"value\":{\"int64Value\":\"2\"}}]}],\"nextPageToken\":\"next page/+\"}");
            }
            assertEquals("metric.labels.type",q.get("aggregation.groupByFields"));
            return node("{\"timeSeries\":[{\"metric\":{\"labels\":{\"type\":\"input\"}},\"points\":[{\"value\":{\"int64Value\":\"100\"}}]},{\"metric\":{\"labels\":{\"type\":\"output\"}},\"points\":[{\"value\":{\"int64Value\":\"20\"}}]}]}");
        },clock);
        Map<String,Object> data = dashboard.refresh(settings().get());
        assertEquals("CONNECTED",section(data,"connection").get("status"));
        Map<String,Object> usage = section(data,"usage");
        assertEquals(5L,usage.get("requests")); assertEquals(100L,usage.get("inputTokens"));
        assertEquals(20L,usage.get("outputTokens")); assertEquals(120L,usage.get("totalTokens"));
        assertNull(section(data,"quotas").get("remaining"));
        assertNull(section(data,"billing").get("remainingCredit"));
        assertEquals("CONSOLE_ONLY",section(data,"billing").get("creditStatus"));
        assertTrue(seen.stream().anyMatch(uri -> uri.getRawQuery()!=null && uri.getRawQuery().contains("next%20page%2F%2B")));
    }

    @Test void quotaUsesEffectiveLimitsDimensionsAndFiltersUnrelatedModels() {
        var dashboard = new GoogleAiDashboard(uri -> {
            if (uri.getHost().equals("monitoring.googleapis.com")) return node("{}");
            if (!uri.getHost().equals("serviceusage.googleapis.com")) return base(uri);
            assertEquals("FULL",query(uri).get("view"));
            return node("""
                {"metrics":[{"metric":"aiplatform.googleapis.com/generate_content_requests_per_minute","displayName":"Requests","consumerQuotaLimits":[{"unit":"1/min/{project}","quotaBuckets":[{"effectiveLimit":"-1","dimensions":{"base_model":"gemini-3.8-flash","region":"global"}},{"effectiveLimit":"99","dimensions":{"base_model":"other-model"}}]}]},{"metric":"aiplatform.googleapis.com/embedding_tokens_per_minute","consumerQuotaLimits":[{"quotaBuckets":[{"effectiveLimit":"100"}]}]}]}
                """);
        },clock);
        Map<String,Object> quota = section(dashboard.refresh(settings().get()),"quotas");
        assertEquals("OK",quota.get("status")); assertEquals("SHARED_PAYGO",quota.get("capacityMode"));
        List<?> items=(List<?>)quota.get("items"); assertEquals(1,items.size());
        assertEquals("-1",((Map<?,?>)items.getFirst()).get("value")); assertNull(quota.get("remaining"));
    }

    @Test void quotaExcludesOtherApiFamiliesMediaAndUnusedRequestTiers() {
        var response = json.createObjectNode();
        var metrics = response.putArray("metrics");
        var relevant = List.of("global_generate_content_requests_per_minute_per_project_per_base_model",
                "global_generate_content_input_tokens_per_minute_per_base_model",
                "online_prediction_requests_per_base_model", "online_prediction_request_throughput");
        var unrelated = List.of("eu_multi_region_responses_delete_response_requests_per_minute_per_project",
                "global_responses_get_response_requests_per_minute_per_project",
                "online_prediction_web_search_requests_per_publisher", "generate_content_document_input_per_base_model_id_and_resolution",
                "generate_content_video_input_per_base_model_id_and_resolution", "long_running_online_prediction_requests_per_base_model",
                "flex_requests_per_minute_per_project_per_base_model", "shared_generate_content_multimodal_per_mimetype_per_base_model");
        var names = new ArrayList<>(relevant); names.addAll(unrelated);
        for (String name : names) {
            var metric = metrics.addObject().put("metric", "aiplatform.googleapis.com/" + name);
            metric.putArray("consumerQuotaLimits").addObject().put("unit", "1/min/{project}")
                    .putArray("quotaBuckets").addObject().put("effectiveLimit", "100");
        }
        var dashboard = new GoogleAiDashboard(uri -> {
            if (uri.getHost().equals("monitoring.googleapis.com")) return node("{}");
            return uri.getHost().equals("serviceusage.googleapis.com") ? response : base(uri);
        }, clock);
        List<?> items = (List<?>) section(dashboard.refresh(settings().get()), "quotas").get("items");
        assertEquals(relevant.stream().map(name -> "aiplatform.googleapis.com/" + name).toList(),
                items.stream().map(item -> ((Map<?,?>) item).get("quotaId")).toList());
    }

    @Test void quotaKeepsGoogleDefaultAndRegionalBucketsButExcludesOtherPublishers() {
        var dashboard = new GoogleAiDashboard(uri -> {
            if (uri.getHost().equals("monitoring.googleapis.com")) return node("{}");
            if (!uri.getHost().equals("serviceusage.googleapis.com")) return base(uri);
            return node("""
                {"metrics":[{"metric":"aiplatform.googleapis.com/online_prediction_requests_per_base_model","consumerQuotaLimits":[{"unit":"1/min/{project}/{region}","quotaBuckets":[
                {"effectiveLimit":"-1","dimensions":{}},
                {"effectiveLimit":"11","dimensions":{"publisher":"google","base_model":"gemini-3.8-flash","region":"us-central1"}},
                {"effectiveLimit":"12","dimensions":{"publisher":"google","base_model":"gemini-3.8-flash","region":"europe-west1"}},
                {"effectiveLimit":"13","dimensions":{"publisher":"*","base_model":"*","region":"global"}},
                {"effectiveLimit":"14","dimensions":{"publisher":"anthropic","region":"us-central1"}},
                {"effectiveLimit":"15","dimensions":{"publisher":"openai","region":"global"}},
                {"effectiveLimit":"16","dimensions":{"publisher":"google","base_model":"another-model","region":"us-central1"}}
                ]}]}]}
                """);
        }, clock);
        List<?> items = (List<?>) section(dashboard.refresh(settings().get()), "quotas").get("items");
        assertEquals(List.of("-1", "11", "12", "13"), items.stream().map(item -> ((Map<?,?>) item).get("value")).toList());
    }

    @Test void noObservationStaysNullWhileObservedZeroIsPreserved() {
        var empty = new GoogleAiDashboard(uri -> uri.getHost().equals("monitoring.googleapis.com") ? node("{}") : base(uri),clock);
        Map<String,Object> usage = section(empty.refresh(settings().get()),"usage");
        assertEquals("NO_DATA",usage.get("status")); assertNull(usage.get("requests")); assertNull(usage.get("totalTokens"));
        var zero = new GoogleAiDashboard(uri -> {
            if (!uri.getHost().equals("monitoring.googleapis.com")) return base(uri);
            if (query(uri).get("filter").contains("model_invocation_count")) return node("{}");
            return node("{\"timeSeries\":[{\"metric\":{\"labels\":{\"type\":\"input\"}},\"points\":[{\"value\":{\"int64Value\":\"0\"}}]}]}");
        },clock);
        usage=section(zero.refresh(settings().get()),"usage");
        assertEquals(0L,usage.get("inputTokens")); assertNull(usage.get("outputTokens")); assertNull(usage.get("requests"));
    }

    @Test void tokenPermissionFailurePreservesKnownRequestsAndOtherSections() {
        var dashboard=new GoogleAiDashboard(uri -> {
            if (!uri.getHost().equals("monitoring.googleapis.com")) return base(uri);
            if (query(uri).get("filter").contains("token_count")) throw new GoogleApiException(403,"PERMISSION_DENIED");
            return node("{\"timeSeries\":[{\"points\":[{\"value\":{\"int64Value\":\"4\"}}]}]}");
        },clock);
        var data=dashboard.refresh(settings().get()); var usage=section(data,"usage");
        assertEquals("PARTIAL",usage.get("status")); assertEquals(4L,usage.get("requests")); assertNull(usage.get("totalTokens"));
        assertEquals(true,section(data,"billing").get("billingEnabled"));
    }

    @Test void invalidProjectNumberNeverBecomesAQuotaResourcePath() {
        var quotaCalls=new AtomicInteger();
        var dashboard=new GoogleAiDashboard(uri -> {
            if (uri.getHost().equals("cloudresourcemanager.googleapis.com")) return node("{\"projectNumber\":\"wrong/value\"}");
            if (uri.getHost().equals("serviceusage.googleapis.com")) { quotaCalls.incrementAndGet(); throw new AssertionError(); }
            if (uri.getHost().equals("monitoring.googleapis.com")) return node("{}");
            return base(uri);
        },clock);
        var data=dashboard.refresh(settings().get()); assertEquals(0,quotaCalls.get());
        assertEquals("INVALID_RESPONSE",section(data,"quotas").get("code"));
        assertEquals("OK",section(data,"billing").get("status"));
    }

    @Test void permissionsAndDisabledApisRemainIndependentAndNeverBecomeZero() {
        var dashboard=new GoogleAiDashboard(uri -> {
            if (uri.getHost().equals("monitoring.googleapis.com")) throw new GoogleApiException(403,"SERVICE_DISABLED");
            if (uri.getHost().equals("serviceusage.googleapis.com")) throw new GoogleApiException(403,"PERMISSION_DENIED");
            return base(uri);
        },clock);
        var data=dashboard.refresh(settings().get());
        assertEquals("API_DISABLED",section(data,"usage").get("status"));
        assertEquals("PERMISSION_DENIED",section(data,"quotas").get("status"));
        assertEquals("OK",section(data,"billing").get("status")); assertNull(section(data,"billing").get("remainingCredit"));
    }

    @Test void repeatedPaginationTokenDoesNotReturnAnApparentlyCompleteTotal() {
        var dashboard=new GoogleAiDashboard(uri -> uri.getHost().equals("monitoring.googleapis.com")
                ? node("{\"nextPageToken\":\"again\",\"timeSeries\":[{\"points\":[{\"value\":{\"int64Value\":\"1\"}}]}]}") : base(uri),clock);
        var usage=section(dashboard.refresh(settings().get()),"usage");
        assertEquals("INCOMPLETE_DATA",usage.get("code")); assertNull(usage.get("requests")); assertNull(usage.get("totalTokens"));
    }

    @Test void cacheIsBoundToSavedModelRevisionAndUnconfiguredNeverCallsGoogle() {
        var calls=new AtomicInteger();
        var dashboard=new GoogleAiDashboard(uri -> { calls.incrementAndGet(); return uri.getHost().equals("monitoring.googleapis.com") ? node("{}") : base(uri); },clock);
        var settings=settings(); var first=dashboard.refresh(settings.get()); int count=calls.get();
        assertSame(first,dashboard.refresh(settings.get())); assertEquals(count,calls.get());
        settings.update("gemini-3.5-flash-lite",settings.get().revision());
        assertNotSame(first,dashboard.refresh(settings.get())); assertTrue(calls.get()>count);
        var noConfig = new AiSettingsManager(new AiConfig(null,"global","gemini-3.8-flash",null),directory.resolve("none.properties"));
        var offline = new GoogleAiDashboard(uri -> { throw new AssertionError("No credentials means no request"); },clock).refresh(noConfig.get());
        assertEquals("NOT_CONFIGURED",section(offline,"connection").get("status")); assertNull(section(offline,"usage").get("requests"));
    }
}
