package io.github.lz007001cn.veriqra.admin;

import java.util.List;
import java.util.Optional;

/** Read projections and serialized ADMIN lock; ordinary row writes remain on UserDao. */
public interface AdminUserDao {
    Page<AdminUserView> list(int page, int pageSize);
    Optional<AdminUserView> find(long id);
    List<Long> lockActiveAdminIds();
}
