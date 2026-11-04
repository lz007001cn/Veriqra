package io.github.lz007001cn.veriqra.admin;

import com.fasterxml.jackson.databind.JsonNode;
import io.github.lz007001cn.veriqra.service.ai.AiSettingsManager;
import io.github.lz007001cn.veriqra.service.ai.GoogleApiException;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;

/** Read-only Google project telemetry. Missing observations never become a fabricated zero balance. */
public final class GoogleAiDashboard {
    public static final String ATTRIBUTE = GoogleAiDashboard.class.getName();
    @FunctionalInterface public interface Reader { JsonNode get(URI uri); }
    private record Cached(String key, Instant fetchedAt, Map<String,Object> data) { }
    private final Reader reader;
    private final Clock clock;
    private Cached cached;
    private static final String METRIC_PREFIX = "aiplatform.googleapis.com/publisher/online_serving/";
    private static final String CAPACITY = "SHARED_PAYGO";
    private static final int MAX_PAGES = 8;

    public GoogleAiDashboard(Reader reader, Clock clock) {
        this.reader = Objects.requireNonNull(reader); this.clock = Objects.requireNonNull(clock);
    }

    public synchronized Map<String,Object> refresh(AiSettingsManager.Settings settings) {
        Instant now = clock.instant();
        long deadline = System.nanoTime() + Duration.ofSeconds(25).toNanos();
        String key = settings.project() + ":" + settings.location() + ":" + settings.model() + ":" + settings.revision();
        if (cached != null && cached.key().equals(key)
                && Duration.between(cached.fetchedAt(), now).compareTo(Duration.ofSeconds(30)) < 0) return cached.data();
        Map<String,Object> result = map("checkedAt", now, "project", settings.project(), "location", settings.location(),
                "model", settings.model(), "revision", settings.revision());
        if (!settings.configured()) {
            result.put("connection", unavailable("NOT_CONFIGURED"));
            result.put("usage", usageUnavailable("NOT_CONFIGURED", now));
            result.put("quotas", quotaUnavailable("NOT_CONFIGURED"));
            result.put("billing", billingUnavailable("NOT_CONFIGURED"));
            return result;
        }
        Map<String,Object> connection;
        String number = null;
        try {
            JsonNode project = reader.get(uri("https://cloudresourcemanager.googleapis.com/v1/projects/" + segment(settings.project()), Map.of()));
            String candidate = project.path("projectNumber").asText();
            if (!candidate.matches("[0-9]+")) throw new GoogleApiException(502, "INVALID_RESPONSE");
            number = candidate;
            connection = map("status", "CONNECTED", "code", null);
        } catch (GoogleApiException failure) {
            connection = error(failure);
        }
        result.put("connection", connection);
        final String projectNumber = number;
        final String projectFailure = Objects.toString(connection.get("code"), "PROJECT_NUMBER_UNAVAILABLE");
        // These sections have independent permissions. One denied API must not hide successful reads from another.
        try (var tasks = Executors.newVirtualThreadPerTaskExecutor()) {
            Future<Map<String,Object>> usage = tasks.submit(() -> usage(settings, now));
            Future<Map<String,Object>> quotas = tasks.submit(() -> projectNumber == null
                    ? quotaUnavailable(projectFailure)
                    : quotas(settings, projectNumber));
            Future<Map<String,Object>> billing = tasks.submit(() -> billing(settings.project()));
            result.put("usage", await(usage, usageUnavailable("TIMEOUT", now), deadline));
            result.put("quotas", await(quotas, quotaUnavailable("TIMEOUT"), deadline));
            result.put("billing", await(billing, billingUnavailable("TIMEOUT"), deadline));
        }
        cached = new Cached(key, now, Collections.unmodifiableMap(result));
        return cached.data();
    }

    private Map<String,Object> usage(AiSettingsManager.Settings settings, Instant end) {
        Map<String,Object> result = usageUnavailable("NO_DATA", end);
        result.put("scope", "GOOGLE_PROJECT_CURRENT_MODEL_ALL_LOCATIONS");
        String failureCode = null;
        try {
            List<JsonNode> requests = series(settings, "model_invocation_count", end, false);
            result.put("requests", total(requests));
        } catch (GoogleApiException failure) { failureCode = failure.code(); }
        try {
            List<JsonNode> tokens = series(settings, "token_count", end, true);
            Long input = null, output = null, total = total(tokens);
            for (JsonNode series : tokens) {
                String type = series.path("metric").path("labels").path("type").asText();
                Long count = total(List.of(series));
                if (type.equals("input")) input = add(input, count);
                else if (type.equals("output")) output = add(output, count);
            }
            result.put("inputTokens", input);
            result.put("outputTokens", output); result.put("totalTokens", total);
        } catch (GoogleApiException failure) { if (failureCode == null) failureCode = failure.code(); }
        boolean observed = result.get("requests") != null || result.get("totalTokens") != null;
        result.put("status", failureCode == null ? observed ? "OK" : "NO_DATA" : observed ? "PARTIAL" : status(failureCode));
        result.put("code", failureCode);
        return result;
    }

    private List<JsonNode> series(AiSettingsManager.Settings settings, String metric, Instant end, boolean types) {
        Map<String,String> query = new LinkedHashMap<>();
        query.put("filter", "metric.type=\"" + METRIC_PREFIX + metric + "\" AND resource.type=\"aiplatform.googleapis.com/PublisherModel\""
                + " AND resource.labels.publisher=\"google\" AND resource.labels.model_user_id=\"" + settings.model() + "\"");
        query.put("interval.startTime", end.minus(Duration.ofHours(24)).toString());
        query.put("interval.endTime", end.toString()); query.put("view", "FULL");
        query.put("aggregation.alignmentPeriod", "60s"); query.put("aggregation.perSeriesAligner", "ALIGN_SUM");
        query.put("aggregation.crossSeriesReducer", "REDUCE_SUM"); query.put("pageSize", "1000");
        if (types) query.put("aggregation.groupByFields", "metric.labels.type");
        return pages("https://monitoring.googleapis.com/v3/projects/" + segment(settings.project()) + "/timeSeries", query, "timeSeries");
    }

    private Map<String,Object> quotas(AiSettingsManager.Settings settings, String number) {
        Map<String,Object> result = quotaUnavailable("NO_DATA");
        try {
            List<JsonNode> metrics = pages("https://serviceusage.googleapis.com/v1beta1/projects/" + number
                    + "/services/aiplatform.googleapis.com/consumerQuotaMetrics", Map.of("view", "FULL", "pageSize", "200"), "metrics");
            List<Map<String,Object>> items = new ArrayList<>();
            for (JsonNode metric : metrics) {
                String name = metric.path("metric").asText();
                if (!textGenerationQuota(name)) continue;
                for (JsonNode limit : metric.path("consumerQuotaLimits")) for (JsonNode bucket : limit.path("quotaBuckets")) {
                    Map<String,String> dimensions = new LinkedHashMap<>();
                    bucket.path("dimensions").fields().forEachRemaining(field -> dimensions.put(field.getKey(), field.getValue().asText()));
                    if (dimensions.entrySet().stream().anyMatch(entry -> entry.getKey().toLowerCase(Locale.ROOT).contains("publisher")
                            && !entry.getValue().equalsIgnoreCase("google") && !entry.getValue().equals("*"))) continue;
                    if (dimensions.entrySet().stream().anyMatch(entry -> entry.getKey().contains("model")
                            && !entry.getValue().equals(settings.model()) && !entry.getValue().equals("*"))) continue;
                    String region = dimensions.getOrDefault("region", dimensions.getOrDefault("location", ""));
                    if (!settings.location().equals("global") && !region.isEmpty() && !region.equals(settings.location()) && !region.equals("global")) continue;
                    String value = bucket.path("effectiveLimit").isValueNode() ? bucket.path("effectiveLimit").asText() : null;
                    if (value != null && !value.matches("-?[0-9]+")) value = null;
                    items.add(map("name", metric.path("displayName").asText(name), "quotaId", name,
                            "value", value, "unit", limit.path("unit").asText(), "dimensions", dimensions));
                }
            }
            result.put("status", items.isEmpty() ? "NO_DATA" : "OK"); result.put("code", null); result.put("items", items);
        } catch (GoogleApiException failure) { result.putAll(error(failure)); }
        return result;
    }

    private static boolean textGenerationQuota(String metric) {
        String lower = metric.toLowerCase(Locale.ROOT);
        // Veriqra sends ordinary Google generateContent text requests, without tools or media input.
        // Service Usage also returns other publishers, API families, and request tiers for this service.
        if (List.of("embed", "image", "audio", "video", "document", "multimodal", "batch", "tuning",
                "responses", "long_running", "flex_", "web_search", "grounding").stream().anyMatch(lower::contains)) return false;
        return lower.contains("generate_content") || lower.contains("online_prediction") || lower.contains("publisher")
                || lower.contains("tokens_per_minute") || lower.contains("requests_per_minute");
    }

    private Map<String,Object> billing(String project) {
        Map<String,Object> result = billingUnavailable("NO_DATA");
        try {
            JsonNode info = reader.get(uri("https://cloudbilling.googleapis.com/v1/projects/" + segment(project) + "/billingInfo", Map.of()));
            if (!info.path("billingEnabled").isBoolean()) throw new GoogleApiException(502, "INVALID_RESPONSE");
            String name = info.path("billingAccountName").asText();
            result.put("status", "OK"); result.put("code", null);
            result.put("billingEnabled", info.path("billingEnabled").asBoolean());
            if (name.matches("billingAccounts/[A-Z0-9-]+")) {
                result.put("billingAccountName", name);
                try {
                    JsonNode account = reader.get(uri("https://cloudbilling.googleapis.com/v1/" + name, Map.of()));
                    result.put("displayName", account.path("displayName").asText(null));
                    result.put("currencyCode", account.path("currencyCode").asText(null));
                    result.put("accountStatus", "OK");
                } catch (GoogleApiException failure) { result.put("accountStatus", status(failure.code())); }
            }
        } catch (GoogleApiException failure) { result.putAll(error(failure)); }
        return result;
    }

    private List<JsonNode> pages(String url, Map<String,String> initial, String field) {
        Map<String,String> query = new LinkedHashMap<>(initial);
        List<JsonNode> result = new ArrayList<>(); Set<String> seen = new HashSet<>();
        for (int page = 0; page < MAX_PAGES; page++) {
            JsonNode body = reader.get(uri(url, query));
            if (!body.isObject() || body.has("error") || body.has(field) && !body.path(field).isArray()) throw new GoogleApiException(502, "INVALID_RESPONSE");
            body.path(field).forEach(result::add);
            String next = body.path("nextPageToken").asText();
            if (next.isEmpty()) return result;
            if (!seen.add(next)) throw new GoogleApiException(502, "INCOMPLETE_DATA");
            query.put("pageToken", next);
        }
        throw new GoogleApiException(502, "INCOMPLETE_DATA");
    }
    private static Long total(List<JsonNode> series) {
        Long sum = null;
        for (JsonNode item : series) for (JsonNode point : item.path("points")) {
            JsonNode number = point.path("value").path("int64Value");
            if (number.isMissingNode()) continue;
            try {
                long value = Long.parseLong(number.asText());
                if (value < 0) throw new NumberFormatException();
                sum = sum == null ? value : Math.addExact(sum, value);
            } catch (NumberFormatException | ArithmeticException invalid) { throw new GoogleApiException(502, "INVALID_RESPONSE"); }
        }
        return sum;
    }
    private static Long add(Long first, Long second) {
        if (second == null) return first; if (first == null) return second;
        try { return Math.addExact(first, second); } catch (ArithmeticException invalid) { throw new GoogleApiException(502, "INVALID_RESPONSE"); }
    }
    public static Map<String,Object> links(String project) {
        String query = "?project=" + segment(Objects.toString(project, ""));
        return map("vertex", "https://console.cloud.google.com/vertex-ai" + query,
                "quotas", "https://console.cloud.google.com/apis/api/aiplatform.googleapis.com/quotas" + query,
                "billing", "https://console.cloud.google.com/billing" + query,
                "credits", "https://console.cloud.google.com/billing/credits" + query);
    }
    private static Map<String,Object> usageUnavailable(String code, Instant now) {
        return map("status", status(code), "code", code, "source", "GOOGLE_MONITORING",
                "windowStart", now.minus(Duration.ofHours(24)), "windowEnd", now,
                "requests", null, "inputTokens", null, "outputTokens", null, "totalTokens", null);
    }
    private static Map<String,Object> quotaUnavailable(String code) {
        return map("status", status(code), "code", code, "capacityMode", CAPACITY, "items", List.of(), "remaining", null);
    }
    private static Map<String,Object> billingUnavailable(String code) {
        return map("status", status(code), "code", code, "billingEnabled", null, "billingAccountName", null,
                "displayName", null, "currencyCode", null, "remainingCredit", null,
                "creditStatus", "CONSOLE_ONLY", "costStatus", "EXPORT_REQUIRED");
    }
    private static Map<String,Object> unavailable(String code) { return map("status", status(code), "code", code); }
    private static Map<String,Object> error(GoogleApiException failure) { return unavailable(failure.code()); }
    private static String status(String code) {
        return switch (code) {
            case "NOT_CONFIGURED", "NO_DATA" -> code;
            case "SERVICE_DISABLED", "API_DISABLED" -> "API_DISABLED";
            case "PERMISSION_DENIED", "IAM_PERMISSION_DENIED", "ACCESS_TOKEN_SCOPE_INSUFFICIENT", "PROJECT_NUMBER_UNAVAILABLE" -> "PERMISSION_DENIED";
            default -> "UNAVAILABLE";
        };
    }
    private static Map<String,Object> await(Future<Map<String,Object>> future, Map<String,Object> fallback, long deadline) {
        try { return future.get(Math.max(1, deadline-System.nanoTime()), TimeUnit.NANOSECONDS); }
        catch (InterruptedException interrupted) { future.cancel(true); Thread.currentThread().interrupt(); return fallback; }
        catch (TimeoutException timeout) { future.cancel(true); return fallback; }
        catch (ExecutionException failure) { return fallback; }
    }
    private static String segment(String value) { return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20"); }
    private static URI uri(String url, Map<String,String> query) {
        if (query.isEmpty()) return URI.create(url);
        StringJoiner params = new StringJoiner("&"); query.forEach((key,value) -> params.add(segment(key) + "=" + segment(value)));
        return URI.create(url + "?" + params);
    }
    private static Map<String,Object> map(Object... entries) {
        Map<String,Object> result = new LinkedHashMap<>();
        for (int i=0; i<entries.length; i+=2) result.put((String)entries[i], entries[i+1]);
        return result;
    }
}
