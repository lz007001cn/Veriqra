# Phase 2 Round 4 — Automation & Import Persistence

> Historical report: the original identifiers, paths, configuration names and checksums below are preserved as recorded. For current Veriqra configuration and deployment, see [VERIQRA-RENAME.md](VERIQRA-RENAME.md).

日期：2026-09-08。开始时 main 与 origin/main 的本地跟踪状态一致，工作区干净。沿用 Round 1/2/3 已批准的原生 JDBC 模式，未修改冻结 schema。

## 1. 新增持久化能力

根包 `io.github.lz007001cn.qatrack`，record/enum 位于 model，接口位于 dao，实现位于 dao.jdbc。

| Model | DAO contract | JDBC implementation | 能力 |
| --- | --- | --- | --- |
| TestAutomationIdentity | TestAutomationIdentityDao | JdbcTestAutomationIdentityDao | insert、findById、findByExternalKey、listByProject、findByIdForUpdate |
| TestAutomationMapping | TestAutomationMappingDao | JdbcTestAutomationMappingDao | add、findById、findByIdentity、listByTestCase、existsRecord、findByIdentityForUpdate、update |
| TestImport | TestImportDao | JdbcTestImportDao | insert、findById、findByRequestKey、listByRun |

新增 enum：AutomationSource 只有 JUNIT；AutomationMappingStatus 为 ACTIVE / INACTIVE。没有添加 PLAYWRIGHT 值；示例框架名称不是修改冻结 CHECK 的授权。TestImport 没有 source/status enum，不虚构 schema 中不存在的字段。

### Identity

6 个字段逐列映射。稳定身份由 projectId + source + namespace + externalKey 唯一确定；namespace/externalKey 使用冻结二进制排序规则，大小写和尾部空格保持原样。不拼接、解析、trim 或截断外部名称；格式构造与空名等更严格业务规则属于后续解析/Service。

Identity 只插入和查询，没有 update/delete。listByProject 按 source/namespace/externalKey/id 确定排序，完整唯一键查询需要四个组成部分。同 externalKey 在不同项目或不同 namespace 下可以共存。

### Mapping

8 个字段逐列映射。数据库 UNIQUE(automation_identity_id) 表示每个 Identity 至多一条 Mapping，包含 INACTIVE；Case 一侧允许多条。因此反向查询使用 Optional 的 findByIdentity，而不制造一个身份对应多个 Case 的列表语义。listByTestCase 返回 Mapping 记录及 identityId，按 identityId 排序，包含 INACTIVE。

existsRecord 只表示绑定行存在，不等于 ACTIVE 或可导入。停用/恢复复用原行，不提供 remove/hard delete。update 只写 testCaseId/status，以 id + lockVersion 乐观锁更新并递增；Identity、创建者、创建时间不变。未使用映射允许纠正 Case，已使用时禁止重绑由 Service 校验，DAO 不检查历史或同项目。

Identity 的 findByIdForUpdate 与 Mapping 的 findByIdentityForUpdate 仅为冻结锁协议提供底层能力，拒绝 autoCommit=true。调用方按全局顺序先锁所需 Project/Case，再锁 Identity/Mapping，之后才锁 Run/RunCase；查不到 Mapping 也应先锁 Identity。锁定读在旧 REPEATABLE READ 视图下能看到最新提交状态，已有真实测试。没有 DAO 自动事务、重试或隐式创建绑定。

### Import

8 个字段：id、testRunId、requestKey、reportSha256、sourceNamespace、originalFilename、importedBy、importedAt。项目由 testRunId → TestRun.projectId 得到；本表没有独立 projectId、source 或 status。仅提供当前冻结查询所需的 listByRun，不增加项目级报表查询。

requestKey 为 UUID，以大端的两个 long 写 BINARY(16)，与 Attempt 相同，等价 UUID_TO_BIN(uuid,0)。reportSha256 为 byte[]，构造与访问均防御性复制，equals/hashCode 比较二进制内容，避免 record 暴露可修改数组或使用数组地址判等。没有在 Model 或 DAO 中计算摘要。

DAO 写入前拒绝非 32 字节摘要，防止 BINARY(32) 对短数据自动补零。null UUID/摘要交由 NOT NULL 拒绝，数据库异常转换 DataAccessException；读取检查 UUID/摘要实际宽度。生成 ID/时间由 MySQL 回读，insert 输入中的 id/importedAt 忽略。无 update/delete，不修改已导入批次。


originalFilename 按传入文本保存；DAO 不净化路径或解析 XML。安全文件名、上传大小和 XML 解析限制应在后续入口实现。导入者是 batch.importedBy，自动化 Attempt.executedBy 保持 NULL，不冒充实际执行者。

## 2. 幂等与原子性

requestKey 全局 UNIQUE，findByRequestKey 支持重复请求查询。相同令牌无论摘要是否相同，重复 insert 都被数据库拒绝；相同摘要使用不同令牌可以保存两个批次。DAO 不将唯一冲突自动当成成功，不比较业务载荷、不自动 retry。未来 Service 须核对权限、目标 Run、namespace 和摘要后才能返回已有结果。

所有 DAO 显式接收同一外层 Connection，不自行 commit/rollback/close Connection，值通过 PreparedStatement 绑定，Statement/ResultSet 使用 try-with-resources，SQLException 保留为统一 DataAccessException。写入与写后回读仍应在外层事务内；返回 Model 不表示已经提交。

真实事务测试覆盖：

- 新 Run + RunCase + 快照步骤 + Identity/Mapping + TestImport + 自动化 Attempt 整体提交，并可继续追加人工 PASS，旧导入 FAIL 保留。
- 同一外层事务先插 TestImport，再插 Identity/Mapping 与第一条 Attempt，第二条 Attempt 触发 UNIQUE(import_id,test_run_case_id)，整个批次、身份、映射和第一条证据全部回滚，原有 Run/快照保留。

以上是 DAO 组合能力测试，不是已实现 Import Service；冻结产品流程中的人工补齐映射、再次预览仍在后续 Service 实现。没有 XML parser，没有自动创建 Case/Mapping/Run/Attempt 的 DAO 行为。

## 3. 本轮实测的 Service invariant

隔离库探针实际确认以下写入会被数据库接受；探针均主动回滚，不留下错误数据：

- Identity 与 Case 分属不同项目仍可建立 Mapping。
- Mapping 被 Attempt 引用后，仍可直接更新其 testCaseId；FK 只保护 Mapping 主键引用，不保护被引用行内部的业务含义。
- Attempt 的 RunCase 与 Import 所属 Run 可以不一致。
- Attempt 的 Mapping 可以属于另一 Case、处于 INACTIVE，Import.namespace 也可以与 Identity.namespace 不一致。

未来 Service 必须在外层事务和冻结锁顺序下校验这些规则，以及项目/成员权限、Run 开放状态、完整快照、单 RunCase 单自动化实现、同令牌载荷一致性、非空批次、人工映射确认等。数据库 CHECK 仅保证人工/自动化来源字段形状，不能替代跨表语义。

## 4. 全部 19 表一致性审计

下表每个 Model 均有同名 XxxDao 与 JdbcXxxDao，字段总数 154。审计脚本逐列比较 Model 与 schema，并核对 enum 集合、乐观锁入口和清理依赖；同时审阅 DAO 的 SQL、连接所有权和删除语义。脚本是辅助检查，不替代业务并发证明。

| Table | Model | 字段数 | 写入边界 |
| --- | --- | ---: | --- |
| users | User | 9 | 增改、乐观锁 |
| projects | Project | 9 | 增改、乐观锁 |
| project_members | ProjectMember | 7 | 关系增改、乐观锁，INACTIVE 保留 |
| project_counters | ProjectCounter | 3 | 初始化、既有行锁内递增 |
| requirements | Requirement | 11 | 增改、乐观锁 |
| test_cases | TestCase | 12 | 当前定义增改、乐观锁 |
| test_steps | TestStep | 4 | 当前步骤可替换 |
| test_case_requirements | TestCaseRequirement | 8 | 复核状态更新、逻辑移除 |
| test_plans | TestPlan | 10 | 增改、乐观锁 |
| test_plan_cases | TestPlanCase | 4 | 当前范围可增删关联 |
| test_runs | TestRun | 12 | 增改、乐观锁，项目/来源不迁移 |
| test_run_cases | TestRunCase | 8 | 插入快照，无 update/delete |
| test_run_case_steps | TestRunCaseStep | 4 | 插入快照，无 update/delete |
| test_attempts | TestAttempt | 13 | 追加事实，无 update/delete |
| defects | Defect | 14 | 增改、乐观锁，项目/编号不迁移 |
| test_attempt_defects | TestAttemptDefect | 4 | 可纠正错误链接，不删证据两端 |
| test_automation_identities | TestAutomationIdentity | 6 | 插入身份，无 update/delete |
| test_automation_mappings | TestAutomationMapping | 8 | 关系增改、乐观锁，不硬删 |
| test_imports | TestImport | 8 | 追加批次，无 update/delete |

20 组 enum/字段 CHECK 集合一致；所有有 lock_version 的实体沿用 JdbcValues 范围保护及版本比较递增。所有 DAO 可共享外层 Connection，没有内建 Service 业务事务、未参数化的外部 SQL 值或自行 commit/rollback。SQL 拼接仅为固定查询片段，调用者值绑定参数。

ProjectMember、TestCaseRequirement、TestAttemptDefect 和新增 Mapping 的 existsRecord 均是行存在判断。保留已批准 TestPlanCase.exists：它仅有物理存在/移除，未引入不同业务判断，也未为命名统一重构既有接口。

仅 TestStep、TestPlanCase、TestAttemptDefect 提供冻结设计允许的物理删除。没有无锁 SELECT MAX + 1；业务编号仍由 ProjectCounter 行锁分配，Attempt 沿用父锁内最新序号加一。列表尚未分页、跨项目约束仍由 Service 保证，未增加触发器或修改数据库结构。

## 5. Fixture、测试和验证

MysqlFixture 仅新增 test_imports、test_automation_mappings、test_automation_identities 三条清理 SQL，位于 test_attempts 之后、Run/Case/Project/User 之前。当前固定清单覆盖全部 19 表，逐条核对 40 FK 均为先子后父。保留 loopback + qatrack_test_*、专用非 root 账号、空 schema、catalog、命名锁及对象所有权校验；未关闭 FK 检查、未加载 seed，suppression 仍局限于明确清理语句。

新增 16 项测试：

| 测试类 | 数量 | 主要证据 |
| --- | ---: | --- |
| TestImportTest | 2 | 二进制防御性复制、record 内容相等/hashCode |
| TestAutomationIdentityDaoIntegrationTest | 3 | 完整身份键、跨项目/namespace/大小写、FK/CHECK、锁前置条件 |
| TestAutomationMappingDaoIntegrationTest | 4 | 双向关系、INACTIVE 存在、唯一/FK、纠正、乐观锁、当前锁定读 |
| TestImportDaoIntegrationTest | 3 | UUID/摘要原字节、重复令牌、相同摘要不同令牌、长度/null、FK/CHECK |
| ImportTransactionIntegrationTest | 4 | 完整证据链提交、批次中途失败回滚、跨项目/重绑/来源关联的 Service 边界 |

首轮失败来自新测试摘要常量误写为 33 字节，被长度保护正确拒绝；已修正为 32 字节并重新执行。全层审计脚本最初未允许字段名包含数字，漏识别 report_sha256；已修正审计脚本，schema/Model 未因此改变。保留首次失败日志，不用它替代最终结果。

| 最终验证 | 结果 |
| --- | --- |
| mvn test | 41 tests，0 failures/errors/skipped，BUILD SUCCESS |
| mvn -Pmysql-tests test | 137 tests，0 failures/errors/skipped，BUILD SUCCESS |
| mvn -Pmysql-tests clean package | 137 tests，0 failures/errors/skipped，WAR BUILD SUCCESS |
| git diff --check | PASS；新增文本另检查 UTF-8、尾随空白及本机身份信息 |
| WAR | 包含新增三组 Model/DAO；唯一运行库 mysql-connector-j-9.7.0.jar，无 local properties、IDEA 配置或测试 Fixture |
| 临时实例 | MySQL 8.0.46 / 127.0.0.1:13307，qatrack_test_r1 最终 0 表，正常 shutdown，13307 无监听 |

没有连接或修改 localhost:3306/qatrack；未改 schema、seed、pom、ConnectionPool、JdbcTransactionManager 或已批准 DAO。未 commit/push。本地日志与全层审计 JSON 位于忽略目录 `docs/verification/phase2-r4/`，不提交公开仓库。

当前建议以“Phase 2 JDBC Persistence Foundation 完成”作为阶段结论，随后进行针对性 Review。19 表覆盖不等于业务后端已实现；Service、解析器、Servlet、Authentication、Dashboard、前端和 AI 均未开发。
