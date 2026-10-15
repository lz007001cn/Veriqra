package io.github.lz007001cn.veriqra.integration;

import java.nio.file.*;
import java.sql.*;
import java.util.*;

/** Dedicated R1 identity guard, before fixture DDL/DML; no environment fallback. */
final class R1MysqlTarget {
    private R1MysqlTarget() { }
    static Connection open() throws Exception {
        return open(true);
    }
    static Connection observer() throws Exception {
        return open(false);
    }
    private static Connection open(boolean owner) throws Exception {
        String selected=System.getProperty("r1.fixture.config");
        if(selected==null)throw new IllegalStateException("Explicit R1 fixture configuration required");
        Properties p=new Properties();
        try(var r=Files.newBufferedReader(Path.of(selected))){p.load(r);}
        String url=p.getProperty("jdbcUrl"); String schema=MysqlFixture.requireTestUrl(url);
        if(!schema.startsWith("veriqra_test_r1_") || !"r1_foundation".equals(p.getProperty("username"))
                || !url.startsWith("jdbc:mysql://127.0.0.1:"+p.getProperty("r1.expectedPort")+"/"))
            throw new IllegalStateException("Wrong R1 URL/account");
        Properties login=new Properties();login.setProperty("user",p.getProperty("username"));login.setProperty("password",p.getProperty("password"));
        login.setProperty("connectTimeout","3000");login.setProperty("socketTimeout","10000");
        Connection c=DriverManager.getConnection(url,login);
        try {
            try(var s=c.createStatement();var r=s.executeQuery("SELECT DATABASE(),VERSION(),@@port,@@datadir,@@server_uuid,@@foreign_key_checks")){
                if(!r.next() || !schema.equals(r.getString(1)) || !"8.0.46".equals(r.getString(2))
                        || Integer.parseInt(p.getProperty("r1.expectedPort"))!=r.getInt(3)
                        || !Path.of(p.getProperty("r1.expectedDataDir")).toRealPath().equals(Path.of(r.getString(4)).toRealPath())
                        || !p.getProperty("r1.expectedServerUuid").equals(r.getString(5)) || r.getInt(6)!=1)
                    throw new IllegalStateException("R1 server/schema identity mismatch");
            }
            if(owner)try(var s=c.prepareStatement("SELECT GET_LOCK(?,0)")){
                s.setString(1,"r1-foundation:"+schema);
                try(var r=s.executeQuery()){if(!r.next() || r.getInt(1)!=1)throw new IllegalStateException("R1 fixture already owned");}
            }
            if(!owner)c.setReadOnly(true);
            return c;
        } catch(Exception e){try{c.close();}catch(SQLException close){e.addSuppressed(close);}throw e;}
    }
}
