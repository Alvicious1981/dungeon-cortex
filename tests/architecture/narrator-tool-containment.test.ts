/**
 * tests/architecture/narrator-tool-containment.test.ts
 *
 * SEC-AI-001 PR2 — source-level guardrails for tool containment and the common
 * result contract. These complement the behavioural tests by preventing the
 * old patterns from being reintroduced.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACTIVE_NARRATOR_TOOL_NAMES,
  UNAVAILABLE_NARRATOR_TOOL_NAMES,
} from "@/lib/ai/tool-policy";

const toolsDir = join(process.cwd(), "lib", "ai", "tools");
const toolFiles = readdirSync(toolsDir).filter((file) => file.endsWith(".ts"));
const narratorSource = readFileSync(join(process.cwd(), "lib", "ai", "narrator.ts"), "utf8");
const policySource = readFileSync(join(process.cwd(), "lib", "ai", "tool-policy.ts"), "utf8");

function readTool(file: string): string {
  return readFileSync(join(toolsDir, file), "utf8");
}

describe("narrator physical tool containment", () => {
  it("passes one physically projected tools object to streamText", () => {
    const occurrences = narratorSource.match(/\btools\s*:/g) ?? [];
    expect(occurrences).toHaveLength(1);
    expect(narratorSource).toContain("tools: buildNarratorTools(campaignId)");
  });

  it("derives the model tool object from the typed policy projection", () => {
    expect(narratorSource).toContain(
      "satisfies Record<ActiveNarratorToolName, unknown>",
    );
    expect(narratorSource).toContain(
      "return selectActiveNarratorTools(toolCatalogue)",
    );
    expect(policySource).toContain(
      "const TTools extends NarratorToolCatalogue",
    );

    for (const name of [
      "getSpellInfo",
      "getItemInfo",
      "getEquipmentInfo",
      "getMonsterInfo",
    ]) {
      expect(policySource).toMatch(new RegExp(`\\b${name}\\b`));
    }

    expect(ACTIVE_NARRATOR_TOOL_NAMES).not.toContain("getMundaneLoot");
    expect(narratorSource).not.toContain("executeTrade");
    expect(narratorSource).not.toContain("buildProgressionTools");
    expect(narratorSource).not.toContain("buildCombatTools");
  });
  it("does not use activeTools, prepareStep, or mutation callbacks", () => {
    expect(narratorSource).not.toMatch(/\bactiveTools\s*:/);
    expect(narratorSource).not.toContain("prepareStep");
    expect(narratorSource).not.toContain("onLevelUp:");
    expect(narratorSource).not.toContain("onMerchantGenerated:");
  });

  it("keeps the policy module free of runtime inputs and I/O", () => {
    expect(policySource).toMatch(/getActiveNarratorToolNames\s*\(\s*\)\s*:/);
    expect(policySource).not.toMatch(/\bimport\s+.*\bfrom\b/);
    expect(policySource).not.toMatch(/\bprisma\b/);
    expect(policySource).toContain("Object.freeze");
  });

  it("catalogues every implemented non-SRD tool as unavailable", () => {
    const declaredNames = toolFiles
      .filter((file) => !["srd-lookup.ts", "wilderness.ts"].includes(file))
      .flatMap((file) => Array.from(
        readTool(file).matchAll(/^\s{4}([A-Za-z][A-Za-z0-9]*): tool\(\{/gm),
        (match) => match[1]!,
      ));
    declaredNames.push("executeTravelWatch");

    expect([...UNAVAILABLE_NARRATOR_TOOL_NAMES].sort()).toEqual(declaredNames.sort());
  });
});

describe("common tool-result contract", () => {
  it("registers every tool file for inspection", () => {
    expect(toolFiles.sort()).toEqual([
      "combat.ts",
      "exploration.ts",
      "inventory.ts",
      "progression.ts",
      "social.ts",
      "srd-lookup.ts",
      "wilderness.ts",
      "world.ts",
    ]);
  });

  it.each(toolFiles)("%s contains no ad-hoc JSON serialisation", (file) => {
    expect(readTool(file)).not.toMatch(/\bJSON\.stringify\s*\(/);
  });

  it.each(toolFiles)("%s routes every execute through the shared contract", (file) => {
    const source = readTool(file);
    const executeCount = (source.match(/execute:\s*async/g) ?? []).length;
    const wrapperCount = (source.match(/\b(?:runTool|runLookup)\s*\(/g) ?? []).length;

    expect(executeCount).toBeGreaterThan(0);
    expect(wrapperCount).toBe(executeCount);
    expect(source).toMatch(/from\s*["']@\/lib\/ai\/tool-result["']/);
  });

  it.each(toolFiles)("%s never propagates an exception message or detail", (file) => {
    const source = readTool(file);

    expect(source).not.toMatch(/\berror\.message\b/);
    expect(source).not.toMatch(/\berr\.message\b/);
    expect(source).not.toMatch(/instanceof Error\s*\?\s*\w+\.message/);
    expect(source).not.toMatch(/\bdetail\s*:/);
    expect(source).not.toMatch(/\.stack\b/);
  });

  it.each(toolFiles)("%s does not throw out of an execute body", (file) => {
    // Tool bodies must classify, not rethrow.
    const executeBodies = readTool(file).split(/execute:\s*async/).slice(1);

    for (const body of executeBodies) {
      const untilNextTool = body.split(/\n {4}\w+: tool\(\{/)[0] ?? "";
      expect(untilNextTool).not.toMatch(/^\s*throw\b/m);
    }
  });
});
