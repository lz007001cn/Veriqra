package io.github.lz007001cn.veriqra.service.ai;

import io.github.lz007001cn.veriqra.exception.DataAccessException;
import io.github.lz007001cn.veriqra.model.Project;
import io.github.lz007001cn.veriqra.service.ai.ProjectChatContext.*;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDateTime;
import java.util.*;
import java.util.regex.Pattern;

/** Projection queries for an already authorized project, all over the same connection. */
final class JdbcProjectChatEvidence {
    private static final Pattern REFERENCE = Pattern.compile("(?i)(?:REQ|TC|TP|PLAN|BUG|RUN|IMPORT|ACCEPTANCE)[-# ]*0*[1-9][0-9]{0,18}");
    private static final Pattern WORD = Pattern.compile("[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*|[\\p{IsHan}]{2,12}");
    private static final Set<String> COMMON = Set.of("and", "for", "how", "are", "the", "who", "what", "which", "with", "all", "about", "test", "project", "case", "run", "was", "has", "there", "give", "tell", "list", "show");
    private static final Pattern URL = Pattern.compile(
            "(?iu)(?<![a-z0-9])(?:(?:https?|ftp|file|wss?|ssh|s3|gs)://|www\\.)[^\\s<>\"'，。；、）]+");
    private static final Pattern SECRET = Pattern.compile(
            "(?iu)(?<![a-z0-9])(?:authorization|password|passwd|api[_ -]?key|access[_ -]?token|secret|密码|密钥|令牌)"
            + "\\s*[:=：]\\s*(?:Bearer\\s+)?[^\\s,;，。；]+|(?<![a-z0-9])(?:AIza[\\w-]{35}|ya29\\.[\\w.-]+)");
    private static final String LATEST_ATTEMPT = """
            LEFT JOIN test_attempts a ON a.test_run_case_id=rc.id AND a.attempt_no=(
                SELECT MAX(newest.attempt_no) FROM test_attempts newest WHERE newest.test_run_case_id=rc.id
            )
            """;

    private final Connection connection;
    private final long projectId;
    private final List<String> terms;
    private final Map<String, Section> sections = new LinkedHashMap<>();
    private final Map<String, Source> sources = new LinkedHashMap<>();
    private int textRemaining = 1_000;
    private boolean truncated;

    JdbcProjectChatEvidence(Connection connection, long projectId, String question) {
        this.connection = Objects.requireNonNull(connection);
        this.projectId = projectId;
        this.terms = terms(question);
    }

    ProjectChatContext snapshot(Project row) {
        var project = new ProjectInfo(row.id(), row.projectKey(), text(row.name(), 160), row.status().name(), text(row.description(), 750));
        collect(2_300, this::requirements);
        collect(3_400, this::testCases);
        collect(2_100, this::plans);
        collect(3_700, this::runs);
        collect(3_200, this::defects);
        collect(1_800, this::comments);
        collect(1_400, this::imports);
        collect(2_100, this::acceptances);
        collect(1_000, this::members);
        return new ProjectChatContext(project, sections, new ArrayList<>(sources.values()), truncated);
    }

    /** Long notes in an early section cannot crowd out evidence in other areas. */
    private void collect(int textBudget, Runnable read) {
        textRemaining = textBudget;
        read.run();
    }

    private void requirements() {
        String confirmedReady = """
                FROM test_case_requirements link JOIN test_cases tc ON tc.id=link.test_case_id
                WHERE link.requirement_id=req.id AND tc.project_id=req.project_id
                  AND link.status='CONFIRMED' AND tc.status='READY'
                """;
        var counts = statusCounts("requirements", "DRAFT", "ACTIVE", "ARCHIVED");
        long total = total(counts);
        long covered = scalar("SELECT COUNT(*) FROM requirements req WHERE req.project_id=? AND req.status='ACTIVE' AND EXISTS (SELECT 1 " + confirmedReady + ")", projectId);
        counts.put("activeCoveredByConfirmedReadyCases", covered);
        counts.put("activeUncovered", counts.get("ACTIVE") - covered);
        var items = selected("""
                SELECT req.id, req.key_no, req.title, req.priority, req.status, req.updated_at,
                       LEFT(req.description,501) AS description,
                       (SELECT COUNT(*) %s) AS confirmed_ready
                FROM requirements req WHERE req.project_id=?
                """.formatted(confirmedReady), "REQ", "req.key_no", "req.title,LEFT(req.description,500)",
                "req.updated_at DESC,req.id DESC", 12, r -> {
                    Source source = source("REQUIREMENT", r.getLong("id"), key("REQ", r.getLong("key_no")), r.getString("title"));
                    return item(source, "status", r.getString("status"), "priority", r.getString("priority"),
                            "description", text(r.getString("description"), 500), "updatedAt", date(r, "updated_at"),
                            "confirmedReadyCaseCount", r.getLong("confirmed_ready"));
                });
        section("requirements", total, counts, items);
    }

    private void testCases() {
        var counts = statusCounts("test_cases", "DRAFT", "READY", "ARCHIVED");
        var items = selected("""
                SELECT tc.id, tc.key_no, tc.title, tc.priority, tc.status, tc.updated_at,
                       LEFT(tc.description,351) AS description, LEFT(tc.preconditions,251) AS preconditions
                FROM test_cases tc WHERE tc.project_id=?
                """, "TC", "tc.key_no", "tc.title,LEFT(tc.description,350)", "tc.updated_at DESC,tc.id DESC", 12, r -> {
                    long id = r.getLong("id");
                    Source source = source("TEST_CASE", id, key("TC", r.getLong("key_no")), r.getString("title"));
                    return item(source, "status", r.getString("status"), "priority", r.getString("priority"),
                            "description", text(r.getString("description"), 350), "preconditions", text(r.getString("preconditions"), 250),
                            "updatedAt", date(r, "updated_at"), "steps", testSteps(id));
                });
        section("testCases", total(counts), counts, items);
    }

    private Map<String, Object> testSteps(long id) {
        long total = scalar("SELECT COUNT(*) FROM test_steps WHERE test_case_id=?", id);
        var rows = query("""
                SELECT step_order, LEFT(action,151) AS action, LEFT(expected_result,151) AS expected_result
                FROM test_steps WHERE test_case_id=? ORDER BY step_order LIMIT 3
                """, r -> facts("order", r.getInt("step_order"), "action", text(r.getString("action"), 150),
                "expected", text(r.getString("expected_result"), 150)), id);
        return detail(total, rows);
    }

    private void plans() {
        var counts = statusCounts("test_plans", "DRAFT", "READY", "ARCHIVED");
        var items = selected("""
                SELECT p.id, p.key_no, p.name, p.status, LEFT(p.description,351) AS description,
                       (SELECT COUNT(*) FROM test_plan_cases pc JOIN test_cases tc ON tc.id=pc.test_case_id
                        WHERE pc.test_plan_id=p.id AND tc.project_id=p.project_id) AS case_count
                FROM test_plans p WHERE p.project_id=?
                """, "TP", "p.key_no", "p.name,LEFT(p.description,350)", "p.updated_at DESC,p.id DESC", 8, r -> {
                    long id = r.getLong("id");
                    Source source = source("TEST_PLAN", id, key("TP", r.getLong("key_no")), r.getString("name"));
                    var cases = query("""
                            SELECT tc.key_no, tc.title, tc.status FROM test_plan_cases pc
                            JOIN test_cases tc ON tc.id=pc.test_case_id AND tc.project_id=?
                            WHERE pc.test_plan_id=? ORDER BY tc.key_no LIMIT 4
                            """, c -> facts("key", key("TC", c.getLong("key_no")), "title", text(c.getString("title"), 160),
                            "status", c.getString("status")), projectId, id);
                    return item(source, "status", r.getString("status"), "description", text(r.getString("description"), 350),
                            "cases", detail(r.getLong("case_count"), cases));
                });
        section("testPlans", total(counts), counts, items);
    }

    private void runs() {
        var counts = statusCounts("test_runs", "IN_PROGRESS", "COMPLETED", "CANCELLED");
        long total = total(counts);
        if (total > 0) counts.put("latestCreatedRunId", scalar(
                "SELECT id FROM test_runs WHERE project_id=? ORDER BY created_at DESC,id DESC LIMIT 1", projectId));
        var items = selected("""
                SELECT r.id, r.name, r.status, r.build_version, r.environment, r.created_at, r.ended_at,
                       p.key_no AS plan_key, u.display_name AS assignee
                FROM test_runs r
                LEFT JOIN test_plans p ON p.id=r.test_plan_id AND p.project_id=r.project_id
                LEFT JOIN users u ON u.id=r.assignee_id
                WHERE r.project_id=?
                """, "RUN", "r.id", "r.name,r.build_version,r.environment,u.display_name", "r.created_at DESC,r.id DESC", 8, r -> {
                    long id = r.getLong("id");
                    Source source = source("RUN", id, "Run #" + id, r.getString("name"));
                    Long plan = r.getObject("plan_key", Long.class);
                    var outcomes = outcomes("""
                            SELECT COALESCE(a.status,'NOT_RUN') AS outcome, COUNT(*) AS n
                            FROM test_run_cases rc
                            """ + LATEST_ATTEMPT + " WHERE rc.test_run_id=? GROUP BY outcome", id);
                    return item(source, "status", r.getString("status"), "buildVersion", text(r.getString("build_version"), 80),
                            "environment", text(r.getString("environment"), 160), "planKey", plan == null ? null : key("TP", plan),
                            "assignee", text(r.getString("assignee"), 80), "createdAt", date(r, "created_at"), "endedAt", date(r, "ended_at"),
                            "latestResults", outcomes, "attentionCases", attentionCases(id, outcomes));
                });
        section("runs", total, counts, items);
    }

    private Map<String, Object> attentionCases(long runId, Map<String, Long> outcomes) {
        long total = outcomes.get("FAIL") + outcomes.get("BLOCKED") + outcomes.get("NOT_RUN");
        if (total == 0) return detail(0, List.of());
        var rows = query("""
                SELECT tc.key_no, rc.snapshot_title, COALESCE(a.status,'NOT_RUN') AS outcome, a.recorded_at,
                       LEFT(a.failure_message,301) AS failure_message, LEFT(a.comment,241) AS comment
                FROM test_run_cases rc LEFT JOIN test_cases tc ON tc.id=rc.test_case_id AND tc.project_id=?
                """ + LATEST_ATTEMPT + """
                WHERE rc.test_run_id=? AND (a.status IN ('FAIL','BLOCKED') OR a.id IS NULL)
                ORDER BY CASE a.status WHEN 'FAIL' THEN 0 WHEN 'BLOCKED' THEN 1 ELSE 2 END,rc.id LIMIT 4
                """, r -> {
                    Long keyNo = r.getObject("key_no", Long.class);
                    return facts("testCaseKey", keyNo == null ? null : key("TC", keyNo),
                            "snapshotTitle", text(r.getString("snapshot_title"), 160), "outcome", r.getString("outcome"),
                            "recordedAt", date(r, "recorded_at"), "failure", text(r.getString("failure_message"), 300),
                            "comment", text(r.getString("comment"), 240));
                }, projectId, runId);
        return detail(total, rows);
    }

    private void defects() {
        var counts = statusCounts("defects", "OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED", "REOPENED");
        long total = total(counts);
        counts.put("unclosed", total - counts.get("CLOSED"));
        var items = selected("""
                SELECT d.id, d.key_no, d.title, d.priority, d.severity, d.status, d.updated_at,
                       LEFT(d.description,451) AS description, LEFT(d.resolution_note,301) AS resolution_note,
                       u.display_name AS assignee, (d.assignee_id IS NOT NULL) AS assigned
                FROM defects d
                LEFT JOIN project_members m ON m.project_id=d.project_id AND m.user_id=d.assignee_id
                LEFT JOIN users u ON u.id=m.user_id WHERE d.project_id=?
                """, "BUG", "d.key_no", "d.title,LEFT(d.description,450),u.display_name,d.status,d.severity",
                "(d.status='CLOSED'),d.updated_at DESC,d.id DESC", 12, r -> {
                    long id = r.getLong("id");
                    Source source = source("DEFECT", id, key("BUG", r.getLong("key_no")), r.getString("title"));
                    return item(source, "status", r.getString("status"), "severity", r.getString("severity"), "priority", r.getString("priority"),
                            "description", text(r.getString("description"), 450), "resolutionNote", text(r.getString("resolution_note"), 300),
                            "assigned", r.getBoolean("assigned"), "assignee", text(r.getString("assignee"), 80), "updatedAt", date(r, "updated_at"),
                            "historicalFailureLinks", defectFailures(id));
                });
        section("defects", total, counts, items);
    }

    private Map<String, Object> defectFailures(long id) {
        String from = """
                FROM test_attempt_defects link JOIN test_attempts a ON a.id=link.attempt_id AND a.status='FAIL'
                JOIN test_run_cases rc ON rc.id=a.test_run_case_id
                JOIN test_runs r ON r.id=rc.test_run_id AND r.project_id=? WHERE link.defect_id=?
                """;
        long total = scalar("SELECT COUNT(*) " + from, projectId, id);
        var rows = query("SELECT r.id AS run_id, r.name, r.build_version, a.recorded_at " + from + " ORDER BY link.linked_at DESC,a.id DESC LIMIT 3",
                r -> facts("runId", r.getLong("run_id"), "runName", text(r.getString("name"), 160),
                        "buildVersion", text(r.getString("build_version"), 80), "recordedAt", date(r, "recorded_at")), projectId, id);
        return detail(total, rows);
    }

    private void comments() {
        long total = scalar("SELECT COUNT(*) FROM defect_comments c JOIN defects d ON d.id=c.defect_id WHERE d.project_id=?", projectId);
        var items = selected("""
                SELECT c.id, d.id AS defect_id, d.key_no, d.title, c.created_at,
                       LEFT(c.comment_text,401) AS comment_text, u.display_name AS author
                FROM defect_comments c JOIN defects d ON d.id=c.defect_id
                JOIN users u ON u.id=c.author_id WHERE d.project_id=?
                """, "BUG", "d.key_no", "d.title,LEFT(c.comment_text,400)", "c.id DESC", 10, r -> {
                    Source source = source("DEFECT", r.getLong("defect_id"), key("BUG", r.getLong("key_no")), r.getString("title"));
                    return item(source, "commentId", r.getLong("id"), "createdAt", date(r, "created_at"),
                            "author", text(r.getString("author"), 80), "text", text(r.getString("comment_text"), 400));
                });
        section("defectComments", total, Map.of(), items);
    }

    private void imports() {
        long total = scalar("SELECT COUNT(*) FROM test_imports i JOIN test_runs r ON r.id=i.test_run_id WHERE r.project_id=?", projectId);
        var items = selected("""
                SELECT i.id, i.original_filename, i.source_namespace, i.imported_at, r.id AS run_id, r.name,
                       r.build_version
                FROM test_imports i JOIN test_runs r ON r.id=i.test_run_id WHERE r.project_id=?
                """, "IMPORT", "i.id", "i.original_filename,i.source_namespace,r.name,r.build_version", "i.imported_at DESC,i.id DESC", 8, r -> {
                    long id = r.getLong("id");
                    var results = outcomes("SELECT status AS outcome, COUNT(*) AS n FROM test_attempts WHERE import_id=? GROUP BY status", id);
                    return item(source("IMPORT", id, "Import #" + id, r.getString("original_filename")), "namespace", text(r.getString("source_namespace"), 128),
                            "importedAt", date(r, "imported_at"), "runId", r.getLong("run_id"), "runName", text(r.getString("name"), 160),
                            "buildVersion", text(r.getString("build_version"), 80), "importedResults", results);
                });
        section("imports", total, Map.of(), items);
    }

    private void acceptances() {
        var counts = grouped("SELECT verdict AS outcome,COUNT(*) AS n FROM release_acceptances WHERE project_id=? GROUP BY verdict",
                List.of("APPROVED", "REJECTED"), projectId);
        var items = selected("""
                SELECT r.id, r.build_version, r.verdict, r.reviewer_name, r.created_at, r.run_count,
                       r.unclosed_defect_count, r.defect_scope, LEFT(r.notes,501) AS notes
                FROM release_acceptances r WHERE r.project_id=?
                """, "ACCEPTANCE", "r.id", "r.build_version,LEFT(r.notes,500),r.verdict", "r.id DESC", 8, r -> {
                    long id = r.getLong("id");
                    String build = r.getString("build_version");
                    return item(source("RELEASE_ACCEPTANCE", id, "Acceptance #" + id, build), "buildVersion", text(build, 80),
                            "humanVerdict", r.getString("verdict"), "reviewedAt", date(r, "created_at"),
                            "reviewer", text(r.getString("reviewer_name"), 80), "notes", text(r.getString("notes"), 500),
                            "runCountAtCapture", r.getInt("run_count"), "unclosedDefectCountAtCapture", r.getLong("unclosed_defect_count"),
                            "defectScope", r.getString("defect_scope"));
                });
        section("releaseAcceptances", total(counts), counts, items);
    }

    private void members() {
        var counts = statusCounts("project_members", "ACTIVE", "INACTIVE");
        long total = total(counts);
        counts.putAll(grouped("""
                SELECT project_role AS outcome,COUNT(*) AS n FROM project_members
                WHERE project_id=? AND status='ACTIVE' GROUP BY project_role
                """, List.of("TESTER", "DEVELOPER"), projectId));
        counts.put("activeManagers", scalar("""
                SELECT COUNT(*) FROM project_managers pm JOIN project_members m ON m.project_id=pm.project_id AND m.user_id=pm.user_id
                WHERE pm.project_id=? AND pm.status='ACTIVE' AND m.status='ACTIVE'
                """, projectId));
        var items = selected("""
                SELECT u.display_name, m.project_role, m.status, (pm.user_id IS NOT NULL) AS manager
                FROM project_members m JOIN users u ON u.id=m.user_id
                LEFT JOIN project_managers pm ON pm.project_id=m.project_id AND pm.user_id=m.user_id AND pm.status='ACTIVE'
                WHERE m.project_id=?
                """, null, null, "u.display_name,m.project_role", "(m.status='ACTIVE') DESC,manager DESC,m.user_id", 12,
                r -> item(null, "displayName", text(r.getString("display_name"), 80), "projectRole", r.getString("project_role"),
                        "membershipStatus", r.getString("status"), "managerAppointmentActive", r.getBoolean("manager")));
        section("projectMembers", total, counts, items);
    }

    private void section(String name, long total, Map<String, Long> counts, List<Item> items) {
        long omitted = Math.max(0, total - items.size());
        truncated |= omitted > 0;
        sections.put(name, new Section(total, omitted, counts, items));
    }

    private Map<String, Object> detail(long total, List<Map<String, Object>> rows) {
        long omitted = Math.max(0, total - rows.size());
        truncated |= omitted > 0;
        return facts("total", total, "omittedCount", omitted, "items", rows);
    }

    private Source source(String type, long id, String key, String title) {
        return sources.computeIfAbsent(type + ':' + id, ignored -> new Source(type, id, key + " · " + label(title)));
    }

    private String label(String value) {
        String redacted = redact(value);
        if (redacted.length() > 180) { truncated = true; return truncate(redacted, 180); }
        return redacted;
    }

    private String text(String value, int limit) {
        if (value == null) return null;
        String redacted = redact(value);
        int max = Math.min(limit, textRemaining);
        truncated |= value.length() > limit || redacted.length() > max;
        String excerpt = truncate(redacted, max);
        textRemaining -= excerpt.length();
        return excerpt;
    }

    private static String redact(String value) {
        return value == null ? "" : SECRET.matcher(URL.matcher(value).replaceAll("[link omitted]")).replaceAll("[credential omitted]");
    }

    private static String truncate(String value, int max) {
        if (value.length() <= max) return value;
        if (max > 0 && Character.isHighSurrogate(value.charAt(max - 1))) max--;
        return value.substring(0, max);
    }

    private static List<String> terms(String question) {
        if (question == null || question.isBlank()) return List.of();
        String normalized = truncate(question.toLowerCase(Locale.ROOT), 2000);
        var terms = new LinkedHashSet<String>();
        var refs = REFERENCE.matcher(normalized);
        while (terms.size() < 4 && refs.find()) terms.add(refs.group().replaceAll("[-# ]+", "-"));
        var words = WORD.matcher(normalized.replaceAll("一下|请问|那个|这个|有哪些|怎么样|能不能|告诉我|为什么|怎么看|是什么|的|了|吗", " "));
        while (terms.size() < 7 && words.find()) {
            String token = words.group();
            if (token.length() >= 2 && !COMMON.contains(token)) terms.add(token);
        }
        return List.copyOf(terms);
    }

    private static String key(String prefix, long number) { return prefix + '-' + String.format(Locale.ROOT, "%03d", number); }

    private static LocalDateTime date(ResultSet row, String column) throws SQLException {
        return row.getObject(column, LocalDateTime.class);
    }

    private static Item item(Source source, Object... pairs) { return new Item(source, facts(pairs)); }

    private static Map<String, Object> facts(Object... pairs) {
        var map = new LinkedHashMap<String, Object>();
        for (int i = 0; i < pairs.length; i += 2) map.put((String) pairs[i], pairs[i + 1]);
        return Collections.unmodifiableMap(map);
    }

    private Map<String, Long> statusCounts(String table, String... statuses) {
        return grouped("SELECT status AS outcome,COUNT(*) AS n FROM " + table + " WHERE project_id=? GROUP BY status",
                List.of(statuses), projectId);
    }

    private Map<String, Long> outcomes(String sql, long id) {
        var values = grouped(sql, List.of("PASS", "FAIL", "BLOCKED", "SKIPPED", "NOT_RUN"), id);
        long total = total(values);
        values.put("total", total);
        values.put("recorded", total - values.get("NOT_RUN"));
        return Collections.unmodifiableMap(values);
    }

    private Map<String, Long> grouped(String sql, List<String> keys, Object... args) {
        var counts = new LinkedHashMap<String, Long>();
        keys.forEach(key -> counts.put(key, 0L));
        query(sql, row -> Map.entry(row.getString("outcome"), row.getLong("n")), args)
                .forEach(entry -> counts.put(entry.getKey(), entry.getValue()));
        return counts;
    }

    private static long total(Map<String, Long> counts) { return counts.values().stream().mapToLong(Long::longValue).sum(); }

    private long scalar(String sql, Object... args) { return query(sql, row -> row.getLong(1), args).getFirst(); }

    private <T> List<T> selected(String sql, String prefix, String key, String searchable, String fallback, int cap, Row<T> reader) {
        var args = new ArrayList<Object>();
        args.add(projectId);
        var rank = new ArrayList<String>();
        for (String term : terms) {
            if (prefix != null) {
                String number = referenceNumber(prefix, term);
                if (number != null) {
                    rank.add("8*(CAST(" + key + " AS CHAR)=?)");
                    args.add(number);
                    continue;
                }
            }
            rank.add("(LOCATE(?,LOWER(CONCAT_WS(' '," + searchable + ")))>0)");
            args.add(term);
        }
        String priority = rank.isEmpty() ? "" : "(" + String.join("+", rank) + ") DESC,";
        args.add(cap);
        return query(sql + " ORDER BY " + priority + fallback + " LIMIT ?", reader, args.toArray());
    }

    private static String referenceNumber(String prefix, String term) {
        String equivalent = prefix.equals("TP") ? "(?:tp|plan)" : prefix.toLowerCase(Locale.ROOT);
        return term.matches(equivalent + "-?0*[1-9][0-9]{0,18}")
                ? term.replaceFirst("^[a-z]+-?0*", "") : null;
    }

    @FunctionalInterface private interface Row<T> { T read(ResultSet rows) throws SQLException; }

    private <T> List<T> query(String sql, Row<T> reader, Object... args) {
        try (var query = connection.prepareStatement(sql)) {
            for (int i = 0; i < args.length; i++) query.setObject(i + 1, args[i]);
            try (var rows = query.executeQuery()) {
                var result = new ArrayList<T>();
                while (rows.next()) result.add(reader.read(rows));
                return List.copyOf(result);
            }
        } catch (SQLException e) { throw new DataAccessException("Read project chat evidence", e); }
    }
}
