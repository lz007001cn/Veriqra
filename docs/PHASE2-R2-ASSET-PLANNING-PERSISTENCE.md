# Phase 2 Round 2 — Core Asset & Planning Persistence

> Historical report: the original identifiers, paths, configuration names and checksums below are preserved as recorded. For current Veriqra configuration and deployment, see [VERIQRA-RENAME.md](VERIQRA-RENAME.md).

日期：2026-09-07。实际仓库：`<PROJECT_ROOT>`。

本轮沿用 Round 1 审查批准的 ConnectionPool、JdbcTransactionManager、异常转换、显式 Connection 所有权和 immutable record 模式。实现 8 张表的持久化访问，没有实现业务 Service、Servlet 或后续执行模块。

## 1. Model / enum / DAO

所有新类位于 `io.github.lz007001cn.qatrack` 下：record/enum 在 `model`，接口在 `dao`，实现类在 `dao.jdbc`。每个 DAO 接口都有对应 `JdbcXxxDao`，没有通用 CRUD 框架或自动事务包装层。

| 冻结表 | 新 Model | DAO interface / implementation | 主要能力 |
| --- | --- | --- | --- |
| project_members | ProjectMember | ProjectMemberDao / JdbcProjectMemberDao | add、find、existsRecord、listByProject、listByUser（按状态）、update role/status + lockVersion |
| project_counters | ProjectCounter | ProjectCounterDao / JdbcProjectCounterDao | insert 初始计数器行、find、listByProject、allocateNext |
| requirements | Requirement | RequirementDao / JdbcRequirementDao | findById、findByKey(projectId,keyNo)、listByProject、findByIdForUpdate、insert、update |
| test_cases | TestCase | TestCaseDao / JdbcTestCaseDao | 同上；仅当前定义，支持 preconditions |
| test_steps | TestStep | TestStepDao / JdbcTestStepDao | add、find(caseId,order)、按序 listByTestCase、updateContent、remove、deleteByTestCase |
| test_case_requirements | TestCaseRequirement | TestCaseRequirementDao / JdbcTestCaseRequirementDao | add、find、existsRecord、双向 list、updateReviewState、markRemoved |
| test_plans | TestPlan | TestPlanDao / JdbcTestPlanDao | findById、findByKey、listByProject、findByIdForUpdate、insert、update |
| test_plan_cases | TestPlanCase | TestPlanCaseDao / JdbcTestPlanCaseDao | add、find、exists、双向 list、remove |

新增 8 个 enum，值与冻结 CHECK 集合一致：

| enum | 值 |
| --- | --- |
| ProjectRole | TESTER / DEVELOPER |
| MembershipStatus | ACTIVE / INACTIVE |
| CounterEntityType | REQ / TC / PLAN / BUG |
| Priority | LOW / MEDIUM / HIGH |
| RequirementStatus | DRAFT / ACTIVE / ARCHIVED |
| TestCaseStatus | DRAFT / READY / ARCHIVED |
| TestPlanStatus | DRAFT / READY / ARCHIVED |
| TraceabilityStatus | CONFIRMED / NEEDS_REVIEW / REMOVED |

CounterEntityType 的 BUG 只是映射既有计数器合法值，没有实现 Defect Model/DAO。

8 个 record 的字段与目标表逐列核对，包括顺序、可空复核字段和复合主键。BIGINT → Long；INT/lockVersion → Integer；DATETIME(6) → LocalDateTime。step_order 是 SMALLINT UNSIGNED，映射 Integer 才能完整容纳 1..65535；未使用 Short，也未虚构独立步骤 ID。

Requirement / TestCase / TestPlan / ProjectMember 沿用 `WHERE key=? AND lock_version=?` 并递增版本，0 行抛 OptimisticLockException。沿用既有 JdbcValues 的 Integer 上界检查。不为没有 lock_version 的步骤、追溯关系、计划关系增造版本。

## 2. 事务与资源规范

- DAO 构造器仅接收外层 Connection，所有值用 PreparedStatement 绑定，Statement/ResultSet 使用 try-with-resources。
- DAO 不借连接、不 close Connection、不 commit/rollback、不切换 autoCommit。SQLException 统一转换 DataAccessException 并保留 cause、SQLState、vendor code。
- insert 忽略生成 ID/创建时间/更新时间/版本输入，回读数据库完整行。update 不改变项目、业务序号、创建者和创建时间。返回新 record，不修改输入对象。
- 写入及写后回读由外层事务包裹；返回 Model 不是已提交凭证。外层失败必须传播到 JdbcTransactionManager 回滚。
- `findByIdForUpdate` 和 `allocateNext` 拒绝 autoCommit=true，报 SQLState 25000；普通写 DAO 保留 Round 1 的显式调用约定。
- 普通列表为确定顺序的完整结果，尚无分页；只有当前 V1 查询能力，没有为了未来页面增加查询框架。

## 3. Counter 并发与原子性

冻结设计要求项目创建时初始化 REQ/TC/PLAN/BUG 四行。本轮只提供单行 insert，由未来 Service 将四行与项目创建组合到同一事务；不做懒初始化、不提供任意重置或回收接口。

`allocateNext(projectId, type)` 在外层已开启的事务中：

1. 对指定复合主键执行 `SELECT next_value ... FOR UPDATE`。
2. 缺行明确失败，正 BIGINT 上界处拒绝分配，不发生 Java 溢出。
3. 执行 `UPDATE ... SET next_value=next_value+1`，要求恰好一行。
4. 返回递增前的值。行锁持续到调用方提交或回滚，DAO 不释放事务。

没有 `MAX(...) + 1`，没有 LAST_INSERT_ID 会话变量，没有业务编号字符串格式化。调用方必须把分配与目标实体插入放入同一事务；已提交编号不回收，回滚事务未提交的分配可重新使用。

真实测试证明：4 个线程各执行 6 个独立事务，24 个返回编号与 24 条需求记录一一对应且不重复，最终 next_value=25。另一测试在先建立一致性读快照后，由其他事务递增计数器，随后 FOR UPDATE 仍读到最新值。重复业务序号导致后续写失败时，已递增的计数器与此前实体插入一起回滚。

## 4. 三种关联及步骤语义

**ProjectMember：**成员退出通过 update 写 INACTIVE，重新加入复用原行；保留 joinedAt。可以更新项目角色，仍由外层校验平台 ADMIN 权限及退出协调。existsRecord 代表行存在，不代表 ACTIVE。

**TestCaseRequirement：**add 建立新行，重复复合键由数据库拒绝；移除改 REMOVED，重新关联显式 updateReviewState 为 NEEDS_REVIEW，保留首次 linkedBy/linkedAt。复核人和复核时间按输入写入，CHECK 校验状态与空值组合；markRemoved 单语句清空复核字段。双向查询包含 REMOVED，existsRecord 也包含 REMOVED，不能直接当有效覆盖率。未实现需求或用例修改时自动 NEEDS_REVIEW。

**TestPlanCase：**只表示当前清单，remove 物理删除关系，不删用例或计划。listByTestPlan 按 test_cases.key_no、id 排序，不用关联插入时间或 ID 冒充用例排序。反向查询按 planId，未添加 sort_order/status/version。

**TestStep：**复合主键为 caseId + stepOrder；updateContent 不修改步骤主键。父用例锁定、版本检查/递增、旧步骤删除、新步骤写入由未来 Service 放入同一事务。没有封装批量业务重排事务，没有快照、用例版本系统或 Living Traceability 逻辑。测试实际验证重排成功及重复步骤号失败后旧集合和父版本一起恢复。

无版本关系的 boolean update 表示 JDBC 更新计数大于 0；驱动 `useAffectedRows=true` 时，同值更新可能返回 false，不能将这个 boolean 当成乐观锁失败或授权结果。需要确切当前状态时，调用方在父锁内查询。

## 5. 集成测试与隔离

沿用已批准 MysqlFixture；唯一修改为 resetRows 按 FK 依赖顺序先清理本轮新增测试数据，再清理 projects/users。仍核对 loopback + qatrack_test_*、空库、实际 catalog、精确 MySQL 版本和命名锁，仍仅清理成功 CREATE 的表，不关闭 FK 检查，不加载 seed。新增 AssetFixture 只提供测试数据构造方法。

新增 29 项真实 MySQL 集成测试：

| 测试类 | 新增数量 | 核心证据 |
| --- | ---: | --- |
| RequirementDaoIntegrationTest | 3 | 增查改、项目隔离/编号排序、不可变身份、乐观锁、FK/UNIQUE/CHECK、锁定前置条件 |
| TestCaseDaoIntegrationTest | 3 | 同上，当前用例字段映射 |
| TestPlanDaoIntegrationTest | 3 | 同上，当前计划定义 |
| ProjectMemberDaoIntegrationTest | 3 | 成员增查、按状态反查、退出/重新加入、复合键/FK、乐观锁及外层回滚 |
| ProjectCounterDaoIntegrationTest | 6 | 类型独立、缺行/无事务拒绝、约束/溢出、并发唯一性、原子回滚、最新锁定读 |
| TestStepDaoIntegrationTest | 4 | 有序步骤、更新/删除、UNIQUE/FK/CHECK/65535 上界、重排与失败恢复 |
| TestCaseRequirementDaoIntegrationTest | 4 | 双向查询、复核微秒、逻辑移除/复用、约束错误、明确 Service invariant |
| TestPlanCaseDaoIntegrationTest | 3 | 按业务编号排序、反向查询、物理移除、UNIQUE/FK、跨项目边界 |

测试中的预期约束错误可以在断言后继续验证数据库行为，生产调用不能据此吞掉应引发外层回滚的错误。跨项目探针由测试主动抛错回滚，不留下错误关联。

| 最终命令 | 结果 |
| --- | --- |
| mvn -B -ntp test | 39 / 39，0 failures / errors / skipped，BUILD SUCCESS |
| mvn -B -ntp -Pmysql-tests test | 94 / 94，0 failures / errors / skipped，BUILD SUCCESS |
| mvn -B -ntp -Pmysql-tests clean package | 94 / 94，WAR BUILD SUCCESS |
| git diff --check | PASS；新增文本另做空白检查，因为大量文件尚未跟踪 |

使用 Java 21 与 IDEA 自带 Maven，仅设置当前进程 JAVA_HOME，没有修改系统 PATH。独立 MySQL 8.0.46 位于既有 E: 验证目录，监听 127.0.0.1:13307，测试 schema 为 qatrack_test_r1。最后一次 package 后表数为 0，mysqladmin 正常关闭，PID 165528 消失，13307 无监听，原 MySQL80 服务仍 Running。本轮未连接 localhost:3306/qatrack，未读写开发 seed。

WAR 检查和文件哈希见[验证结果](verification/phase2-r2/results.json)，原始 Maven 输出见[单元测试](verification/phase2-r2/maven-test.txt)、[MySQL 测试](verification/phase2-r2/maven-mysql-test.txt)、[完整打包](verification/phase2-r2/maven-clean-package.txt)。

## 6. 保留风险和 Service 边界

没有发现需要修改已批准基础设施或冻结 schema 的明确错误。以下限制仍然存在：

- FK 不保证 Requirement–Case、Plan–Case 同项目；本轮真实探针验证仍可写入，必须由 Service 锁父记录后检查。
- 权限、成员状态、归档后只读、READY 子项要求、步骤从 1 开始连续及非空清单、父状态和版本协调属于 Service，不是当前 DAO 已保证的能力。
- 无版本关系需要按冻结锁顺序锁定父记录；不能因 DAO 单语句成功便认为解决了跨表并发。版本冲突、死锁或失败应由外层回滚，重试不能在 DAO 内偷偷发生。
- 多对象锁仍需未来按领域文档顺序获取；24 次分配并发测试不构成全业务无死锁或生产负载证明。
- 计数器行必须预先正确初始化，不能用错误 next_value 绕过业务创建流程；实体表 UNIQUE 是最后防线。计数器到 Long.MAX_VALUE 时明确拒绝继续分配。
- 现有 lock_version 的数据库 unsigned 范围大于 Integer；沿用 Round 1 的显式拒绝，不修改模型类型或 schema。

没有实现 TestRun、Attempt、Defect、Automation、Import、Service、Servlet、Authentication、前端或 AI；没有修改任何 database 文件；没有新增 Maven 依赖或重构基础设施；没有 commit/push。

## 7. 文件与 Review 建议

新增源文件 41 个：8 record + 8 enum + 8 DAO interface + 8 JDBC implementation + 8 integration test class + 1 测试数据 helper。已有源文件仅修改 MysqlFixture 的清理顺序；另新增本说明和本轮验证证据。Round 1 生产源文件、pom、README、冻结文档及 SQL 的哈希均与本轮开始时相同。

优先 Review：

1. [JdbcProjectCounterDao.java](../src/main/java/io/github/lz007001cn/veriqra/dao/jdbc/JdbcProjectCounterDao.java)：锁、递增、溢出与连接所有权。
2. [ProjectCounterDaoIntegrationTest.java](../src/test/java/io/github/lz007001cn/veriqra/integration/ProjectCounterDaoIntegrationTest.java)：真实并发及编号/实体原子回滚证据。
3. [JdbcTestCaseRequirementDao.java](../src/main/java/io/github/lz007001cn/veriqra/dao/jdbc/JdbcTestCaseRequirementDao.java)：复核字段形状、逻辑移除与首次关联信息保留。
4. [JdbcTestStepDao.java](../src/main/java/io/github/lz007001cn/veriqra/dao/jdbc/JdbcTestStepDao.java)：复合主键、批量删除底层能力与外层重排约定。
5. [MysqlFixture.java](../src/test/java/io/github/lz007001cn/veriqra/integration/MysqlFixture.java)：专用 schema 防护和新增 FK 清理顺序。

`git diff --stat` 与 `git status --short` 原样保存在 [git-worktree.txt](verification/phase2-r2/git-worktree.txt)。开始前 README/pom 已修改，Round 1 大量 Java/config/docs 已未跟踪，docs/submission 亦为已有材料。`git diff --stat` 不含未跟踪文件，不能将其视为本轮全部变化；本轮精确新增/修改列表见 [round-changes.json](verification/phase2-r2/round-changes.json)。

本轮最终针对性 Review 已将成员/追溯关系的 exists 更名为 existsRecord，行为不变，当前测试覆盖保留在源码中。
