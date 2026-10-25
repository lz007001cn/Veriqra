# Veriqra 项目标识与配置

项目早期名称为 QATrack。现有产品名称、Maven artifact、Java 包名和环境变量均使用 Veriqra；早期技术文档中的旧名称属于当时记录。

- Maven 坐标：`io.github.lz007001cn:veriqra`。
- Java 包：`io.github.lz007001cn.veriqra`。
- 配置文件选择：`VERIQRA_DB_CONFIG` → Java 属性 `veriqra.db.config` → 可选 `config/database.local.properties`。
- 配置值优先级：classpath 默认值 → 外部文件 → `VERIQRA_DB_*` 字段覆盖。
- WAR 可部署为根路径 `ROOT.war` 或 `/veriqra` 上下文的 `veriqra.war`，前端 API 使用相对路径。

当前版本与构建方式见 [README](../README.md)，数据库安装见 [database/README](../database/README.md)，线上部署见 [ECS 部署记录](ECS-DEPLOYMENT.md)。
