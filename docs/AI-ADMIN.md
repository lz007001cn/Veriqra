# 管理后台 AI 设置

入口：管理员进入“管理后台 → AI 设置”（`admin/ai.html`）。此页使用服务器已有 Google Cloud 项目和服务账号，不要求在浏览器上传凭据。

## 模型选择

- 显示当前项目、位置和生效模型。选择预设或填写 Gemini 模型 ID，点击保存后，新发起的用例生成与运行总结使用新模型；进行中的请求保持原模型。
- 保存使用设置版本校验。冲突或响应不确定时，先读取当前设置并复核，不自动覆盖他人的改动。
- 选择独立保存到 `ai-settings.local.properties`，不会改写数据库或原凭据文件。重启后仍保留。若服务器文件不可写，页面会显示只读状态。
- 设置文件路径优先级：`VERIQRA_AI_SETTINGS`、`-Dveriqra.ai.settings=...`，默认位于当前 AI 配置文件的同目录。已有 `VERIQRA_AI_MODEL` 是默认配置，管理员保存的独立选择覆盖该默认值。
- 页面预设是模型 ID 列表，不是“该项目已获准调用”的保证。模型须支持当前位置、文本生成和结构化 JSON 输出；已有模型不会被静默更换。

截至 2026-11-04 官方资料，Gemini 4 Argon 的模型 ID 为 `gemini-4-argon`，支持 `global`、`us`、`eu`。Gemini 2.5 文本模型列出的退役日期为 2026-10-20；页面保留旧当前值供识别，预设提供 Gemini 4 Argon、3.8 Flash、3.5 Flash-Lite 和 3.5 Flash。此列表是应用预设，并未自动发现 Google 项目可用的全部模型。具体可用性以 Google 项目、位置和模型文档为准。[Gemini 4 接入](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/start/get-started-with-gemini-4) · [模型生命周期](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/model-versions)

Gemini 3／4 的用例生成与测试总结请求使用 `thinkingLevel: LOW`，省略旧版 `thinkingBudget` 与 `temperature`；旧 2.5 配置保持原有行为。Token 计数不携带这些生成参数，因此“检查当前模型”成功也不能替代实际生成验收。

## Google 查询和模型检查

“刷新 Google 数据”执行只读查询，使用当前已保存配置，不使用尚未保存的下拉选择；不调用内容生成。短时间重复刷新复用最多 30 秒缓存，显示数据取得时间。

| 区域 | 真实数据来源 | 边界 |
|---|---|---|
| Google 项目连接 | Cloud Resource Manager 项目查询 | 成功表示可读取项目，不代表所有模型生成已验证。 |
| 最近 24 小时用量 | Cloud Monitoring PublisherModel 指标 | 当前项目、当前模型、跨区域，可能包含其他应用。无监测数据使用 `—`，不冒充零用量。 |
| 配额上限 | Service Usage consumerQuotaMetrics（FULL） | 展示相关模型/地区的有效限额。共享 PayGo 不提供可保证的固定剩余调用量。 |
| 账单状态 | Cloud Billing 项目关联与可读取的账号元数据 | 可显示结算关联和账号信息；不会据此推算赠金余额。 |
| 赠金与费用 | Google 控制台入口 | 当前公开 Billing API 未提供赠金剩余字段。费用明细需要另行配置账单导出；本页没有伪造实时余额。 |

独立的“检查当前模型”仅向该模型调用 `countTokens`，请求内容为固定 `ping`。官方当前标明此接口免费；成功只表示模型 Token 计数请求通过，不代表内容生成和当时容量必然可用。普通刷新不会执行此检查。[Token 计数](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/get-token-count)

配额明细默认折叠，摘要分别显示分组数量与适用范围条目数量。同一指标按单位归并后，再展开查看各地区、模型等维度的限额；这些数值不相加。明细表仅在展开对应指标时创建，刷新或切换语言会保留本标签页的展开状态。模型检查、用量统计范围、赠金与费用的较长说明也可独立折叠。

配额查询会排除其他发布商、Responses API、媒体／文档输入、长任务、Flex 和搜索工具等当前文本生成流程未使用的限额；仍保留可能适用的通用在线预测配额。`global` 配置下保留相关地区记录，避免将空维度的默认值误解为全球端点专用限额。条目数量较多主要来自同一指标的多个维度桶，不代表已开通或已使用这些服务。

## 权限不足时

Google 的模型调用权限不自动包含监测、配额和账单读取权限。各区域独立显示失败，不会将缺少权限、API 未启用或网络失败显示为 `0`。若需查询，按提示为现有服务账号配置对应 API 和只读权限：

- 项目读取：`resourcemanager.projects.get`。
- 监测：`monitoring.timeSeries.list`（可由 Monitoring Viewer 提供）。
- 配额：`serviceusage.quotas.get`（可由 Service Usage Viewer 提供）。
- 账单账号元数据：相应账单账号的读取权限；账单账号与项目权限是不同范围。

应用不会自动启用 Google API、修改 IAM 或创建账单导出。无法查询时仍可使用页面的 Google 控制台链接。

## 管理接口

- `GET /api/admin/ai`：当前设置和控制台入口，不返回凭据路径或凭据内容。
- `PUT /api/admin/ai`：`{"model":"gemini-3.8-flash","expectedRevision":0}`，保存独立模型选择。
- `POST /api/admin/ai/refresh`：分区查询 Google 数据。
- `POST /api/admin/ai/check-model`：只检查已生效模型的 Token 计数。

上述入口均重新校验当前活跃管理员；写请求沿用应用同源规则。当前不新增数据库表。本地更新不等于已经部署 ECS 或推送 GitHub。

实现依据与 Google 参考：

- [Service Usage 配额查询](https://docs.cloud.google.com/service-usage/docs/reference/rest/v1beta1/services.consumerQuotaMetrics/list)
- [Monitoring timeSeries.list](https://docs.cloud.google.com/monitoring/api/ref_v3/rest/v3/projects.timeSeries/list)
- [Standard PayGo 共享容量](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/standard-paygo)
- [Cloud Billing 项目关联](https://docs.cloud.google.com/billing/docs/reference/rest/v1/projects/getBillingInfo)
- [Google 赠金查看说明](https://docs.cloud.google.com/billing/docs/how-to/resolve-issues#view_promotional_credits)
