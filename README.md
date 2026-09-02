# 晨间信号

本地优先的开源个人新闻研究系统。它完成 RSS/Atom 采集、事件候选、Codex
分析草稿、SQLite 历史存储，以及只在本机开放的人工审核 Dashboard。

默认关注 DeFi、MEV、加密安全、AI × 金融 × 区块链、全球宏观和突发事件。
关注范围与来源都可以通过 YAML 配置修改。

## 安装

```bash
git clone https://github.com/MagicTaoT/Daily-News-Brief.git
cd Daily-News-Brief
corepack enable
pnpm install
pnpm db:init
pnpm check
pnpm dev
```

需要 Node.js 22 或更高版本和 pnpm 11。打开 `http://127.0.0.1:3000/`
即可查看本地 Dashboard。

首次采集前请检查并按需修改：

- `config/profile.yaml`：关注主题、时区、日报时间和篇幅。
- `config/sources.yaml`：公开 RSS/Atom 来源、来源等级和主题映射。

## 在 Codex 中每天运行

此仓库不会携带作者本机的自动化实例。克隆后，在 ChatGPT 桌面应用的 Codex
中打开项目，请 Codex 根据 `prompts/automation-daily.md` 创建每天早晨运行的本地计划任务。
每个用户拥有自己的 SQLite 数据、计划任务和审核结果。

当前版本适合拥有 ChatGPT 桌面应用 Codex、本地 Node.js 环境且能保持电脑开机的用户。
纯 Web 或移动端 ChatGPT 无法直接运行本仓库的本地 Worker 和 Dashboard。面向所有
ChatGPT/Codex 客户端的插件分发边界与演进方案见
[`docs/public-distribution.md`](docs/public-distribution.md)。

## 目录

```text
apps/dashboard       React/Vite 本地 Dashboard
apps/worker          可由 Codex automation 调用的本地 Worker CLI
packages/contracts   共享 TypeScript 类型与运行时数据校验
packages/storage     SQLite 迁移、Repository 与全文检索
packages/collector   RSS/Atom 解析、抓取与持久化管线
packages/candidates  事件聚类、候选排序与分析输入生成
prompts              Codex 本地分析任务提示词
config               用户关注配置
schemas              对外 JSON Schema
examples             示例日报
docs                 产品与架构文档
```

不需要 OpenAI API Key。后续模型分析由 Codex Desktop recurring automation 执行。

## 开发命令

```bash
pnpm install
pnpm dev
```

Dashboard 和审核 API 默认只监听：

```text
http://127.0.0.1:3000
http://127.0.0.1:8787
```

常用命令：

```bash
pnpm worker:health  # 查看 Worker 状态
pnpm worker:dry     # 生成一份不落盘的安全草稿
pnpm db:init        # 初始化或迁移本地 SQLite 数据库
pnpm db:status      # 查看迁移版本与数据量
pnpm sources        # 查看配置来源及最近抓取状态
pnpm collect:dry    # 联网采集预演，不写本地状态
pnpm collect        # 采集所有启用来源并写入 SQLite
pnpm daily:preflight -- --date 2026-09-02
                    # 只读检查当天日报是否已经存在
pnpm candidates:prepare -- --date 2026-09-02
                    # 为指定日报日期生成分析候选包
pnpm draft:validate -- --input <draft.json> --bundle <analysis-input.json>
                    # 校验草稿 Schema、候选溯源和人工审核门禁
pnpm draft:import -- --input <draft.json> --bundle <analysis-input.json>
                    # 将已校验草稿以 review_required 状态写入 SQLite
pnpm typecheck      # TypeScript 类型检查
pnpm test           # 单元测试
pnpm build          # 构建所有包
pnpm check          # 完整交付检查
```

## 安全默认值

- Dashboard 只绑定 `127.0.0.1`。
- 人工审核 API 只绑定 `127.0.0.1`；批准不会触发发布。
- Worker dry-run 只输出 `review_required` 草稿。
- Codex 分析草稿只允许进入 `review_required`，不自动批准或发布。
- 每天 07:00 的 Codex 本地自动化只创建当天首份草稿；重复运行不会覆盖人工修改。
- 当前不包含自动发布、AWS 部署或 ENS 修改。
- 本机密钥和运行数据默认不进入 Git。

产品边界见 [`docs/product-spec.md`](docs/product-spec.md)。
数据表、关系和不可变规则见 [`docs/data-model.md`](docs/data-model.md)。
采集来源、失败行为和命令见 [`docs/collection.md`](docs/collection.md)。
候选窗口、聚类规则和限制见 [`docs/candidate-pipeline.md`](docs/candidate-pipeline.md)。
Codex 分析、校验和人工审核门禁见 [`docs/editorial-workflow.md`](docs/editorial-workflow.md)。
本地 Dashboard、可编辑字段和批准边界见 [`docs/dashboard-review.md`](docs/dashboard-review.md)。

## License

[MIT](LICENSE)
