package io.github.lz007001cn.veriqra.admin;

import io.github.lz007001cn.veriqra.dao.jdbc.JdbcUserDao;
import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.auth.PasswordVerifier;
import io.github.lz007001cn.veriqra.service.exception.*;
import io.github.lz007001cn.veriqra.service.support.ServiceTransaction;
import io.github.lz007001cn.veriqra.exception.DataAccessException;
import java.util.*;

/** Account administration; every mutation and required audit row share one JDBC transaction. */
public final class AdminUserService {
    private final ServiceTransaction tx;
    private final AdminAccessPolicy policy;
    private final PasswordVerifier passwords;
    public AdminUserService(ServiceTransaction tx,AdminAccessPolicy policy,PasswordVerifier passwords) {
        this.tx=Objects.requireNonNull(tx);this.policy=Objects.requireNonNull(policy);this.passwords=Objects.requireNonNull(passwords);
    }
    public Page<AdminUserView> list(long actor,int page,int size) {
        return list(actor,AdminUserQuery.page(page,size));
    }
    public Page<AdminUserView> list(long actor,AdminUserQuery query) {
        Objects.requireNonNull(query);
        return tx.execute(c->{policy.requireRead(c,actor);return new JdbcAdminUserDao(c).list(query);});
    }
    public AdminUserView get(long actor,long id) {
        return tx.execute(c->{policy.requireRead(c,actor);return new JdbcAdminUserDao(c).find(id)
                .orElseThrow(()->new NotFoundException("User not found"));});
    }
    public AdminUserView create(AdminContext ctx,String username,String displayName,String rawPassword,
                                SystemRole role,UserStatus status) {
        if(username==null || !username.matches("[A-Za-z0-9._-]{3,64}") || displayName==null
                || displayName.isBlank() || displayName.length()>80 || role==null || status==null)
            throw new ValidationException("Invalid user fields");
        validatePassword(rawPassword);
        tx.execute(c->{policy.requireRead(c,ctx.actorId());return null;});
        String hash=passwords.hash(rawPassword);
        try {
            return tx.execute(c->{
                policy.requireWrite(c,ctx.actorId());
                User created=new JdbcUserDao(c).insert(new User(null,username,displayName.strip(),hash,role,status,null,null,null));
                audit(c,ctx,"USER_CREATED",created.id(),"User created");
                return new JdbcAdminUserDao(c).find(created.id()).orElseThrow();
            });
        } catch(DataAccessException e) {
            if(e.getVendorCode()==1062)throw new AdminConflictException("USERNAME_CONFLICT","Username is already in use");
            throw e;
        }
    }
    public AdminUserView update(AdminContext ctx,long id,String displayName,SystemRole role,
                                UserStatus status,int expectedVersion) {
        if(displayName==null || displayName.isBlank() || displayName.length()>80 || role==null || status==null
                || expectedVersion<0) throw new ValidationException("Invalid user update");
        return tx.execute(c->{
            List<Long> activeAdmins=policy.requireWrite(c,ctx.actorId());
            var users=new JdbcUserDao(c);
            User before=users.findById(id).orElseThrow(()->new NotFoundException("User not found"));
            if(before.lockVersion()!=expectedVersion)throw new ConflictException("User version changed");
            if(before.status()==UserStatus.ACTIVE && before.systemRole()==SystemRole.ADMIN
                    && (role!=SystemRole.ADMIN || status!=UserStatus.ACTIVE)
                    && activeAdmins.size()==1 && activeAdmins.contains(id))
                throw new AdminConflictException("LAST_ADMIN_REQUIRED","At least one active administrator is required");
            User after=users.update(new User(before.id(),before.username(),displayName.strip(),before.passwordHash(),
                    role,status,before.createdAt(),before.updatedAt(),expectedVersion));
            if(before.status()!=status) audit(c,ctx,status==UserStatus.ACTIVE?"USER_ENABLED":"USER_DISABLED",id,"User status changed");
            if(before.systemRole()!=role) audit(c,ctx,"USER_ROLE_CHANGED",id,"User role changed");
            if(before.status()==status && before.systemRole()==role) audit(c,ctx,"USER_UPDATED",id,"User profile updated");
            return new JdbcAdminUserDao(c).find(after.id()).orElseThrow();
        });
    }
    public void resetPassword(AdminContext ctx,long id,String rawPassword) {
        validatePassword(rawPassword);
        tx.execute(c->{policy.requireRead(c,ctx.actorId());return null;});
        String hash=passwords.hash(rawPassword);
        tx.execute(c->{
            policy.requireWrite(c,ctx.actorId());
            var users=new JdbcUserDao(c);
            User before=users.findById(id).orElseThrow(()->new NotFoundException("User not found"));
            users.update(new User(before.id(),before.username(),before.displayName(),hash,before.systemRole(),
                    before.status(),before.createdAt(),before.updatedAt(),before.lockVersion()));
            audit(c,ctx,"USER_PASSWORD_RESET",id,"User password reset");
            return null;
        });
    }
    private static void validatePassword(String password) {
        if(password==null || password.length()<12 || password.length()>1024 || password.isBlank())
            throw new ValidationException("Password must be 12 to 1024 characters");
    }
    static void audit(java.sql.Connection c,AdminContext ctx,String action,Long target,String summary) {
        new JdbcAdminLogDao(c).appendAudit(new AuditEvent(0,ctx.actorId(),action,"USER",target,summary,
                null,ctx.ipAddress(),ctx.requestId(),null));
    }
}
