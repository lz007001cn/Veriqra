package io.github.lz007001cn.veriqra.integration;

import io.github.lz007001cn.veriqra.admin.*;
import io.github.lz007001cn.veriqra.dao.jdbc.JdbcUserDao;
import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.DefaultAuthService;
import io.github.lz007001cn.veriqra.service.auth.PasswordVerifier;
import io.github.lz007001cn.veriqra.service.exception.*;
import io.github.lz007001cn.veriqra.service.support.*;
import org.junit.jupiter.api.*;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;

/** Administration mutations run only against the fixture-owned veriqra_test_* schema. */
class AdminServiceIntegrationTest extends MysqlFixture {
    private AdminUserService users;
    private PasswordVerifier passwords;
    private User admin,user;
    private AdminContext context;

    @BeforeEach void setUpAdmin() {
        var transactions=new JdbcServiceTransaction(tx);
        var access=new AdminAccessPolicy();passwords=new PasswordVerifier();
        users=new AdminUserService(transactions,access,passwords);
        admin=tx.inTransaction(c->new JdbcUserDao(c).insert(new User(null,"admin_r5","Admin",passwords.hash("admin-test-password"),
                SystemRole.ADMIN,UserStatus.ACTIVE,null,null,null)));
        user=tx.inTransaction(c->new JdbcUserDao(c).insert(new User(null,"user_r5","User","fixture-hash",
                SystemRole.USER,UserStatus.ACTIVE,null,null,null)));
        context=new AdminContext(admin.id(),"127.0.0.1",UUID.randomUUID().toString());
    }

    @Test void userCreationReturnsBasicAccountFieldsAndRequiresAdmin() {
        AdminUserView created=users.create(context,"new_r5","New User","fresh-user-password",SystemRole.USER,UserStatus.ACTIVE);
        assertEquals("new_r5",created.username());
        assertEquals("New User",created.displayName());
        assertThrows(AdminConflictException.class,()->users.create(context,"new_r5","Again","fresh-user-password",SystemRole.USER,UserStatus.ACTIVE));
        assertThrows(ForbiddenException.class,()->users.list(user.id(),1,10));
    }

    @Test void lastActiveAdminCannotBeDisabledOrDemotedAndVersionsAreEnforced() {
        assertEquals("LAST_ADMIN_REQUIRED",assertThrows(AdminConflictException.class,()->users.update(context,admin.id(),
                admin.displayName(),SystemRole.ADMIN,UserStatus.DISABLED,admin.lockVersion())).code());
        assertEquals("LAST_ADMIN_REQUIRED",assertThrows(AdminConflictException.class,()->users.update(context,admin.id(),
                admin.displayName(),SystemRole.USER,UserStatus.ACTIVE,admin.lockVersion())).code());
        var second=users.create(context,"second_r5","Second","second-admin-pass",SystemRole.ADMIN,UserStatus.ACTIVE);
        var changed=users.update(context,admin.id(),"Admin",SystemRole.ADMIN,UserStatus.DISABLED,admin.lockVersion());
        assertEquals(UserStatus.DISABLED,changed.status());
        assertThrows(ForbiddenException.class,()->users.list(admin.id(),1,10));
        assertThrows(ConflictException.class,()->users.update(new AdminContext(second.id(),"127.0.0.1",UUID.randomUUID().toString()),
                user.id(),"Changed",SystemRole.USER,UserStatus.ACTIVE,99));
    }

    @Test void competingAdminDisablesNeverRemoveEveryActiveAdmin() throws Exception {
        var second=users.create(context,"second_r5","Second","second-admin-pass",SystemRole.ADMIN,UserStatus.ACTIVE);
        var secondContext=new AdminContext(second.id(),"127.0.0.1",UUID.randomUUID().toString());
        var start=new CountDownLatch(1);
        try(var workers=Executors.newFixedThreadPool(2)) {
            var first=workers.submit(()->{start.await();return users.update(context,admin.id(),"Admin",SystemRole.ADMIN,
                    UserStatus.DISABLED,admin.lockVersion());});
            var other=workers.submit(()->{start.await();return users.update(secondContext,second.id(),"Second",SystemRole.ADMIN,
                    UserStatus.DISABLED,second.lockVersion());});
            start.countDown();
            for(var job:List.of(first,other)) {
                try { job.get(15,TimeUnit.SECONDS); }
                catch(ExecutionException failure) {
                    assertTrue(failure.getCause() instanceof AdminConflictException
                                    || failure.getCause() instanceof io.github.lz007001cn.veriqra.exception.DataAccessException,
                            ()->"Unexpected competing update failure: "+failure.getCause());
                }
            }
        }
        long active=tx.inTransaction(c->{try(var statement=c.prepareStatement(
                "SELECT COUNT(*) FROM users WHERE system_role='ADMIN' AND status='ACTIVE'");
            var rows=statement.executeQuery()){rows.next();return rows.getLong(1);} });
        assertTrue(active>=1,"Concurrent demotions must preserve an active administrator");
    }

    @Test void passwordResetUsesCurrentHasherAndDisabledUserCannotAuthenticate() {
        var auth=new DefaultAuthService(new JdbcServiceTransaction(tx),new JdbcServiceDaoFactory(),passwords);
        var created=users.create(context,"login_r5","Login","old-login-password",SystemRole.USER,UserStatus.ACTIVE);
        assertEquals(created.id(),auth.authenticate("login_r5","old-login-password").id());
        users.resetPassword(context,created.id(),"new-login-password");
        assertThrows(AuthenticationException.class,()->auth.authenticate("login_r5","old-login-password"));
        assertEquals(created.id(),auth.authenticate("login_r5","new-login-password").id());
        var latest=users.get(admin.id(),created.id());
        users.update(context,created.id(),latest.displayName(),SystemRole.USER,UserStatus.DISABLED,latest.lockVersion());
        assertThrows(AuthenticationException.class,()->auth.current(created.id()));
        assertThrows(AuthenticationException.class,()->auth.authenticate("login_r5","new-login-password"));
    }

    @Test void requiredAuditFailureRollsBackUserCreation() {
        var invalidContext = new AdminContext(admin.id(), "x".repeat(46), UUID.randomUUID().toString());
        assertThrows(io.github.lz007001cn.veriqra.exception.DataAccessException.class,
                () -> users.create(invalidContext, "audit_rollback", "Rollback", "temporary-password", SystemRole.USER, UserStatus.ACTIVE));
        assertTrue(tx.inTransaction(c -> new JdbcUserDao(c).findByUsername("audit_rollback")).isEmpty());
    }
}
