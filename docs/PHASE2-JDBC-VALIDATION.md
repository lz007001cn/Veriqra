# Phase 2 Round 1 验证记录

> Historical report: the original identifiers, paths, configuration names and checksums below are preserved as recorded. For current Veriqra configuration and deployment, see [VERIQRA-RENAME.md](VERIQRA-RENAME.md).

本文保存初次实现的 52 项测试历史记录。当前实现与验证以仓库源码和测试为准。

日期：2026-09-07。仓库：<PROJECT_ROOT>，main。开始时只有既有 `docs/submission/` 未跟踪，本轮未修改该目录。

## 实际环境与命令结果

- Microsoft JDK 21.0.12.1，IDEA 自带 Maven 3.9.16；只设置构建进程 JAVA_HOME，没有修改 Windows PATH。
- MySQL 8.0.46 新建独立实例，127.0.0.1:13307 / qatrack_test_r1，专用账号仅有该测试库权限。
- [mvn test](verification/phase2-r1/maven-test.txt)：28 测试，0 failure / error / skipped，BUILD SUCCESS。
- [mvn -Pmysql-tests test](verification/phase2-r1/maven-mysql-test.txt)：52 测试，0 failure / error / skipped，BUILD SUCCESS。
- [mvn -Pmysql-tests clean package](verification/phase2-r1/maven-package.txt)：52 测试，0 failure / error / skipped，BUILD SUCCESS。
- git diff --check：通过。另对本轮新建文本检查行末空白，避免未跟踪文件不被 git diff 覆盖。

普通测试不选择 mysql 标签；28 不代表跳过了 24 项已选测试。启用 profile 后的 52 项包含真实集成测试，没有因无凭据而跳过。

| 测试类 | 数量 | 重点 |
| --- | --- | --- |
| DatabaseConfigTest | 7 | 默认、文件、环境优先级；缺失密码；参数校验；脱敏 |
| ConnectionPoolTest | 14 | 初始连接、归还、容量、超时、并发、坏连接、关闭竞态、资源兜底、线程中断 |
| JdbcTransactionManagerTest | 7 | 成功提交、异常回滚、原异常保留、提交失败、嵌套拒绝 |
| ConnectionPoolIntegrationTest | 5 | 真实连接复用、满池超时、归还回滚、状态重置、物理断开 |
| UserDaoIntegrationTest | 10 | 增查改、唯一/CHECK 异常、乐观锁、微秒、Integer 边界 |
| ProjectDaoIntegrationTest | 9 | 增查改、唯一/FK/CHECK 异常、两个 DAO 共同提交及回滚 |
| 合计 | 52 | 全部通过 |

逐类结果及 WAR / 数据库源文件校验和见 [test-results.json](verification/phase2-r1/test-results.json)。

## 数据库及实例收尾

集成测试从冻结 schema.sql 在独立空 schema 建立 19 表，创建自己的 User / Project fixture。未加载 seed.sql；每次测试清理自己的数据，每组测试后按依赖逆序清理本组创建的表。

最终只读查询实测：MySQL VERSION()=8.0.46，@@port=13307；qatrack_test_r1 中表数为 0。独立测试 schema 和专用账户保留在已关闭的临时数据目录中，未作为产品数据库对象增加。

已执行 mysqladmin 正常 shutdown。服务端日志记录：

```text
2026-09-07T00:51:01.949866Z Received SHUTDOWN from user root.
2026-09-07T00:51:01.950462Z Normal shutdown.
2026-09-07T00:51:02.969480Z Shutdown complete (mysqld 8.0.46).
```

随后确认本轮 mysqld PID 168248 已退出、13307 没有监听；原 MySQL80 Windows 服务仍为 Running。数据目录与完整运行日志位于 <PROJECT_ROOT>/../QATrack-local-validation/phase2-r1-20260907。

localhost:3306/qatrack 没有建立连接，未修改其结构、seed 或账户。schema.sql / seed.sql 及 Phase 1 manifest 所列共 7 个数据库文件校验和全部与冻结记录相同。未改领域模型或数据库设计文件。

## 构建物

- WAR：target/qatrack-0.1.0-SNAPSHOT.war，2,481,036 字节。
- 主源码 15 个 Java 文件；测试源码 8 个文件，含 6 个测试类与 2 个辅助类。
- WEB-INF/lib 仅 mysql-connector-j-9.7.0.jar；无 JUnit、protobuf、测试类、.gitkeep 或 *.local.properties。
- 未部署 Tomcat，未实现 HTTP 入口，WAR 构建成功不等于 Web 应用已经可操作。

## 新增与修改文件

修改：README.md、pom.xml。既有 .gitignore 的 `*.local.properties` 已覆盖需求，内容未改。

新增主源码（以下相对 src/main/java/io/github/lz007001cn/qatrack）：

```text
config/DatabaseConfig.java
jdbc/ConnectionPool.java
jdbc/JdbcTransactionManager.java
exception/DataAccessException.java
exception/OptimisticLockException.java
model/User.java
model/SystemRole.java
model/UserStatus.java
model/Project.java
model/ProjectStatus.java
dao/UserDao.java
dao/ProjectDao.java
dao/jdbc/JdbcUserDao.java
dao/jdbc/JdbcProjectDao.java
dao/jdbc/JdbcValues.java
```

新增测试（以下相对 src/test/java/io/github/lz007001cn/qatrack）：

```text
config/DatabaseConfigTest.java
jdbc/ConnectionPoolTest.java
jdbc/JdbcTransactionManagerTest.java
jdbc/FakeJdbc.java
integration/MysqlFixture.java
integration/ConnectionPoolIntegrationTest.java
integration/UserDaoIntegrationTest.java
integration/ProjectDaoIntegrationTest.java
```

其他新增可提交文件：

```text
config/database.example.properties
config/database-test.example.properties
src/main/resources/database.properties
docs/PHASE2-JDBC-FOUNDATION.md
docs/PHASE2-JDBC-VALIDATION.md
docs/verification/phase2-r1/test-results.json
docs/verification/phase2-r1/maven-test.txt
docs/verification/phase2-r1/maven-mysql-test.txt
docs/verification/phase2-r1/maven-package.txt
```

另外生成了 Git 忽略的 config/database-test.local.properties，仅含本轮独立实例测试凭据；该实例已关闭，重新运行集成测试前应按基础设施说明配置正在运行的独立空测试库。没有写入日常应用数据库密码。

## 仍需注意

- 连接池是课程范围实现，驱动网络 I/O 不受池容量等待期限的硬中断保证；不支持任意 session 状态彻底清理或后台健康维护。
- 事务管理器不自动重试；提交过程中连接中断可能导致结果未知。callback 须遵守连接所有权，不能手动提交、关闭或吞掉应回滚的异常。
- INT UNSIGNED 的完整范围大于 Integer；实现明确拒绝超范围读取/更新，没有改变冻结字段类型。
- DAO 不执行权限、状态流和完整项目创建业务；后续 Service 仍需承担已有冻结 invariant。
- .idea、target、真实本地凭据未进入版本管理；未暂存、commit 或 push。

建议优先 Review ConnectionPool、JdbcTransactionManager、DatabaseConfig、JdbcUserDao、MysqlFixture；ProjectDao 使用相同持久化模式，相关集成测试验证其外键和共同事务行为。
