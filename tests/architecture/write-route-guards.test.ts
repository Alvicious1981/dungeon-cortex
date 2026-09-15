import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const WRITE = /export\s+(?:async\s+)?function\s+(POST|PATCH|PUT|DELETE)\b/;

function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return routes(full);
    return name === "route.ts" ? [full] : [];
  });
}

/** Write handlers that answer without touching campaign state. */
const CAMPAIGN_EXEMPT = new Set(["app/api/campaign/[id]/encounter/turn/route.ts"]); // 410 Gone

describe("every campaign write route calls the playable guard (death-saves spec §7.2)", () => {
  const files = routes(join(ROOT, "app", "api", "campaign", "[id]"))
    .map((f) => relative(ROOT, f).replace(/\\/g, "/"))
    .filter((f) => WRITE.test(readFileSync(join(ROOT, f), "utf8")));

  it("finds the write routes", () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it.each(files.filter((f) => !CAMPAIGN_EXEMPT.has(f)))("%s", (file) => {
    expect(readFileSync(join(ROOT, file), "utf8")).toContain("campaignPlayableRefusal(");
  });
});
