import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { isDeepStrictEqual } from "node:util";

import {
  parseEdition,
  type Edition,
  type Story,
} from "@morning-signal/contracts";
import type { NewsStore } from "@morning-signal/storage";

const MAX_REQUEST_BYTES = 1_048_576;
const MUTATION_HEADER = "x-morning-signal-request";

export interface DashboardApiRequest {
  method: string;
  url: string;
  body?: unknown;
  mutationAuthorized?: boolean;
}

export interface DashboardApiResponse {
  status: number;
  body: unknown;
}

function storyInvariant(story: Story): object {
  const {
    headline: _headline,
    what_happened: _whatHappened,
    why_it_matters: _whyItMatters,
    new_since_last_summary: _newSinceLastSummary,
    what_to_watch: _whatToWatch,
    impact_label: _impactLabel,
    ...invariant
  } = story;
  return invariant;
}

function editionInvariant(edition: Edition): object {
  const {
    executive_summary: _executiveSummary,
    risk_alerts: _riskAlerts,
    must_read: _mustRead,
    catch_up: _catchUp,
    market_macro_pulse: _marketMacroPulse,
    next_7_days: _next7Days,
    weak_signals: _weakSignals,
    coverage_health: _coverageHealth,
    ...invariant
  } = edition;

  return {
    ...invariant,
    risk_alerts: edition.risk_alerts.map(storyInvariant),
    must_read: edition.must_read.map(storyInvariant),
    catch_up: edition.catch_up.map(storyInvariant),
    market_macro_pulse: edition.market_macro_pulse.map((pulse) => ({
      citations: pulse.citations,
    })),
    next_7_days: edition.next_7_days.map((item) => ({
      citations: item.citations,
    })),
    weak_signals: edition.weak_signals.map((signal) => ({
      citations: signal.citations,
    })),
    coverage_health: {
      status: edition.coverage_health.status,
      sources_checked: edition.coverage_health.sources_checked,
      sources_failed: edition.coverage_health.sources_failed,
    },
  };
}

function errorResponse(status: number, message: string): DashboardApiResponse {
  return { status, body: { error: message } };
}

function dateRoute(
  pathname: string,
): { date: string; action: "detail" | "approve" } | undefined {
  const match = pathname.match(
    /^\/api\/editions\/(\d{4}-\d{2}-\d{2})(\/approve)?$/,
  );
  if (!match?.[1]) {
    return undefined;
  }
  return { date: match[1], action: match[2] ? "approve" : "detail" };
}

function editableStatus(status: Edition["status"]): boolean {
  return status === "review_required" || status === "needs_attention";
}

export async function handleDashboardApiRequest(
  store: NewsStore,
  request: DashboardApiRequest,
): Promise<DashboardApiResponse> {
  const method = request.method.toUpperCase();
  const url = new URL(request.url, "http://127.0.0.1");

  if (method === "GET" && url.pathname === "/api/health") {
    return {
      status: 200,
      body: {
        status: "ok",
        visibility: "local_only",
        automaticPublishEnabled: false,
      },
    };
  }

  if (method === "GET" && url.pathname === "/api/editions") {
    const requestedLimit = Number(url.searchParams.get("limit") ?? 30);
    const limit = Number.isFinite(requestedLimit) ? requestedLimit : 30;
    return {
      status: 200,
      body: { editions: store.repository.listEditions(limit) },
    };
  }

  const route = dateRoute(url.pathname);
  if (!route) {
    return errorResponse(404, "未找到该接口。");
  }

  const current = store.repository.getEditionByDate(route.date);
  if (!current) {
    return errorResponse(404, `没有 ${route.date} 的日报。`);
  }

  if (method === "GET" && route.action === "detail") {
    return { status: 200, body: { edition: current } };
  }

  if (!request.mutationAuthorized) {
    return errorResponse(403, "审核写操作缺少本地 Dashboard 标识。");
  }

  if (method === "PUT" && route.action === "detail") {
    if (!editableStatus(current.status)) {
      return errorResponse(409, "只有待审核或需处理的日报可以修改。");
    }

    let proposed: Edition;
    try {
      proposed = parseEdition(request.body);
    } catch {
      return errorResponse(400, "日报内容不符合数据 Schema。");
    }

    if (proposed.edition_date !== route.date) {
      return errorResponse(400, "请求日期与日报日期不一致。");
    }
    if (
      !isDeepStrictEqual(editionInvariant(current), editionInvariant(proposed))
    ) {
      return errorResponse(
        400,
        "只能修改编辑文字、影响方向、日历内容和覆盖备注；来源与溯源字段不可修改。",
      );
    }

    const saved = store.repository.saveEdition(proposed);
    return { status: 200, body: { edition: saved } };
  }

  if (method === "POST" && route.action === "approve") {
    if (!editableStatus(current.status)) {
      return errorResponse(409, "该日报当前不能批准。");
    }

    const approved = store.repository.saveEdition({
      ...current,
      status: "approved",
      published_at: null,
    });
    store.database
      .prepare(
        `UPDATE runs SET
          status = 'completed', stage = 'approved', completed_at = ?
         WHERE id = ?`,
      )
      .run(new Date().toISOString(), approved.run_id);
    return {
      status: 200,
      body: {
        edition: approved,
        message: "日报已批准，但尚未发布。",
      },
    };
  }

  return errorResponse(405, "该接口不支持此操作。");
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  if (!request.headers["content-type"]?.startsWith("application/json")) {
    throw new Error("UNSUPPORTED_MEDIA_TYPE");
  }

  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += buffer.byteLength;
    if (received > MAX_REQUEST_BYTES) {
      throw new Error("PAYLOAD_TOO_LARGE");
    }
    chunks.push(buffer);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new Error("INVALID_JSON");
  }
}

function sendJson(
  response: ServerResponse,
  result: DashboardApiResponse,
): void {
  const body = JSON.stringify(result.body);
  response.writeHead(result.status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

export function createDashboardApiServer(store: NewsStore) {
  return createServer(async (request, response) => {
    try {
      const method = request.method ?? "GET";
      const mutation = method === "PUT" || method === "POST";
      const body = mutation ? await readJsonBody(request) : undefined;
      const result = await handleDashboardApiRequest(store, {
        method,
        url: request.url ?? "/",
        body,
        mutationAuthorized:
          request.headers[MUTATION_HEADER] === "dashboard-review",
      });
      sendJson(response, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "UNKNOWN";
      const result =
        message === "PAYLOAD_TOO_LARGE"
          ? errorResponse(413, "请求内容过大。")
          : message === "UNSUPPORTED_MEDIA_TYPE"
            ? errorResponse(415, "写操作只接受 JSON。")
            : message === "INVALID_JSON"
              ? errorResponse(400, "请求不是有效 JSON。")
              : errorResponse(500, "本地日报服务发生错误。");
      sendJson(response, result);
    }
  });
}
