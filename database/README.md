# Veriqra V1 数据库

核心模型冻结版本：[Freeze v1.0](../docs/DOMAIN-FREEZE-v1.0.md)，目标 MySQL 8.0.46，19 表、154 字段。Phase 5 R5 增加 5 张 Administration 表；项目协作增量再增加 5 张表，当前 schema.sql 为 32 表，执行 R1 缺陷复测迁移后为 35 表。增量结构分别见 [R5 说明](../docs/PHASE5-R5-ADMINISTRATION.md) 和 [项目协作说明](../docs/PROJECT-COLLABORATION.md)。
见 [完整设计](../docs/DATABASE-DESIGN-DRAFT.md) 和 [实测报告](../docs/DATABASE-VALIDATION-v1.0.md)。

## 执行文件

| 文件 | 作用 |
| --- | --- |
| schema.sql | 当前 32 表空库建表及约束；不含建库/删库或 IF NOT EXISTS |
| schema-v1-frozen.sql | 原 19 表冻结 DDL，保留给 V1 验证脚本复现历史结果 |
| migrations/20260924-admin.sql | 已有 19 表安装的单次升级脚本；新增索引、5 表并为已有用户补 0 余额账户；必须先备份并在选定目标库人工执行 |
| migrations/20260926-collaboration.sql | 已有 24 表（含 Administration）安装的单次升级脚本；增加项目负责人、小组、任务和历史事件 5 表。不得跳过备份或在本地开发时自动执行 |
| seed.sql | 空表种子，单事务 680 行，每表至少 10 行；重复执行应报冲突 |
| constraint-tests.sql | 验证库专用，178 项测试；修改逐项回滚，三个测试过程成功后删除 |
| queries.sql | 10 组核心查询与 2 条 EXPLAIN ANALYZE |
| service-invariants.sql | 22 项只读业务一致性检查；不安装触发器 |
| inspect.sql | 真实对象、索引、引用动作、CHECK 状态及行数 |
| verify.ps1 | PowerShell 7 历史 V1 验证入口；使用 schema-v1-frozen.sql，只创建新的 veriqra_v1_verify_* 数据库 |
| verification/ | 本轮实测证据，不是 MySQL 数据目录 |

## 当前安装与历史验证

新安装在空库依次执行 `schema.sql` 和 `migrations/20261014-r1-defect-retest.sql`（共 35 表）。已有 19 表的环境必须先迁移 Administration；已有 24 表的环境先备份、核对当前结构，再审查并单次执行 `migrations/20260926-collaboration.sql`。迁移必须由具备 DDL 权限的数据库管理员执行，不能使用只有 DML 权限的运行用户 `veriqra_app`。迁移 SQL 不含 `USE`，必须显式选择目标库；不使用 `--force`，失败时保留现场并调查，不盲目重跑。此轮没有对生产或日常开发库执行迁移。旧版 680 行 seed 和 178 项约束测试只对应冻结的 19 表；历史验证脚本继续使用冻结 DDL，不把它误称为当前 32 表验证。

## 从空库复现历史 V1 验证

准备 MySQL 8.0.46 客户端/服务器和有建库、建表、创建测试例程权限的验证账户。
脚本拒绝已存在的库，不删除或覆盖数据；更换新库名重跑。DDL 有隐式提交，失败时保留现场，不能承诺整份 schema 事务回滚。
不要把测试运行到业务数据库，不加 --force、不禁用 FK/CHECK、不以 IGNORE/upsert 掩盖失败。

下面在仓库根目录执行，使用自己的路径/端口/账户。配置 mysql_config_editor 登录路径后可传 LoginPath，不把密码写入仓库或命令参数。

```powershell
.\database\verify.ps1 `
  -MySql 'C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe' `
  -Server 127.0.0.1 -Port 3306 -User veriqra_validator `
  -LoginPath veriqra-local -Database veriqra_v1_verify_demo01
```

历史冻结验证实际使用独立实例 127.0.0.1:13306、新库 qatrack_v1_verify_freeze10；该名称作为历史事实保留。
验证数据目录位于 E 盘，实例收尾正常关闭；复现时使用明确且正在运行的目标实例。

## 手动执行

在仓库根目录启动 MySQL 客户端，显式创建并选择新库，再依次 SOURCE：

```sql
CREATE DATABASE veriqra_v1_verify_manual01 CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE veriqra_v1_verify_manual01;
SOURCE database/schema-v1-frozen.sql;
SOURCE database/seed.sql;
SOURCE database/constraint-tests.sql;
SOURCE database/queries.sql;
SOURCE database/service-invariants.sql;
SOURCE database/inspect.sql;
```

seed 不是重复同步脚本。约束测试失败时客户端停止，修正后换新库重跑，避免残留 qt_* 过程造成误判。
测试中跨项目错误关联“预期接受”意味着暴露 Service invariant；所有修改随后回滚。
密码哈希的随机输入已丢弃，没有可直接登录的公开种子口令；后续登录测试另行配置。

## 模型约定

- Run 自身 project_id NOT NULL/FK，test_plan_id 可空；不再创建 test_run_projects。
- 19 PK + 13 UNIQUE + 24 普通索引 = 56 总索引；非 PK 共 37。
- 40 FK 均 DELETE/UPDATE RESTRICT，51 CHECK 全部强制执行。
- 行内来源/复核组合由 CHECK 保证；跨项目、权限、历史不可变和父状态等由 Service 保证。
- 会话 UTC、严格 SQL 模式；比率 SQL NULL 在页面显示 N/A。
- 上述 19 表计数和不变量是冻结核心模型的历史基线；Administration 和 Collaboration 增量不改其字段语义。
