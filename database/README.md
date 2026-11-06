# 数据库安装

目标环境为 MySQL 8.0，字符集 `utf8mb4`。当前空库安装使用 32 表基线，再加入缺陷复测、缺陷评论和发版验收表，共 37 表。

## 新安装

创建并选中自己的空库，然后依次执行：

```sql
SOURCE database/schema.sql;
SOURCE database/migrations/20261014-r1-defect-retest.sql;
SOURCE database/migrations/20261106-defect-comments.sql;
SOURCE database/migrations/20261106-release-acceptance.sql;
```

`schema.sql` 不包含建库、删库和已有表覆盖；SQL 中没有 `USE`，以客户端当前选中的数据库为准。数据库连接配置参考 `config/database.example.properties`。

## 已有实例

从 v0.3 升级到原 v0.9.0 发布包时沿用已有结构。小团队试用构建增加了运行负责人、缺陷评论和发版验收。

升级到支持测试运行负责人的构建前，在已有实例应用 `migrations/20261105-run-assignee.sql`。已有运行的负责人初始为空。新安装的 `schema.sql` 已包含该字段，无需再执行此增量。

升级到支持缺陷评论和发版验收的构建前，按顺序应用 `migrations/20261106-defect-comments.sql` 和 `migrations/20261106-release-acceptance.sql`。

如果实例早于 v0.2，可根据实际结构使用 `migrations/` 中的历史增量；已经应用的迁移不重复执行。实际生产升级记录见 [ECS 部署记录](../docs/ECS-DEPLOYMENT.md)。

## 数据与测试文件

- `schema.sql`：当前安装基线。
- `migrations/20261014-r1-defect-retest.sql`：缺陷复测关联与关闭记录。
- `schema-v1-frozen.sql`、`seed.sql`、`constraint-tests.sql`、`queries.sql`、`service-invariants.sql`：初始 19 表模型的历史验证材料，不能用来覆盖当前业务库。
- `verify.ps1` 与 `verification/`：上述历史验证的脚本与结果。

Java 集成测试使用独立空库。正在本地演示的数据库包含已保存的需求、用例与执行记录，继续使用现有数据。
