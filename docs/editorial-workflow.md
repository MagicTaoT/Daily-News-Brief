# Codex 分析与人工审核工作流

本阶段不调用 OpenAI API。Codex Desktop 负责需要判断力的检索和写作，本地 Worker 负责确定性的校验、入库和发布门禁。

## 每日链路

```text
collect -> candidates:prepare -> Codex 补查与分析
        -> draft:validate -> draft:import -> review_required
```

每天 07:00（`America/Los_Angeles`）的 Codex 本地自动化以项目根目录为工作目录，先执行 `prompts/automation-daily.md`，再按 `prompts/daily-brief.md` 完成编辑。自动任务只导入 `review_required` 草稿，不执行发布动作。

## 命令

```bash
pnpm daily:preflight -- --date YYYY-MM-DD

pnpm draft:validate -- \
  --input data/runs/YYYY-MM-DD/<bundle-id>/draft.review-required.json \
  --bundle data/runs/YYYY-MM-DD/<bundle-id>/analysis-input.json

pnpm draft:import -- \
  --input data/runs/YYYY-MM-DD/<bundle-id>/draft.review-required.json \
  --bundle data/runs/YYYY-MM-DD/<bundle-id>/analysis-input.json
```

`daily:preflight` 是只读操作；当天已有日报时，自动任务必须停止。`draft:validate` 也是只读操作。`draft:import` 仅接受 `review_required`，且只允许首次创建当天日报；它不会覆盖已有人工稿，也不批准、不发布、不部署。

## 不可绕过的门禁

- 日期、时区、覆盖窗口、profile 版本和 run id 必须与候选包一致。
- `must_read` 与 `risk_alerts` 必须来自 24 小时候选；`catch_up` 必须来自 7 天候选。
- 每个正文事件至少引用候选包内的一份原始文档。
- 单来源未核验候选不能在此流程中升级验证等级。
- 补录原因、首次出现时间和最后更新时间必须与候选证据一致。
- 同一事件或条目 id 不能在日报中重复。
- 草稿必须保持 `published_at: null` 和 `revision: null`。

补充网页检索可用于强化分析、宏观脉搏和未来日历；如果未来要凭补充来源升级事件验证等级，应先把该来源采集、归档并关联到事件，而不是只在文稿里改标签。
