import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  ProfileConfigSchema,
  type ProfileConfig,
} from "@morning-signal/contracts";
import { parse } from "yaml";

export interface LoadedProfile {
  config: ProfileConfig;
  raw: string;
  hash: string;
}

export function loadProfile(path: string): LoadedProfile {
  const raw = readFileSync(path, "utf8");
  return {
    config: ProfileConfigSchema.parse(parse(raw)),
    raw,
    hash: `sha256:${createHash("sha256").update(raw).digest("hex")}`,
  };
}
