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

    @Override public Page<AdminUserView> list(AdminUserQuery query) {
        Objects.requireNonNull(query);
        StringBuilder where = new StringBuilder("WHERE 1=1");
        List<String> parameters = new ArrayList<>();
        if (!query.search().isEmpty()) {
            where.append(" AND (LOCATE(?,username)>0 OR LOCATE(?,display_name)>0)");
            parameters.add(query.search()); parameters.add(query.search());
        }
        if (query.systemRole() != null) { where.append(" AND system_role=?"); parameters.add(query.systemRole().name()); }
        if (query.status() != null) { where.append(" AND status=?"); parameters.add(query.status().name()); }
        // Only fixed SQL identifiers enter ORDER BY; all user text remains bound data.
        String sort = switch (query.sort()) {
            case "username" -> "username";
            case "displayName" -> "display_name";
            case "systemRole" -> "system_role";
            case "status" -> "status";
            case "createdAt" -> "created_at";
            default -> "id";
        };
        String order = query.order().equals("asc") ? " ASC" : " DESC";
        String ordering = " ORDER BY " + sort + order + (sort.equals("id") ? "" : ",id" + order);
        try (var count = connection.prepareStatement("SELECT COUNT(*) FROM users " + where);
             var statement = connection.prepareStatement(VIEW + where + ordering + " LIMIT ? OFFSET ?")) {
            bind(count, parameters); bind(statement, parameters);
            long total;
            try (var rs=count.executeQuery()) { rs.next(); total=rs.getLong(1); }
            statement.setInt(parameters.size()+1,query.pageSize());
            statement.setInt(parameters.size()+2,Math.multiplyExact(query.page()-1,query.pageSize()));
            List<AdminUserView> rows=new ArrayList<>();
            try (var rs=statement.executeQuery()) { while(rs.next()) rows.add(map(rs)); }
            return new Page<>(rows,total,query.page(),query.pageSize());
        } catch (SQLException e) { throw new DataAccessException("List admin users",e); }
    }

    private static void bind(PreparedStatement statement, List<String> values) throws SQLException {
        for (int i = 0; i < values.size(); i++) statement.setString(i+1, values.get(i));
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
