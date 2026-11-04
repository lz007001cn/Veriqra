# Veriqra

软件测试与质量管理平台，用于课程期末展示。

主线：**需求 → AI 辅助生成用例 → 测试计划 → 执行结果 → 缺陷 → 复测关闭**。支持手工执行和 JUnit XML 结果导入。

当前版本为 `0.9.0`，发布包见 [v0.9.0](https://github.com/lz007001cn/Veriqra/releases/tag/v0.9.0)。[部署记录](docs/ECS-DEPLOYMENT.md)最近条目为 2026-10-31 的 v0.9 更新；此后的本地界面与 AI 后台设置改动尚未记为 ECS 部署，版本字符串相同不代表构建内容相同。

## 功能

- 需求、测试用例和步骤、需求覆盖关联。
- AI 生成候选用例，编辑、选择后保存为草稿。
- 测试计划、运行、执行记录及历史用例内容。
- AI 测试运行总结：根据本轮结果和关联缺陷生成概况、问题与后续建议，支持复制和重新生成；见[使用说明](docs/AI-RUN-SUMMARY.md)。
- 管理员 AI 设置：保存运行时模型选择，检查 Google 项目连接与模型 Token 计数，读取配额、监测用量和账单状态；余额查询边界见[后台说明](docs/AI-ADMIN.md)。
- 从失败创建缺陷，处理后复测并关闭。
- JUnit XML 预览、映射、导入记录和来源查询。
- 首页项目概况、项目成员与负责人设置、基础用户维护。

v0.9 已裁撤小组任务、任务转交、积分奖励和排行；管理后台收为用户维护。现有数据库表和历史数据继续保留。

## 技术与目录

Java 21、Jakarta Servlet 6、原生 JDBC、Jackson、MySQL 8、Tomcat 10.1；前端使用 jQuery 和 Bootstrap，支持中文与 English，无前端构建工具。仪表盘使用 ECharts 6.0.0 展示当前运行结果；用户维护使用 Bootstrap Table 1.24.2，支持服务端搜索、筛选、排序和分页。两项组件均随 WAR 本地打包。

后端调用方向为 Servlet → Service → DAO → MySQL。主要代码位于 `src/main/java/io/github/lz007001cn/veriqra/`，页面与脚本位于 `src/main/webapp/`，数据库安装文件位于 `database/`。

## 构建与运行

```shell
mvn clean package
node --test src/test/js/*.test.js
```

输出 `target/veriqra-0.9.0.war`，部署到 Tomcat 10.1。

1. 按[数据库说明](database/README.md)安装数据库；已有 v0.3 实例不需要结构迁移。
2. 复制 `config/database.example.properties` 为 `config/database.local.properties`，填写本地数据库连接。部署时也可通过 `VERIQRA_DB_CONFIG` 指向外部配置文件。
3. AI 配置使用 `config/ai.example.properties`，接入步骤见 [AI 与导入说明](docs/V0.3.md)。
4. 使用已有账号登录；管理员可在“用户维护”新增用户，再在“项目设置”添加成员和任命负责人。

普通 `mvn test` 不依赖数据库。MySQL 集成测试使用单独的空测试库和 `mysql-tests` profile；本地演示库保留用户操作记录。

## 项目资料

- [软件设计说明书（v0.9，架构、模块、权限、流程与接口）](docs/SOFTWARE-DESIGN-v0.9.md)
- [完整数据库数据字典（35 表、逐字段与约束）](docs/DATABASE-DICTIONARY-v0.9.md)
- [开发与精简计划](docs/DEVELOPMENT-ROADMAP.md)
- [ZZZSwitch 演示文案与操作顺序](docs/demo/ZZZSWITCH-DEMO.md)
- [v0.9 发布说明](docs/RELEASE-0.9.0.md)
- [v0.3 发布说明](docs/RELEASE-0.3.0.md)
- [ECS 部署记录](docs/ECS-DEPLOYMENT.md)
