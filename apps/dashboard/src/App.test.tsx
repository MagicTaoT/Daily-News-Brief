import { parseEdition } from "@morning-signal/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import exampleEdition from "../../../examples/edition.example.json";
import { App } from "./App";

describe("Dashboard review experience", () => {
  it("renders a persisted edition with history and review actions", () => {
    const edition = parseEdition(exampleEdition);
    const markup = renderToStaticMarkup(
      <App
        initialEdition={edition}
        initialEditions={[
          {
            editionId: edition.edition_id,
            editionDate: edition.edition_date,
            profileVersion: edition.profile_version,
            status: edition.status,
            generatedAt: edition.generated_at,
            publishedAt: edition.published_at,
            revisionNumber: 1,
          },
        ]}
      />,
    );

    expect(markup).toContain("仅本机可见");
    expect(markup).toContain("等待人工审核");
    expect(markup).toContain("批准本期");
    expect(markup).toContain("风险雷达");
    expect(markup).toContain("过去 7 天补漏");
    expect(markup).toContain("示例：订单流市场设计出现新的公开数据");
    expect(markup).toContain("所有来源均可追溯");
  });

  it("renders published editions without local review controls in public mode", () => {
    const edition = parseEdition({
      ...exampleEdition,
      status: "published",
      published_at: "2026-09-01T14:15:00Z",
    });
    const markup = renderToStaticMarkup(
      <App
        initialEdition={edition}
        initialEditions={[
          {
            editionId: edition.edition_id,
            editionDate: edition.edition_date,
            profileVersion: edition.profile_version,
            status: edition.status,
            generatedAt: edition.generated_at,
            publishedAt: edition.published_at,
            revisionNumber: 1,
          },
        ]}
        publicMode
      />,
    );

    expect(markup).toContain("公网只读");
    expect(markup).toContain("每日自动更新");
    expect(markup).toContain("原始采集与数据库不公开");
    expect(markup).toContain("自动发布 · 所有来源均可追溯");
    expect(markup).not.toContain("编辑内容");
    expect(markup).not.toContain("批准本期");
  });
});
