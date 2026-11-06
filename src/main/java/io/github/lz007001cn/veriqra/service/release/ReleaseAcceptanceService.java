package io.github.lz007001cn.veriqra.service.release;

import io.github.lz007001cn.veriqra.exception.DataAccessException;
import io.github.lz007001cn.veriqra.model.ProjectStatus;
import io.github.lz007001cn.veriqra.service.exception.ConflictException;
import io.github.lz007001cn.veriqra.service.exception.NotFoundException;
import io.github.lz007001cn.veriqra.service.exception.ValidationException;
import io.github.lz007001cn.veriqra.service.release.ReleaseAcceptance.*;
import io.github.lz007001cn.veriqra.service.support.ProjectAccessPolicy;
import io.github.lz007001cn.veriqra.service.support.ServiceDaoFactory;
import io.github.lz007001cn.veriqra.service.support.ServiceTransaction;
import io.github.lz007001cn.veriqra.service.support.ServiceValidation;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.Clock;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.regex.Pattern;

/** Captures current saved evidence with the actor's explicit verdict in one database transaction. */
public final class ReleaseAcceptanceService {
    private static final int MAX_RUNS = 50;
    private static final int MAX_UNCLOSED_DEFECTS = 2000;
    private static final int PAGE_SIZE = 50;
    private static final Pattern REQUEST_KEY = Pattern.compile("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");
    private static final Pattern REVIEW_TOKEN = Pattern.compile("[0-9a-f]{64}");

    public record PreviewRequest(String buildVersion, List<Long> runIds) { }
    public record Preview(String buildVersion, List<RunEvidence> runs, List<DefectEvidence> unclosedDefects,
            String defectScope, String reviewToken) {
        public Preview {
            runs = List.copyOf(runs);
            unclosedDefects = List.copyOf(unclosedDefects);
        }
    }
    public record CreateRequest(String buildVersion, List<Long> runIds, Verdict verdict, String notes, String requestKey,
            String reviewToken) { }

    public static final class EvidenceLimitExceeded extends ConflictException {
        EvidenceLimitExceeded() { super("Too many unclosed project defects to save a complete acceptance record"); }
    }
    public static final class EvidenceChanged extends ConflictException {
        EvidenceChanged() { super("Release evidence changed; preview it again before saving"); }
    }

    private record Selection(String buildVersion, List<Long> runIds) { }
    private record ValidatedRequest(Selection selection, Verdict verdict, String notes, UUID requestKey, String reviewToken) { }

    private final ServiceTransaction transactions;
    private final ServiceDaoFactory daos;
    private final ProjectAccessPolicy access;
    private final Clock clock;

    public ReleaseAcceptanceService(ServiceTransaction transactions, ServiceDaoFactory daos, ProjectAccessPolicy access, Clock clock) {
        this.transactions = Objects.requireNonNull(transactions);
        this.daos = Objects.requireNonNull(daos);
        this.access = Objects.requireNonNull(access);
        this.clock = Objects.requireNonNull(clock);
    }

    public List<Summary> list(Long actorId, long projectId, Long beforeId) {
        if (beforeId != null && beforeId <= 0) throw new ValidationException("Invalid acceptance cursor");
        return transactions.execute(connection -> {
            requireRead(connection, actorId, projectId);
            return new JdbcReleaseAcceptanceStore(connection).list(projectId, beforeId, PAGE_SIZE);
        });
    }

    public ReleaseAcceptance get(Long actorId, long projectId, long id) {
        return transactions.execute(connection -> {
            requireRead(connection, actorId, projectId);
            return new JdbcReleaseAcceptanceStore(connection).find(projectId, id)
                    .orElseThrow(() -> new NotFoundException("Release acceptance does not exist in project"));
        });
    }

    public Preview preview(Long actorId, long projectId, PreviewRequest request) {
        ServiceValidation.required(request, "preview");
        Selection selection = selection(request.buildVersion(), request.runIds());
        return transactions.execute(connection -> {
            useRepeatableRead(connection);
            var d = daos.create(connection);
            var project = d.projects().findByIdForShare(projectId).orElseThrow(() -> new NotFoundException("Project does not exist"));
            access.requireAssetWrite(d.users(), d.members(), actorId, projectId);
            if (project.status() != ProjectStatus.ACTIVE) throw new ConflictException("Project is archived");
            return capture(new JdbcReleaseAcceptanceStore(connection), projectId, selection);
        });
    }

    public ReleaseAcceptance create(Long actorId, long projectId, CreateRequest request) {
        var input = validate(request);
        try {
            return transactions.execute(connection -> save(connection, actorId, projectId, input));
        } catch (DataAccessException failure) {
            if (failure.getVendorCode() != 1062) throw failure;
            // A concurrent same-key insert can win after our snapshot began. Read the committed winner in a new transaction.
            return transactions.execute(connection -> {
                var d = daos.create(connection);
                d.projects().findByIdForShare(projectId).orElseThrow(() -> new NotFoundException("Project does not exist"));
                var reviewer = access.requireAssetWrite(d.users(), d.members(), actorId, projectId);
                var saved = new JdbcReleaseAcceptanceStore(connection).findByRequest(projectId, reviewer.id(), input.requestKey())
                        .orElseThrow(() -> failure);
                return replay(saved, input);
            });
        }
    }

    private ReleaseAcceptance save(Connection connection, Long actorId, long projectId, ValidatedRequest input) {
        useRepeatableRead(connection);
        var d = daos.create(connection);
        var project = d.projects().findByIdForShare(projectId).orElseThrow(() -> new NotFoundException("Project does not exist"));
        var reviewer = access.requireAssetWrite(d.users(), d.members(), actorId, projectId);
        var store = new JdbcReleaseAcceptanceStore(connection);
        var existing = store.findByRequest(projectId, reviewer.id(), input.requestKey());
        if (existing.isPresent()) return replay(existing.get(), input);
        if (project.status() != ProjectStatus.ACTIVE) throw new ConflictException("Project is archived");

        Preview evidence = capture(store, projectId, input.selection());
        if (!evidence.reviewToken().equals(input.reviewToken())) throw new EvidenceChanged();
        var captured = new ReleaseAcceptance(0, projectId, evidence.buildVersion(), input.verdict(), reviewer.id(),
                reviewer.displayName(), LocalDateTime.now(clock).truncatedTo(ChronoUnit.MICROS), evidence.runs().size(),
                evidence.unclosedDefects().size(), evidence.defectScope(), input.notes(), evidence.runs(), evidence.unclosedDefects());
        return store.insert(captured, input.requestKey());
    }

    private static Preview capture(JdbcReleaseAcceptanceStore store, long projectId, Selection selection) {
        List<RunEvidence> runs = store.runs(projectId, selection.runIds());
        if (runs.size() != selection.runIds().size() || runs.stream().anyMatch(run -> !selection.buildVersion().equals(run.buildVersion())))
            throw new ValidationException("Every selected run must belong to the project and match the exact build version");
        List<DefectEvidence> unclosed = store.unclosedDefects(projectId, MAX_UNCLOSED_DEFECTS + 1);
        if (unclosed.size() > MAX_UNCLOSED_DEFECTS) throw new EvidenceLimitExceeded();
        return new Preview(selection.buildVersion(), runs, unclosed, ReleaseAcceptance.ALL_PROJECT_UNCLOSED,
                JdbcReleaseAcceptanceStore.reviewToken(projectId, selection.buildVersion(), runs, unclosed));
    }

    private void requireRead(Connection connection, Long actorId, long projectId) {
        var d = daos.create(connection);
        d.projects().findById(projectId).orElseThrow(() -> new NotFoundException("Project does not exist"));
        access.requireProjectRead(d.users(), d.members(), actorId, projectId);
    }

    private static void useRepeatableRead(Connection connection) {
        // All nonlocking evidence reads use one InnoDB snapshot. The pool restores its default when the lease closes.
        try {
            if (connection.getTransactionIsolation() != Connection.TRANSACTION_REPEATABLE_READ)
                connection.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
        } catch (SQLException e) { throw new DataAccessException("Set release evidence snapshot isolation", e); }
    }

    private static ReleaseAcceptance replay(ReleaseAcceptance saved, ValidatedRequest input) {
        List<Long> savedIds = saved.runs().stream().map(RunEvidence::id).sorted().toList();
        if (!saved.buildVersion().equals(input.selection().buildVersion()) || !savedIds.equals(input.selection().runIds())
                || saved.verdict() != input.verdict() || !Objects.equals(saved.notes(), input.notes())
                || !JdbcReleaseAcceptanceStore.reviewToken(saved.projectId(), saved.buildVersion(), saved.runs(), saved.unclosedDefects()).equals(input.reviewToken()))
            throw new ConflictException("Release acceptance request key was already used for a different submission");
        return saved;
    }

    private static ValidatedRequest validate(CreateRequest request) {
        ServiceValidation.required(request, "acceptance");
        Selection selection = selection(request.buildVersion(), request.runIds());
        Verdict verdict = ServiceValidation.required(request.verdict(), "verdict");
        String notes = ServiceValidation.optionalText(request.notes(), 2000, "notes");
        if (request.requestKey() == null || !REQUEST_KEY.matcher(request.requestKey()).matches())
            throw new ValidationException("A canonical UUID request key is required");
        if (request.reviewToken() == null || !REVIEW_TOKEN.matcher(request.reviewToken()).matches())
            throw new ValidationException("A release evidence preview is required");
        return new ValidatedRequest(selection, verdict, notes == null || notes.isBlank() ? null : notes,
                UUID.fromString(request.requestKey()), request.reviewToken());
    }

    private static Selection selection(String build, List<Long> ids) {
        ServiceValidation.requiredText(build, 80, "buildVersion");
        if (ids == null || ids.isEmpty() || ids.size() > MAX_RUNS)
            throw new ValidationException("Select between 1 and 50 runs");
        Set<Long> unique = new TreeSet<>();
        for (Long id : ids) {
            if (id == null || id <= 0 || !unique.add(id))
                throw new ValidationException("Run IDs must be distinct positive integers");
        }
        return new Selection(build, List.copyOf(unique));
    }
}
