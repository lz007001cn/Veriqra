# ECS 部署记录

## 2026-10-31：AI 测试总结与需求操作更新

已更新到 [veriqra.xyz](https://veriqra.xyz)。本次包含 AI 测试运行总结、需求列表与详情操作调整、AI 面板按需展开、需求主按钮及关联用例按钮的排版修复。

- 版本字符串仍为 `0.9.0`，构建时间 `2026-10-31T07:13:42Z`。构建基于提交 `8259b8a4a49417e87c1505b4e4e404a4b20b237e` 及当前工作区改动；本次未创建新版本标签，以 WAR 哈希识别这次更新。
- WAR：6,067,532 字节；SHA-256：`dbc4876d46f9f2b3f4bba1102721bbcbbdee1e80735b0d91c2de2317ef09d0a0`。
- 沿用 35 张表，未执行 DDL 或本地数据同步；线上已有项目、需求、用例、计划和运行数据保留。
- 继续使用 ECS 原有外部数据库与 Vertex AI 配置。AI 测试总结无需新增配置或数据表。

验证：326 项前端测试通过；本轮功能构建的 Java 基础测试 187 项通过、1 项跳过；新 SQL 的独立 MySQL 测试 4 项通过。部署后 25 项公开资源均返回 HTTP 200，并逐字节匹配本次 WAR。线上登录、需求操作和按钮尺寸、AI 用例预览（5 条候选，未接受保存）、AI 测试总结均通过真实验证。总结正确识别现有运行的 5 条用例尚未执行。

升级与验收后业务表行数保持不变；验收产生正常访问日志 78 条、登录事件 1 条。未修改需求状态、覆盖关联、执行结果或缺陷。

升级前备份：

- ECS：`/root/veriqra-backup-v09-ai-requirements-20261031T072601Z`。
- 本机：`E:/Veriqra-private-backups/ai-requirements-20261031/veriqra-backup-v09-ai-requirements-20261031T072601Z.tar.gz`。
- 归档 SHA-256：`684e1517de0a73c924114a7e61ab7ea2845058ec0409dca083c6bcf30928b21f`；本机与 ECS 校验一致。
- 包含原 WAR、数据库、外部配置、systemd 服务及覆盖配置。回退应用时不覆盖上线后的新增业务数据。

## 2026-10-28：v0.9.0 界面更新

已部署统一页面风格与可搜索项目选择器。部署包 SHA-256 为 `a60d45e7b38abf3b9464719388f5a0aea2b4db3f9dcc3d15c918bef5191a9a18`，沿用 35 张表与线上业务数据，无结构迁移。该包也是 2026-10-31 更新前实际运行的版本。

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
