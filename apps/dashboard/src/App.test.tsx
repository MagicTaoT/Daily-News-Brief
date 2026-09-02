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
});
