package io.github.lz007001cn.veriqra.integration;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.lz007001cn.veriqra.dao.jdbc.JdbcUserDao;
import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.auth.PasswordVerifier;
import io.github.lz007001cn.veriqra.service.command.*;
import org.junit.jupiter.api.Test;
import java.nio.file.*;
import java.security.SecureRandom;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** One-time synthetic prerequisites only. FAIL/Defect/retest/close are reserved for real browser input. */
class R1BrowserFixtureSetupTest extends R1ServiceFixture {
    @Test void createSyntheticBrowserPrerequisitesOnce() throws Exception {
        Path output=Path.of(Objects.requireNonNull(System.getProperty("r1.browser.credentials")));
        assertEquals("private",output.toAbsolutePath().getParent().getFileName().toString());
        assertFalse(Files.exists(output),"Never overwrite/reseed browser credentials");
        Map<String,Object> accounts=new LinkedHashMap<>();
        User admin=loginActor(accounts,"admin","R1 隔离管理员",SystemRole.ADMIN);
        User tester=loginActor(accounts,"tester","陈测试 · QA",SystemRole.USER);
        User developer=loginActor(accounts,"developer","林开发 · Backend",SystemRole.USER);
        User developer2=loginActor(accounts,"developer2","王开发 · Frontend",SystemRole.USER);
        loginActor(accounts,"outsider","无项目权限用户",SystemRole.USER);
        Project project=projects.create(admin.id(),new CreateProjectCommand("R1BROWSER","R1 隔离 QA 闭环",
                "仅合成隔离验收。不是生产测试结果。",tester.id(),ProjectRole.TESTER));
        addMember(project,developer,ProjectRole.DEVELOPER,MembershipStatus.ACTIVE);
        addMember(project,developer2,ProjectRole.DEVELOPER,MembershipStatus.ACTIVE);
        Map<String,Object> cases=new LinkedHashMap<>();
        for(var entry:Map.of("terminal","终态登录失败复测","manual","同运行手工复测",
                "imported","JUnit 导入登录校验","multi","多来源与阻断校验").entrySet()) {
            TestCase tc=readyCase(tester,project,entry.getValue(),"合成 R1 验收：冻结事实保持不变",
                    "处于隔离环境",Priority.HIGH,List.of(new TestStepInput(1,"打开合成登录页","显示登录表单"),
                            new TestStepInput(2,"提交合成有效账号","显示工作台")));
            TestRun run=testRuns.createAdHoc(tester.id(),new CreateAdHocRunCommand(project.id(),
                    entry.getValue()+" · 原运行","isolated","R1-SYNTHETIC",List.of(tc.id())));
            cases.put(entry.getKey(),Map.of("testCaseId",tc.id(),"runId",run.id(),"runCaseId",testRuns.listRunCases(tester.id(),run.id()).getFirst().id()));
            if(entry.getKey().equals("imported")) {
                var identity=automation.registerIdentity(tester.id(),project.id(),AutomationSource.JUNIT,"r1.browser.junit","demo.Login#validCredentials");
                automation.mapIdentity(tester.id(),identity.id(),tc.id(),null);
            }
        }
        assertTrue(defects.listByProject(tester.id(),project.id()).isEmpty());
        var record=Map.of("accounts",accounts,"projectId",project.id(),"cases",cases,"syntheticOnly",true);
        Files.writeString(output,new ObjectMapper().writerWithDefaultPrettyPrinter().writeValueAsString(record),StandardOpenOption.CREATE_NEW);
    }
    private User loginActor(Map<String,Object> accounts,String role,String name,SystemRole systemRole) {
        byte[] random=new byte[24];new SecureRandom().nextBytes(random);
        String password=Base64.getUrlEncoder().withoutPadding().encodeToString(random);
        String username="r1_browser_"+role;
        String hash=new PasswordVerifier().hash(password);
        User user=tx.inTransaction(c->new JdbcUserDao(c).insert(new User(null,username,name,hash,systemRole,UserStatus.ACTIVE,null,null,null)));
        accounts.put(role,Map.of("username",username,"password",password,"id",user.id(),"displayName",name));
        return user;
    }
}
