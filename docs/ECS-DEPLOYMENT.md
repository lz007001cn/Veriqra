# ECS 部署记录

## v0.9.0：尚未部署

2026-10-28 v0.9 最终展示验收通过。用户尚未启动 ECS，本次完成代码与版本发布，未执行线上升级。最近一次部署记录仍为下方的 v0.3.0。

后续部署使用 `v0.9.0` 正式 WAR，沿用 35 张表、原有外部配置和线上业务数据，无 DDL 升级。

## v0.3.0：AI 用例、导入恢复与本地演示数据

2026-10-22 已部署到 [veriqra.xyz](https://veriqra.xyz)。

- 发布提交：`eaae3db9c9a54996727e2b99155b347243a5f149`；[PR #3](https://github.com/lz007001cn/Veriqra/pull/3) 已合并。
- 候选 `v0.3.0-rc.1` 与正式 `v0.3.0` 使用同一提交、同一 WAR；[正式发布](https://github.com/lz007001cn/Veriqra/releases/tag/v0.3.0)。
- WAR：5,716,594 字节；SHA-256：`c0a85856372d612f4e4a0e6668d25cc6c3432a628eb69e8dcb350bc2bca89d3d`。
- 沿用 35 张表，未执行结构迁移；线上原有两个项目保留。
- Vertex 配置位于 `/opt/veriqra/config/ai.properties`，通过 systemd 外部配置加载；真实后端生成返回 HTTP 200、3 条候选。

用户本地创建的 `QA20261022`／ZZZSwitch 项目已增量同步为线上项目 ID `3`：1 条需求、5 条用例、1 个计划、1 次运行、5 个运行用例及步骤快照，同时保留需求关联、项目成员、负责人和两个小组设置。44 条记录按映射后的 ID 逐字段核对通过，包含原始保存时间。

本地 `v03demo` 的操作映射至现有线上账号 `lz007001cn`；未复制演示账号密码或登录会话。同步时本地没有已提交的 Attempt 或新缺陷，线上这次运行仍为 `IN_PROGRESS`、5 条 `NOT_RUN`。可从[同步后的运行](https://veriqra.xyz/index.html?projectId=3&runId=3#runs)继续。

此次是一次快照迁移；本地与线上后续修改不自动互相同步。界面内尚未提交的表单不属于已保存数据。

验证：发布包 Java 基础测试、272 项前端测试；线上版本及 Commit、登录、项目与资产读取、运行快照、真实 AI 生成均通过。相关 MySQL 服务与 HTTP 测试已在开发阶段验证；本次保留用户本地业务记录，未清空该本地测试库。

升级前备份：

- ECS：`/root/veriqra-backup-v030-20261022T085716Z`。
- 本机：`E:/Veriqra-private-backups/v030-local-sync-20261022/veriqra-backup-v030-20261022T085716Z.tar.gz`。
- 包含原数据库、原 WAR、配置、本地最终快照与 ID 映射。代码回退和数据恢复分别按实际需要处理，避免覆盖上线后新记录。

## v0.2.0

2026-10-21 08:46（Asia/Singapore）已部署 v0.2.0：[veriqra.xyz](https://veriqra.xyz)。

## 发布材料

- Commit：`49f145d3edcce8df53df5242207ea06efcfcef11`。
- WAR：`target/veriqra-0.2.0.war`，5,683,958 字节。
- SHA-256：`e2525ca824b6a93121578598ac1a4a0403631b86c32a8d4a69a4fabefc725850`。
- 数据库迁移：[20261014-r1-defect-retest.sql](../database/migrations/20261014-r1-defect-retest.sql)。

数据库已从 32 表升级至 35 表。迁移期间原有 32 表行数保持不变。

## 本次部署

1. 确认 ECS 原运行 R5.3-D、32 张表，磁盘可用约 31 GiB。
2. 停止 Tomcat，保存新鲜数据库备份、旧 WAR、数据库配置和服务配置。
3. 执行 R1 三表迁移，新增 `defect_retest_links`、`defect_closure_receipts`、`defect_closure_items`。
4. 替换 `/opt/tomcat/apache-tomcat-10.1.60/webapps/ROOT.war`，将旧展开目录与工作缓存移入备份目录，启动 `tomcat10.service`。
5. 验证实际版本与 Commit；登录、项目、用例、执行、关闭条件和复测候选等 16 次接口检查通过；未新增或修改业务数据。启动日志未发现错误。

## 升级前备份

- ECS：`/root/veriqra-backup-20261021T004615Z`，含数据库、旧 WAR、配置、旧展开目录与部署记录。
- 本机：`E:\Veriqra-private-backups\production-pre-v020-20261021T004615Z\pre-v020.tar.gz`，含数据库、旧 WAR 和配置。
- 本机归档 SHA-256：`cdb908d6baf73e7743204ec55521aa7cb003c763adb18ac9fdb86fd702339c54`。

需要回退时先停止业务写入，按故障及新增数据情况选择恢复方式，避免旧备份覆盖上线后的新数据。此次已安装三表，不重复执行迁移。
