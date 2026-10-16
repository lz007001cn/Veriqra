# Veriqra

Software Test & Quality Management Platform · 软件测试与质量管理平台

以可追踪性为核心，将需求、测试用例、测试计划、测试执行、测试结果与缺陷关联起来。
项目用于《Web应用开发实践》课程设计，并计划作为长期维护的个人项目。

公开域名目标：[https://veriqra.xyz](https://veriqra.xyz)。仓库包含 REST 后端、主业务前端、Administration Console 和项目协作界面。

核心业务模型冻结为 19 表 / 154 字段；Phase 5 R5 新增 5 张 Administration 表，项目协作再新增 5 张表，当前空库 `schema.sql` 共 29 表。JDBC、Service、登录/会话、测试资产、执行、缺陷、自动化、JUnit 导入和项目协作 API 均已实现。公开部署安全基线包括登录限流、严格 Origin/Host 校验、同源写请求头和安全 Session Cookie。现有环境升级步骤分别见 [Administration 说明](docs/PHASE5-R5-ADMINISTRATION.md) 与 [项目协作说明](docs/PROJECT-COLLABORATION.md)；仓库结构不代表生产库已完成相应迁移。

QATrack → Veriqra 的更名与部署历史见 [更名与部署说明](docs/VERIQRA-RENAME.md)。

## 技术约束

- 目标环境：JDK 21 LTS、Maven 3.9.x、MySQL 8.0.46、Tomcat 10.1.x。
- Servlet 体系：Jakarta Servlet 6.0，使用 `jakarta.servlet.*`，不混用 `javax.servlet.*`。
- 后端采用原生 Java、JDBC、Jackson JSON；不使用 Spring 或 ORM 框架。
- 调用方向：Servlet → Service → DAO → JDBC → MySQL；Model 为数据模型。
- DAO 必须分离接口与实现；业务规则和事务控制归 Service，Servlet 只处理 HTTP。
- 前端使用 HTML、CSS、JavaScript、jQuery、Bootstrap 和 AJAX，不引入前端构建系统。
- 前端界面支持 English / 简体中文切换；语言偏好仅保存在浏览器本地，时间统一按 `Asia/Shanghai` 显示，详见 [R5.1 国际化说明](docs/PHASE5-R5.1-I18N.md)。
- 使用 JUnit 5、Mockito、JaCoCo 和隔离 MySQL/HTTP 集成测试验证实现。

运行依赖为 Jakarta Servlet 6（provided）、Jackson JSON 和 MySQL Connector/J；JUnit 5 与嵌入式 Tomcat 仅用于测试。

## 目录

```text
docs/                         审计和后续设计文档
src/main/java/io/github/lz007001cn/veriqra/
  model/                      数据模型
  dao/                        DAO 接口及 JDBC 实现
  config/                     默认配置、外部文件与环境变量加载
  jdbc/                       自定义连接池与事务入口
  service/                    业务规则与事务
  web/                        Servlet、Filter、DTO、JSON 与同源安全策略
  admin/                      Administration 授权、Service、DAO 与只读 DTO
  util/                       职责明确的基础工具
  exception/                  异常类型
src/main/resources/           应用资源
src/main/webapp/WEB-INF/       Web 应用配置
src/main/webapp/assets/        主应用 CSS、JS、vendor 资源
src/main/webapp/admin/         Administration 页面、CSS 与 JS
config/                      可提交配置示例；*.local.properties 忽略
src/test/java/                配置、连接池、事务及 MySQL 集成测试
```

空目录使用 `.gitkeep` 保留，打包时排除这些占位文件。

## 构建

使用 JDK 21 和 Maven。没有全局 Maven 的 Windows 环境可直接调用 IDEA 自带 Maven，无需修改 PATH，具体命令见 [JDBC 基础设施说明](docs/PHASE2-JDBC-FOUNDATION.md)。

```shell
java -version
mvn -version
mvn validate
mvn clean package
```

输出为 `target/veriqra-0.2.0.war`。普通 `mvn test` 运行不依赖数据库的测试；
配置独立空测试库后使用 `mvn -Pmysql-tests test` 或 `mvn -Pmysql-tests clean package`，同时运行真实 MySQL 测试。
集成测试拒绝开发库及非空库，不使用开发 seed。配置、连接生命周期、事务示例和本轮实测见 [Phase 2 JDBC 说明](docs/PHASE2-JDBC-FOUNDATION.md)。

## IntelliJ IDEA

打开仓库根目录的 `pom.xml` 并作为 Maven 项目加载。Project SDK、Maven importer 和
Maven runner 均应选择 JDK 21，语言级别以 POM 中的 `maven.compiler.release=21` 为准。
本地 `.idea/`、`*.iml`、构建产物和本地敏感配置已由 `.gitignore` 排除。

## V1 冻结模型与数据库

- [领域模型](docs/DOMAIN-MODEL.md)：冻结的业务边界、关系、状态、快照与事务。
- [数据库设计](docs/DATABASE-DESIGN-DRAFT.md)：19 表、154 字段及与真实 DDL 一致的约束和索引。
- [Mermaid ER 源文件](docs/V1-ER.mmd)：19 表、40 条外键关系。
- [Freeze v1.0 决策](docs/DOMAIN-FREEZE-v1.0.md)：Run 直接保存非空 project_id 的七维比较。
- [数据库执行说明](database/README.md)：冻结 19 表验证、当前 29 表空库安装及增量迁移。
- [数据库实测报告](docs/DATABASE-VALIDATION-v1.0.md)：178 项测试、22 项数据一致性检查及对象统计。
- [上一轮设计审计](docs/V1-DESIGN-AUDIT.md)：20 表阶段的历史记录，已由冻结模型取代。

Run 支持可选 Plan、Ad-hoc 与无计划 JUnit/CI 导入；执行项/快照与 Attempt 结果分离，SKIPPED 单独统计，自动化身份通过独立映射关联用例。

本轮明确使用 MySQL 8.0.46；环境审计中的 8.4 目标保留为历史记录。
Run 项目归属直接保存在 test_runs.project_id。当前本地开发数据库为 `veriqra`；冻结的19表结构和已有680行验证数据在迁移前后保持一致，旧源库仅作为本地回滚副本暂时保留。
