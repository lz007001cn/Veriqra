# v0.2.0 部署到 ECS

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
