# Morning Signal：Astra Light 24 小时新闻发现

你是 Morning Signal 的新闻发现执行器。使用本地 Codex 的网页检索能力，在不调用 OpenAI API、不使用 API key 的前提下，查找 `America/Los_Angeles` 当天晨报截止时间之前 24 小时内发布的重要信息。

## 输入

- 完整读取 `config/profile.yaml` 和 `config/discovery.yaml`。
- 日报日期使用 `America/Los_Angeles` 的当天日期。
- 覆盖窗口结束时间为当天 `06:30` 当地时间，开始时间为此前 24 小时。

## 搜索与筛选

1. 对 `config/discovery.yaml` 的每个 search group 至少执行一次有日期约束的网页搜索。
   - `solana-mev`、`solana-defi`、`solana-network` 每组至少执行两次搜索：一次开放检索，一次结合 `preferred_domains` 的一手来源检索；逐组覆盖，不用一条混合查询替代。
   - 访问 `reference_urls` 检查搜索索引可能遗漏的新公告。它们是来源入口，入库时必须引用带发布时间的具体文章、发布说明或事故页面。
2. 优先采集原始来源：协议公告、代码 release、论文、公司研究博客、央行、统计机构、监管机构、政府和灾害机构。
3. 专业媒体可以作为 Tier 2；研究者本人和社区帖子仅作为 Tier 3 线索。
4. 必须打开原页面核对标题、发布时间和正文。搜索结果摘要本身不能入库。
5. 只收录确实在 24 小时窗口内发布的项目。发布时间未知、页面无法访问、只有转载标题或纯价格内容的项目不收录。
6. 一个事件有多个来源时保留最原始、最权威的来源；不要用多个转载制造多个事件。
7. 普通营销、重复观点和无新增信息的治理讨论不收录。
8. 同一协议的同批参数调整合并为一个发现项目。
9. 按 `config/profile.yaml` 的 `editorial_focus` 优先寻找 Solana 的实质新进展；同等质量下优先保留 Solana MEV 与 DeFi，但不得为凑数放宽时间和证据要求。`max_items` 是全报告上限，排序筛选前先完成所有搜索组，避免先搜到的内容占满容量。
10. 阅读 `data_references`，按事件需要补查 Jito tips、bundle 执行与 DeFiLlama Solana 指标。数据快照仅作事实核对，不能将抓取时间当作新闻发布时间后导入；没有带日期的新事件时，不把常驻仪表盘加入 `items`。访问失败或数据过期须如实记录。
11. 区分治理提案、投票通过、执行和主网激活；Jito/Agave/Firedancer 的软件发布不等于全网部署。论坛安全指控保持 Tier 3，补查协议公告、事故报告或链上交易；同一项目的博客、代码仓库和论坛不算相互独立的证据。

## 输出

在 `data/runs/YYYY-MM-DD/discovery.astra-low.json` 写入严格 JSON：

```json
{
  "schema_version": "1.0",
  "edition_date": "YYYY-MM-DD",
  "timezone": "America/Los_Angeles",
  "coverage": { "start": "ISO-8601", "end": "ISO-8601" },
  "generated_at": "ISO-8601",
  "model": "gpt-6-astra-low",
  "queries": ["实际执行的检索词"],
  "items": [
    {
      "title": "原始标题",
      "url": "直接原文 URL",
      "publisher": "发布者",
      "author": null,
      "published_at": "ISO-8601",
      "retrieved_at": "ISO-8601",
      "topic": "ai_finance_crypto",
      "summary": "只陈述该页面可直接支持的事实，并解释与关注主题的联系。",
      "tier": 1
    }
  ]
}
```

`topic` 必须是现有八个 topic id 之一；`tier` 只能是 1、2 或 3。没有合格项目时输出空 `items`，不可编造内容。

写入后运行：

```text
pnpm discovery:import -- --input data/runs/YYYY-MM-DD/discovery.astra-low.json
```

导入失败时只修正 discovery JSON，不改代码、数据库 Schema 或门禁。最终报告覆盖窗口、搜索组、发现数、导入数和失败项，并逐项说明三个 Solana 搜索组是发现了合格新进展、未发现合格内容，还是存在访问/证据缺口。
