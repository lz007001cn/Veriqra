# Phase 2 Round 1 — JDBC Persistence Foundation

> Historical report: the original identifiers, paths, configuration names and checksums below are preserved as recorded. For current Veriqra configuration and deployment, see [VERIQRA-RENAME.md](VERIQRA-RENAME.md).

日期：2026-09-07。基线为 Java 21、Maven WAR、MySQL 8.0.46、V1 Freeze v1.0。
本轮只实现 JDBC 基础设施以及 User / Project 的持久化验证；没有修改冻结模型、schema.sql 或 seed.sql，没有实现 Service 业务、Servlet、Authentication 或前端。

## 1. 文件与依赖

应用根包：`io.github.lz007001cn.qatrack`。

```text
config/
  DatabaseConfig
jdbc/
  ConnectionPool
  JdbcTransactionManager
exception/
  DataAccessException
  OptimisticLockException
model/
  User, SystemRole, UserStatus
  Project, ProjectStatus
dao/
  UserDao, ProjectDao
  jdbc/JdbcUserDao, JdbcProjectDao, JdbcValues
```

Model 使用 Java 21 支持的 immutable record；id/FK 为 Long，lockVersion 为 Integer，时间为 LocalDateTime，状态及角色为 enum。User.toString 不输出密码哈希。记录不提供业务行为或认证方法。

Connector/J 固定 9.7.0（与当前 IDEA 驱动版本一致），runtime scope；仅使用经典 JDBC，排除 X DevAPI 需要的 protobuf-java。JUnit Jupiter 固定 5.13.4，test scope。Surefire 3.5.4 用于运行测试；无连接池库、ORM、Spring、Mockito 或 Servlet 依赖。

## 2. 配置加载

优先级由低到高：

1. classpath `/database.properties`：非敏感默认值。
2. 外部 UTF-8 properties 文件：默认 `config/database.local.properties`，相对于进程工作目录。
3. `QATRACK_DB_*` 环境变量：逐项覆盖，包括空字符串值。

外部文件路径选择优先级为 `QATRACK_DB_CONFIG` > JVM 参数 `-Dqatrack.db.config=...` > 默认相对路径。
显式指定的文件缺失立即报错；默认本地文件可不存在，但 password 必须通过文件或环境提供。示例中的空密码只是待配置值，加载器允许显式空密码，不代表已经配置日常开发库凭据。

| 属性 | 环境变量 | 默认 / 单位 |
| --- | --- | --- |
| jdbcUrl | QATRACK_DB_JDBC_URL | jdbc:mysql://localhost:3306/qatrack |
| username | QATRACK_DB_USERNAME | qatrack_app |
| password | QATRACK_DB_PASSWORD | 无默认，必须外部提供 |
| initialPoolSize | QATRACK_DB_INITIAL_POOL_SIZE | 2 |
| maxPoolSize | QATRACK_DB_MAX_POOL_SIZE | 8 |
| acquireTimeout | QATRACK_DB_ACQUIRE_TIMEOUT | 3000 毫秒；允许 1–300000 |

将 [应用示例](../config/database.example.properties) 复制为 `config/database.local.properties` 后填写本机账号；本轮没有创建 qatrack_app 账号或修改开发库账号权限。部署 Tomcat 时建议指定外部绝对路径，不依赖容器工作目录。

既有 `.gitignore` 的 `*.local.properties` 已覆盖本地配置，无需新增规则。配置目录在 WAR 源资源之外；POM 同时在 classpath 资源、webapp 复制及最终 WAR 打包环节排除 `*.local.properties`，覆盖压缩 WAR 和 exploded webapp。不要把真实口令放入默认文件或 JDBC URL。配置对象的 toString 隐藏 URL 和凭据。DataAccessException 的顶层消息不拼 SQL 参数，但保留的 SQLException cause 可能包含数据库值，不应直接返回客户端或无筛选打印日志。

## 3. 连接池与生命周期

- 构造时打开 initialPoolSize 条物理连接；并发需求增加时扩容，最多 maxPoolSize。
- `ReentrantLock + Condition` 保护空闲队列、连接集合及创建中的容量预留；网络连接创建在锁外执行。
- `borrow()` 返回 JDBC Connection 代理。`Connection.close()` 幂等地归还借用；旧代理不允许操作新借用者的连接。
- 归还前关闭遗漏的 Statement，回滚未提交事务，再恢复 autoCommit、readOnly、catalog、schema、隔离级别、warnings、UTC 会话时区与冻结 SQL 严格模式。catalog/schema 同时保存，兼容 Connector/J 的 databaseTerm 两种模式。
- 借出前调用 `isClosed/isValid(1)` 检查明显失效连接；失效或重置失败时先关闭，完成后才释放容量，防止替代连接与尚未关闭的旧连接竞争突破上限。若驱动物理 close 本身失败，会记录警告并移出池，不能承诺驱动故障后服务端会话已消失。
- Statement / ResultSet / DatabaseMetaData 的连接引用保持指向当前代理；禁止通过 unwrap 取得物理或厂商连接，避免 close 绕过连接池。Statement / ResultSet 代理有独立关闭标记，驱动缓存重用物理对象不会复活旧逻辑句柄。
- `pool.close()` 唤醒等待者、拒绝新借用，并关闭空闲及借出的物理连接；创建中的连接完成后也会被关闭。应用关闭时应先停止接受工作，再关闭池，不把关闭池当成正常事务完成方式。
- 每次借用只由一个线程使用，DAO 与其连接同生命周期，不能作为跨请求共享单例。

acquireTimeout 限定等待池容量的期限，并在验证/创建后检查是否已经超时；不承诺硬中断进行中的驱动网络 I/O。驱动默认 connectTimeout=3000ms、socketTimeout=10000ms，JDBC URL 可以显式调整。这是教学用连接池，没有后台清理、泄漏扫描、最大寿命、公平排队保证或自动事务重试。

池只恢复上述基础 JDBC 状态，不支持任意会话改造的彻底清理。业务 DAO 不应设置自定义 session 变量、修改网络时限、创建临时表或执行 DDL。DAO 必须仍然使用 try-with-resources 关闭 Statement/ResultSet，池的兜底不是资源管理替代品。

## 4. 事务基础：显式共享 Connection

事务入口统一拥有连接；DAO 构造函数接收该连接，DAO 不自行借连接、不 commit/rollback、不 close Connection。
这样多个 DAO 不会在各自自动提交的连接上形成“半个事务”。下面只展示调用模式，不是已实现的业务 Service：

```java
try (ConnectionPool pool = new ConnectionPool(DatabaseConfig.load())) {
    JdbcTransactionManager transactions = new JdbcTransactionManager(pool);
    transactions.inTransaction(connection -> {
        UserDao users = new JdbcUserDao(connection);
        ProjectDao projects = new JdbcProjectDao(connection);
        // 在同一个 connection 上调用两个 DAO。
        // 后续 Service 在这里执行权限校验及完整的项目创建事务。
        return null;
    });
}
```

成功时提交；SQLException / RuntimeException / Error 时回滚，回滚失败附加到原错误；最终归还连接。SQL 异常转换为 DataAccessException，并保存 SQLState、vendorCode 和 cause。提交已成功但连接清理失败时，异常消息明确标记 Transaction committed；此时不能把事务当成回滚并重试。未提供自动重试，因为提交本身失败也可能意味着提交结果未知。

同一事务管理器使用 ThreadLocal 仅检测当前线程上的嵌套入口，不通过 ThreadLocal 隐式寻找连接。嵌套事务直接拒绝；内层代码继续使用已有 Connection。不要创建另一个管理器绕过检测，也不要跨线程使用事务连接。callback 不得自行 commit、close 或改变 autoCommit；不要吞掉应导致整单回滚的异常。

单次读取可以由调用者 `try (Connection c = pool.borrow())` 包住 DAO 调用。写入及需要一致性的多次读取应走事务入口；DAO insert/update 后在同一连接读取完整数据库行，事务内可避免其他写入在回读前改变结果。DAO 返回的是事务内读回的数据，不是提交凭证；外层回滚后应丢弃该对象。若调用者使用 autoCommit=true，写入与回读是两个提交边界，不能依靠 DAO 自动恢复，应避免将此方式复制到跨 DAO 工作流。只写 User/Project 行不等于完成用户创建/项目创建业务流程，项目 Counter、成员等将由后续 Service 原子处理。

## 5. DAO 行为与类型边界

| DAO | 已实现 |
| --- | --- |
| UserDao / JdbcUserDao | findById、findByUsername、insert、update |
| ProjectDao / JdbcProjectDao | findById、findByKey、insert、update |

查无记录返回 Optional.empty。SQL 值全部通过 PreparedStatement 绑定；insert 使用生成主键并回读数据库默认时间/版本，调用参数中的 id/createdAt/updatedAt/lockVersion 不参与插入。

update 采用 `WHERE id=? AND lock_version=?`，同时 `lock_version=lock_version+1`、`updated_at=CURRENT_TIMESTAMP(6)`；影响行数不是 1 时抛 OptimisticLockException（DataAccessException 子类），表示记录不存在或版本过期，不静默覆盖。

User update 只修改 displayName/passwordHash/systemRole/status，不修改 username。Project update 只修改 name/description/status，不修改 projectKey/createdBy。不可变字段即使输入不同也不写入，返回实际持久化值；合法用户名格式、角色权限、归档前置条件等不在 DAO 内判断。没有 hard delete，也没有单独的业务 archive 方法。

冻结 schema 的 lock_version 是 INT UNSIGNED，完整范围超过 Java Integer。遵守本轮 Integer 映射，读取超过 Integer.MAX_VALUE 的值抛 SQLState 22003 对应 DataAccessException；更新到上界前拒绝增量，避免负数或溢出。此限制没有修改 Schema，需要未来有证据时另行评估类型映射。

DATETIME(6) 使用 `getObject(..., LocalDateTime.class)`，没有时区字段；应用约定 UTC，池显式设置 MySQL session time_zone。实测保存 123456 微秒并原样读回，不把 LocalDateTime 当成自动携带时区的 Instant。枚举转换不支持未知状态时明确失败。

## 6. 测试隔离与复现

选择 **A：独立空 test schema**。B：开发库内回滚不能覆盖真实 commit、连接归还、pool.close 等路径，AUTO_INCREMENT 消耗和 DDL 也不能依靠回滚恢复，因此不使用开发 seed 做集成测试。

集成测试使用测试库内自建 fixture，可以测试真实提交和回滚。要求 MySQL 精确版本 8.0.46，URL 为 `jdbc:mysql://localhost:端口/qatrack_test_名称` 或 127.0.0.1；拒绝其他库名、URL 参数及 root 测试账号。先取得命名锁并确认 schema 没有表，再从原始 schema.sql 创建完整 19 表；只有成功执行 CREATE 的表才登记为本轮所有，结束后逆序清理。DROP 使用完整 schema.table 名并再次检查 catalog；某项失败时继续收集后续清理异常，owner.close 不覆盖首个错误。schema 本身及账号由操作者事先创建，测试不创建账号、不删除 schema、不加载 seed。setup/cleanup 中断后可能保留部分测试对象；下次会拒绝非空库，不会自动强行删除未知对象。

将 [测试配置示例](../config/database-test.example.properties) 复制为 `config/database-test.local.properties`，填入独立测试库及其专用账号。测试配置独立于应用配置，优先级为测试文件 < QATRACK_TEST_JDBC_URL / USERNAME / PASSWORD。文件路径优先级为 QATRACK_TEST_CONFIG > -Dqatrack.test.config > 默认测试本地文件。集成测试 profile 启用但缺配置时构建失败，不跳过冒充通过。

```powershell
# 仅当前进程设置 JAVA_HOME；不修改 Windows PATH。
$env:JAVA_HOME = '<JDK_21_HOME>'
$qatrackMaven = '<MAVEN_HOME>\bin\mvn.cmd'
& $qatrackMaven -B -ntp test
& $qatrackMaven -B -ntp -Pmysql-tests test
& $qatrackMaven -B -ntp -Pmysql-tests clean package
git diff --check
```

本轮独立验证使用本机 MySQL 8.0.46 二进制，在 <PROJECT_ROOT>/../QATrack-local-validation/phase2-r1-20260907 下初始化新实例，监听 127.0.0.1:13307。测试库为 qatrack_test_r1；测试账户权限仅覆盖该库。3306/qatrack 未连接、未修改，也没有访问 IDEA 私有连接配置。

测试覆盖配置优先级；池并发容量/超时/重复 close/初始化失败/失效连接/归还重置/关闭竞态；事务提交/回滚/异常保留/嵌套拒绝；真实 User/Project 的增查改、唯一键/FK/CHECK 错误转换、乐观锁、微秒时间和整数范围。当前测试不是业务 Service 覆盖率或生产压力指标。

初次 52 项测试结果见 [Round 1 验证记录](PHASE2-JDBC-VALIDATION.md)。当前验证以仓库内测试为准。

## 7. 官方资料

- [MySQL Connector/J 安装及 JDBC / X DevAPI 依赖](https://dev.mysql.com/doc/connector-j/en/connector-j-installing.html)
- [Connector/J 日期时间配置说明](https://dev.mysql.com/doc/connector-j/en/connector-j-connp-props-datetime-types-processing.html)
- [JUnit 5.13.4 文档](https://docs.junit.org/5.13.4/user-guide/junit-user-guide-5.13.4.pdf)

本项目依赖版本固定，行为由本轮真实 MySQL 8.0.46 集成测试验证，不以在线文档版本变化替代测试证据。
