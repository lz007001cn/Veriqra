package io.github.lz007001cn.veriqra.service.support;

import io.github.lz007001cn.veriqra.dao.jdbc.*;
import java.sql.Connection;
import java.util.Objects;

/** Creates non-owning JDBC DAOs over exactly the supplied transaction Connection. */
public final class JdbcServiceDaoFactory implements ServiceDaoFactory {
    @Override public ServiceDaos create(Connection connection) {
        Objects.requireNonNull(connection);
        return new ServiceDaos(new JdbcUserDao(connection), new JdbcProjectDao(connection),
                new JdbcProjectMemberDao(connection), new JdbcProjectCounterDao(connection),
                new JdbcRequirementDao(connection), new JdbcTestCaseDao(connection),
                new JdbcTestStepDao(connection), new JdbcTestCaseRequirementDao(connection),
                new JdbcTestPlanDao(connection), new JdbcTestPlanCaseDao(connection),
                new JdbcTestRunDao(connection), new JdbcTestRunCaseDao(connection),
                new JdbcTestRunCaseStepDao(connection), new JdbcTestAttemptDao(connection),
                new JdbcDefectDao(connection), new JdbcTestAttemptDefectDao(connection),
                new JdbcTestAutomationIdentityDao(connection), new JdbcTestAutomationMappingDao(connection),
                new JdbcTestImportDao(connection), new JdbcCollaborationDao(connection),
                new JdbcDefectRetestLinkDao(connection), new JdbcDefectClosureReceiptDao(connection),
                new JdbcDefectClosureItemDao(connection));
    }
}
