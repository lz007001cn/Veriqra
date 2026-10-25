package io.github.lz007001cn.veriqra.web;

import io.github.lz007001cn.veriqra.model.*;
import io.github.lz007001cn.veriqra.service.*;
import io.github.lz007001cn.veriqra.service.auth.AuthenticatedUser;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.net.URI;
import java.net.http.*;
import java.nio.file.Path;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Basic project settings routes keep their existing JSON contract after collaboration retirement. */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class ProjectSettingsWebTest {
    @TempDir static Path directory;
    EmbeddedWebServer server;
    HttpClient client;
    String cookie, invoked;
    Object[] arguments;

    private static <T> T unused(Class<T> type) {
        return WebFoundationTest.proxy(type, (o,m,a) -> { throw new AssertionError("Unexpected " + m.getName()); });
    }
    @BeforeAll void start() throws Exception {
        AuthService auth=new AuthService() {
            public AuthenticatedUser authenticate(String username,String password) { return current(1L); }
            public AuthenticatedUser current(Long id) { return new AuthenticatedUser(id,"settings-test",SystemRole.ADMIN,UserStatus.ACTIVE); }
        };
        ProjectSettingsService settings=WebFoundationTest.proxy(ProjectSettingsService.class,(o,m,a) -> {
            invoked=m.getName(); arguments=a;
            return switch(m.getName()) {
                case "listProjectMembers" -> List.of(new ProjectSettingsService.MemberView(2L,"tester","Tester",ProjectRole.TESTER,MembershipStatus.ACTIVE,UserStatus.ACTIVE));
                case "addProjectMember" -> new ProjectSettingsService.MemberView(3L,(String)a[2],"Developer",(ProjectRole)a[3],MembershipStatus.ACTIVE,UserStatus.ACTIVE);
                case "listManagers" -> List.of(new ProjectManager(7L,2L,1L,MembershipStatus.ACTIVE,null,null));
                case "appointManager" -> new ProjectManager(7L,(Long)a[2],1L,MembershipStatus.ACTIVE,null,null);
                case "revokeManager" -> null;
                default -> throw new AssertionError(m.getName());
            };
        });
        server=new EmbeddedWebServer(directory,new WebServices(auth,unused(ProjectService.class),unused(RequirementService.class),
                unused(TestCaseService.class),unused(TraceabilityService.class),unused(TestPlanService.class),
                unused(TestRunService.class),unused(TestExecutionService.class),unused(DefectService.class),
                unused(AutomationService.class),unused(TestImportService.class)),settings,false,"/veriqra");
        client=HttpClient.newHttpClient();
    }
    @AfterAll void stop() throws Exception { if(client!=null) client.close(); if(server!=null) server.close(); }
    @BeforeEach void login() throws Exception {
        cookie=null;
        var response=call("POST","/auth/login","{\"username\":\"settings-test\",\"password\":\"test-only\"}");
        assertEquals(200,response.statusCode());
        cookie=response.headers().firstValue("set-cookie").orElseThrow().split(";",2)[0];
        invoked=null;arguments=null;
    }
    private HttpResponse<String> call(String method,String path,String body) throws Exception {
        URI address=URI.create(server.base()+"/api"+path);
        var request=HttpRequest.newBuilder(address).header("Origin","http://"+address.getRawAuthority()).header("X-Veriqra-Request","1");
        if(cookie!=null) request.header("Cookie",cookie);
        if(body!=null) request.header("Content-Type","application/json");
        return client.send(request.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(body)).build(),HttpResponse.BodyHandlers.ofString());
    }
    @Test void membersAndManagersKeepScopedReadWriteAndRemovalContracts() throws Exception {
        assertEquals(200,call("GET","/projects/7/members",null).statusCode());
        assertEquals("listProjectMembers",invoked); assertArrayEquals(new Object[]{1L,7L},arguments);
        assertEquals(201,call("POST","/projects/7/members","{\"username\":\"developer\",\"projectRole\":\"DEVELOPER\"}").statusCode());
        assertEquals("addProjectMember",invoked); assertArrayEquals(new Object[]{1L,7L,"developer",ProjectRole.DEVELOPER},arguments);
        assertEquals(200,call("GET","/projects/7/managers",null).statusCode()); assertEquals("listManagers",invoked);
        assertEquals(201,call("POST","/projects/7/managers","{\"userId\":2}").statusCode()); assertArrayEquals(new Object[]{1L,7L,2L},arguments);
        assertEquals(204,call("DELETE","/projects/7/managers/2",null).statusCode()); assertEquals("revokeManager",invoked);
        assertArrayEquals(new Object[]{1L,7L,2L},arguments);
    }
    @Test void retiredWorkflowEndpointsNoLongerDispatch() throws Exception {
        for(String path:List.of("/projects/7/teams","/projects/7/tasks","/projects/7/handoffs","/projects/7/contributions","/projects/7/credit-transfers","/credits/me"))
            assertEquals(404,call("GET",path,null).statusCode(),path);
        assertNull(invoked);
    }
    @Test void settingsRequestBodiesRetainStrictIdAndRoleTypes() throws Exception {
        assertEquals(400,call("POST","/projects/7/managers","{\"userId\":\"2\"}").statusCode());
        assertEquals(400,call("POST","/projects/7/members","{\"username\":\"developer\",\"projectRole\":\"ADMIN\"}").statusCode());
        assertEquals(405,call("DELETE","/projects/7/members",null).statusCode());
        assertNull(invoked);
    }
}
