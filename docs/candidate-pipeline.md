# 事件候选与分析输入

Task 4 将本地原文转换成供 Codex 审阅的结构化候选包。它是确定性的预分析层，不负责撰写
最终新闻结论，也不会生成或发布日报。

## 输出

运行：

```bash
pnpm candidates:prepare -- --date 2026-09-02
```

会同时生成：

- SQLite 中的 `events`、`event_documents` 和 `event_updates`；
- SQLite 中不可变的 `analysis_bundles` 审计记录；
- `data/runs/<edition-date>/<bundle-id>/analysis-input.json` 文件。

候选包通过共享 Zod Schema 校验，包含：

- 精确到时区的过去 24 小时和 7 天补漏窗口；
- 当前窗口候选和补漏候选；
- 每个事件的原文、来源 Tier、验证状态种子和内部排序信号；
- 被规则抑制的低严重度、低相关性或已经发布的事件；
- 来源覆盖健康度和可行动的缺失说明。

## 时间窗口

窗口以 `config/profile.yaml` 的 `timezone` 和 `edition.publish_time` 计算，而不是简单使用
UTC 日期。`America/Los_Angeles` 的夏令时和冬令时偏移均有测试覆盖。

```text
current_start = edition_date 07:00 local - 24 hours
end           = edition_date 07:00 local
catchup_start = end - 7 days
```

某个旧事件只要在当前窗口出现新原文，其 `last_updated_at` 会让它重新进入 24 小时候选。
7 天补漏仅接收窗口内尚未出现在以前正式日报中的事件。

## 保守聚类

系统以事件而非文章为单位，但宁可暂时保留两个候选，也不做高风险误合并：

1. 已有关联 `event_id` 的原文始终回到原事件；
2. 标题规范化后完全一致且相隔不超过 72 小时，可以合并；
3. 模糊标题只在不同来源、主题一致、共享至少 3 个有效词项、Jaccard 相似度不低于
   `0.68` 且相隔不超过 72 小时时合并；
4. 同一来源的模板化标题不做模糊合并。例如不同国家的 GDACS 火灾提醒不会混为一件事；
5. 重复执行会沿用现有事件 ID，不重复添加 `event_updates`。

## 主题、可信度与排序信号

主题分类只允许落在来源配置声明的主题范围内，再结合个人 Profile 关键词选择。宽泛来源若正文
没有足够领域关键词，会以 `low_relevance` 留在抑制清单中，而不是污染主要候选。

验证状态是给 Codex 的起始判断：

- 有 Tier 1 原始/权威来源：`confirmed`；
- 至少两个不同来源且没有 Tier 1：`multi_source`；
- 其他情况：`unverified`。

这不是最终事实判断。Codex 仍需打开原始链接、识别来源是否真正独立并处理冲突。

内部排序使用产品规格中的 relevance、impact、novelty、confidence、urgency 五个信号及 Profile
权重。数字只存在于机器输入和审核工具中，不直接向日报读者展示。摘要、周报和开发更新类标题
不会因为正文提到高风险词而自动获得高紧迫度。

## 明确限制

- 当前规则不具备真正的语义理解，可能漏合并措辞差异很大的同一事件；
- 没有对实体、金额、链上地址和宏观数据数值做结构化提取；
- Feed 摘要可能不足以支持最终结论，核心候选必须继续补查原始页面；
- `analysis-input.json` 只是下一阶段 Codex 分析的输入，不是可发布日报。
