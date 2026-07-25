import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const socialToolPath = join(process.cwd(), "lib", "ai", "tools", "social.ts");
const socialToolSource = readFileSync(socialToolPath, "utf8");

function extractExecuteTradeSource(source: string): string {
  const start = source.indexOf("executeTrade: tool({");
  if (start === -1) return "";

  const end = source.indexOf("\n    }),\n  };", start);
  return end === -1 ? source.slice(start) : source.slice(start, end);
}

describe("AI tools architecture: executeTrade must not own trade persistence", () => {
  const executeTradeSource = extractExecuteTradeSource(socialToolSource);

  it("does not import prisma into the social AI tool", () => {
    expect(socialToolSource).not.toMatch(
      /import\s*{\s*prisma\s*}\s*from\s*["']@\/lib\/db\/prisma["']/
    );
  });

  it("contains the executeTrade tool under test", () => {
    expect(executeTradeSource).toContain("executeTrade");
  });

  it("delegates executeTrade to the authoritative trade service", () => {
    expect(socialToolSource).toMatch(
      /import\s*{[^}]*\bresolveTradeTransaction\b[^}]*}\s*from\s*["']@\/lib\/rules\/trade-service["']/
    );
    expect(executeTradeSource).toMatch(/\bresolveTradeTransaction\s*\(/);
  });

  it("does not call prisma.$transaction directly from executeTrade", () => {
    expect(executeTradeSource).not.toMatch(/\bprisma\.\$transaction\s*\(/);
  });

  it("does not update campaign gold directly from executeTrade", () => {
    expect(executeTradeSource).not.toMatch(/\btx\.campaign\.update\s*\(/);
  });

  it("does not create inventory items directly from executeTrade", () => {
    expect(executeTradeSource).not.toMatch(/\btx\.inventoryItem\.create\s*\(/);
  });

  it("does not update inventory items directly from executeTrade", () => {
    expect(executeTradeSource).not.toMatch(/\btx\.inventoryItem\.update\s*\(/);
  });

  it("does not delete inventory items directly from executeTrade", () => {
    expect(executeTradeSource).not.toMatch(/\btx\.inventoryItem\.delete\s*\(/);
  });

  it("does not create trade game logs directly from executeTrade", () => {
    expect(executeTradeSource).not.toMatch(/\btx\.gameLog\.create\s*\(/);
  });

  it("does not mutate campaign.gold from the AI tool", () => {
    expect(executeTradeSource).not.toMatch(
      /\btx\.campaign\.update\s*\([\s\S]*?\bdata\s*:\s*{[\s\S]*?\bgold\s*:/
    );
  });

  it("does not persist new InventoryItem rows from the AI tool", () => {
    expect(executeTradeSource).not.toMatch(
      /\btx\.inventoryItem\.create\s*\([\s\S]*?\bdata\s*:/
    );
  });

  it("does not persist InventoryItem.quantity changes from the AI tool", () => {
    expect(executeTradeSource).not.toMatch(
      /\btx\.inventoryItem\.update\s*\([\s\S]*?\bdata\s*:\s*{[\s\S]*?\bquantity\s*:/
    );
  });

  it("does not generate narrative trade prose while persisting", () => {
    expect(executeTradeSource).not.toMatch(
      /\btx\.gameLog\.create\s*\([\s\S]*?\bcontent\s*:\s*`[\s\S]*?(Purchased|Sold|Trade|GP)[\s\S]*?`/
    );
  });
});
