# English / 简体中文界面

界面支持 `en` 和 `zh-CN`，登录页、主工作区及用户管理页可切换。选择保存在当前浏览器的 `veriqra.locale`，首次访问按浏览器语言选择，默认英文。

`src/main/webapp/i18n/en.json` 与 `zh-CN.json` 使用相同的扁平键。静态文案通过 `data-i18n` 标记；动态文案调用 `I18n.t(key, params, fallback)`，在 `veriqra:localechange` 后重新渲染。项目设置使用 `projectSettings.*`，首页汇总使用 `dashboard.*`。新增文案须同时补齐两种语言。

翻译仅用于显示，API 字段、枚举、项目名称、需求描述与其他用户输入保留原值。插值使用纯文本，不插入 HTML。UTC 时间通过 `Intl.DateTimeFormat` 按 `Asia/Shanghai` 显示，计数通过 `Intl.NumberFormat` 格式化。

v0.9 已删除团队、任务、积分和旧后台页面的专属文案。用户管理是唯一后台业务页面，`admin/index.html` 直接跳转到该页。

`I18nResourcesTest` 检查 JSON 重复键、双语键及参数一致性、页面和脚本引用；前端测试覆盖切换、插值、日期与登录反馈。运行方式见项目 README。
