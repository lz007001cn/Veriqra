package io.github.lz007001cn.veriqra.admin;

public interface AdminLogDao {
    void appendLogin(LoginEvent event);
    void appendAccess(AccessEvent event);
    void appendAudit(AuditEvent event);
    String databaseVersion();
    int databaseTableCount();
}
