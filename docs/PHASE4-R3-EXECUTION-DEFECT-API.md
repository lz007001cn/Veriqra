# Phase 4 Round 3 — Test Run, Execution & Defect REST API

> Historical report: the original identifiers, paths, configuration names and checksums below are preserved as recorded. For current Veriqra configuration and deployment, see [VERIQRA-RENAME.md](VERIQRA-RENAME.md).

日期：2026-09-21。实现基线：`606d6d8e84ef398907e377f1b211a9f6a4e05a7d`（Round 2 Final Review 已批准）。开始时本地 main、origin/main 与远端 main 一致，working tree clean。本轮不 commit/push。

## 1. Scope 与架构

新增 TestRunHandler、DefectHandler；ApiServlet 仅增加 runs/defects 路由分派。WebServices 和 ApplicationListener 注入现有 TestRunService、TestExecutionService、DefectService。HTTP → Handler → Service → DAO → JDBC/MySQL；Handler 不访问 DAO、连接或 SQL，不开启事务、不判断权限/状态机、不生成编号/快照、不计算 latest PASS、不 retry。

不修改 schema、seed、DAO、ConnectionPool、JdbcTransactionManager、JSON mapper、Session/Filter、web.xml 或 Maven 依赖。Service 的变动限定为带路径 scope 的重载与必要 read capability；原业务规则、锁顺序和局部 1213/1062 恢复机制保持不变。

## 2. Route table

前缀：`/api/projects/{projectId}`。新增 **17 个 method/path 组合**。

| Method | Path | 成功 | Service |
| --- | --- | --- | --- |
| GET | /runs | 200 | listByProject |
| POST | /runs | 201 | createFromPlan / createAdHoc |
| GET | /runs/{runId} | 200 | scoped getDetails |
| POST | /runs/{runId}/complete | 204 | scoped complete |
| POST | /runs/{runId}/cancel | 204 | scoped cancel |
| GET | /runs/{runId}/cases/{runCaseId}/attempts | 200 | scoped listAttempts |
| POST | /runs/{runId}/cases/{runCaseId}/attempts | 201 | scoped recordAttempt |
| GET | /defects | 200 | listByProject |
| POST | /defects | 201 | create |
| GET | /defects/{defectId} | 200 | scoped getDetails |
| PUT | /defects/{defectId} | 200 | scoped update |
| POST | /defects/{defectId}/start | 204 | transition IN_PROGRESS |
| POST | /defects/{defectId}/resolve | 204 | transition RESOLVED |
| POST | /defects/{defectId}/close | 204 | transition CLOSED |
| POST | /defects/{defectId}/reopen | 204 | scoped reopen |
| POST | /defects/{defectId}/evidence | 204 | scoped addEvidence |
| POST | /defects/{defectId}/evidence/{attemptId}/remove | 204 | scoped removeEvidence |

Evidence remove 使用与 Round 2 关系动作一致的 POST action，body 为 `{}`。没有 generic DELETE/状态 PATCH，也没有 snapshot 或历史 Attempt 的更新/删除接口。Run/Defect 创建返回 Location；Attempt 没有单项 GET 路由，不生成虚假 Location。

## 3. Run API 与 snapshot read model

创建请求选择一个非 null 来源，二者都有值或均无值返回 400：

```json
{"name":"release","environment":"local","buildVersion":"v1","testPlanId":123}
```

```json
{"name":"ad-hoc","testCaseIds":[1,2]}
```

Service 负责 READY、同项目、非空且不重复的用例集合、计划范围和原子快照。创建结果为 IN_PROGRESS；complete/cancel body 为 `{"expectedVersion":0}`。complete 要求每个 RunCase 至少一个 Attempt，不要求全部 PASS；cancel 不要求已执行。规则完全沿用 Phase 3。

详情为 `{run, cases}`。run 包含 projectId、testPlanId（Ad-hoc 为 null）、环境/build、status、创建/结束时间、version。cases 包含 runCaseId、原 testCaseId、snapshotTitle/Description/Preconditions/Priority、capturedAt、按 stepOrder 的快照步骤、currentOutcome、latestAttempt。

无 Attempt 明确返回 `"currentOutcome":"NOT_RUN"`、`"latestAttempt":null`；NOT_RUN 不是可提交的 Attempt enum。已有 Attempt 时 currentOutcome 使用最新 attempt_no 的真实状态，区分 SKIPPED 与 BLOCKED。当前 TestCase/Step 编辑不会更新这些快照。

## 4. Execution API、submissionKey 与历史

```json
{
  "outcome":"FAIL",
  "durationMs":125,
  "comment":"manual execution",
  "failureMessage":"unexpected result",
  "submissionKey":"12345678-1234-1234-1234-123456789012"
}
```

outcome 与 UUID submissionKey 必须存在且非 null。durationMs/comment/failureMessage 可省略；FAIL 允许没有 failureMessage，非 FAIL 不允许任何非 null failureMessage。负 duration 由 Service 拒绝。响应将模型 status 映射为 outcome，testRunCaseId 映射为 runCaseId，不直接序列化数据库 Model。

同 key + 同 payload + 同执行人返回同一 Attempt，首次与 replay 均返回 201。不同 payload/执行人/RunCase 复用 key 返回 409。既有 Service 先检查实际权限和路径归属，再恢复重复结果，随后才判断 terminal Run 是否允许新写入；因此 COMPLETED/CANCELLED 后新 key 被拒绝，但终态前成功的同 key/payload 可重放。成员已撤销或项目不可写时，不以幂等绕过权限。

没有 HTTP 幂等缓存或 Handler retry。Service 仍只对 MySQL 1213 重试整个事务一次，对 1062 在独立恢复事务中检查已存在结果；路径 project/run scope 同时传递给原始、retry 和 recovery 分支。有限并发测试不代表所有调度下“永不死锁”。

历史 GET 按 attempt_no 升序。FAIL #1 → PASS #2 是两行且均返回；调用方不能提交 id、attemptNo、actorUserId、runId/runCaseId/projectId 或 source。序号继续由 Service 在既有 Run → RunCase 锁定模式下分配。

## 5. Defect API、状态机与 evidence

创建请求字段：failureAttemptId、title、description、severity、priority、assigneeId。severity 使用冻结 enum LOW/MEDIUM/HIGH/CRITICAL；priority 使用原模型。仅 FAIL、同项目 evidence 可创建，BUG counter 分配、Defect 和首条 evidence 位于原 Service 同一事务。PASS evidence 按现有 Service 返回 **409**，不改写为 Web validation 规则。

PUT 仅接受 title/description/severity/priority/assigneeId/expectedVersion；project、keyNo、reporter、创建时间、status 不可由 body 修改。

动作及 body：

| Action | body |
| --- | --- |
| start / close | expectedVersion |
| resolve | expectedVersion、resolutionNote |
| reopen | expectedVersion、failureAttemptId、assigneeId |
| evidence | failureAttemptId |
| evidence/{attemptId}/remove | 空对象 |

resolve 的 note required shape 由 DTO 检查，nonblank 由 Service 检查。close 复用已保存 resolutionNote，不提供隐含 note 编辑入口；reopen 要求非 null assignee，与现有 command 一致。

状态流转：
`OPEN → IN_PROGRESS → RESOLVED → CLOSED`；
`RESOLVED/CLOSED → REOPENED → IN_PROGRESS`。

重复 evidence add 在非 CLOSED 状态下幂等；CLOSED 证据只读。remove 仅纠正关联，不删除 Attempt 历史，也不修改结果。evidence 方法本身不要求 expectedVersion，沿用 Service 行锁/关系锁机制，不凭空增加 version contract。

详情为 `{defect, evidence}`：evidence 仅返回 attemptId、runId、runCaseId、attemptNo、outcome、failureMessage、linkedBy/At，不嵌套完整运行和测试用例。

### Close / retest

每条 FAIL evidence 对应 RunCase 的**当前 latest Attempt**必须 PASS，且 attempt_no 大于该 FAIL。FAIL #1/PASS #2 可关闭；再出现 FAIL #3 后不可关闭。多个证据 RunCase 必须全部满足；无 evidence 不可关闭。Handler 只调用 transition(CLOSED)。

### Reopen

一个 Service 操作完成：新同项目 FAIL evidence 校验、保留 BUG key 和旧 evidence、清空 resolutionNote、加入新 evidence、状态置 REOPENED。不得先改状态再由第二次 HTTP 加 evidence。stale version 失败不留下新关联。

## 6. 权限、version 与 ownership

Session 只存 actorUserId；每次请求经过现有认证 Filter，Service 读取实际用户和当前成员资格。ADMIN / active TESTER 可执行测试与完整缺陷工作流。DEVELOPER 可读/report，只能把 self-assigned Defect 置 IN_PROGRESS/RESOLVED，不能执行测试、close、reopen、编辑 Defect 内容或管理 evidence。旧 Session 在成员撤销后的下一次调用被拒绝。

update、Run complete/cancel、Defect start/resolve/close/reopen 要求 expectedVersion 非空非负整数；小数、字符串、null、溢出或负数返回 400，stale 返回 409。输出 token 名为 version，不接收新 version 或 lockVersion。204 后调用方 GET 最新 version。

所有 scoped Service 在原事务内验证 URL project 与真实父实体一致，ADMIN 同样不能使用错误项目路径。Attempt history/record 还验证 RunCase 实际父 Run 等于 URL runId；同项目另一个 Run 也不允许。Defect evidence 始终检查 Attempt 所属真实项目。实体项目/Run 归属在既有 DAO 中不可变，不新增锁或改变顺序。

旧 Service 方法保留，内部以 null scope 委托新增重载，维持已有 Java 调用兼容；HTTP 始终使用 positive path ID 的 scoped 入口。

## 7. Read capability 与 DTO

TestRunService 新增 listByProject/getDetails；TestExecutionService 为 history 增加项目/Run scope；DefectService 新增 getDetails。RunDetails/DefectDetails 是 Service 查询结果，列表 defensive copy；HTTP 用独立响应 DTO 转换。

Run + RunCases + steps + latest，以及 Defect + evidence + Attempt context，分别在**一次 Service transaction**内读取。验证环境实际为 MySQL 8.0.46 REPEATABLE-READ，普通一致性读复用同一视图；部署需保留该隔离级别，不能宣称 READ-COMMITTED 下多条 SELECT 也具有同样快照保证。Handler 不跨多个 Service 事务拼接详情。

新增 7 个请求 DTO：CreateRunRequest、RecordAttemptRequest、CreateDefectRequest、UpdateDefectRequest、ResolveDefectRequest、ReopenDefectRequest、AddEvidenceRequest；复用 ExpectedVersionRequest/EmptyActionRequest。新增 5 个响应 DTO：RunResponse、RunDetailResponse（内含 Case/Step projection）、AttemptResponse、DefectResponse、DefectDetailResponse（内含 Evidence projection）。

## 8. HTTP、JSON 与安全策略

保持统一错误映射：validation 400；unauthenticated 401；forbidden 403；not found 404；conflict 409；unexpected 500。未知路由 404，已知路由错误 method 405 + Allow；非 JSON body 415；超过 64 KiB 返回 413。安全错误内容不泄露 SQL/堆栈/凭据。

全部新写入要求 `X-QATrack-Request: 1` 和 application/json；统一 mapper 拒绝 unknown/duplicate/trailing token、错误字段类型。DTO 没有 actorUserId、role、attemptNo、status、bugKey、lockVersion 等服务端字段，不能被静默接受。

继续使用 HttpOnly、SameSite=Lax、Session 重新登录轮换与既有 request-header 防护。不新增 JWT/OAuth、role cache、CORS 放行、完整 CSRF token 或限流。公网部署前仍需落实登录限流、HTTPS/Secure Cookie/可信代理、账号 bootstrap 及完整 CSRF token 或严格 Origin 方案；本轮不是公网部署批准。

## 9. Test evidence

新增 **14 项**高价值测试：
- ExecutionWebTest：6 项真实 Tomcat HTTP 契约测试，覆盖两种创建模式、错误 shape、Session/path/command/version 映射、snapshot/NOT_RUN projection、显式状态与 evidence 路由、伪造字段/严格 JSON/64 KiB/header 拒绝；使用 Service stub，不冒充业务校验。
- ExecutionHttpIntegrationTest：8 项真实 HTTP → Service → MySQL 测试，核心数据通过 HTTP 创建，DAO 仅 bootstrap users/members 或最终只读断言。

集成覆盖：
1. Login → Project → Requirement → READY Case/steps → Traceability → READY Plan → Run → FAIL → Defect → IN_PROGRESS → RESOLVED → PASS → CLOSED；数据库核对两条 Attempt、序号、FAIL evidence 与 CLOSED。
2. CLOSED 后新 FAIL → reopen，BUG key 不变、旧/新 evidence 保留、note 清空；stale reopen 不留下半完成关联。
3. 当前用例编辑不改变快照；无 Attempt 不可 complete；complete/cancel 后 replay 返回原行、新写入拒绝。
4. ADMIN 错项目 Run/Defect 读写、同项目错误 RunCase→Run、跨项目 evidence/create/reopen 都拒绝且状态不变。
5. 多 evidence latest PASS 条件、FAIL/PASS/FAIL 拒绝 close、关系 remove 不删除历史、CLOSED evidence 只读。
6. PASS 携 failureMessage、PASS 作 evidence、无效状态、空白 resolutionNote、stale update 拒绝。
7. Developer self-assigned start/resolve 与权限拒绝、TESTER 执行/关闭、成员撤销对旧 Session 生效。
8. 两个并发 HTTP 同 key/payload 返回同一 Attempt，历史仅一行。

原有 Service 并发、锁、事务回滚和 1213/1062 测试继续参加全量运行；没有复制几十个并发场景或修改 Fixture 安全限制。

## 10. Known limitations 与 Round 4 boundary

- CRITICAL：none。
- HIGH：none。
- MEDIUM：本轮无未解决阻塞问题。
- LOW：列表/历史无分页，Run/Defect 详情有 N+1 查询；204 action 需再 GET version。课程规模接受，未引入缓存/ORM/分页框架。
- 运行前提：配置实际 MySQL 为 REPEATABLE-READ；公共网络安全加固仍属后续范围。

本轮实现完成后进入针对性 Final Review。Automation/JUnit upload/import API、Dashboard、前端、AI、password/admin-user 管理、rate limiter、完整 CSRF framework 均未实现。未开始 Round 4。

## 11. 最终执行结果

| 验证 | 实际结果 |
| --- | --- |
| mvn test | 94 tests，0 failures/errors/skips |
| mvn -Pmysql-tests test | 262 tests，0 failures/errors/skips |
| mvn -Pmysql-tests clean package | 262 tests，BUILD SUCCESS，WAR 已生成 |
| WAR content | 16 个新增顶层生产类均存在；无 test classes/JUnit/MysqlFixture/local properties/embedded Tomcat/Servlet API |
| standalone WAR | Tomcat 10.1.60，两次独立 deploy/stop；保护端点均返回 401 JSON |
| MySQL | 8.0.46，127.0.0.1:13307，REPEATABLE-READ |
| 结束后的测试 schema | qatrack_test_r1：0 tables |
| 临时进程与端口 | 正常 shutdown，13307 no listener |
| git diff --check | PASS |

HTTP 测试总计：35 项组件测试（23 + 6 + 6），19 项真实 HTTP→MySQL 测试（3 + 8 + 8）。本轮新增 14 项，基线 248 项全部通过。测试类内的多请求断言不冒充更多 JUnit 测试数量。

使用 IDEA bundled Maven 与 JDK 21，仅在命令环境中设置 JAVA_HOME；没有修改 Windows PATH。沿用已有 Windows 测试 JVM 参数 `-Djdk.net.unixdomain.tmpdir=<VALIDATION_ROOT>/no-unix-sockets`，没有写入项目配置。验证日志保存在仓库外的本地验证目录：
- `<VALIDATION_ROOT>/phase4-r3-test.log`
- `<VALIDATION_ROOT>/phase4-r3-mysql-test.log`
- `<VALIDATION_ROOT>/phase4-r3-package.log`
- `<VALIDATION_ROOT>/phase4-r3-war-smoke.log`

WAR 位置为 `target/qatrack-0.1.0-SNAPSHOT.war`（gitignored）；5 个运行时依赖为 Jackson annotations/core/databind/jsr310 和 MySQL Connector/J。独立 smoke 的父加载器只有 Tomcat core；驱动/应用从 WAR 加载。本轮仅修改 Listener 的 Service wiring，驱动发现与清理生命周期不变。

未连接或修改 localhost:3306/qatrack，没有加载开发 seed；Fixture 安全门禁/清理逻辑完全未改。MySQL 临时实例关闭前再次查询确认 0 表；关闭后确认 13307 无监听。

## 12. Working tree 与推荐 Final Review

实际修改 12 个已跟踪文件；新增 19 个未跟踪文件（16 个生产 Java、2 个测试 Java、本文档）。没有 staged changes，没有 commit/push。普通 `git diff --stat` 只计算已跟踪部分：12 files changed, 141 insertions(+), 16 deletions(-)，不包括这 19 个新增文件。

优先 Review：
1. `service/DefaultTestExecutionService.java`：嵌套 scope 在 append/retry/recovery 全路径传递，终态幂等顺序。
2. `service/DefaultDefectService.java`：所有 scoped 写入口与 close 分支归属校验、详情一致读。
3. `web/handler/TestRunHandler.java`：创建模式、层级路径、Attempt DTO 映射，无 Web retry。
4. `web/handler/DefectHandler.java`：显式状态动作、version、evidence/reopen 的单 Service 调用。
5. `integration/ExecutionHttpIntegrationTest.java`：真实完整链、权限、错误归属、历史、并发和终态 replay 的证据。

以上 Java 路径分别位于 `src/main/java/io/github/lz007001cn/qatrack/`，第 5 项位于 `src/test/java/io/github/lz007001cn/qatrack/`。

最终 `git status --short --untracked-files=all`：

```text
 M src/main/java/io/github/lz007001cn/qatrack/bootstrap/ApplicationListener.java
 M src/main/java/io/github/lz007001cn/qatrack/service/DefaultDefectService.java
 M src/main/java/io/github/lz007001cn/qatrack/service/DefaultTestExecutionService.java
 M src/main/java/io/github/lz007001cn/qatrack/service/DefaultTestRunService.java
 M src/main/java/io/github/lz007001cn/qatrack/service/DefectService.java
 M src/main/java/io/github/lz007001cn/qatrack/service/TestExecutionService.java
 M src/main/java/io/github/lz007001cn/qatrack/service/TestRunService.java
 M src/main/java/io/github/lz007001cn/qatrack/web/ApiServlet.java
 M src/main/java/io/github/lz007001cn/qatrack/web/WebServices.java
 M src/test/java/io/github/lz007001cn/qatrack/integration/TestAssetHttpIntegrationTest.java
 M src/test/java/io/github/lz007001cn/qatrack/web/TestAssetWebTest.java
 M src/test/java/io/github/lz007001cn/qatrack/web/WebFoundationTest.java
?? docs/PHASE4-R3-EXECUTION-DEFECT-API.md
?? src/main/java/io/github/lz007001cn/qatrack/service/query/DefectDetails.java
?? src/main/java/io/github/lz007001cn/qatrack/service/query/RunDetails.java
?? src/main/java/io/github/lz007001cn/qatrack/web/dto/AddEvidenceRequest.java
?? src/main/java/io/github/lz007001cn/qatrack/web/dto/AttemptResponse.java
?? src/main/java/io/github/lz007001cn/qatrack/web/dto/CreateDefectRequest.java
?? src/main/java/io/github/lz007001cn/qatrack/web/dto/CreateRunRequest.java
?? src/main/java/io/github/lz007001cn/qatrack/web/dto/DefectDetailResponse.java
?? src/main/java/io/github/lz007001cn/qatrack/web/dto/DefectResponse.java
?? src/main/java/io/github/lz007001cn/qatrack/web/dto/RecordAttemptRequest.java
?? src/main/java/io/github/lz007001cn/qatrack/web/dto/ReopenDefectRequest.java
?? src/main/java/io/github/lz007001cn/qatrack/web/dto/ResolveDefectRequest.java
?? src/main/java/io/github/lz007001cn/qatrack/web/dto/RunDetailResponse.java
?? src/main/java/io/github/lz007001cn/qatrack/web/dto/RunResponse.java
?? src/main/java/io/github/lz007001cn/qatrack/web/dto/UpdateDefectRequest.java
?? src/main/java/io/github/lz007001cn/qatrack/web/handler/DefectHandler.java
?? src/main/java/io/github/lz007001cn/qatrack/web/handler/TestRunHandler.java
?? src/test/java/io/github/lz007001cn/qatrack/integration/ExecutionHttpIntegrationTest.java
?? src/test/java/io/github/lz007001cn/qatrack/web/ExecutionWebTest.java
```

**本轮实现完成，可进入 Phase 4 Round 3 Final Review；不自动批准或执行 commit/push，也未进入 Round 4。**

当前部署方式见 [ECS 部署说明](ECS-DEPLOYMENT.md)。
