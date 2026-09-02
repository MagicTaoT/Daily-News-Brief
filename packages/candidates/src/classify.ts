import type {
  ProfileConfig,
  RankingSignals,
  Topic,
} from "@morning-signal/contracts";
import type { AnalysisDocument } from "@morning-signal/storage";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

const TOPIC_KEYWORDS: Record<Topic, string[]> = {
  mev: [
    "mev",
    "builder",
    "relay",
    "order flow",
    "orderflow",
    "solver",
    "intent",
    "sequencer",
    "preconfirmation",
    "mempool",
    "arbitrage bot",
  ],
  defi: [
    "defi",
    "stablecoin",
    "lending",
    "liquidation",
    "dex",
    "liquidity pool",
    "aave",
    "uniswap",
    "bridge",
    "lst",
    "lrt",
    "rwa",
  ],
  crypto_security: [
    "exploit",
    "hack",
    "vulnerability",
    "security",
    "oracle manipulation",
    "governance attack",
    "depeg",
    "chain halt",
    "client bug",
  ],
  market_structure: [
    "market structure",
    "market depth",
    "custody",
    "clearing",
    "settlement",
    "crypto exchange",
    "exchange act",
    "etf",
    "funding rate",
    "basis",
    "24-hour trading",
    "transfer agent",
  ],
  ai_finance_crypto: [
    "agent",
    "artificial intelligence",
    " ai ",
    "wallet permission",
    "verifiable inference",
    "zkml",
    "trusted execution environment",
    "decentralized compute",
  ],
  macro: [
    "monetary policy",
    "inflation",
    "employment",
    "central bank",
    "interest rate",
    "fiscal",
    "treasury",
    "sovereign debt",
    "repo",
    "credit conditions",
    "commodity",
    "energy",
  ],
  regulation: [
    "regulation",
    "regulatory",
    "digital asset",
    "crypto asset",
    "blockchain",
    "enforcement",
    "litigation",
    "rule",
    "licensing",
    "tax",
  ],
  black_swan: [
    "war",
    "earthquake",
    "flood",
    "forest fire",
    "wildfire",
    "cyclone",
    "hurricane",
    "tsunami",
    "volcano",
    "drought",
    "emergency",
    "outage",
    "sanction",
    "shipping disruption",
  ],
};

function normalized(value: string): string {
  return ` ${value.normalize("NFKC").toLocaleLowerCase()} `;
}

function keywordScore(text: string, keyword: string): number {
  const escaped = keyword.trim().toLocaleLowerCase();
  if (!escaped) {
    return 0;
  }

  const matched = /^[a-z0-9]+$/u.test(escaped)
    ? new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "u").test(text)
    : text.includes(escaped);
  if (!matched) {
    return 0;
  }
  return escaped.includes(" ") ? 2 : 1;
}

function keywordsForTopic(topic: Topic, profile: ProfileConfig): string[] {
  const configured =
    profile.topics.find((candidate) => candidate.id === topic)?.include ?? [];
  return [...TOPIC_KEYWORDS[topic], ...configured];
}

export function topicEvidenceScore(
  topic: Topic,
  title: string,
  body: string,
  profile: ProfileConfig,
): number {
  const normalizedTitle = normalized(title);
  const normalizedBody = normalized(body.slice(0, 4_000));
  return keywordsForTopic(topic, profile).reduce(
    (total, keyword) =>
      total +
      keywordScore(normalizedTitle, keyword) * 3 +
      keywordScore(normalizedBody, keyword),
    0,
  );
}

export function classifyTopic(
  document: AnalysisDocument,
  profile: ProfileConfig,
): Topic {
  const title = normalized(document.title);
  const body = normalized(document.body);
  const allowedTopics =
    document.sourceTopics.length > 0
      ? document.sourceTopics
      : profile.topics.map((topic) => topic.id);
  let bestTopic = allowedTopics[0] ?? "black_swan";
  let bestScore = -1;

  for (const topic of allowedTopics) {
    const score = topicEvidenceScore(topic, title, body, profile);
    if (score > bestScore) {
      bestTopic = topic;
      bestScore = score;
    }
  }

  return bestTopic;
}

export function normalizeTitle(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/^\[[^\]]{1,40}\]\s*/u, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function titleTokens(value: string): Set<string> {
  const normalizedTitle = normalizeTitle(value);
  const tokens = new Set(
    (normalizedTitle.match(/[a-z0-9]+/gu) ?? []).filter(
      (token) => token.length > 1 && !STOP_WORDS.has(token),
    ),
  );

  for (const sequence of normalizedTitle.match(/\p{Script=Han}+/gu) ?? []) {
    if (sequence.length === 1) {
      tokens.add(sequence);
    } else {
      for (let index = 0; index < sequence.length - 1; index += 1) {
        tokens.add(sequence.slice(index, index + 2));
      }
    }
  }

  return tokens;
}

export function titleSimilarity(left: string, right: string): number {
  const leftTokens = titleTokens(left);
  const rightTokens = titleTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  const intersection = [...leftTokens].filter((token) =>
    rightTokens.has(token),
  ).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return intersection / union;
}

export function sharedTitleTokenCount(left: string, right: string): number {
  const leftTokens = titleTokens(left);
  const rightTokens = titleTokens(right);
  return [...leftTokens].filter((token) => rightTokens.has(token)).length;
}

function includesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function inferSeverity(
  headline: string,
  _body: string,
  topic: Topic,
): "critical" | "high" | "watch" | null {
  const text = headline;
  if (
    includesAny(text, [
      /\bred alert\b/iu,
      /\bcritical (?:outage|vulnerability|incident)\b/iu,
      /\bchain halt(?:ed)?\b/iu,
      /\bstablecoin.{0,30}\bdepeg/iu,
      /\b(?:war|invasion) (?:declared|began|starts?)\b/iu,
    ])
  ) {
    return "critical";
  }
  if (
    includesAny(text, [
      /\borange alert\b/iu,
      /\bexploit(?:ed)?\b/iu,
      /\bhack(?:ed)?\b/iu,
      /\bemergency\b/iu,
      /magnitude\s*[67-9](?:\.\d+)?/iu,
    ])
  ) {
    return "high";
  }
  return topic === "black_swan" || topic === "crypto_security" ? "watch" : null;
}

function rounded(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function rankingSignals(
  topic: Topic,
  headline: string,
  body: string,
  tiers: number[],
  independentSources: number,
  sourceTopicBreadth: number,
  previouslyPublished: boolean,
  profile: ProfileConfig,
): { signals: RankingSignals; priority: number } {
  const text = headline;
  const greenAlert = /^green\b/iu.test(headline);
  const urgent = includesAny(text, [
    /\bexploit/iu,
    /\bhack/iu,
    /\bemergency/iu,
    /\bdepeg/iu,
    /\bhalt/iu,
    /\bred alert/iu,
    /\borange alert/iu,
    /\bwar\b/iu,
  ]);
  const structurallyRelevant = includesAny(text, [
    /\bproposal/iu,
    /\bgovernance/iu,
    /\brelease/iu,
    /\brule/iu,
    /\bpolicy/iu,
    /\bsettlement/iu,
    /\bliquidity/iu,
  ]);
  const topicWeight =
    profile.topics.find((candidate) => candidate.id === topic)?.weight ?? 0.5;
  const evidenceScore = topicEvidenceScore(topic, headline, body, profile);
  const evidenceFactor =
    evidenceScore >= 3
      ? 1
      : evidenceScore > 0
        ? 0.8
        : sourceTopicBreadth === 1
          ? 0.65
          : 0.25;
  const bestTier = Math.min(...tiers);
  const confidence =
    bestTier === 1
      ? 0.95
      : independentSources >= 2
        ? 0.8
        : bestTier === 2
          ? 0.68
          : bestTier === 3
            ? 0.38
            : 0.2;
  const signals: RankingSignals = {
    relevance: rounded(topicWeight * evidenceFactor),
    impact: greenAlert
      ? 0.1
      : /\b(?:letter|weekly|roundup|development update)\b/iu.test(headline)
        ? 0.38
        : urgent
          ? 0.9
          : structurallyRelevant
            ? 0.62
            : 0.45,
    novelty: previouslyPublished ? 0.2 : 1,
    confidence,
    urgency: greenAlert
      ? 0.1
      : /\b(?:letter|weekly|roundup|development update)\b/iu.test(headline)
        ? 0.3
        : urgent
          ? 0.92
          : 0.45,
  };
  const factorWeights = profile.ranking.factors;
  const weighted = (
    ["relevance", "impact", "novelty", "confidence", "urgency"] as const
  ).map((factor) => ({
    score: Math.max(signals[factor], 0.01),
    weight: factorWeights[factor],
  }));
  const totalWeight = weighted.reduce((total, item) => total + item.weight, 0);
  const priority = Math.exp(
    weighted.reduce(
      (total, item) => total + Math.log(item.score) * item.weight,
      0,
    ) / totalWeight,
  );

  return { signals, priority: rounded(priority) };
}
