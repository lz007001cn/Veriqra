package io.github.lz007001cn.veriqra.admin;

import com.fasterxml.jackson.databind.JsonNode;
import io.github.lz007001cn.veriqra.config.EnvironmentVariables;
import java.io.IOException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.DateTimeException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Currency;
import java.util.List;
import java.util.Map;
import java.util.Properties;

/** Estimates charges after a dated Cloud Billing credits snapshot. */
public record GoogleCreditEstimate(String status, String currency, BigDecimal remaining, BigDecimal baseline,
        BigDecimal total, LocalDate baselineDate, Instant asOf, Instant usageStart, Long inputTokens,
        Long outputTokens, BigDecimal estimatedSpend, List<ModelCharge> models) {
    private static final String DEFAULT_PATH = "config/ai-credit-estimate.local.properties";
    record Skus(String input, String output) { }
    // Google Cloud SKU Groups / Gen AI Gemini Models, Vertex AI, Global standard online text.
    // Monetary rates are fetched from Cloud Billing, in the snapshot currency, on refresh.
    private static final Map<String, Skus> GLOBAL_TEXT_SKUS = Map.of(
            "gemini-4-hydrogen", new Skus("F4D7-3BA1-107D", "E576-C50D-41EF"),
            "gemini-4-carbon", new Skus("C47F-BE66-1A4E", "1B77-85A0-B300"),
            "gemini-4-argon", new Skus("3BAE-62B7-C9B9", "1E84-F91D-8B95"),
            "gemini-3.8-flash", new Skus("2A35-AC68-14D6", "90FD-DC5F-DC55"),
            "gemini-3.5-flash-lite", new Skus("255D-4FF7-8DB3", "EF3E-6ED9-3CD1"),
            "gemini-3.5-flash", new Skus("9733-FF95-45E3", "4E73-15BD-0D78"),
            "gemini-2.5-flash", new Skus("FDAB-647C-5A22", "AF56-1BF9-492A"));

    public record ModelCharge(String model, Long inputTokens, Long outputTokens, BigDecimal inputRate,
                              BigDecimal outputRate, BigDecimal estimatedSpend) {
        static ModelCharge from(String model, Long input, Long output, BigDecimal inputRate, BigDecimal outputRate) {
            BigDecimal spend = input == null || output == null || inputRate == null || outputRate == null ? null
                    : inputRate.multiply(BigDecimal.valueOf(input)).add(outputRate.multiply(BigDecimal.valueOf(output)))
                            .movePointLeft(6);
            return new ModelCharge(model, input, output, inputRate, outputRate, spend);
        }
    }

    static Baseline load(String project) {
        String configuredPath = EnvironmentVariables.get("AI_CREDIT_ESTIMATE");
        try {
            Path path = Path.of(configuredPath == null ? DEFAULT_PATH : configuredPath);
            Properties data = new Properties();
            try (var reader = Files.newBufferedReader(path)) { data.load(reader); }
            return baseline(data, project);
        } catch (IOException | IllegalArgumentException | DateTimeException e) {
            return null;
        }
    }

    static Baseline baseline(Properties data, String project) {
        if (project == null || !project.equals(data.getProperty("project"))) return null;
        Currency currency = Currency.getInstance(data.getProperty("currency", ""));
        BigDecimal balance = amount(data, "balance"), total = amount(data, "total");
        LocalDate date = LocalDate.parse(data.getProperty("baselineDate", ""));
        Instant start = date.plusDays(1).atStartOfDay(ZoneId.of(data.getProperty("zone", "UTC"))).toInstant();
        String model = data.getProperty("model", "");
        String inputSku = data.getProperty("inputSku", ""), outputSku = data.getProperty("outputSku", "");
        if (currency.getDefaultFractionDigits() < 0 || balance.compareTo(total) > 0) return null;
        if (!(model.isEmpty() && inputSku.isEmpty() && outputSku.isEmpty())
                && (!model.matches("gemini-[a-z0-9][a-z0-9._-]{0,119}")
                || !inputSku.matches("[0-9A-F]{4}(?:-[0-9A-F]{4}){2}")
                || !outputSku.matches("[0-9A-F]{4}(?:-[0-9A-F]{4}){2}") || inputSku.equals(outputSku))) return null;
        return new Baseline(currency, balance, total, date, start, model, inputSku, outputSku);
    }

    record Baseline(Currency currency, BigDecimal balance, BigDecimal total, LocalDate date, Instant start,
                    String model, String inputSku, String outputSku) {
        Skus skus(String observedModel) {
            return !model.isEmpty() && model.equals(observedModel)
                    ? new Skus(inputSku, outputSku) : GLOBAL_TEXT_SKUS.get(observedModel);
        }

        GoogleCreditEstimate reply(String status, Instant now, List<ModelCharge> models) {
            BigDecimal remaining = null, spend = null;
            if ("OK".equals(status)) {
                spend = models.stream().map(ModelCharge::estimatedSpend).reduce(BigDecimal.ZERO, BigDecimal::add);
                remaining = balance.subtract(spend).max(BigDecimal.ZERO)
                        .setScale(currency.getDefaultFractionDigits(), RoundingMode.HALF_UP);
            } else if ("NO_DATA".equals(status)) {
                remaining = balance;
            }
            return new GoogleCreditEstimate(status, currency.getCurrencyCode(), remaining, balance, total, date,
                    now, start, sum(models, ModelCharge::inputTokens), sum(models, ModelCharge::outputTokens),
                    spend, List.copyOf(models));
        }

        private static Long sum(List<ModelCharge> models, java.util.function.Function<ModelCharge, Long> count) {
            if (models.isEmpty()) return null;
            long total = 0;
            for (var model : models) {
                Long value = count.apply(model);
                if (value == null) return null;
                total = Math.addExact(total, value);
            }
            return total;
        }
    }

    static BigDecimal listPrice(JsonNode response, String currency) {
        JsonNode rate = response.path("rate"), tiers = rate.path("tiers"), unit = rate.path("unitInfo");
        JsonNode tier = tiers.path(0), price = tier.path("listPrice");
        if (!tiers.isArray() || tiers.size() != 1 || !"0".equals(tier.path("startAmount").path("value").asText())
                || !"count".equals(unit.path("unit").asText())
                || !"1000000".equals(unit.path("unitQuantity").path("value").asText())
                || !currency.equals(price.path("currencyCode").asText())
                || !(price.hasNonNull("units") || price.hasNonNull("nanos"))) return null;
        try {
            long units = Long.parseLong(price.path("units").asText("0"));
            int nanos = Integer.parseInt(price.path("nanos").asText("0"));
            if (units < 0 || nanos < 0 || nanos >= 1_000_000_000) return null;
            return BigDecimal.valueOf(units).add(BigDecimal.valueOf(nanos, 9)).stripTrailingZeros();
        } catch (NumberFormatException invalid) {
            return null;
        }
    }

    private static BigDecimal amount(Properties data, String key) {
        String value = data.getProperty(key, "");
        if (!value.matches("[0-9]{1,9}(?:\\.[0-9]{1,4})?")) {
            throw new IllegalArgumentException("Invalid credit estimate amount");
        }
        return new BigDecimal(value);
    }
}
