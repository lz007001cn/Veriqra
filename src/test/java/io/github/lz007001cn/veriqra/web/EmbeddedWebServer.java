package io.github.lz007001cn.veriqra.web;

import jakarta.servlet.*;
import org.apache.catalina.Context;
import org.apache.catalina.startup.Tomcat;
import org.apache.tomcat.util.descriptor.web.*;
import java.nio.file.*;
import java.util.Set;

/** Real loopback Tomcat; no database is opened by this component-test composition root. */
public final class EmbeddedWebServer implements AutoCloseable {
    private final Tomcat tomcat;
    private final String contextPath;
    public EmbeddedWebServer(Path directory, WebServices services) throws Exception {
        this(directory, services, false);
    }
    public EmbeddedWebServer(Path directory, WebServices services, boolean secureCookie) throws Exception {
        this(directory, services, secureCookie, "/veriqra");
    }
    public EmbeddedWebServer(Path directory, WebServices services, boolean secureCookie, String contextPath) throws Exception {
        this(directory, services, null, secureCookie, contextPath);
    }
    public EmbeddedWebServer(Path directory, WebServices services,
                             io.github.lz007001cn.veriqra.service.ProjectSettingsService projectSettings,
                             boolean secureCookie, String contextPath) throws Exception {
        this.contextPath = contextPath;
        tomcat = new Tomcat();
        tomcat.setBaseDir(directory.toString());
        tomcat.setPort(0);
        tomcat.getConnector().setProperty("address", "127.0.0.1");
        Context context = tomcat.addContext(contextPath, directory.toString());
        context.setParentClassLoader(EmbeddedWebServer.class.getClassLoader());
        context.addServletContainerInitializer((classes, servletContext) -> {
            servletContext.setAttribute(WebServices.ATTRIBUTE, services);
            if (projectSettings != null) servletContext.setAttribute(
                    io.github.lz007001cn.veriqra.service.ProjectSettingsService.class.getName(), projectSettings);
            servletContext.setSessionTrackingModes(Set.of(SessionTrackingMode.COOKIE));
            io.github.lz007001cn.veriqra.web.security.SessionCookiePolicy.configure(
                    servletContext, Boolean.toString(secureCookie), null);
        }, Set.of());
        Tomcat.addServlet(context, "api", new ApiServlet());
        context.addServletMappingDecoded("/api/*", "api");
        filter(context, "errors", new ApiExceptionFilter());
        filter(context, "auth", new AuthenticationFilter());
        tomcat.start();
    }
    private static void filter(Context context, String name, Filter filter) {
        FilterDef def = new FilterDef(); def.setFilterName(name); def.setFilter(filter);
        context.addFilterDef(def);
        FilterMap map = new FilterMap(); map.setFilterName(name); map.addURLPattern("/api/*");
        context.addFilterMap(map);
    }
    public String base() { return "http://127.0.0.1:" + tomcat.getConnector().getLocalPort() + contextPath; }
    @Override public void close() throws Exception { try { tomcat.stop(); } finally { tomcat.destroy(); } }
}
