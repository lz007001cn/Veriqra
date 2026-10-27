package io.github.lz007001cn.veriqra.admin;

import java.util.List;
import java.util.Optional;

/** Read projections and serialized ADMIN lock; ordinary row writes remain on UserDao. */
public interface AdminUserDao {
    default Page<AdminUserView> list(int page, int pageSize) { return list(AdminUserQuery.page(page, pageSize)); }
    Page<AdminUserView> list(AdminUserQuery query);
    Optional<AdminUserView> find(long id);
    List<Long> lockActiveAdminIds();
}
