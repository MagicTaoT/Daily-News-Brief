import { useEffect, useState } from "react";

import {
  EDITION_STATUS_LABELS,
  type Citation,
  type Edition,
  type EditionStatus,
  type Story,
} from "@morning-signal/contracts";

interface EditionSummary {
  editionId: string;
  editionDate: string;
  profileVersion: number;
  status: EditionStatus;
  generatedAt: string;
  publishedAt: string | null;
  revisionNumber: number;
}

interface AppProps {
  initialEdition?: Edition | null;
  initialEditions?: EditionSummary[];
}

type StoryEdit = Partial<
  Pick<
    Story,
    | "headline"
    | "what_happened"
    | "why_it_matters"
    | "new_since_last_summary"
    | "what_to_watch"
    | "impact_label"
  >
>;

const topicLabels: Record<Story["topic"], string> = {
  mev: "MEV",
  defi: "DeFi",
  crypto_security: "加密安全",
  market_structure: "市场结构",
  ai_finance_crypto: "AI × 金融 × 区块链",
  macro: "宏观",
  regulation: "监管",
  black_swan: "突发事件",
};

const verificationLabels: Record<Story["verification_status"], string> = {
  unverified: "单源待核验",
  multi_source: "多源交叉",
  confirmed: "原始来源确认",
  disputed: "存在争议",
  resolved: "已解决",
};

const impactLabels: Record<Story["impact_label"], string> = {
  positive: "正面",
  negative: "负面",
  mixed: "双向",
  uncertain: "不确定",
};

const directionLabels: Record<
  Edition["market_macro_pulse"][number]["direction"],
  string
> = {
  tightening: "收紧",
  easing: "宽松",
  rising: "上行",
  falling: "下行",
  stable: "稳定",
  mixed: "分化",
};

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

function formatTime(timestamp: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  }).format(new Date(timestamp));
}

function replaceAt<T>(
  items: T[],
  index: number,
  patch: Partial<NoInfer<T>>,
): T[] {
  return items.map((item, itemIndex) =>
    itemIndex === index ? { ...item, ...patch } : item,
  );
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "本地日报服务暂时不可用。");
  }
  return payload;
}

function CitationLinks({ citations }: { citations: Citation[] }) {
  return (
    <div className="citation-list" aria-label="来源">
      {citations.map((citation, index) => (
        <a
          href={citation.url}
          key={`${citation.url}-${index}`}
          rel="noreferrer"
          target="_blank"
        >
          <span>{citation.publisher}</span>
          <small>T{citation.tier} · 原文 ↗</small>
        </a>
      ))}
    </div>
  );
}

function TextEditor({
  label,
  value,
  onChange,
  rows = 4,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
}) {
  return (
    <label className="editor-field">
      <span>{label}</span>
      <textarea
        onChange={(event) => onChange(event.target.value)}
        rows={rows}
        value={value}
      />
    </label>
  );
}

function StoryCard({
  story,
  index,
  editing,
  meta,
  onChange,
}: {
  story: Story;
  index: number;
  editing: boolean;
  meta?: string;
  onChange: (patch: StoryEdit) => void;
}) {
  return (
    <article className="story-card">
      <div className="story-number" aria-hidden="true">
        {String(index + 1).padStart(2, "0")}
      </div>
      <div className="story-content">
        <div className="story-labels">
          <span className={`topic-pill topic-${story.topic}`}>
            {topicLabels[story.topic]}
          </span>
          <span
            className={`verification verification-${story.verification_status}`}
          >
            {verificationLabels[story.verification_status]}
          </span>
          {meta ? <span className="story-meta">{meta}</span> : null}
        </div>

        {editing ? (
          <label className="headline-editor">
            <span>标题</span>
            <input
              onChange={(event) => onChange({ headline: event.target.value })}
              value={story.headline}
            />
          </label>
        ) : (
          <h3>{story.headline}</h3>
        )}

        {editing ? (
          <div className="editor-grid">
            <TextEditor
              label="发生了什么"
              onChange={(value) => onChange({ what_happened: value })}
              value={story.what_happened}
            />
            <TextEditor
              label="为什么重要"
              onChange={(value) => onChange({ why_it_matters: value })}
              value={story.why_it_matters}
            />
            <TextEditor
              label="相对上一期新增"
              onChange={(value) => onChange({ new_since_last_summary: value })}
              value={story.new_since_last_summary}
            />
            <TextEditor
              label="接下来观察"
              onChange={(value) => onChange({ what_to_watch: value })}
              value={story.what_to_watch}
            />
            <label className="editor-field compact-editor">
              <span>影响判断</span>
              <select
                onChange={(event) =>
                  onChange({
                    impact_label: event.target.value as Story["impact_label"],
                  })
                }
                value={story.impact_label}
              >
                {Object.entries(impactLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <>
            <p className="story-lead">{story.what_happened}</p>
            <div className="analysis-grid">
              <div>
                <span>为什么重要</span>
                <p>{story.why_it_matters}</p>
              </div>
              <div>
                <span>接下来观察</span>
                <p>{story.what_to_watch}</p>
              </div>
            </div>
            <details>
              <summary>查看本期新增与判断</summary>
              <p>{story.new_since_last_summary}</p>
              <span className={`impact impact-${story.impact_label}`}>
                影响：{impactLabels[story.impact_label]}
              </span>
            </details>
          </>
        )}

        <CitationLinks citations={story.citations} />
      </div>
    </article>
  );
}

function SectionHeading({
  eyebrow,
  title,
  count,
}: {
  eyebrow: string;
  title: string;
  count: number;
}) {
  return (
    <div className="section-heading">
      <div>
        <span>{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      <strong>{String(count).padStart(2, "0")}</strong>
    </div>
  );
}

function StatusBadge({ status }: { status: EditionStatus }) {
  return (
    <span className={`status-badge status-${status}`}>
      <span aria-hidden="true" />
      {EDITION_STATUS_LABELS[status]}
    </span>
  );
}

export function App({ initialEdition = null, initialEditions = [] }: AppProps) {
  const [editions, setEditions] = useState(initialEditions);
  const [edition, setEdition] = useState<Edition | null>(initialEdition);
  const [draft, setDraft] = useState<Edition | null>(initialEdition);
  const [selectedDate, setSelectedDate] = useState(
    initialEdition?.edition_date ?? "",
  );
  const [dateQuery, setDateQuery] = useState(
    initialEdition?.edition_date ?? "",
  );
  const [loading, setLoading] = useState(initialEdition === null);
  const [editing, setEditing] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshSummaries = async (): Promise<EditionSummary[]> => {
    const response = await apiRequest<{ editions: EditionSummary[] }>(
      "/api/editions?limit=90",
    );
    setEditions(response.editions);
    return response.editions;
  };

  const loadEdition = async (date: string): Promise<void> => {
    setLoading(true);
    setError(null);
    setNotice(null);
    setEditing(false);
    try {
      const response = await apiRequest<{ edition: Edition }>(
        `/api/editions/${date}`,
      );
      setEdition(response.edition);
      setDraft(response.edition);
      setSelectedDate(date);
      setDateQuery(date);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "无法读取该日报。",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialEdition) {
      return;
    }

    const bootstrap = async () => {
      try {
        const summaries = await refreshSummaries();
        const latest = summaries[0];
        if (latest) {
          await loadEdition(latest.editionDate);
        } else {
          setLoading(false);
        }
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "无法连接本地日报服务。",
        );
        setLoading(false);
      }
    };

    void bootstrap();
  }, [initialEdition]);

  const updateDraft = (next: Edition): void => {
    setDraft(next);
    setNotice(null);
  };

  const saveDraft = async (): Promise<void> => {
    if (!draft) {
      return;
    }
    setWorking(true);
    setError(null);
    try {
      const response = await apiRequest<{ edition: Edition }>(
        `/api/editions/${draft.edition_date}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "X-Morning-Signal-Request": "dashboard-review",
          },
          body: JSON.stringify(draft),
        },
      );
      setEdition(response.edition);
      setDraft(response.edition);
      setEditing(false);
      setNotice("修改已保存，日报仍在等待人工审核。");
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "保存修改失败。",
      );
    } finally {
      setWorking(false);
    }
  };

  const approveEdition = async (): Promise<void> => {
    if (!draft) {
      return;
    }
    const confirmed = window.confirm(
      "批准后将锁定本期编辑内容，但不会发布到网站。确认批准？",
    );
    if (!confirmed) {
      return;
    }

    setWorking(true);
    setError(null);
    try {
      const response = await apiRequest<{ edition: Edition; message: string }>(
        `/api/editions/${draft.edition_date}/approve`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Morning-Signal-Request": "dashboard-review",
          },
          body: "{}",
        },
      );
      setEdition(response.edition);
      setDraft(response.edition);
      setEditing(false);
      setNotice(response.message);
      await refreshSummaries();
    } catch (approvalError) {
      setError(
        approvalError instanceof Error ? approvalError.message : "批准失败。",
      );
    } finally {
      setWorking(false);
    }
  };

  const editable =
    draft?.status === "review_required" || draft?.status === "needs_attention";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            MS
          </span>
          <div>
            <strong>Morning Signal</strong>
            <span>晨间信号</span>
          </div>
        </div>
        <div className="topbar-state">
          <span className="live-dot" aria-hidden="true" />
          仅本机可见
          <span className="topbar-divider" />
          自动发布关闭
        </div>
      </header>

      <div className="dashboard-layout">
        <aside className="history-panel">
          <div className="history-intro">
            <span className="eyebrow">ARCHIVE</span>
            <h2>日报历史</h2>
            <p>按日期检索草稿、批准记录与未来修订。</p>
          </div>

          <form
            className="date-search"
            onSubmit={(event) => {
              event.preventDefault();
              if (dateQuery) {
                void loadEdition(dateQuery);
              }
            }}
          >
            <label htmlFor="edition-date">检索日期</label>
            <div>
              <input
                id="edition-date"
                onChange={(event) => setDateQuery(event.target.value)}
                type="date"
                value={dateQuery}
              />
              <button type="submit">查看</button>
            </div>
          </form>

          <nav className="edition-list" aria-label="历史日报">
            {editions.map((summary) => (
              <button
                className={
                  summary.editionDate === selectedDate ? "selected" : ""
                }
                key={summary.editionId}
                onClick={() => void loadEdition(summary.editionDate)}
                type="button"
              >
                <span>{formatDate(summary.editionDate)}</span>
                <small>{EDITION_STATUS_LABELS[summary.status]}</small>
              </button>
            ))}
          </nav>

          <div className="privacy-note">
            <span aria-hidden="true">⌾</span>
            <p>
              数据保存在本机 SQLite。
              <br />
              当前没有公网访问入口。
            </p>
          </div>
        </aside>

        <main className="brief-panel">
          {loading ? (
            <div className="page-state">
              <span className="loading-ring" aria-hidden="true" />
              <h1>正在读取日报</h1>
              <p>从本地数据库加载历史与审核状态。</p>
            </div>
          ) : draft ? (
            <>
              <header className="brief-header">
                <div>
                  <span className="eyebrow">DAILY INTELLIGENCE BRIEF</span>
                  <h1>{formatDate(draft.edition_date)}</h1>
                  <div className="brief-meta">
                    <StatusBadge status={draft.status} />
                    <span>生成于 {formatTime(draft.generated_at)}</span>
                    <span>Profile v{draft.profile_version}</span>
                  </div>
                </div>
                <div className="review-actions">
                  {editing ? (
                    <>
                      <button
                        className="button-secondary"
                        disabled={working}
                        onClick={() => {
                          setDraft(edition);
                          setEditing(false);
                          setError(null);
                        }}
                        type="button"
                      >
                        取消
                      </button>
                      <button
                        className="button-primary"
                        disabled={working}
                        onClick={() => void saveDraft()}
                        type="button"
                      >
                        {working ? "保存中…" : "保存修改"}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="button-secondary"
                        disabled={!editable || working}
                        onClick={() => setEditing(true)}
                        type="button"
                      >
                        编辑内容
                      </button>
                      <button
                        className="button-approve"
                        disabled={!editable || working}
                        onClick={() => void approveEdition()}
                        type="button"
                      >
                        {draft.status === "approved" ? "已批准" : "批准本期"}
                      </button>
                    </>
                  )}
                </div>
              </header>

              {error ? (
                <div className="message message-error">{error}</div>
              ) : null}
              {notice ? (
                <div className="message message-success">{notice}</div>
              ) : null}

              <section
                className="executive-card"
                aria-labelledby="summary-title"
              >
                <div className="summary-kicker">
                  <span>EXECUTIVE SUMMARY</span>
                  <strong>约 8 分钟阅读</strong>
                </div>
                <h2 id="summary-title">今晨判断</h2>
                {editing ? (
                  <TextEditor
                    label="执行摘要"
                    onChange={(value) =>
                      updateDraft({ ...draft, executive_summary: value })
                    }
                    rows={7}
                    value={draft.executive_summary}
                  />
                ) : (
                  <p>{draft.executive_summary}</p>
                )}
                <div className="summary-stats">
                  <div>
                    <strong>{draft.must_read.length}</strong>
                    <span>今日必读</span>
                  </div>
                  <div>
                    <strong>{draft.catch_up.length}</strong>
                    <span>七天补漏</span>
                  </div>
                  <div>
                    <strong>{draft.risk_alerts.length}</strong>
                    <span>风险警报</span>
                  </div>
                  <div>
                    <strong>{draft.next_7_days.length}</strong>
                    <span>未来事件</span>
                  </div>
                </div>
              </section>

              <section className="brief-section">
                <SectionHeading
                  count={draft.risk_alerts.length}
                  eyebrow="RISK RADAR"
                  title="风险雷达"
                />
                {draft.risk_alerts.length === 0 ? (
                  <div className="clear-state">
                    <span aria-hidden="true">✓</span>
                    <div>
                      <h3>本窗口无高等级警报</h3>
                      <p>
                        低等级信号仍保留在来源记录中，不为填版制造风险事件。
                      </p>
                    </div>
                  </div>
                ) : (
                  draft.risk_alerts.map((story, index) => (
                    <StoryCard
                      editing={editing}
                      index={index}
                      key={story.id}
                      meta={`风险等级：${story.severity}`}
                      onChange={(patch) =>
                        updateDraft({
                          ...draft,
                          risk_alerts: replaceAt(
                            draft.risk_alerts,
                            index,
                            patch,
                          ),
                        })
                      }
                      story={story}
                    />
                  ))
                )}
              </section>

              <section className="brief-section">
                <SectionHeading
                  count={draft.must_read.length}
                  eyebrow="MUST READ"
                  title="今日必读"
                />
                <div className="story-stack">
                  {draft.must_read.map((story, index) => (
                    <StoryCard
                      editing={editing}
                      index={index}
                      key={story.id}
                      onChange={(patch) =>
                        updateDraft({
                          ...draft,
                          must_read: replaceAt(draft.must_read, index, patch),
                        })
                      }
                      story={story}
                    />
                  ))}
                </div>
              </section>

              <section className="brief-section catchup-section">
                <SectionHeading
                  count={draft.catch_up.length}
                  eyebrow="7-DAY CATCH-UP"
                  title="过去 7 天补漏"
                />
                <div className="story-stack">
                  {draft.catch_up.map((story, index) => (
                    <StoryCard
                      editing={editing}
                      index={index}
                      key={story.id}
                      meta={`原事件：${story.original_event_date}`}
                      onChange={(patch) =>
                        updateDraft({
                          ...draft,
                          catch_up: replaceAt(draft.catch_up, index, patch),
                        })
                      }
                      story={story}
                    />
                  ))}
                </div>
              </section>

              <section className="brief-section">
                <SectionHeading
                  count={draft.market_macro_pulse.length}
                  eyebrow="MARKET & MACRO"
                  title="市场与宏观脉搏"
                />
                <div className="pulse-grid">
                  {draft.market_macro_pulse.map((pulse, index) => (
                    <article
                      className="pulse-card"
                      key={`${pulse.name}-${index}`}
                    >
                      {editing ? (
                        <>
                          <label className="headline-editor compact-headline">
                            <span>指标名称</span>
                            <input
                              onChange={(event) =>
                                updateDraft({
                                  ...draft,
                                  market_macro_pulse: replaceAt(
                                    draft.market_macro_pulse,
                                    index,
                                    { name: event.target.value },
                                  ),
                                })
                              }
                              value={pulse.name}
                            />
                          </label>
                          <label className="editor-field compact-editor">
                            <span>方向</span>
                            <select
                              onChange={(event) =>
                                updateDraft({
                                  ...draft,
                                  market_macro_pulse: replaceAt(
                                    draft.market_macro_pulse,
                                    index,
                                    {
                                      direction: event.target
                                        .value as typeof pulse.direction,
                                    },
                                  ),
                                })
                              }
                              value={pulse.direction}
                            >
                              {Object.entries(directionLabels).map(
                                ([value, label]) => (
                                  <option key={value} value={value}>
                                    {label}
                                  </option>
                                ),
                              )}
                            </select>
                          </label>
                          <TextEditor
                            label="解释"
                            onChange={(value) =>
                              updateDraft({
                                ...draft,
                                market_macro_pulse: replaceAt(
                                  draft.market_macro_pulse,
                                  index,
                                  { explanation: value },
                                ),
                              })
                            }
                            value={pulse.explanation}
                          />
                        </>
                      ) : (
                        <>
                          <span
                            className={`direction direction-${pulse.direction}`}
                          >
                            {directionLabels[pulse.direction]}
                          </span>
                          <h3>{pulse.name}</h3>
                          <p>{pulse.explanation}</p>
                        </>
                      )}
                      <CitationLinks citations={pulse.citations} />
                    </article>
                  ))}
                </div>
              </section>

              <section className="brief-section">
                <SectionHeading
                  count={draft.next_7_days.length}
                  eyebrow="FORWARD CALENDAR"
                  title="未来 7 天"
                />
                <div className="calendar-list">
                  {draft.next_7_days.map((item, index) => (
                    <article
                      className="calendar-item"
                      key={`${item.date}-${index}`}
                    >
                      {editing ? (
                        <div className="calendar-editor">
                          <label className="editor-field compact-editor">
                            <span>日期</span>
                            <input
                              onChange={(event) =>
                                updateDraft({
                                  ...draft,
                                  next_7_days: replaceAt(
                                    draft.next_7_days,
                                    index,
                                    { date: event.target.value },
                                  ),
                                })
                              }
                              type="date"
                              value={item.date}
                            />
                          </label>
                          <label className="headline-editor compact-headline">
                            <span>事件</span>
                            <input
                              onChange={(event) =>
                                updateDraft({
                                  ...draft,
                                  next_7_days: replaceAt(
                                    draft.next_7_days,
                                    index,
                                    { title: event.target.value },
                                  ),
                                })
                              }
                              value={item.title}
                            />
                          </label>
                          <TextEditor
                            label="为什么关注"
                            onChange={(value) =>
                              updateDraft({
                                ...draft,
                                next_7_days: replaceAt(
                                  draft.next_7_days,
                                  index,
                                  { why_watch: value },
                                ),
                              })
                            }
                            value={item.why_watch}
                          />
                        </div>
                      ) : (
                        <>
                          <time dateTime={item.date}>
                            <strong>{item.date.slice(8, 10)}</strong>
                            <span>{item.date.slice(5, 7)}月</span>
                          </time>
                          <div>
                            <span className="calendar-topic">{item.topic}</span>
                            <h3>{item.title}</h3>
                            <p>{item.why_watch}</p>
                          </div>
                        </>
                      )}
                      <CitationLinks citations={item.citations} />
                    </article>
                  ))}
                </div>
              </section>

              <section className="brief-section">
                <SectionHeading
                  count={draft.weak_signals.length}
                  eyebrow="WEAK SIGNALS"
                  title="值得追踪的弱信号"
                />
                <div className="signal-stack">
                  {draft.weak_signals.map((signal, index) => (
                    <article
                      className="signal-card"
                      key={`${signal.title}-${index}`}
                    >
                      <span className="signal-mark" aria-hidden="true">
                        ?
                      </span>
                      <div>
                        {editing ? (
                          <>
                            <label className="headline-editor compact-headline">
                              <span>信号标题</span>
                              <input
                                onChange={(event) =>
                                  updateDraft({
                                    ...draft,
                                    weak_signals: replaceAt(
                                      draft.weak_signals,
                                      index,
                                      { title: event.target.value },
                                    ),
                                  })
                                }
                                value={signal.title}
                              />
                            </label>
                            {(
                              [
                                ["evidence", "证据"],
                                ["uncertainty", "不确定性"],
                                ["what_would_confirm", "确认条件"],
                              ] as const
                            ).map(([field, label]) => (
                              <TextEditor
                                key={field}
                                label={label}
                                onChange={(value) =>
                                  updateDraft({
                                    ...draft,
                                    weak_signals: replaceAt(
                                      draft.weak_signals,
                                      index,
                                      { [field]: value },
                                    ),
                                  })
                                }
                                value={signal[field]}
                              />
                            ))}
                          </>
                        ) : (
                          <>
                            <h3>{signal.title}</h3>
                            <p>{signal.evidence}</p>
                            <div className="signal-conditions">
                              <p>
                                <strong>不确定性</strong>
                                {signal.uncertainty}
                              </p>
                              <p>
                                <strong>确认条件</strong>
                                {signal.what_would_confirm}
                              </p>
                            </div>
                          </>
                        )}
                        <CitationLinks citations={signal.citations} />
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <section className="coverage-card">
                <div>
                  <span
                    className={`coverage-dot coverage-${draft.coverage_health.status}`}
                  />
                  <div>
                    <span>覆盖健康</span>
                    <strong>
                      {draft.coverage_health.status === "complete"
                        ? "完整"
                        : draft.coverage_health.status === "partial"
                          ? "部分覆盖"
                          : "覆盖降级"}
                    </strong>
                  </div>
                </div>
                <p>
                  已检查 {draft.coverage_health.sources_checked} 个来源 · 失败{" "}
                  {draft.coverage_health.sources_failed} 个
                </p>
                {editing ? (
                  <div className="coverage-editors">
                    {draft.coverage_health.notes.map((note, index) => (
                      <TextEditor
                        key={index}
                        label={`覆盖备注 ${index + 1}`}
                        onChange={(value) =>
                          updateDraft({
                            ...draft,
                            coverage_health: {
                              ...draft.coverage_health,
                              notes: replaceAt(
                                draft.coverage_health.notes,
                                index,
                                value,
                              ),
                            },
                          })
                        }
                        rows={2}
                        value={note}
                      />
                    ))}
                  </div>
                ) : (
                  <ul>
                    {draft.coverage_health.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                )}
              </section>

              <footer className="brief-footer">
                <span>Morning Signal · Personal Research System</span>
                <span>批准 ≠ 发布 · 所有来源均可追溯</span>
              </footer>
            </>
          ) : (
            <div className="page-state">
              <span className="empty-mark" aria-hidden="true">
                —
              </span>
              <h1>{error ? "暂时无法读取日报" : "还没有日报"}</h1>
              <p>{error ?? "完成采集和分析后，草稿会出现在这里。"}</p>
              <button
                className="button-secondary"
                onClick={() => window.location.reload()}
                type="button"
              >
                重新连接
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
