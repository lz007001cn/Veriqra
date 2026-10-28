package io.github.lz007001cn.veriqra.admin;

import io.github.lz007001cn.veriqra.model.SystemRole;
import io.github.lz007001cn.veriqra.model.UserStatus;
import io.github.lz007001cn.veriqra.service.exception.ValidationException;
import java.util.Set;

/** Validated, server-wide account filters and ordering. */
public record AdminUserQuery(int page, int pageSize, String search, SystemRole systemRole,
                             UserStatus status, String sort, String order) {
    private static final Set<String> SORTS = Set.of("id", "username", "displayName", "systemRole", "status", "createdAt");
    public AdminUserQuery {
        if (page < 1 || page > 1_000_000 || pageSize < 1 || pageSize > 100)
            throw new ValidationException("Invalid user pagination");
        search = search == null ? "" : search.strip();
        if (search.length() > 160) throw new ValidationException("User search is too long");
        sort = sort == null || sort.isBlank() ? "id" : sort;
        order = order == null || order.isBlank() ? "desc" : order;
        if (!SORTS.contains(sort) || !Set.of("asc", "desc").contains(order))
            throw new ValidationException("Invalid user ordering");
    }
    public static AdminUserQuery page(int page, int pageSize) {
        return new AdminUserQuery(page, pageSize, "", null, null, "id", "desc");
    }
}
