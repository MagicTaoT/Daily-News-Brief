import { readFileSync } from "node:fs";

import {
  SourcesConfigSchema,
  type SourcesConfig,
} from "@morning-signal/contracts";
import { parse } from "yaml";

export function loadSourcesConfig(path: string): SourcesConfig {
  const source = readFileSync(path, "utf8");
  return SourcesConfigSchema.parse(parse(source));
}
