package io.github.lz007001cn.veriqra.admin;

import io.github.lz007001cn.veriqra.exception.DataAccessException;
import java.sql.*;
import java.util.*;

/** Shared login, access and user-change logging. */
public final class JdbcAdminLogDao implements AdminLogDao {
    private final Connection connection;
    public JdbcAdminLogDao(Connection connection) { this.connection=Objects.requireNonNull(connection); }

    @Override public void appendLogin(LoginEvent e) {
        try(var s=connection.prepareStatement("INSERT INTO login_events(user_id,username_attempted,ip_address,user_agent,browser,operating_system,device_type,result,failure_reason) VALUES(?,?,?,?,?,?,?,?,?)")) {
            s.setObject(1,e.userId(),Types.BIGINT);s.setString(2,e.usernameAttempted());s.setString(3,e.ipAddress());
            s.setString(4,e.userAgent());s.setString(5,e.browser());s.setString(6,e.operatingSystem());
            s.setString(7,e.deviceType());s.setString(8,e.result());s.setString(9,e.failureReason());s.executeUpdate();
        } catch(SQLException failure) { throw new DataAccessException("Append login event",failure); }
    }

    @Override public void appendAccess(AccessEvent e) {
        try(var s=connection.prepareStatement("INSERT INTO access_logs(user_id,ip_address,user_agent,browser,operating_system,device_type,http_method,request_path,status_code,request_id,duration_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)")) {
            s.setObject(1,e.userId(),Types.BIGINT);s.setString(2,e.ipAddress());s.setString(3,e.userAgent());
            s.setString(4,e.browser());s.setString(5,e.operatingSystem());s.setString(6,e.deviceType());
            s.setString(7,e.httpMethod());s.setString(8,e.requestPath());s.setInt(9,e.statusCode());
            s.setString(10,e.requestId());s.setInt(11,e.durationMs());s.executeUpdate();
        } catch(SQLException failure) { throw new DataAccessException("Append access event",failure); }
    }

    @Override public void appendAudit(AuditEvent e) {
        try(var s=connection.prepareStatement("INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,summary,metadata_json,ip_address,request_id) VALUES(?,?,?,?,?,?,?,?)")) {
            s.setLong(1,e.actorUserId());s.setString(2,e.action());s.setString(3,e.targetType());
            s.setObject(4,e.targetId(),Types.BIGINT);s.setString(5,e.summary());s.setString(6,e.metadataJson());
            s.setString(7,e.ipAddress());s.setString(8,e.requestId());s.executeUpdate();
        } catch(SQLException failure) { throw new DataAccessException("Append admin audit",failure); }
    }

    @Override public String databaseVersion() {
        try (var statement = connection.prepareStatement("SELECT VERSION()"); var rows = statement.executeQuery()) {
            rows.next(); return rows.getString(1);
        } catch (SQLException e) { throw new DataAccessException("Read database version", e); }
    }
    @Override public int databaseTableCount() {
        try (var statement = connection.prepareStatement("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()");
             var rows = statement.executeQuery()) {
            rows.next(); return rows.getInt(1);
        } catch (SQLException e) { throw new DataAccessException("Read database table count", e); }
    }
}
