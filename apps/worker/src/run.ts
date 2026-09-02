import { parseEdition, type Edition } from "@morning-signal/contracts";

export const WORKER_VERSION = "0.1.0";

export interface WorkerHealth {
  component: "worker";
  status: "ok";
  version: string;
  executionBackend: "codex_local_automation";
  automaticPublishEnabled: false;
}

export function getWorkerHealth(): WorkerHealth {
  return {
    component: "worker",
    status: "ok",
    version: WORKER_VERSION,
    executionBackend: "codex_local_automation",
    automaticPublishEnabled: false,
  };
}

function previousDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

export function createDryRunEdition(date: string): Edition {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid edition date: ${date}`);
  }

  const edition: Edition = {
    schema_version: "1.0",
    edition_id: `${date}-daniel-default-v1`,
    edition_date: date,
    timezone: "America/Los_Angeles",
    coverage: {
      start: `${previousDate(date, 1)}T07:00:00-07:00`,
      end: `${date}T07:00:00-07:00`,
      catchup_start: `${previousDate(date, 7)}T07:00:00-07:00`,
    },
    profile_version: 1,
    status: "review_required",
    generated_at: new Date().toISOString(),
    published_at: null,
    run_id: `dry-run-${date}`,
    executive_summary: "Task 1 dry-run：采集与分析尚未启用。",
    risk_alerts: [],
    must_read: [],
    catch_up: [],
    market_macro_pulse: [],
    next_7_days: [],
    weak_signals: [],
    coverage_health: {
      status: "partial",
      sources_checked: 0,
      sources_failed: 0,
      notes: ["Task 1 scaffold dry-run; no sources were queried."],
    },
    revision: null,
  };

  return parseEdition(edition);
}
