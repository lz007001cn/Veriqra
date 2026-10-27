# Veriqra

软件测试与质量管理平台，用于课程期末展示。

主线：**需求 → AI 辅助生成用例 → 测试计划 → 执行结果 → 缺陷 → 复测关闭**。支持手工执行和 JUnit XML 结果导入。

v0.3.0 已部署到 [veriqra.xyz](https://veriqra.xyz)，当前开发版为 `0.9.0-SNAPSHOT`。

## 功能

- 需求、测试用例和步骤、需求覆盖关联。
- AI 生成候选用例，编辑、选择后保存为草稿。
- 测试计划、运行、执行记录及历史用例内容。
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

输出 `target/veriqra-0.9.0-SNAPSHOT.war`，部署到 Tomcat 10.1。

1. 按[数据库说明](database/README.md)安装数据库；已有 v0.3 实例不需要结构迁移。
2. 复制 `config/database.example.properties` 为 `config/database.local.properties`，填写本地数据库连接。部署时也可通过 `VERIQRA_DB_CONFIG` 指向外部配置文件。
3. AI 配置使用 `config/ai.example.properties`，接入步骤见 [AI 与导入说明](docs/V0.3.md)。
4. 使用已有账号登录；管理员可在“用户维护”新增用户，再在“项目设置”添加成员和任命负责人。

普通 `mvn test` 不依赖数据库。MySQL 集成测试使用单独的空测试库和 `mysql-tests` profile；本地演示库保留用户操作记录。

## 项目资料

- [开发与精简计划](docs/DEVELOPMENT-ROADMAP.md)
- [ZZZSwitch 演示文案与操作顺序](docs/demo/ZZZSWITCH-DEMO.md)
- [v0.3 发布说明](docs/RELEASE-0.3.0.md)
- [ECS 部署记录](docs/ECS-DEPLOYMENT.md)
