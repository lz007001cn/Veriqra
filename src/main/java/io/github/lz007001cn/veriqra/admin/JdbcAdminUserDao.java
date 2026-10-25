package io.github.lz007001cn.veriqra.admin;

import io.github.lz007001cn.veriqra.exception.DataAccessException;
import io.github.lz007001cn.veriqra.model.*;
import java.sql.*;
import java.time.LocalDateTime;
import java.util.*;

/** Connection-scoped, non-owning Administration user queries. */
public final class JdbcAdminUserDao implements AdminUserDao {
    private static final String VIEW = "SELECT id,username,display_name,system_role,status,lock_version,created_at FROM users ";
    private final Connection connection;
    public JdbcAdminUserDao(Connection connection) { this.connection = Objects.requireNonNull(connection); }

    @Override public Page<AdminUserView> list(int page, int pageSize) {
        try (var count = connection.prepareStatement("SELECT COUNT(*) FROM users");
             var statement = connection.prepareStatement(VIEW + "ORDER BY id DESC LIMIT ? OFFSET ?")) {
            long total;
            try (var rs=count.executeQuery()) { rs.next(); total=rs.getLong(1); }
            statement.setInt(1,pageSize); statement.setInt(2,Math.multiplyExact(page-1,pageSize));
            List<AdminUserView> rows=new ArrayList<>();
            try (var rs=statement.executeQuery()) { while(rs.next()) rows.add(map(rs)); }
            return new Page<>(rows,total,page,pageSize);
        } catch (SQLException e) { throw new DataAccessException("List admin users",e); }
    }

    @Override public Optional<AdminUserView> find(long id) {
        try(var statement=connection.prepareStatement(VIEW+"WHERE id=?")) {
            statement.setLong(1,id);
            try(var rs=statement.executeQuery()) { return rs.next()?Optional.of(map(rs)):Optional.empty(); }
        } catch(SQLException e) { throw new DataAccessException("Find admin user",e); }
    }

    @Override public List<Long> lockActiveAdminIds() {
        try {
            if(connection.getAutoCommit()) throw new SQLException("ADMIN lock requires transaction");
            try(var statement=connection.prepareStatement("SELECT id FROM users WHERE system_role='ADMIN' AND status='ACTIVE' ORDER BY id FOR UPDATE");
                var rs=statement.executeQuery()) {
                List<Long> ids=new ArrayList<>(); while(rs.next()) ids.add(rs.getLong(1)); return ids;
            }
        } catch(SQLException e) { throw new DataAccessException("Lock active admins",e); }
    }

    private static AdminUserView map(ResultSet rs) throws SQLException {
        return new AdminUserView(rs.getLong("id"),rs.getString("username"),rs.getString("display_name"),
                SystemRole.valueOf(rs.getString("system_role")),UserStatus.valueOf(rs.getString("status")),
                rs.getInt("lock_version"),rs.getObject("created_at",LocalDateTime.class));
    }
}
