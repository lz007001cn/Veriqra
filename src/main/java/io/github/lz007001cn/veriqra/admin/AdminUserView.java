package io.github.lz007001cn.veriqra.admin;

import io.github.lz007001cn.veriqra.model.*;
import java.time.LocalDateTime;

/** Safe admin projection; deliberately excludes password hash. */
public record AdminUserView(long id, String username, String displayName, SystemRole systemRole,
                            UserStatus status, int lockVersion, LocalDateTime createdAt) { }
