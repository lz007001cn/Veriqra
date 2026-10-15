package io.github.lz007001cn.veriqra.dao;
import io.github.lz007001cn.veriqra.model.*;
import java.util.*;

/** Caller supplies authorization, common Case locks, Defect version bump and transaction. */
public interface DefectRetestLinkDao {
    /** Generated id/linkedAt ignored; revocation must be absent. Requires outer transaction. */
    DefectRetestLink insert(DefectRetestLink value);
    Optional<DefectRetestLink> findById(Long id);
    Optional<DefectRetestLink> findByIdForUpdate(Long id);
    Optional<DefectRetestLink> findByLinkRequestKey(UUID key);
    Optional<DefectRetestLink> findByRevokeRequestKey(UUID key);
    Optional<DefectRetestLink> findReplacedByLinkRequestKey(UUID key);
    /** Current reads of both indexed key namespaces. Locks also guard cross-action collisions. */
    List<DefectRetestLink> listByRequestKeyForUpdate(UUID key);
    List<DefectRetestLink> listByDefect(Long defectId);
    List<DefectRetestLink> listByDefectForUpdate(Long defectId);
    Optional<DefectRetestLink> findActive(Long defectId, Long failureAttemptId);
    /** One-way CAS. False means absent/wrong owner/already revoked; never automatic replay success. */
    boolean revoke(Long id, Long defectId, DefectRetestRevocation value);
}
