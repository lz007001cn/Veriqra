package io.github.lz007001cn.veriqra.integration;

import java.nio.file.Path;
import java.sql.*;
import java.util.Properties;

/** R2-only identity proof before fixture DDL/DML; no fallback to R1 or daily development data. */
final class R2MysqlTarget {
    private R2MysqlTarget() { }
    static String validate(Properties properties) {
        String url = properties.getProperty("jdbcUrl", "");
        String schema = MysqlFixture.requireTestUrl(url);
        String port = properties.getProperty("r2.expectedPort", "");
        if (!schema.startsWith("veriqra_test_r2_contract_")
                || !"r2_contract".equals(properties.getProperty("username"))
                || !port.matches("[1-9][0-9]{0,4}")
                || !url.equals("jdbc:mysql://127.0.0.1:" + port + "/" + schema)
                || !properties.getProperty("r2.expectedServerUuid", "").matches("[a-fA-F0-9-]{36}")
                || !Path.of(properties.getProperty("r2.expectedDataDir", "")).isAbsolute())
            throw new IllegalStateException("Wrong R2 fixture identity configuration");
        return schema;
    }
    static Connection open(Properties properties) throws Exception {
        String schema = validate(properties);
        Properties login = new Properties();
        login.setProperty("user", properties.getProperty("username"));
        login.setProperty("password", properties.getProperty("password"));
        login.setProperty("connectTimeout", "3000");
        login.setProperty("socketTimeout", "10000");
        Connection connection = DriverManager.getConnection(properties.getProperty("jdbcUrl"), login);
        try {
            try (var statement = connection.createStatement(); var result = statement.executeQuery(
                    "SELECT DATABASE(),VERSION(),@@port,@@datadir,@@server_uuid,@@foreign_key_checks")) {
                if (!result.next() || !schema.equals(result.getString(1)) || !"8.0.46".equals(result.getString(2))
                        || Integer.parseInt(properties.getProperty("r2.expectedPort")) != result.getInt(3)
                        || !Path.of(properties.getProperty("r2.expectedDataDir")).toRealPath()
                            .equals(Path.of(result.getString(4)).toRealPath())
                        || !properties.getProperty("r2.expectedServerUuid").equals(result.getString(5))
                        || result.getInt(6) != 1)
                    throw new IllegalStateException("R2 server/schema identity mismatch");
            }
            try (var statement = connection.prepareStatement("SELECT GET_LOCK(?,0)")) {
                statement.setString(1, "r2-contract:" + schema);
                try (var result = statement.executeQuery()) {
                    if (!result.next() || result.getInt(1) != 1)
                        throw new IllegalStateException("R2 fixture already owned");
                }
            }
            return connection;
        } catch (Exception failure) {
            try { connection.close(); } catch (SQLException close) { failure.addSuppressed(close); }
            throw failure;
        }
    }
}
