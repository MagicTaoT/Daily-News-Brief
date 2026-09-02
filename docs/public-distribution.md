# 公开分发与 ChatGPT/Codex 兼容性

## 当前可用方式

公开 GitHub 仓库允许用户克隆项目，并在自己的电脑上运行 Worker、SQLite、Dashboard
和 Codex 本地计划任务。每位用户的数据、自动化配置和审核记录都留在自己的设备上。

这条路径要求：

- ChatGPT 桌面应用中的 Codex；
- Node.js 22+ 与 pnpm 11；
- 计划执行时电脑开机、桌面应用运行且项目目录可访问；
- 用户为联网采集和本地文件写入配置适当的 Codex 权限。

作者机器上的计划任务不属于 Git 仓库，因此不会随 clone 自动安装。用户应在自己的
Codex 中打开仓库，并要求 Codex 依据 `prompts/automation-daily.md` 创建计划任务。

## 为什么还不能覆盖所有 ChatGPT 客户端

当前架构依赖本地 Node.js 进程、SQLite 文件和 localhost Dashboard。ChatGPT Web
和移动端无法直接访问用户电脑中的仓库或数据库，因此仅公开源码不能让所有 ChatGPT
客户端一键使用完整产品。

## 通用分发路径

### 路径 A：skills-only 插件

把主题配置、检索规范、分析方法和计划任务模板封装为公开插件。用户可以在支持插件的
ChatGPT 或 Codex 界面安装，并直接在聊天中生成日报。这条路径最轻，但不会提供当前的
本地 SQLite 历史库和 Dashboard。

### 路径 B：托管服务 + MCP 插件

将采集、历史存储和 Dashboard 改造成多租户托管服务，再通过 MCP 插件向 ChatGPT 和
Codex 提供配置、运行、检索和审核工具。这条路径能保留完整产品体验，但需要账号体系、
数据隔离、隐私政策、服务条款、支持页面、公开 MCP 服务和持续运维。

## 推荐顺序

1. 先让公开仓库用户完成本地安装并验证数周。
2. 抽取一套不依赖本机绝对路径的 skills-only 插件，使用仓库 marketplace 测试。
3. 准备公开插件所需的说明、图标、测试用例、隐私与支持材料并提交审核。
4. 只有确认用户确实需要跨设备历史和共享 Dashboard 后，再建设多租户托管服务。
