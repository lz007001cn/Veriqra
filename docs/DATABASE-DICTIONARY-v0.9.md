# Veriqra 数据库数据字典（v0.9）

整理日期：2026-10-29。代码依据：8259b8a4a49417e87c1505b4e4e404a4b20b237e。

当前最终结构：**35 张表、310 个字段、82 个外键、31 个 UNIQUE KEY、87 个 CHECK**。统计不把 PRIMARY KEY 计入 UNIQUE KEY；字段统计包含生成列。软件模块和业务流程见 [软件设计说明书](SOFTWARE-DESIGN-v0.9.md)。

依据当前仓库 `database/schema.sql` 加 `database/migrations/20261014-r1-defect-retest.sql` 的最终结构整理，包含基线文件内的 ALTER 结果。字段类型、可空、默认值和约束直接取自 DDL；字段中文含义是结合命名及实现用途的解释，不属于数据库列 COMMENT。未访问生产数据库。

## 安装与结构范围

- MySQL 8.0，InnoDB，默认字符集 utf8mb4，排序规则 utf8mb4_0900_ai_ci。字符串标识/状态部分列另设 ascii_bin 或 utf8mb4_0900_bin，完整声明保留于逐表 SQL 字段定义中。
- 新空库先执行 schema.sql（32 表），再执行 20261014-r1-defect-retest.sql（3 表），共 35 表。
- v0.3 到 v0.9 无 DDL 升级；20260924-admin.sql、20260926-collaboration.sql、20260927-task-credit.sql 的改动已合并进当前 schema.sql，新安装不再重复追加。
- schema-v1-frozen.sql 和旧 seed/constraint-tests/queries/service-invariants 是历史 19 表验证材料。
- 当前核心 23 表；后台日志 3 表；功能已裁撤但保留结构和历史数据 9 表。
- 所有实际外键均为 ON DELETE RESTRICT / ON UPDATE RESTRICT；项目一致性与状态流转还需服务层校验。

## 表目录

|序号|表名|中文名称|用途|分类|字段数|
|---|---|---|---|---|---|
|1|`users`|用户表|平台账号、显示名称、密码摘要及账号状态。|当前核心功能|9|
|2|`projects`|项目表|质量资产与权限隔离的项目容器。|当前核心功能|9|
|3|`project_members`|项目成员表|用户在项目中的角色与成员状态。|当前核心功能|7|
|4|`project_counters`|项目业务编号计数器|按项目分别分配需求、用例、计划和缺陷编号。|当前核心功能|3|
|5|`requirements`|需求表|需求标题、描述、优先级与生命周期。|当前核心功能|11|
|6|`test_cases`|测试用例表|可编辑的用例定义及前置条件。|当前核心功能|12|
|7|`test_automation_identities`|自动化测试标识表|JUnit source、classname/namespace 和 testcase name 组成外部标识。|当前核心功能|6|
|8|`test_automation_mappings`|自动化映射表|人工确认外部自动化标识与系统用例的对应关系。|当前核心功能|8|
|9|`test_steps`|测试步骤表|当前用例定义的有序操作与预期结果。|当前核心功能|4|
|10|`test_case_requirements`|需求用例关联表|需求与用例的覆盖关系及人工复核状态。|当前核心功能|8|
|11|`test_plans`|测试计划表|按目标组织要执行的测试用例。|当前核心功能|10|
|12|`test_plan_cases`|计划用例成员表|测试计划包含哪些用例。|当前核心功能|4|
|13|`test_runs`|测试运行表|某次执行批次的环境、构建版本和状态。|当前核心功能|12|
|14|`test_run_cases`|运行用例快照表|运行创建时冻结的用例定义。|当前核心功能|8|
|15|`test_run_case_steps`|运行步骤快照表|运行创建时冻结的测试步骤。|当前核心功能|4|
|16|`test_imports`|JUnit 导入记录表|导入来源、报告摘要与幂等请求标识。|当前核心功能|8|
|17|`test_attempts`|测试执行尝试表|同一运行用例可追加多次人工或自动化执行结果。|当前核心功能|13|
|18|`defects`|缺陷表|缺陷描述、严重程度、处理人与处理状态。|当前核心功能|14|
|19|`test_attempt_defects`|失败缺陷证据关联表|将具体执行尝试与缺陷建立证据关系。|当前核心功能|4|
|20|`credit_accounts`|历史积分账户表|保留用户积分余额。|历史保留（已裁撤功能）|4|
|21|`credit_transactions`|历史积分流水表|保留发放、收回、转账和任务奖励流水。|历史保留（已裁撤功能）|11|
|22|`login_events`|登录事件表|后台持续记录登录结果与终端信息。|后台运行记录（无独立维护页面）|11|
|23|`access_logs`|访问日志表|后台持续记录请求、响应状态及耗时。|后台运行记录（无独立维护页面）|13|
|24|`audit_logs`|操作日志表|后台持续记录用户维护等管理操作。|后台运行记录（无独立维护页面）|10|
|25|`project_managers`|项目负责人表|从项目成员中任命项目负责人。|当前核心功能|6|
|26|`project_teams`|历史项目小组表|保留项目内小组及组长资料。|历史保留（已裁撤功能）|9|
|27|`team_members`|历史小组成员表|保留小组与项目成员的关系。|历史保留（已裁撤功能）|6|
|28|`work_tasks`|历史任务表|保留小组任务、执行人、奖励及验收状态。|历史保留（已裁撤功能）|14|
|29|`work_task_events`|历史任务事件表|保留任务状态和执行人变更。|历史保留（已裁撤功能）|10|
|30|`task_handoff_offers`|历史任务转交邀约表|保留附带积分的任务转交邀约。|历史保留（已裁撤功能）|12|
|31|`credit_transfers`|历史积分转账表|保留项目内成员互转与任务转交支付记录。|历史保留（已裁撤功能）|9|
|32|`contribution_events`|历史贡献事件表|保留任务验收完成时的贡献积分。|历史保留（已裁撤功能）|7|
|33|`defect_retest_links`|缺陷复测关联表|为原始失败选定另一次兼容的通过结果，并记录撤销或替换。|当前核心功能|20|
|34|`defect_closure_receipts`|缺陷关闭回执表|冻结一次缺陷关闭时使用的说明、版本与证据数量。|当前核心功能|8|
|35|`defect_closure_items`|缺陷关闭证据明细表|冻结关闭回执中每个原始失败及采信通过结果。|当前核心功能|6|

## 主要关系与实现边界

1. 用户与项目通过 `project_members(project_id,user_id)` 构成多对多关系；`project_managers(project_id,user_id)` 的复合外键确保负责人必须先是该项目成员。负责人身份是额外任命，不是 `project_role` 的第三个枚举。
2. `requirements`、`test_cases`、`test_plans`、`test_runs`、`defects` 直接属于项目；需求/用例/计划/缺陷业务编号通过 `(project_id,key_no)` 唯一，ID 与显示编号不同。
3. 需求与用例通过 `test_case_requirements` 多对多关联；确认、需复核、已移除是覆盖关联状态，不代表执行通过/失败。
4. 用例与当前步骤是一对多；计划与用例通过 `test_plan_cases` 多对多关联。计划存成员关系，不冻结用例内容。
5. 计划可产生多次运行，运行允许无计划。运行与冻结用例、冻结用例与冻结步骤均为一对多。`(test_run_id,test_case_id)` 唯一。
6. 运行用例与执行尝试一对多；执行序号在单个运行用例内唯一。没有执行尝试时派生 `NOT_RUN`，表内实际尝试状态仅 PASS/FAIL/BLOCKED/SKIPPED。
7. `test_automation_identities` 唯一标识 `(project_id,source,namespace,external_key)`；当前每个标识最多一条映射（可 ACTIVE 或 INACTIVE）。多个不同外部标识可映射到同一个用例。
8. 导入记录属于运行；导入尝试同时引用 import 和 mapping，人工尝试引用 executed_by。CHECK 约束两种来源形状互斥。`report_sha256` 记录来源指纹，但没有唯一约束；请求幂等键才是唯一键。
9. 执行尝试与缺陷通过 `test_attempt_defects` 多对多关联。数据库外键只保障存在性；仅关联 FAIL、同项目、操作者权限等由服务层检查。
10. `defect_retest_links` 的 `(failure_attempt_id,defect_id)` 外键必须指向既有失败证据；pass_attempt_id 指向通过尝试。生成列与唯一键限制同缺陷同原始失败最多一条未撤销复测关联。PASS 性质、后续时序、快照兼容性由服务层决定。
11. 缺陷可保留多次关闭回执；`(defect_id,closed_defect_version)` 唯一。回执与明细一对多，复合外键防止混用不同缺陷/失败/通过的证据。旧关闭回执是关闭时事实，不随之后复测选择被改写。
12. `project_counters` 用 `(project_id,entity_type)` 为各项目分配 REQ/TC/PLAN/BUG 序号；数据库检查 next_value 大于零，原子分配由事务和 DAO 实现。

### 当前核心功能表（23）

`users`、`projects`、`project_members`、`project_managers`、`project_counters`、`requirements`、`test_cases`、`test_steps`、`test_case_requirements`、`test_plans`、`test_plan_cases`、`test_runs`、`test_run_cases`、`test_run_case_steps`、`test_attempts`、`defects`、`test_attempt_defects`、`defect_retest_links`、`defect_closure_receipts`、`defect_closure_items`、`test_automation_identities`、`test_automation_mappings`、`test_imports`。

### 后台运行记录（3）

`login_events`、`access_logs`、`audit_logs`。当前 `ApiServlet` 的登录结果记录、`AccessLogFilter` 请求记录和 `AdminUserService` 用户维护事务仍使用这些表；页面精简不等于停止后台写入。

### 已裁撤功能的历史保留表（9）

`credit_accounts`、`credit_transactions`、`project_teams`、`team_members`、`work_tasks`、`work_task_events`、`task_handoff_offers`、`credit_transfers`、`contribution_events`。当前 Java 源码未检索到这些表名引用；README 明确说明小组任务、任务转交、积分奖励与排行已裁撤，表与历史数据保留。不应写成 v0.9 可操作模块。

## 字段与约束

说明：PK 为主键；联合主键按约束所列顺序组成。FK 的业务含义须结合其目标列阅读，复合外键保持原文。`NOT_RUN` 不存入 test_attempts：运行用例没有任何尝试时，查询层派生未执行状态。

### 1. users — 用户表

平台账号、显示名称、密码摘要及账号状态。 分类：当前核心功能。来源：`database/schema.sql:8`。

|字段|类型|可空|默认/生成规则|中文说明|
|---|---|---|---|---|
|`id`|`BIGINT`|否|自增|记录主键|
|`username`|`VARCHAR(64)`|否|无显式默认|登录用户名|
|`display_name`|`VARCHAR(80)`|否|无显式默认|显示名称|
|`password_hash`|`VARCHAR(255)`|否|无显式默认|密码摘要|
|`system_role`|`VARCHAR(16)`|否|'USER'|平台角色|
|`status`|`VARCHAR(16)`|否|'ACTIVE'|业务状态；允许值见下方 CHECK 约束|
|`created_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|创建时间|
|`updated_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|最近更新时间|
|`lock_version`|`INT UNSIGNED`|否|0|乐观锁版本号|

**完整字段声明与约束（最终生效结构）**

```sql
`id` BIGINT NOT NULL AUTO_INCREMENT,
`username` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
`display_name` VARCHAR(80) NOT NULL,
`password_hash` VARCHAR(255) NOT NULL,
`system_role` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'USER',
`status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
`created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
`updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
`lock_version` INT UNSIGNED NOT NULL DEFAULT 0,
PRIMARY KEY (`id`),
UNIQUE KEY `uq_users_username` (`username`),
KEY `ix_users_admin_lock` (`system_role`, `status`, `id`),
CONSTRAINT `ck_users_username_nonblank` CHECK (CHAR_LENGTH(TRIM(`username`)) > 0),
CONSTRAINT `ck_users_display_name_nonblank` CHECK (CHAR_LENGTH(TRIM(`display_name`)) > 0),
CONSTRAINT `ck_users_password_hash_nonblank` CHECK (CHAR_LENGTH(TRIM(`password_hash`)) > 0),
CONSTRAINT `ck_users_system_role` CHECK (`system_role` IN ('ADMIN','USER')),
CONSTRAINT `ck_users_status` CHECK (`status` IN ('ACTIVE','DISABLED'))
```

### 2. projects — 项目表

质量资产与权限隔离的项目容器。 分类：当前核心功能。来源：`database/schema.sql:28`。

|字段|类型|可空|默认/生成规则|中文说明|
|---|---|---|---|---|
|`id`|`BIGINT`|否|自增|记录主键|
|`project_key`|`VARCHAR(16)`|否|无显式默认|项目编号|
|`name`|`VARCHAR(160)`|否|无显式默认|名称|
|`description`|`TEXT`|是|NULL|描述|
|`status`|`VARCHAR(16)`|否|'ACTIVE'|业务状态；允许值见下方 CHECK 约束|
|`created_by`|`BIGINT`|否|无显式默认|创建用户 ID|
|`created_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|创建时间|
|`updated_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|最近更新时间|
|`lock_version`|`INT UNSIGNED`|否|0|乐观锁版本号|

**完整字段声明与约束（最终生效结构）**

```sql
`id` BIGINT NOT NULL AUTO_INCREMENT,
`project_key` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
`name` VARCHAR(160) NOT NULL,
`description` TEXT NULL DEFAULT NULL,
`status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
`created_by` BIGINT NOT NULL,
`created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
`updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
`lock_version` INT UNSIGNED NOT NULL DEFAULT 0,
PRIMARY KEY (`id`),
UNIQUE KEY `uq_projects_key` (`project_key`),
KEY `ix_projects_created_by` (`created_by`),
CONSTRAINT `fk_projects_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `ck_projects_name_nonblank` CHECK (CHAR_LENGTH(TRIM(`name`)) > 0),
CONSTRAINT `ck_projects_status` CHECK (`status` IN ('ACTIVE','ARCHIVED'))
```

### 3. project_members — 项目成员表

用户在项目中的角色与成员状态。 分类：当前核心功能。来源：`database/schema.sql:46`。

|字段|类型|可空|默认/生成规则|中文说明|
|---|---|---|---|---|
|`project_id`|`BIGINT`|否|无显式默认|所属项目 ID|
|`user_id`|`BIGINT`|否|无显式默认|用户 ID|
|`project_role`|`VARCHAR(16)`|否|无显式默认|项目内角色|
|`status`|`VARCHAR(16)`|否|'ACTIVE'|业务状态；允许值见下方 CHECK 约束|
|`joined_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|加入时间|
|`updated_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|最近更新时间|
|`lock_version`|`INT UNSIGNED`|否|0|乐观锁版本号|

**完整字段声明与约束（最终生效结构）**

```sql
`project_id` BIGINT NOT NULL,
`user_id` BIGINT NOT NULL,
`project_role` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
`status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
`joined_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
`updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
`lock_version` INT UNSIGNED NOT NULL DEFAULT 0,
PRIMARY KEY (`project_id`, `user_id`),
KEY `ix_members_user_status_project` (`user_id`, `status`, `project_id`),
CONSTRAINT `fk_project_members_project_id` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_project_members_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `ck_project_members_project_role` CHECK (`project_role` IN ('TESTER','DEVELOPER')),
CONSTRAINT `ck_project_members_status` CHECK (`status` IN ('ACTIVE','INACTIVE'))
```

### 4. project_counters — 项目业务编号计数器

按项目分别分配需求、用例、计划和缺陷编号。 分类：当前核心功能。来源：`database/schema.sql:62`。

|字段|类型|可空|默认/生成规则|中文说明|
|---|---|---|---|---|
|`project_id`|`BIGINT`|否|无显式默认|所属项目 ID|
|`entity_type`|`VARCHAR(16)`|否|无显式默认|业务编号类型|
|`next_value`|`BIGINT`|否|1|下一可分配编号|

**完整字段声明与约束（最终生效结构）**

```sql
`project_id` BIGINT NOT NULL,
`entity_type` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
`next_value` BIGINT NOT NULL DEFAULT 1,
PRIMARY KEY (`project_id`, `entity_type`),
CONSTRAINT `fk_project_counters_project_id` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `ck_project_counters_entity_type` CHECK (`entity_type` IN ('REQ','TC','PLAN','BUG')),
CONSTRAINT `ck_project_counters_next_value` CHECK (`next_value` > 0)
```

### 5. requirements — 需求表

需求标题、描述、优先级与生命周期。 分类：当前核心功能。来源：`database/schema.sql:72`。

|字段|类型|可空|默认/生成规则|中文说明|
|---|---|---|---|---|
|`id`|`BIGINT`|否|自增|记录主键|
|`project_id`|`BIGINT`|否|无显式默认|所属项目 ID|
|`key_no`|`BIGINT`|否|无显式默认|项目内业务序号|
|`title`|`VARCHAR(240)`|否|无显式默认|标题|
|`description`|`TEXT`|是|NULL|描述|
|`priority`|`VARCHAR(16)`|否|'MEDIUM'|优先级|
|`status`|`VARCHAR(16)`|否|'DRAFT'|业务状态；允许值见下方 CHECK 约束|
|`created_by`|`BIGINT`|否|无显式默认|创建用户 ID|
|`created_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|创建时间|
|`updated_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|最近更新时间|
|`lock_version`|`INT UNSIGNED`|否|0|乐观锁版本号|

**完整字段声明与约束（最终生效结构）**

```sql
`id` BIGINT NOT NULL AUTO_INCREMENT,
`project_id` BIGINT NOT NULL,
`key_no` BIGINT NOT NULL,
`title` VARCHAR(240) NOT NULL,
`description` TEXT NULL DEFAULT NULL,
`priority` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'MEDIUM',
`status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'DRAFT',
`created_by` BIGINT NOT NULL,
`created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
`updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
`lock_version` INT UNSIGNED NOT NULL DEFAULT 0,
PRIMARY KEY (`id`),
UNIQUE KEY `uq_requirements_project_key` (`project_id`, `key_no`),
KEY `ix_requirements_created_by` (`created_by`),
CONSTRAINT `fk_requirements_project_id` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_requirements_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `ck_requirements_key_no` CHECK (`key_no` > 0),
CONSTRAINT `ck_requirements_title_nonblank` CHECK (CHAR_LENGTH(TRIM(`title`)) > 0),
CONSTRAINT `ck_requirements_priority` CHECK (`priority` IN ('LOW','MEDIUM','HIGH')),
CONSTRAINT `ck_requirements_status` CHECK (`status` IN ('DRAFT','ACTIVE','ARCHIVED'))
```

### 6. test_cases — 测试用例表

可编辑的用例定义及前置条件。 分类：当前核心功能。来源：`database/schema.sql:95`。

|字段|类型|可空|默认/生成规则|中文说明|
|---|---|---|---|---|
|`id`|`BIGINT`|否|自增|记录主键|
|`project_id`|`BIGINT`|否|无显式默认|所属项目 ID|
|`key_no`|`BIGINT`|否|无显式默认|项目内业务序号|
|`title`|`VARCHAR(240)`|否|无显式默认|标题|
|`description`|`TEXT`|是|NULL|描述|
|`preconditions`|`TEXT`|是|NULL|测试前置条件|
|`priority`|`VARCHAR(16)`|否|'MEDIUM'|优先级|
|`status`|`VARCHAR(16)`|否|'DRAFT'|业务状态；允许值见下方 CHECK 约束|
|`created_by`|`BIGINT`|否|无显式默认|创建用户 ID|
|`created_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|创建时间|
|`updated_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|最近更新时间|
|`lock_version`|`INT UNSIGNED`|否|0|乐观锁版本号|

**完整字段声明与约束（最终生效结构）**

```sql
`id` BIGINT NOT NULL AUTO_INCREMENT,
`project_id` BIGINT NOT NULL,
`key_no` BIGINT NOT NULL,
`title` VARCHAR(240) NOT NULL,
`description` TEXT NULL DEFAULT NULL,
`preconditions` TEXT NULL DEFAULT NULL,
`priority` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'MEDIUM',
`status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'DRAFT',
`created_by` BIGINT NOT NULL,
`created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
`updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
`lock_version` INT UNSIGNED NOT NULL DEFAULT 0,
PRIMARY KEY (`id`),
UNIQUE KEY `uq_test_cases_project_key` (`project_id`, `key_no`),
KEY `ix_test_cases_created_by` (`created_by`),
CONSTRAINT `fk_test_cases_project_id` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_test_cases_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `ck_test_cases_key_no` CHECK (`key_no` > 0),
CONSTRAINT `ck_test_cases_title_nonblank` CHECK (CHAR_LENGTH(TRIM(`title`)) > 0),
CONSTRAINT `ck_test_cases_priority` CHECK (`priority` IN ('LOW','MEDIUM','HIGH')),
CONSTRAINT `ck_test_cases_status` CHECK (`status` IN ('DRAFT','READY','ARCHIVED'))
```

### 7. test_automation_identities — 自动化测试标识表

JUnit source、classname/namespace 和 testcase name 组成外部标识。 分类：当前核心功能。来源：`database/schema.sql:119`。

|字段|类型|可空|默认/生成规则|中文说明|
|---|---|---|---|---|
|`id`|`BIGINT`|否|自增|记录主键|
|`project_id`|`BIGINT`|否|无显式默认|所属项目 ID|
|`source`|`VARCHAR(16)`|否|'JUNIT'|来源类型|
|`namespace`|`VARCHAR(128)`|否|无显式默认|JUnit 类名/命名空间|
|`external_key`|`VARCHAR(512)`|否|无显式默认|JUnit 测试名称|
|`created_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|创建时间|

**完整字段声明与约束（最终生效结构）**

```sql
`id` BIGINT NOT NULL AUTO_INCREMENT,
`project_id` BIGINT NOT NULL,
`source` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'JUNIT',
`namespace` VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
`external_key` VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
`created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
PRIMARY KEY (`id`),
UNIQUE KEY `uq_automation_identity` (`project_id`, `source`, `namespace`, `external_key`),
CONSTRAINT `fk_test_automation_identities_project_id` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `ck_test_automation_identities_source` CHECK (`source` IN ('JUNIT')),
CONSTRAINT `ck_test_automation_identities_namespace_nonblank` CHECK (CHAR_LENGTH(TRIM(`namespace`)) > 0),
CONSTRAINT `ck_automation_external_key_nonempty` CHECK (CHAR_LENGTH(`external_key`) > 0)
```

### 8. test_automation_mappings — 自动化映射表

人工确认外部自动化标识与系统用例的对应关系。 分类：当前核心功能。来源：`database/schema.sql:134`。

|字段|类型|可空|默认/生成规则|中文说明|
|---|---|---|---|---|
|`id`|`BIGINT`|否|自增|记录主键|
|`automation_identity_id`|`BIGINT`|否|无显式默认|外部自动化标识 ID|
|`test_case_id`|`BIGINT`|否|无显式默认|测试用例 ID|
|`status`|`VARCHAR(16)`|否|'ACTIVE'|业务状态；允许值见下方 CHECK 约束|
|`created_by`|`BIGINT`|否|无显式默认|创建用户 ID|
|`created_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|创建时间|
|`updated_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|最近更新时间|
|`lock_version`|`INT UNSIGNED`|否|0|乐观锁版本号|

**完整字段声明与约束（最终生效结构）**

```sql
`id` BIGINT NOT NULL AUTO_INCREMENT,
`automation_identity_id` BIGINT NOT NULL,
`test_case_id` BIGINT NOT NULL,
`status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
`created_by` BIGINT NOT NULL,
`created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
`updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
`lock_version` INT UNSIGNED NOT NULL DEFAULT 0,
PRIMARY KEY (`id`),
UNIQUE KEY `uq_automation_mapping_identity` (`automation_identity_id`),
KEY `ix_automation_mappings_case_status` (`test_case_id`, `status`, `id`),
KEY `ix_automation_mappings_created_by` (`created_by`),
CONSTRAINT `fk_test_automation_mappings_automation_identity_id` FOREIGN KEY (`automation_identity_id`) REFERENCES `test_automation_identities` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_test_automation_mappings_test_case_id` FOREIGN KEY (`test_case_id`) REFERENCES `test_cases` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_test_automation_mappings_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `ck_test_automation_mappings_status` CHECK (`status` IN ('ACTIVE','INACTIVE'))
```

### 9. test_steps — 测试步骤表

当前用例定义的有序操作与预期结果。 分类：当前核心功能。来源：`database/schema.sql:153`。

|字段|类型|可空|默认/生成规则|中文说明|
|---|---|---|---|---|
|`test_case_id`|`BIGINT`|否|无显式默认|测试用例 ID|
|`step_order`|`SMALLINT UNSIGNED`|否|无显式默认|从 1 开始的步骤序号|
|`action`|`TEXT`|否|无显式默认|操作内容|
|`expected_result`|`TEXT`|否|无显式默认|预期结果|

**完整字段声明与约束（最终生效结构）**

```sql
`test_case_id` BIGINT NOT NULL,
`step_order` SMALLINT UNSIGNED NOT NULL,
`action` TEXT NOT NULL,
`expected_result` TEXT NOT NULL,
PRIMARY KEY (`test_case_id`, `step_order`),
CONSTRAINT `fk_test_steps_test_case_id` FOREIGN KEY (`test_case_id`) REFERENCES `test_cases` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `ck_test_steps_step_order` CHECK (`step_order` > 0),
CONSTRAINT `ck_test_steps_action_nonblank` CHECK (CHAR_LENGTH(TRIM(`action`)) > 0),
CONSTRAINT `ck_test_steps_expected_result_nonblank` CHECK (CHAR_LENGTH(TRIM(`expected_result`)) > 0)
```

### 10. test_case_requirements — 需求用例关联表

需求与用例的覆盖关系及人工复核状态。 分类：当前核心功能。来源：`database/schema.sql:165`。

|字段|类型|可空|默认/生成规则|中文说明|
|---|---|---|---|---|
|`requirement_id`|`BIGINT`|否|无显式默认|需求 ID|
|`test_case_id`|`BIGINT`|否|无显式默认|测试用例 ID|
|`status`|`VARCHAR(16)`|否|'NEEDS_REVIEW'|业务状态；允许值见下方 CHECK 约束|
|`linked_by`|`BIGINT`|否|无显式默认|建立关联的用户 ID|
|`linked_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|关联时间|
|`reviewed_by`|`BIGINT`|是|NULL|复核用户 ID|
|`reviewed_at`|`DATETIME(6)`|是|NULL|复核时间|
|`updated_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|最近更新时间|

**完整字段声明与约束（最终生效结构）**

```sql
`requirement_id` BIGINT NOT NULL,
`test_case_id` BIGINT NOT NULL,
`status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'NEEDS_REVIEW',
`linked_by` BIGINT NOT NULL,
`linked_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
`reviewed_by` BIGINT NULL DEFAULT NULL,
`reviewed_at` DATETIME(6) NULL DEFAULT NULL,
`updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
PRIMARY KEY (`requirement_id`, `test_case_id`),
KEY `ix_trace_case_requirement` (`test_case_id`, `requirement_id`),
KEY `ix_test_case_requirements_linked_by` (`linked_by`),
KEY `ix_test_case_requirements_reviewed_by` (`reviewed_by`),
CONSTRAINT `fk_test_case_requirements_requirement_id` FOREIGN KEY (`requirement_id`) REFERENCES `requirements` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_test_case_requirements_test_case_id` FOREIGN KEY (`test_case_id`) REFERENCES `test_cases` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_test_case_requirements_linked_by` FOREIGN KEY (`linked_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_test_case_requirements_reviewed_by` FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `ck_test_case_requirements_status` CHECK (`status` IN ('CONFIRMED','NEEDS_REVIEW','REMOVED')),
CONSTRAINT `ck_trace_review_shape` CHECK ((`status` = 'CONFIRMED' AND `reviewed_by` IS NOT NULL AND `reviewed_at` IS NOT NULL) OR (`status` IN ('NEEDS_REVIEW','REMOVED') AND `reviewed_by` IS NULL AND `reviewed_at` IS NULL))
```

### 11. test_plans — 测试计划表

按目标组织要执行的测试用例。 分类：当前核心功能。来源：`database/schema.sql:186`。

|字段|类型|可空|默认/生成规则|中文说明|
|---|---|---|---|---|
|`id`|`BIGINT`|否|自增|记录主键|
|`project_id`|`BIGINT`|否|无显式默认|所属项目 ID|
|`key_no`|`BIGINT`|否|无显式默认|项目内业务序号|
|`name`|`VARCHAR(160)`|否|无显式默认|名称|
|`description`|`TEXT`|是|NULL|描述|
|`status`|`VARCHAR(16)`|否|'DRAFT'|业务状态；允许值见下方 CHECK 约束|
|`created_by`|`BIGINT`|否|无显式默认|创建用户 ID|
|`created_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|创建时间|
|`updated_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|最近更新时间|
|`lock_version`|`INT UNSIGNED`|否|0|乐观锁版本号|

**完整字段声明与约束（最终生效结构）**

```sql
`id` BIGINT NOT NULL AUTO_INCREMENT,
`project_id` BIGINT NOT NULL,
`key_no` BIGINT NOT NULL,
`name` VARCHAR(160) NOT NULL,
`description` TEXT NULL DEFAULT NULL,
`status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'DRAFT',
`created_by` BIGINT NOT NULL,
`created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
`updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
`lock_version` INT UNSIGNED NOT NULL DEFAULT 0,
PRIMARY KEY (`id`),
UNIQUE KEY `uq_test_plans_project_key` (`project_id`, `key_no`),
KEY `ix_test_plans_created_by` (`created_by`),
CONSTRAINT `fk_test_plans_project_id` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_test_plans_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `ck_test_plans_key_no` CHECK (`key_no` > 0),
CONSTRAINT `ck_test_plans_name_nonblank` CHECK (CHAR_LENGTH(TRIM(`name`)) > 0),
CONSTRAINT `ck_test_plans_status` CHECK (`status` IN ('DRAFT','READY','ARCHIVED'))
```

### 12. test_plan_cases — 计划用例成员表

测试计划包含哪些用例。 分类：当前核心功能。来源：`database/schema.sql:207`。

|字段|类型|可空|默认/生成规则|中文说明|
|---|---|---|---|---|
|`test_plan_id`|`BIGINT`|否|无显式默认|来源测试计划 ID；运行允许为空|
|`test_case_id`|`BIGINT`|否|无显式默认|测试用例 ID|
|`added_by`|`BIGINT`|否|无显式默认|添加用户 ID|
|`added_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|添加时间|

**完整字段声明与约束（最终生效结构）**

```sql
`test_plan_id` BIGINT NOT NULL,
`test_case_id` BIGINT NOT NULL,
`added_by` BIGINT NOT NULL,
`added_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
PRIMARY KEY (`test_plan_id`, `test_case_id`),
KEY `ix_plan_cases_case_plan` (`test_case_id`, `test_plan_id`),
KEY `ix_test_plan_cases_added_by` (`added_by`),
CONSTRAINT `fk_test_plan_cases_test_plan_id` FOREIGN KEY (`test_plan_id`) REFERENCES `test_plans` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_test_plan_cases_test_case_id` FOREIGN KEY (`test_case_id`) REFERENCES `test_cases` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_test_plan_cases_added_by` FOREIGN KEY (`added_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
```

### 13. test_runs — 测试运行表

某次执行批次的环境、构建版本和状态。 分类：当前核心功能。来源：`database/schema.sql:220`。

|字段|类型|可空|默认/生成规则|中文说明|
|---|---|---|---|---|
|`id`|`BIGINT`|否|自增|记录主键|
|`project_id`|`BIGINT`|否|无显式默认|所属项目 ID|
|`test_plan_id`|`BIGINT`|是|NULL|来源测试计划 ID；运行允许为空|
|`name`|`VARCHAR(160)`|否|无显式默认|名称|
|`environment`|`VARCHAR(160)`|是|NULL|执行环境|
|`build_version`|`VARCHAR(80)`|是|NULL|被测构建版本|
|`status`|`VARCHAR(16)`|否|'IN_PROGRESS'|业务状态；允许值见下方 CHECK 约束|
|`ended_at`|`DATETIME(6)`|是|NULL|运行结束时间|
|`created_by`|`BIGINT`|否|无显式默认|创建用户 ID|
|`created_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|创建时间|
|`updated_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|最近更新时间|
|`lock_version`|`INT UNSIGNED`|否|0|乐观锁版本号|

**完整字段声明与约束（最终生效结构）**

```sql
`id` BIGINT NOT NULL AUTO_INCREMENT,
`project_id` BIGINT NOT NULL,
`test_plan_id` BIGINT NULL DEFAULT NULL,
`name` VARCHAR(160) NOT NULL,
`environment` VARCHAR(160) NULL DEFAULT NULL,
`build_version` VARCHAR(80) NULL DEFAULT NULL,
`status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'IN_PROGRESS',
`ended_at` DATETIME(6) NULL DEFAULT NULL,
`created_by` BIGINT NOT NULL,
`created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
`updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
`lock_version` INT UNSIGNED NOT NULL DEFAULT 0,
PRIMARY KEY (`id`),
KEY `ix_runs_plan_created_id` (`test_plan_id`, `created_at`, `id`),
KEY `ix_test_runs_created_by` (`created_by`),
KEY `ix_runs_project_created_id` (`project_id`, `created_at`, `id`),
CONSTRAINT `fk_test_runs_project_id` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_test_runs_test_plan_id` FOREIGN KEY (`test_plan_id`) REFERENCES `test_plans` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_test_runs_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `ck_test_runs_name_nonblank` CHECK (CHAR_LENGTH(TRIM(`name`)) > 0),
CONSTRAINT `ck_test_runs_status` CHECK (`status` IN ('IN_PROGRESS','COMPLETED','CANCELLED')),
CONSTRAINT `ck_runs_ended_at` CHECK ((`status` <> 'IN_PROGRESS' OR `ended_at` IS NULL) AND (`status` NOT IN ('COMPLETED','CANCELLED') OR (`ended_at` IS NOT NULL AND `ended_at` >= `created_at`)))
```

### 14. test_run_cases — 运行用例快照表

运行创建时冻结的用例定义。 分类：当前核心功能。来源：`database/schema.sql:245`。

|字段|类型|可空|默认/生成规则|中文说明|
|---|---|---|---|---|
|`id`|`BIGINT`|否|自增|记录主键|
|`test_run_id`|`BIGINT`|否|无显式默认|测试运行 ID|
|`test_case_id`|`BIGINT`|否|无显式默认|测试用例 ID|
|`snapshot_title`|`VARCHAR(240)`|否|无显式默认|冻结的用例标题|
|`snapshot_description`|`TEXT`|是|NULL|冻结的用例描述|
|`snapshot_preconditions`|`TEXT`|是|NULL|冻结的前置条件|
|`snapshot_priority`|`VARCHAR(16)`|否|无显式默认|冻结的优先级|
|`captured_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|快照捕获时间|

**完整字段声明与约束（最终生效结构）**

```sql
`id` BIGINT NOT NULL AUTO_INCREMENT,
`test_run_id` BIGINT NOT NULL,
`test_case_id` BIGINT NOT NULL,
`snapshot_title` VARCHAR(240) NOT NULL,
`snapshot_description` TEXT NULL DEFAULT NULL,
`snapshot_preconditions` TEXT NULL DEFAULT NULL,
`snapshot_priority` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
`captured_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
PRIMARY KEY (`id`),
UNIQUE KEY `uq_run_cases_run_case` (`test_run_id`, `test_case_id`),
KEY `ix_run_cases_case_run` (`test_case_id`, `test_run_id`),
CONSTRAINT `fk_test_run_cases_test_run_id` FOREIGN KEY (`test_run_id`) REFERENCES `test_runs` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_test_run_cases_test_case_id` FOREIGN KEY (`test_case_id`) REFERENCES `test_cases` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `ck_test_run_cases_snapshot_title_nonblank` CHECK (CHAR_LENGTH(TRIM(`snapshot_title`)) > 0),
CONSTRAINT `ck_test_run_cases_snapshot_priority` CHECK (`snapshot_priority` IN ('LOW','MEDIUM','HIGH'))
```

### 15. test_run_case_steps — 运行步骤快照表

运行创建时冻结的测试步骤。 分类：当前核心功能。来源：`database/schema.sql:263`。

|字段|类型|可空|默认/生成规则|中文说明|
|---|---|---|---|---|
|`test_run_case_id`|`BIGINT`|否|无显式默认|运行用例快照 ID|
|`step_order`|`SMALLINT UNSIGNED`|否|无显式默认|从 1 开始的步骤序号|
|`action`|`TEXT`|否|无显式默认|操作内容|
|`expected_result`|`TEXT`|否|无显式默认|预期结果|

**完整字段声明与约束（最终生效结构）**

```sql
`test_run_case_id` BIGINT NOT NULL,
`step_order` SMALLINT UNSIGNED NOT NULL,
`action` TEXT NOT NULL,
`expected_result` TEXT NOT NULL,
PRIMARY KEY (`test_run_case_id`, `step_order`),
CONSTRAINT `fk_test_run_case_steps_test_run_case_id` FOREIGN KEY (`test_run_case_id`) REFERENCES `test_run_cases` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `ck_test_run_case_steps_step_order` CHECK (`step_order` > 0),
CONSTRAINT `ck_test_run_case_steps_action_nonblank` CHECK (CHAR_LENGTH(TRIM(`action`)) > 0),
CONSTRAINT `ck_test_run_case_steps_expected_result_nonblank` CHECK (CHAR_LENGTH(TRIM(`expected_result`)) > 0)
```

### 16. test_imports — JUnit 导入记录表

导入来源、报告摘要与幂等请求标识。 分类：当前核心功能。来源：`database/schema.sql:275`。

|字段|类型|可空|默认/生成规则|中文说明|
|---|---|---|---|---|
|`id`|`BIGINT`|否|自增|记录主键|
|`test_run_id`|`BIGINT`|否|无显式默认|测试运行 ID|
|`request_key`|`BINARY(16)`|否|无显式默认|请求幂等键|
|`report_sha256`|`BINARY(32)`|否|无显式默认|原始导入报告 SHA-256 摘要|
|`source_namespace`|`VARCHAR(128)`|否|无显式默认|报告所属 classname/命名空间|
|`original_filename`|`VARCHAR(255)`|否|无显式默认|原始上传文件名|
|`imported_by`|`BIGINT`|否|无显式默认|导入用户 ID|
|`imported_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|导入时间|

**完整字段声明与约束（最终生效结构）**

```sql
`id` BIGINT NOT NULL AUTO_INCREMENT,
`test_run_id` BIGINT NOT NULL,
`request_key` BINARY(16) NOT NULL,
`report_sha256` BINARY(32) NOT NULL,
`source_namespace` VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
`original_filename` VARCHAR(255) NOT NULL,
`imported_by` BIGINT NOT NULL,
`imported_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
PRIMARY KEY (`id`),
UNIQUE KEY `uq_imports_request` (`request_key`),
KEY `ix_imports_run_time_id` (`test_run_id`, `imported_at`, `id`),
KEY `ix_test_imports_imported_by` (`imported_by`),
CONSTRAINT `fk_test_imports_test_run_id` FOREIGN KEY (`test_run_id`) REFERENCES `test_runs` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_test_imports_imported_by` FOREIGN KEY (`imported_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `ck_test_imports_source_namespace_nonblank` CHECK (CHAR_LENGTH(TRIM(`source_namespace`)) > 0),
CONSTRAINT `ck_test_imports_original_filename_nonblank` CHECK (CHAR_LENGTH(TRIM(`original_filename`)) > 0)
```

### 17. test_attempts — 测试执行尝试表

同一运行用例可追加多次人工或自动化执行结果。 分类：当前核心功能。来源：`database/schema.sql:294`。

|字段|类型|可空|默认/生成规则|中文说明|
|---|---|---|---|---|
|`id`|`BIGINT`|否|自增|记录主键|
|`test_run_case_id`|`BIGINT`|否|无显式默认|运行用例快照 ID|
|`attempt_no`|`INT UNSIGNED`|否|无显式默认|同一运行用例内的执行序号|
|`status`|`VARCHAR(16)`|否|无显式默认|业务状态；允许值见下方 CHECK 约束|
|`executed_by`|`BIGINT`|是|NULL|人工执行用户 ID；自动导入为空|
|`import_id`|`BIGINT`|是|NULL|JUnit 导入记录 ID；人工执行为空|
|`automation_mapping_id`|`BIGINT`|是|NULL|导入时使用的映射 ID；人工执行为空|
|`executed_at`|`DATETIME(6)`|是|NULL|实际执行时间；可为空|
|`recorded_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|系统记录入库时间|
|`duration_ms`|`BIGINT UNSIGNED`|是|NULL|执行耗时，毫秒|
|`comment`|`TEXT`|是|NULL|实际结果或备注|
|`failure_message`|`TEXT`|是|NULL|失败信息；非 FAIL 必须为空|
|`submission_key`|`BINARY(16)`|否|无显式默认|执行结果提交的幂等键|

**完整字段声明与约束（最终生效结构）**

```sql
`id` BIGINT NOT NULL AUTO_INCREMENT,
`test_run_case_id` BIGINT NOT NULL,
`attempt_no` INT UNSIGNED NOT NULL,
`status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
`executed_by` BIGINT NULL DEFAULT NULL,
`import_id` BIGINT NULL DEFAULT NULL,
`automation_mapping_id` BIGINT NULL DEFAULT NULL,
`executed_at` DATETIME(6) NULL DEFAULT NULL,
`recorded_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
`duration_ms` BIGINT UNSIGNED NULL DEFAULT NULL,
`comment` TEXT NULL DEFAULT NULL,
`failure_message` TEXT NULL DEFAULT NULL,
`submission_key` BINARY(16) NOT NULL,
PRIMARY KEY (`id`),
UNIQUE KEY `uq_attempts_run_case_no` (`test_run_case_id`, `attempt_no`),
UNIQUE KEY `uq_attempts_submission` (`submission_key`),
UNIQUE KEY `uq_attempts_import_run_case` (`import_id`, `test_run_case_id`),
KEY `ix_test_attempts_executed_by` (`executed_by`),
KEY `ix_attempts_automation_mapping` (`automation_mapping_id`),
CONSTRAINT `fk_test_attempts_test_run_case_id` FOREIGN KEY (`test_run_case_id`) REFERENCES `test_run_cases` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_test_attempts_executed_by` FOREIGN KEY (`executed_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_test_attempts_import_id` FOREIGN KEY (`import_id`) REFERENCES `test_imports` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_test_attempts_automation_mapping_id` FOREIGN KEY (`automation_mapping_id`) REFERENCES `test_automation_mappings` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `ck_test_attempts_attempt_no` CHECK (`attempt_no` > 0),
CONSTRAINT `ck_test_attempts_status` CHECK (`status` IN ('PASS','FAIL','BLOCKED','SKIPPED')),
CONSTRAINT `ck_attempts_failure_message` CHECK (`status` = 'FAIL' OR `failure_message` IS NULL),
CONSTRAINT `ck_attempts_source_shape` CHECK ((`import_id` IS NULL AND `automation_mapping_id` IS NULL AND `executed_by` IS NOT NULL) OR (`import_id` IS NOT NULL AND `automation_mapping_id` IS NOT NULL AND `executed_by` IS NULL))
```

### 18. defects — 缺陷表

缺陷描述、严重程度、处理人与处理状态。 分类：当前核心功能。来源：`database/schema.sql:324`。

|字段|类型|可空|默认/生成规则|中文说明|
|---|---|---|---|---|
|`id`|`BIGINT`|否|自增|记录主键|
|`project_id`|`BIGINT`|否|无显式默认|所属项目 ID|
|`key_no`|`BIGINT`|否|无显式默认|项目内业务序号|
|`title`|`VARCHAR(240)`|否|无显式默认|标题|
|`description`|`TEXT`|是|NULL|描述|
|`severity`|`VARCHAR(16)`|否|'MEDIUM'|严重程度|
|`priority`|`VARCHAR(16)`|否|'MEDIUM'|优先级|
|`status`|`VARCHAR(16)`|否|'OPEN'|业务状态；允许值见下方 CHECK 约束|
|`reporter_id`|`BIGINT`|否|无显式默认|缺陷报告人 ID|
|`assignee_id`|`BIGINT`|是|NULL|缺陷处理人 ID|
|`resolution_note`|`TEXT`|是|NULL|解决说明|
|`created_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|创建时间|
|`updated_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|最近更新时间|
|`lock_version`|`INT UNSIGNED`|否|0|乐观锁版本号|

**完整字段声明与约束（最终生效结构）**

```sql
`id` BIGINT NOT NULL AUTO_INCREMENT,
`project_id` BIGINT NOT NULL,
`key_no` BIGINT NOT NULL,
`title` VARCHAR(240) NOT NULL,
`description` TEXT NULL DEFAULT NULL,
`severity` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'MEDIUM',
`priority` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'MEDIUM',
`status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'OPEN',
`reporter_id` BIGINT NOT NULL,
`assignee_id` BIGINT NULL DEFAULT NULL,
`resolution_note` TEXT NULL DEFAULT NULL,
`created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
`updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
`lock_version` INT UNSIGNED NOT NULL DEFAULT 0,
PRIMARY KEY (`id`),
UNIQUE KEY `uq_defects_project_key` (`project_id`, `key_no`),
KEY `ix_defects_assignee_status_id` (`assignee_id`, `status`, `id`),
KEY `ix_defects_reporter_id` (`reporter_id`),
CONSTRAINT `fk_defects_project_id` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_defects_reporter_id` FOREIGN KEY (`reporter_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_defects_assignee_id` FOREIGN KEY (`assignee_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `ck_defects_key_no` CHECK (`key_no` > 0),
CONSTRAINT `ck_defects_title_nonblank` CHECK (CHAR_LENGTH(TRIM(`title`)) > 0),
CONSTRAINT `ck_defects_severity` CHECK (`severity` IN ('LOW','MEDIUM','HIGH','CRITICAL')),
CONSTRAINT `ck_defects_priority` CHECK (`priority` IN ('LOW','MEDIUM','HIGH')),
CONSTRAINT `ck_defects_status` CHECK (`status` IN ('OPEN','IN_PROGRESS','RESOLVED','CLOSED','REOPENED')),
CONSTRAINT `ck_defects_resolution_note` CHECK (`status` NOT IN ('RESOLVED','CLOSED') OR (`resolution_note` IS NOT NULL AND CHAR_LENGTH(TRIM(`resolution_note`)) > 0))
```

### 19. test_attempt_defects — 失败缺陷证据关联表

将具体执行尝试与缺陷建立证据关系。 分类：当前核心功能。来源：`database/schema.sql:354`。

|字段|类型|可空|默认/生成规则|中文说明|
|---|---|---|---|---|
|`attempt_id`|`BIGINT`|否|无显式默认|执行尝试 ID|
|`defect_id`|`BIGINT`|否|无显式默认|缺陷 ID|
|`linked_by`|`BIGINT`|否|无显式默认|建立关联的用户 ID|
|`linked_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|关联时间|

**完整字段声明与约束（最终生效结构）**

```sql
`attempt_id` BIGINT NOT NULL,
`defect_id` BIGINT NOT NULL,
`linked_by` BIGINT NOT NULL,
`linked_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
PRIMARY KEY (`attempt_id`, `defect_id`),
KEY `ix_attempt_defects_defect_attempt` (`defect_id`, `attempt_id`),
KEY `ix_test_attempt_defects_linked_by` (`linked_by`),
CONSTRAINT `fk_test_attempt_defects_attempt_id` FOREIGN KEY (`attempt_id`) REFERENCES `test_attempts` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_test_attempt_defects_defect_id` FOREIGN KEY (`defect_id`) REFERENCES `defects` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_test_attempt_defects_linked_by` FOREIGN KEY (`linked_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
```

### 20. credit_accounts — 历史积分账户表

保留用户积分余额。 分类：历史保留（已裁撤功能）。来源：`database/schema.sql:368`。

|字段|类型|可空|默认/生成规则|中文说明|
|---|---|---|---|---|
|`user_id`|`BIGINT`|否|无显式默认|用户 ID|
|`balance`|`BIGINT`|否|0|积分余额|
|`updated_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|最近更新时间|
|`lock_version`|`INT UNSIGNED`|否|0|乐观锁版本号|

**完整字段声明与约束（最终生效结构）**

```sql
`user_id` BIGINT NOT NULL,
`balance` BIGINT NOT NULL DEFAULT 0,
`updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
`lock_version` INT UNSIGNED NOT NULL DEFAULT 0,
PRIMARY KEY (`user_id`),
CONSTRAINT `fk_credit_accounts_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `ck_credit_accounts_balance` CHECK (`balance` >= 0)
```

### 21. credit_transactions — 历史积分流水表

保留发放、收回、转账和任务奖励流水。 分类：历史保留（已裁撤功能）。来源：`database/schema.sql:378`。

|字段|类型|可空|默认/生成规则|中文说明|
|---|---|---|---|---|
|`id`|`BIGINT`|否|自增|记录主键|
|`user_id`|`BIGINT`|否|无显式默认|用户 ID|
|`amount`|`BIGINT`|否|无显式默认|积分数量|
|`type`|`VARCHAR(24)`|否|无显式默认|流水业务类型；允许值及配套字段见 CHECK|
|`actor_user_id`|`BIGINT`|否|无显式默认|操作人 ID|
|`reason`|`VARCHAR(500)`|是|无显式默认|原因|
|`batch_id`|`CHAR(36)`|是|无显式默认|批次标识|
|`project_id`|`BIGINT`|是|无显式默认|所属项目 ID|
|`transfer_id`|`CHAR(36)`|是|无显式默认|积分转账 ID|
|`task_id`|`BIGINT`|是|无显式默认|任务 ID|
|`created_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|创建时间|

**完整字段声明与约束（最终生效结构）**

```sql
`id` BIGINT NOT NULL AUTO_INCREMENT,
`user_id` BIGINT NOT NULL,
`amount` BIGINT NOT NULL,
`type` VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
`actor_user_id` BIGINT NOT NULL,
`reason` VARCHAR(500) NULL,
`batch_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
`project_id` BIGINT NULL,
`transfer_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
`task_id` BIGINT NULL,
`created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
PRIMARY KEY (`id`),
KEY `ix_credit_user_created` (`user_id`, `created_at`, `id`),
KEY `ix_credit_actor` (`actor_user_id`),
UNIQUE KEY `uq_credit_batch_user` (`batch_id`, `user_id`),
KEY `ix_credit_type_created` (`type`, `created_at`),
CONSTRAINT `fk_credit_transactions_account` FOREIGN KEY (`user_id`) REFERENCES `credit_accounts` (`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_credit_transactions_actor` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `ck_credit_transactions_amount` CHECK (`amount` > 0),
UNIQUE KEY `uq_credit_transfer_user` (`transfer_id`, `user_id`),
UNIQUE KEY `uq_credit_task_reward` (`task_id`, `type`),
KEY `ix_credit_project_created` (`project_id`, `created_at`, `id`),
CONSTRAINT `fk_credit_tx_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_credit_tx_transfer` FOREIGN KEY (`transfer_id`, `project_id`) REFERENCES `credit_transfers` (`id`, `project_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_credit_tx_task` FOREIGN KEY (`task_id`, `project_id`) REFERENCES `work_tasks` (`id`, `project_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `ck_credit_transactions_type` CHECK ( (`type` IN ('GRANT','RECLAIM') AND `project_id` IS NULL AND `transfer_id` IS NULL AND `task_id` IS NULL) OR (`type` IN ('PEER_TRANSFER_OUT','PEER_TRANSFER_IN','HANDOFF_OUT','HANDOFF_IN') AND `project_id` IS NOT NULL AND `transfer_id` IS NOT NULL AND `task_id` IS NULL) OR (`type` = 'TASK_REWARD' AND `project_id` IS NOT NULL AND `transfer_id` IS NULL AND `task_id` IS NOT NULL))
```

### 22. login_events — 登录事件表

后台持续记录登录结果与终端信息。 分类：后台运行记录（无独立维护页面）。来源：`database/schema.sql:398`。

|字段|类型|可空|默认/生成规则|中文说明|
|---|---|---|---|---|
|`id`|`BIGINT`|否|自增|记录主键|
|`user_id`|`BIGINT`|是|无显式默认|用户 ID|
|`username_attempted`|`VARCHAR(64)`|否|无显式默认|尝试登录的用户名|
|`ip_address`|`VARCHAR(45)`|否|无显式默认|请求 IP 地址|
|`user_agent`|`VARCHAR(512)`|是|无显式默认|User-Agent 摘要|
|`browser`|`VARCHAR(16)`|否|无显式默认|浏览器类别|
|`operating_system`|`VARCHAR(16)`|否|无显式默认|操作系统类别|
|`device_type`|`VARCHAR(16)`|否|无显式默认|设备类别|
|`result`|`VARCHAR(16)`|否|无显式默认|登录结果|
|`failure_reason`|`VARCHAR(32)`|是|无显式默认|登录失败原因|
|`created_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|创建时间|

**完整字段声明与约束（最终生效结构）**

```sql
`id` BIGINT NOT NULL AUTO_INCREMENT,
`user_id` BIGINT NULL,
`username_attempted` VARCHAR(64) NOT NULL,
`ip_address` VARCHAR(45) NOT NULL,
`user_agent` VARCHAR(512) NULL,
`browser` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
`operating_system` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
`device_type` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
`result` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
`failure_reason` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
`created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
PRIMARY KEY (`id`),
KEY `ix_login_created` (`created_at`, `id`),
KEY `ix_login_user_created` (`user_id`, `created_at`),
KEY `ix_login_username_created` (`username_attempted`, `created_at`),
KEY `ix_login_ip_created` (`ip_address`, `created_at`),
KEY `ix_login_result_created` (`result`, `created_at`),
CONSTRAINT `fk_login_events_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `ck_login_events_result` CHECK (`result` IN ('SUCCESS','FAILURE','RATE_LIMITED'))
```

### 23. access_logs — 访问日志表

后台持续记录请求、响应状态及耗时。 分类：后台运行记录（无独立维护页面）。来源：`database/schema.sql:420`。

|字段|类型|可空|默认/生成规则|中文说明|
|---|---|---|---|---|
|`id`|`BIGINT`|否|自增|记录主键|
|`user_id`|`BIGINT`|是|无显式默认|用户 ID|
|`ip_address`|`VARCHAR(45)`|否|无显式默认|请求 IP 地址|
|`user_agent`|`VARCHAR(512)`|是|无显式默认|User-Agent 摘要|
|`browser`|`VARCHAR(16)`|否|无显式默认|浏览器类别|
|`operating_system`|`VARCHAR(16)`|否|无显式默认|操作系统类别|
|`device_type`|`VARCHAR(16)`|否|无显式默认|设备类别|
|`http_method`|`VARCHAR(16)`|否|无显式默认|HTTP 方法|
|`request_path`|`VARCHAR(512)`|否|无显式默认|请求路径|
|`status_code`|`SMALLINT UNSIGNED`|否|无显式默认|HTTP 状态码|
|`request_id`|`CHAR(36)`|否|无显式默认|请求追踪标识|
|`duration_ms`|`INT UNSIGNED`|否|无显式默认|执行耗时，毫秒|
|`created_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|创建时间|

**完整字段声明与约束（最终生效结构）**

```sql
`id` BIGINT NOT NULL AUTO_INCREMENT,
`user_id` BIGINT NULL,
`ip_address` VARCHAR(45) NOT NULL,
`user_agent` VARCHAR(512) NULL,
`browser` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
`operating_system` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
`device_type` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
`http_method` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
`request_path` VARCHAR(512) NOT NULL,
`status_code` SMALLINT UNSIGNED NOT NULL,
`request_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
`duration_ms` INT UNSIGNED NOT NULL,
`created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
PRIMARY KEY (`id`),
KEY `ix_access_created` (`created_at`, `id`),
KEY `ix_access_user_created` (`user_id`, `created_at`),
KEY `ix_access_ip_created` (`ip_address`, `created_at`),
KEY `ix_access_status_created` (`status_code`, `created_at`),
CONSTRAINT `fk_access_logs_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `ck_access_status` CHECK (`status_code` BETWEEN 100 AND 599)
```

### 24. audit_logs — 操作日志表

后台持续记录用户维护等管理操作。 分类：后台运行记录（无独立维护页面）。来源：`database/schema.sql:443`。

|字段|类型|可空|默认/生成规则|中文说明|
|---|---|---|---|---|
|`id`|`BIGINT`|否|自增|记录主键|
|`actor_user_id`|`BIGINT`|否|无显式默认|操作人 ID|
|`action`|`VARCHAR(40)`|否|无显式默认|操作内容|
|`target_type`|`VARCHAR(32)`|否|无显式默认|操作目标类型|
|`target_id`|`BIGINT`|是|无显式默认|操作目标 ID|
|`summary`|`VARCHAR(500)`|否|无显式默认|操作摘要|
|`metadata_json`|`JSON`|是|无显式默认|结构化附加信息|
|`ip_address`|`VARCHAR(45)`|否|无显式默认|请求 IP 地址|
|`request_id`|`CHAR(36)`|否|无显式默认|请求追踪标识|
|`created_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|创建时间|

**完整字段声明与约束（最终生效结构）**

```sql
`id` BIGINT NOT NULL AUTO_INCREMENT,
`actor_user_id` BIGINT NOT NULL,
`action` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
`target_type` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
`target_id` BIGINT NULL,
`summary` VARCHAR(500) NOT NULL,
`metadata_json` JSON NULL,
`ip_address` VARCHAR(45) NOT NULL,
`request_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
`created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
PRIMARY KEY (`id`),
KEY `ix_audit_created` (`created_at`, `id`),
KEY `ix_audit_actor_created` (`actor_user_id`, `created_at`),
KEY `ix_audit_action_created` (`action`, `created_at`),
KEY `ix_audit_target` (`target_type`, `target_id`),
CONSTRAINT `fk_audit_actor` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `ck_audit_summary` CHECK (CHAR_LENGTH(TRIM(`summary`)) > 0)
```

### 25. project_managers — 项目负责人表

从项目成员中任命项目负责人。 分类：当前核心功能。来源：`database/schema.sql:465`。

|字段|类型|可空|默认/生成规则|中文说明|
|---|---|---|---|---|
|`project_id`|`BIGINT`|否|无显式默认|所属项目 ID|
|`user_id`|`BIGINT`|否|无显式默认|用户 ID|
|`appointed_by`|`BIGINT`|否|无显式默认|任命用户 ID|
|`status`|`VARCHAR(16)`|否|'ACTIVE'|业务状态；允许值见下方 CHECK 约束|
|`appointed_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|任命时间|
|`updated_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|最近更新时间|

**完整字段声明与约束（最终生效结构）**

```sql
`project_id` BIGINT NOT NULL,
`user_id` BIGINT NOT NULL,
`appointed_by` BIGINT NOT NULL,
`status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
`appointed_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
`updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
PRIMARY KEY (`project_id`, `user_id`),
KEY `ix_project_managers_user` (`user_id`, `status`, `project_id`),
KEY `ix_project_managers_appointed_by` (`appointed_by`),
CONSTRAINT `fk_project_managers_member` FOREIGN KEY (`project_id`, `user_id`) REFERENCES `project_members` (`project_id`, `user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_project_managers_appointed_by` FOREIGN KEY (`appointed_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `ck_project_managers_status` CHECK (`status` IN ('ACTIVE','INACTIVE'))
```

### 26. project_teams — 历史项目小组表

保留项目内小组及组长资料。 分类：历史保留（已裁撤功能）。来源：`database/schema.sql:480`。

|字段|类型|可空|默认/生成规则|中文说明|
|---|---|---|---|---|
|`id`|`BIGINT`|否|自增|记录主键|
|`project_id`|`BIGINT`|否|无显式默认|所属项目 ID|
|`name`|`VARCHAR(120)`|否|无显式默认|名称|
|`lead_user_id`|`BIGINT`|否|无显式默认|小组组长用户 ID|
|`status`|`VARCHAR(16)`|否|'ACTIVE'|业务状态；允许值见下方 CHECK 约束|
|`created_by`|`BIGINT`|否|无显式默认|创建用户 ID|
|`created_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|创建时间|
|`updated_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|最近更新时间|
|`lock_version`|`INT UNSIGNED`|否|0|乐观锁版本号|

**完整字段声明与约束（最终生效结构）**

```sql
`id` BIGINT NOT NULL AUTO_INCREMENT,
`project_id` BIGINT NOT NULL,
`name` VARCHAR(120) NOT NULL,
`lead_user_id` BIGINT NOT NULL,
`status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
`created_by` BIGINT NOT NULL,
`created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
`updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
`lock_version` INT UNSIGNED NOT NULL DEFAULT 0,
PRIMARY KEY (`id`),
UNIQUE KEY `uq_project_teams_project_name` (`project_id`, `name`),
UNIQUE KEY `uq_project_teams_id_project` (`id`, `project_id`),
KEY `ix_project_teams_lead` (`project_id`, `lead_user_id`),
KEY `ix_project_teams_creator` (`created_by`),
CONSTRAINT `fk_project_teams_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_project_teams_lead` FOREIGN KEY (`project_id`, `lead_user_id`) REFERENCES `project_members` (`project_id`, `user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_project_teams_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `ck_project_teams_name` CHECK (CHAR_LENGTH(TRIM(`name`)) > 0),
CONSTRAINT `ck_project_teams_status` CHECK (`status` IN ('ACTIVE','ARCHIVED'))
```

### 27. team_members — 历史小组成员表

保留小组与项目成员的关系。 分类：历史保留（已裁撤功能）。来源：`database/schema.sql:502`。

|字段|类型|可空|默认/生成规则|中文说明|
|---|---|---|---|---|
|`team_id`|`BIGINT`|否|无显式默认|所属小组 ID|
|`project_id`|`BIGINT`|否|无显式默认|所属项目 ID|
|`user_id`|`BIGINT`|否|无显式默认|用户 ID|
|`status`|`VARCHAR(16)`|否|'ACTIVE'|业务状态；允许值见下方 CHECK 约束|
|`joined_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|加入时间|
|`updated_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|最近更新时间|

**完整字段声明与约束（最终生效结构）**

```sql
`team_id` BIGINT NOT NULL,
`project_id` BIGINT NOT NULL,
`user_id` BIGINT NOT NULL,
`status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
`joined_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
`updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
PRIMARY KEY (`team_id`, `user_id`),
KEY `ix_team_members_team_project` (`team_id`, `project_id`),
KEY `ix_team_members_project_user` (`project_id`, `user_id`),
CONSTRAINT `fk_team_members_team` FOREIGN KEY (`team_id`, `project_id`) REFERENCES `project_teams` (`id`, `project_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_team_members_project_member` FOREIGN KEY (`project_id`, `user_id`) REFERENCES `project_members` (`project_id`, `user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `ck_team_members_status` CHECK (`status` IN ('ACTIVE','INACTIVE'))
```

### 28. work_tasks — 历史任务表

保留小组任务、执行人、奖励及验收状态。 分类：历史保留（已裁撤功能）。来源：`database/schema.sql:517`。

|字段|类型|可空|默认/生成规则|中文说明|
|---|---|---|---|---|
|`id`|`BIGINT`|否|自增|记录主键|
|`project_id`|`BIGINT`|否|无显式默认|所属项目 ID|
|`team_id`|`BIGINT`|否|无显式默认|所属小组 ID|
|`title`|`VARCHAR(240)`|否|无显式默认|标题|
|`description`|`TEXT`|是|无显式默认|描述|
|`reward_credit`|`BIGINT`|否|0|任务奖励积分|
|`assignee_user_id`|`BIGINT`|否|无显式默认|任务执行人 ID|
|`created_by`|`BIGINT`|否|无显式默认|创建用户 ID|
|`status`|`VARCHAR(16)`|否|'OPEN'|业务状态；允许值见下方 CHECK 约束|
|`accepted_by`|`BIGINT`|是|无显式默认|验收用户 ID|
|`accepted_at`|`DATETIME(6)`|是|无显式默认|验收时间|
|`created_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|创建时间|
|`updated_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|最近更新时间|
|`lock_version`|`INT UNSIGNED`|否|0|乐观锁版本号|

**完整字段声明与约束（最终生效结构）**

```sql
`id` BIGINT NOT NULL AUTO_INCREMENT,
`project_id` BIGINT NOT NULL,
`team_id` BIGINT NOT NULL,
`title` VARCHAR(240) NOT NULL,
`description` TEXT NULL,
`reward_credit` BIGINT NOT NULL DEFAULT 0,
`assignee_user_id` BIGINT NOT NULL,
`created_by` BIGINT NOT NULL,
`status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'OPEN',
`accepted_by` BIGINT NULL,
`accepted_at` DATETIME(6) NULL,
`created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
`updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
`lock_version` INT UNSIGNED NOT NULL DEFAULT 0,
PRIMARY KEY (`id`),
KEY `ix_work_tasks_team_status` (`team_id`, `status`, `id`),
KEY `ix_work_tasks_project_status` (`project_id`, `status`, `id`),
KEY `ix_work_tasks_assignee_status` (`assignee_user_id`, `status`, `id`),
KEY `ix_work_tasks_created_by` (`created_by`),
KEY `ix_work_tasks_accepted_by` (`accepted_by`),
CONSTRAINT `fk_work_tasks_team` FOREIGN KEY (`team_id`, `project_id`) REFERENCES `project_teams` (`id`, `project_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_work_tasks_assignee` FOREIGN KEY (`project_id`, `assignee_user_id`) REFERENCES `project_members` (`project_id`, `user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_work_tasks_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_work_tasks_accepted_by` FOREIGN KEY (`accepted_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `ck_work_tasks_title` CHECK (CHAR_LENGTH(TRIM(`title`)) > 0),
CONSTRAINT `ck_work_tasks_status` CHECK (`status` IN ('OPEN','IN_PROGRESS','SUBMITTED','ACCEPTED','CANCELLED')),
CONSTRAINT `ck_work_tasks_acceptance` CHECK ((`status` = 'ACCEPTED' AND `accepted_by` IS NOT NULL AND `accepted_at` IS NOT NULL) OR (`status` <> 'ACCEPTED' AND `accepted_by` IS NULL AND `accepted_at` IS NULL)),
UNIQUE KEY `uq_work_tasks_id_project` (`id`, `project_id`),
CONSTRAINT `ck_work_tasks_reward` CHECK (`reward_credit` >= 0)
```

### 29. work_task_events — 历史任务事件表

保留任务状态和执行人变更。 分类：历史保留（已裁撤功能）。来源：`database/schema.sql:546`。

|字段|类型|可空|默认/生成规则|中文说明|
|---|---|---|---|---|
|`id`|`BIGINT`|否|自增|记录主键|
|`task_id`|`BIGINT`|否|无显式默认|任务 ID|
|`actor_user_id`|`BIGINT`|否|无显式默认|操作人 ID|
|`event_type`|`VARCHAR(16)`|否|无显式默认|事件类型|
|`from_status`|`VARCHAR(16)`|是|无显式默认|原状态|
|`to_status`|`VARCHAR(16)`|否|无显式默认|目标状态|
|`from_assignee_user_id`|`BIGINT`|是|无显式默认|原执行人 ID|
|`to_assignee_user_id`|`BIGINT`|否|无显式默认|目标执行人 ID|
|`note`|`VARCHAR(500)`|是|无显式默认|说明|
|`created_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|创建时间|

**完整字段声明与约束（最终生效结构）**

```sql
`id` BIGINT NOT NULL AUTO_INCREMENT,
`task_id` BIGINT NOT NULL,
`actor_user_id` BIGINT NOT NULL,
`event_type` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
`from_status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL,
`to_status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
`from_assignee_user_id` BIGINT NULL,
`to_assignee_user_id` BIGINT NOT NULL,
`note` VARCHAR(500) NULL,
`created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
PRIMARY KEY (`id`),
KEY `ix_work_task_events_task` (`task_id`, `id`),
KEY `ix_work_task_events_actor` (`actor_user_id`, `created_at`),
CONSTRAINT `fk_work_task_events_task` FOREIGN KEY (`task_id`) REFERENCES `work_tasks` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_work_task_events_actor` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `ck_work_task_events_from_status` CHECK (`from_status` IS NULL OR `from_status` IN ('OPEN','IN_PROGRESS','SUBMITTED','ACCEPTED','CANCELLED')),
CONSTRAINT `ck_work_task_events_to_status` CHECK (`to_status` IN ('OPEN','IN_PROGRESS','SUBMITTED','ACCEPTED','CANCELLED')),
CONSTRAINT `ck_work_task_events_type` CHECK (`event_type` IN ('CREATED','STARTED','SUBMITTED','ACCEPTED','RETURNED','CANCELLED','REASSIGNED','HANDOFF_ACCEPTED'))
```

### 30. task_handoff_offers — 历史任务转交邀约表

保留附带积分的任务转交邀约。 分类：历史保留（已裁撤功能）。来源：`database/schema.sql:580`。

|字段|类型|可空|默认/生成规则|中文说明|
|---|---|---|---|---|
|`id`|`BIGINT`|否|自增|记录主键|
|`request_key`|`CHAR(36)`|否|无显式默认|请求幂等键|
|`project_id`|`BIGINT`|否|无显式默认|所属项目 ID|
|`task_id`|`BIGINT`|否|无显式默认|任务 ID|
|`from_user_id`|`BIGINT`|否|无显式默认|转交发起人 ID|
|`to_user_id`|`BIGINT`|否|无显式默认|转交接收人 ID|
|`credit_amount`|`BIGINT`|否|无显式默认|转交附带积分数量|
|`note`|`VARCHAR(500)`|是|无显式默认|说明|
|`status`|`VARCHAR(16)`|否|'PENDING'|业务状态；允许值见下方 CHECK 约束|
|`created_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|创建时间|
|`resolved_at`|`DATETIME(6)`|是|无显式默认|邀约处理时间|
|`pending_task_id`|`BIGINT`|是|生成列（见完整声明）|仅待处理邀约保留任务 ID 的生成列，用于限制同时待处理邀约|

**完整字段声明与约束（最终生效结构）**

```sql
`id` BIGINT NOT NULL AUTO_INCREMENT,
`request_key` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
`project_id` BIGINT NOT NULL,
`task_id` BIGINT NOT NULL,
`from_user_id` BIGINT NOT NULL,
`to_user_id` BIGINT NOT NULL,
`credit_amount` BIGINT NOT NULL,
`note` VARCHAR(500) NULL,
`status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING',
`created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
`resolved_at` DATETIME(6) NULL,
`pending_task_id` BIGINT GENERATED ALWAYS AS (CASE WHEN `status` = 'PENDING' THEN `task_id` ELSE NULL END) STORED,
PRIMARY KEY (`id`),
UNIQUE KEY `uq_handoff_request` (`request_key`),
UNIQUE KEY `uq_handoff_id_project` (`id`, `project_id`),
UNIQUE KEY `uq_handoff_pending_task` (`pending_task_id`),
KEY `ix_handoff_task_status` (`task_id`, `status`, `id`),
KEY `ix_handoff_recipient_status` (`to_user_id`, `status`, `id`),
KEY `ix_handoff_project_task` (`project_id`, `task_id`),
KEY `ix_handoff_project_from` (`project_id`, `from_user_id`),
KEY `ix_handoff_project_to` (`project_id`, `to_user_id`),
CONSTRAINT `fk_handoff_task` FOREIGN KEY (`task_id`, `project_id`) REFERENCES `work_tasks` (`id`, `project_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_handoff_from` FOREIGN KEY (`project_id`, `from_user_id`) REFERENCES `project_members` (`project_id`, `user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_handoff_to` FOREIGN KEY (`project_id`, `to_user_id`) REFERENCES `project_members` (`project_id`, `user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `ck_handoff_amount` CHECK (`credit_amount` > 0),
CONSTRAINT `ck_handoff_distinct_users` CHECK (`from_user_id` <> `to_user_id`),
CONSTRAINT `ck_handoff_status` CHECK (`status` IN ('PENDING','ACCEPTED','DECLINED','CANCELLED')),
CONSTRAINT `ck_handoff_resolution` CHECK ((`status` = 'PENDING' AND `resolved_at` IS NULL) OR (`status` <> 'PENDING' AND `resolved_at` IS NOT NULL))
```

### 31. credit_transfers — 历史积分转账表

保留项目内成员互转与任务转交支付记录。 分类：历史保留（已裁撤功能）。来源：`database/schema.sql:611`。

|字段|类型|可空|默认/生成规则|中文说明|
|---|---|---|---|---|
|`id`|`CHAR(36)`|否|无显式默认|记录主键|
|`project_id`|`BIGINT`|否|无显式默认|所属项目 ID|
|`sender_user_id`|`BIGINT`|否|无显式默认|转账发起用户 ID|
|`recipient_user_id`|`BIGINT`|否|无显式默认|转账接收用户 ID|
|`amount`|`BIGINT`|否|无显式默认|积分数量|
|`kind`|`VARCHAR(16)`|否|无显式默认|转账种类|
|`offer_id`|`BIGINT`|是|无显式默认|任务转交邀约 ID|
|`note`|`VARCHAR(500)`|是|无显式默认|说明|
|`created_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|创建时间|

**完整字段声明与约束（最终生效结构）**

```sql
`id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
`project_id` BIGINT NOT NULL,
`sender_user_id` BIGINT NOT NULL,
`recipient_user_id` BIGINT NOT NULL,
`amount` BIGINT NOT NULL,
`kind` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
`offer_id` BIGINT NULL,
`note` VARCHAR(500) NULL,
`created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
PRIMARY KEY (`id`),
UNIQUE KEY `uq_credit_transfers_id_project` (`id`, `project_id`),
UNIQUE KEY `uq_credit_transfers_offer_project` (`offer_id`, `project_id`),
KEY `ix_credit_transfers_project_created` (`project_id`, `created_at`, `id`),
KEY `ix_credit_transfers_sender_created` (`sender_user_id`, `created_at`, `id`),
KEY `ix_credit_transfers_recipient_created` (`recipient_user_id`, `created_at`, `id`),
KEY `ix_credit_transfers_project_sender` (`project_id`, `sender_user_id`),
KEY `ix_credit_transfers_project_recipient` (`project_id`, `recipient_user_id`),
CONSTRAINT `fk_credit_transfers_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_credit_transfers_sender` FOREIGN KEY (`project_id`, `sender_user_id`) REFERENCES `project_members` (`project_id`, `user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_credit_transfers_recipient` FOREIGN KEY (`project_id`, `recipient_user_id`) REFERENCES `project_members` (`project_id`, `user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_credit_transfers_offer` FOREIGN KEY (`offer_id`, `project_id`) REFERENCES `task_handoff_offers` (`id`, `project_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `ck_credit_transfers_amount` CHECK (`amount` > 0),
CONSTRAINT `ck_credit_transfers_distinct_users` CHECK (`sender_user_id` <> `recipient_user_id`),
CONSTRAINT `ck_credit_transfers_kind` CHECK ((`kind` = 'PEER' AND `offer_id` IS NULL) OR (`kind` = 'HANDOFF' AND `offer_id` IS NOT NULL))
```

### 32. contribution_events — 历史贡献事件表

保留任务验收完成时的贡献积分。 分类：历史保留（已裁撤功能）。来源：`database/schema.sql:638`。

|字段|类型|可空|默认/生成规则|中文说明|
|---|---|---|---|---|
|`id`|`BIGINT`|否|自增|记录主键|
|`project_id`|`BIGINT`|否|无显式默认|所属项目 ID|
|`user_id`|`BIGINT`|否|无显式默认|用户 ID|
|`task_id`|`BIGINT`|否|无显式默认|任务 ID|
|`points`|`INT`|否|无显式默认|贡献分值|
|`event_type`|`VARCHAR(24)`|否|无显式默认|事件类型|
|`created_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|创建时间|

**完整字段声明与约束（最终生效结构）**

```sql
`id` BIGINT NOT NULL AUTO_INCREMENT,
`project_id` BIGINT NOT NULL,
`user_id` BIGINT NOT NULL,
`task_id` BIGINT NOT NULL,
`points` INT NOT NULL,
`event_type` VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
`created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
PRIMARY KEY (`id`),
UNIQUE KEY `uq_contribution_task` (`task_id`),
KEY `ix_contribution_project_created` (`project_id`, `created_at`, `user_id`),
KEY `ix_contribution_user_created` (`user_id`, `created_at`, `id`),
KEY `ix_contribution_project_user` (`project_id`, `user_id`),
CONSTRAINT `fk_contribution_task` FOREIGN KEY (`task_id`, `project_id`) REFERENCES `work_tasks` (`id`, `project_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_contribution_member` FOREIGN KEY (`project_id`, `user_id`) REFERENCES `project_members` (`project_id`, `user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `ck_contribution_points` CHECK (`points` = 1),
CONSTRAINT `ck_contribution_type` CHECK (`event_type` = 'TASK_ACCEPTED')
```

### 33. defect_retest_links — 缺陷复测关联表

为原始失败选定另一次兼容的通过结果，并记录撤销或替换。 分类：当前核心功能。来源：`database/migrations/20261014-r1-defect-retest.sql:3`。

|字段|类型|可空|默认/生成规则|中文说明|
|---|---|---|---|---|
|`id`|`BIGINT`|否|自增|记录主键|
|`defect_id`|`BIGINT`|否|无显式默认|缺陷 ID|
|`failure_attempt_id`|`BIGINT`|否|无显式默认|原始失败执行尝试 ID|
|`pass_attempt_id`|`BIGINT`|否|无显式默认|采信的通过执行尝试 ID|
|`policy_version`|`VARCHAR(32)`|否|无显式默认|证据判定策略版本|
|`linked_by`|`BIGINT`|否|无显式默认|建立关联的用户 ID|
|`linked_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|关联时间|
|`review_note`|`VARCHAR(2000)`|否|无显式默认|复测人工审查说明|
|`timing_basis`|`VARCHAR(32)`|否|无显式默认|复测时序依据|
|`request_key`|`BINARY(16)`|否|无显式默认|请求幂等键|
|`request_hash`|`BINARY(32)`|否|无显式默认|幂等请求内容摘要|
|`result_defect_version`|`INT UNSIGNED`|否|无显式默认|关联操作结果的缺陷版本|
|`revoked_by`|`BIGINT`|是|无显式默认|撤销用户 ID|
|`revoked_at`|`DATETIME(6)`|是|无显式默认|撤销时间|
|`revoke_reason`|`VARCHAR(2000)`|是|无显式默认|撤销原因|
|`revocation_operation`|`VARCHAR(16)`|是|无显式默认|撤销操作种类|
|`revoke_request_key`|`BINARY(16)`|是|无显式默认|撤销请求幂等键|
|`revoke_request_hash`|`BINARY(32)`|是|无显式默认|撤销请求内容摘要|
|`revoke_result_version`|`INT UNSIGNED`|是|无显式默认|撤销操作结果的缺陷版本|
|`active_failure_id`|`BIGINT`|是|生成列（见完整声明）|仅有效复测关联保留原始失败 ID 的生成列，用于限制有效关联唯一性|

**完整字段声明与约束（最终生效结构）**

```sql
`id` BIGINT NOT NULL AUTO_INCREMENT,
`defect_id` BIGINT NOT NULL,
`failure_attempt_id` BIGINT NOT NULL,
`pass_attempt_id` BIGINT NOT NULL,
`policy_version` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
`linked_by` BIGINT NOT NULL,
`linked_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
`review_note` VARCHAR(2000) NOT NULL,
`timing_basis` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
`request_key` BINARY(16) NOT NULL,
`request_hash` BINARY(32) NOT NULL,
`result_defect_version` INT UNSIGNED NOT NULL,
`revoked_by` BIGINT NULL,
`revoked_at` DATETIME(6) NULL,
`revoke_reason` VARCHAR(2000) NULL,
`revocation_operation` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL,
`revoke_request_key` BINARY(16) NULL,
`revoke_request_hash` BINARY(32) NULL,
`revoke_result_version` INT UNSIGNED NULL,
`active_failure_id` BIGINT GENERATED ALWAYS AS (CASE WHEN `revoked_at` IS NULL THEN `failure_attempt_id` ELSE NULL END) STORED,
PRIMARY KEY (`id`),
UNIQUE KEY `uq_retests_active_source` (`defect_id`,`active_failure_id`),
UNIQUE KEY `uq_retests_endpoints` (`id`,`defect_id`,`failure_attempt_id`,`pass_attempt_id`),
UNIQUE KEY `uq_retests_request` (`request_key`),
UNIQUE KEY `uq_retests_revoke_request` (`revoke_request_key`),
KEY `ix_retests_defect_failure` (`defect_id`,`failure_attempt_id`,`id`),
KEY `ix_retests_source` (`failure_attempt_id`,`defect_id`),
KEY `ix_retests_pass` (`pass_attempt_id`),
KEY `ix_retests_linked_by` (`linked_by`),
KEY `ix_retests_revoked_by` (`revoked_by`),
CONSTRAINT `fk_retests_defect` FOREIGN KEY (`defect_id`) REFERENCES `defects` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_retests_source` FOREIGN KEY (`failure_attempt_id`,`defect_id`) REFERENCES `test_attempt_defects` (`attempt_id`,`defect_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_retests_pass` FOREIGN KEY (`pass_attempt_id`) REFERENCES `test_attempts` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_retests_linked_by` FOREIGN KEY (`linked_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_retests_revoked_by` FOREIGN KEY (`revoked_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `ck_retests_different_attempts` CHECK (`failure_attempt_id` <> `pass_attempt_id`),
CONSTRAINT `ck_retests_policy` CHECK (`policy_version` = 'EXACT_SEMANTIC_V1'),
CONSTRAINT `ck_retests_note` CHECK (CHAR_LENGTH(TRIM(`review_note`)) > 0),
CONSTRAINT `ck_retests_timing` CHECK (`timing_basis` IN ('MANUAL_SERVER_RECORD','IMPORT_REVIEW_ATTESTATION')),
CONSTRAINT `ck_retests_revocation` CHECK ( (`revoked_by` IS NULL AND `revoked_at` IS NULL AND `revoke_reason` IS NULL AND `revocation_operation` IS NULL AND `revoke_request_key` IS NULL AND `revoke_request_hash` IS NULL AND `revoke_result_version` IS NULL) OR (`revoked_by` IS NOT NULL AND `revoked_at` IS NOT NULL AND `revoke_reason` IS NOT NULL AND `revocation_operation` IS NOT NULL AND `revoke_request_key` IS NOT NULL AND `revoke_request_hash` IS NOT NULL AND `revoke_result_version` IS NOT NULL AND `revoked_at` >= `linked_at` AND CHAR_LENGTH(TRIM(`revoke_reason`)) > 0 AND `revocation_operation` IN ('REVOKE','REPLACE')))
```

### 34. defect_closure_receipts — 缺陷关闭回执表

冻结一次缺陷关闭时使用的说明、版本与证据数量。 分类：当前核心功能。来源：`database/migrations/20261014-r1-defect-retest.sql:56`。

|字段|类型|可空|默认/生成规则|中文说明|
|---|---|---|---|---|
|`id`|`BIGINT`|否|自增|记录主键|
|`defect_id`|`BIGINT`|否|无显式默认|缺陷 ID|
|`closed_defect_version`|`INT UNSIGNED`|否|无显式默认|关闭时的缺陷版本|
|`closed_by`|`BIGINT`|否|无显式默认|关闭用户 ID|
|`closed_at`|`DATETIME(6)`|否|CURRENT_TIMESTAMP(6)|关闭时间|
|`policy_version`|`VARCHAR(32)`|否|无显式默认|证据判定策略版本|
|`resolution_note`|`TEXT`|否|无显式默认|解决说明|
|`evidence_count`|`INT UNSIGNED`|否|无显式默认|关闭时的原始失败证据数量|

**完整字段声明与约束（最终生效结构）**

```sql
`id` BIGINT NOT NULL AUTO_INCREMENT,
`defect_id` BIGINT NOT NULL,
`closed_defect_version` INT UNSIGNED NOT NULL,
`closed_by` BIGINT NOT NULL,
`closed_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
`policy_version` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
`resolution_note` TEXT NOT NULL,
`evidence_count` INT UNSIGNED NOT NULL,
PRIMARY KEY (`id`),
UNIQUE KEY `uq_closures_defect_version` (`defect_id`,`closed_defect_version`),
UNIQUE KEY `uq_closures_owner` (`id`,`defect_id`),
KEY `ix_closures_defect_time` (`defect_id`,`closed_at`,`id`),
KEY `ix_closures_closed_by` (`closed_by`),
CONSTRAINT `fk_closures_defect` FOREIGN KEY (`defect_id`) REFERENCES `defects` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_closures_actor` FOREIGN KEY (`closed_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `ck_closures_policy` CHECK (`policy_version` = 'R1_CLOSURE_V1'),
CONSTRAINT `ck_closures_note` CHECK (CHAR_LENGTH(TRIM(`resolution_note`)) > 0),
CONSTRAINT `ck_closures_count` CHECK (`evidence_count` > 0)
```

### 35. defect_closure_items — 缺陷关闭证据明细表

冻结关闭回执中每个原始失败及采信通过结果。 分类：当前核心功能。来源：`database/migrations/20261014-r1-defect-retest.sql:77`。

|字段|类型|可空|默认/生成规则|中文说明|
|---|---|---|---|---|
|`receipt_id`|`BIGINT`|否|无显式默认|关闭回执 ID|
|`failure_attempt_id`|`BIGINT`|否|无显式默认|原始失败执行尝试 ID|
|`defect_id`|`BIGINT`|否|无显式默认|缺陷 ID|
|`pass_attempt_id`|`BIGINT`|否|无显式默认|采信的通过执行尝试 ID|
|`retest_link_id`|`BIGINT`|是|无显式默认|跨运行复测关联 ID；同运行证据可为空|
|`evidence_policy`|`VARCHAR(32)`|否|无显式默认|该项关闭证据的判定策略|

**完整字段声明与约束（最终生效结构）**

```sql
`receipt_id` BIGINT NOT NULL,
`failure_attempt_id` BIGINT NOT NULL,
`defect_id` BIGINT NOT NULL,
`pass_attempt_id` BIGINT NOT NULL,
`retest_link_id` BIGINT NULL,
`evidence_policy` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
PRIMARY KEY (`receipt_id`,`failure_attempt_id`),
KEY `ix_closure_items_owner` (`receipt_id`,`defect_id`),
KEY `ix_closure_items_source` (`failure_attempt_id`,`defect_id`),
KEY `ix_closure_items_pass` (`pass_attempt_id`),
KEY `ix_closure_items_link` (`retest_link_id`,`defect_id`,`failure_attempt_id`,`pass_attempt_id`),
CONSTRAINT `fk_closure_items_owner` FOREIGN KEY (`receipt_id`,`defect_id`) REFERENCES `defect_closure_receipts` (`id`,`defect_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_closure_items_source` FOREIGN KEY (`failure_attempt_id`,`defect_id`) REFERENCES `test_attempt_defects` (`attempt_id`,`defect_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_closure_items_pass` FOREIGN KEY (`pass_attempt_id`) REFERENCES `test_attempts` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `fk_closure_items_link` FOREIGN KEY (`retest_link_id`,`defect_id`,`failure_attempt_id`,`pass_attempt_id`) REFERENCES `defect_retest_links` (`id`,`defect_id`,`failure_attempt_id`,`pass_attempt_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
CONSTRAINT `ck_closure_items_different` CHECK (`failure_attempt_id` <> `pass_attempt_id`),
CONSTRAINT `ck_closure_items_policy` CHECK ( (`evidence_policy` = 'SAME_RUN_CASE_V1' AND `retest_link_id` IS NULL) OR (`evidence_policy` = 'EXACT_SEMANTIC_V1' AND `retest_link_id` IS NOT NULL))
```
