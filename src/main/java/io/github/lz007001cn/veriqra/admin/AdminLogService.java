package io.github.lz007001cn.veriqra.admin;

import io.github.lz007001cn.veriqra.service.support.ServiceTransaction;
import java.util.Objects;

/** Shared authorization and deployment metadata reads. */
public final class AdminLogService {
    private final ServiceTransaction tx;
    private final AdminAccessPolicy policy;
    public AdminLogService(ServiceTransaction tx, AdminAccessPolicy policy) {
        this.tx = Objects.requireNonNull(tx); this.policy = Objects.requireNonNull(policy);
    }
    public void requireAdmin(long actor) { tx.execute(c -> { policy.requireRead(c, actor); return null; }); }
    public String databaseVersion(long actor) { return tx.execute(c -> { policy.requireRead(c, actor); return new JdbcAdminLogDao(c).databaseVersion(); }); }
    public int databaseTableCount(long actor) { return tx.execute(c -> { policy.requireRead(c, actor); return new JdbcAdminLogDao(c).databaseTableCount(); }); }
}
