import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const inventoryToolPath = join(process.cwd(), "lib", "ai", "tools", "inventory.ts");
const inventoryToolSource = readFileSync(inventoryToolPath, "utf8");

function extractUseConsumableSource(source: string): string {
  const start = source.indexOf("useConsumable: tool({");
  if (start === -1) return "";

  const end = source.indexOf("\n    }),", start);
  return end === -1 ? source.slice(start) : source.slice(start, end);
}

describe("AI tools architecture: useConsumable must not own persistence", () => {
  const useConsumableSource = extractUseConsumableSource(inventoryToolSource);

  it("does not import prisma directly from the inventory AI tool", () => {
    expect(inventoryToolSource).not.toMatch(
      /import\s*{\s*prisma\s*}\s*from\s*["']@\/lib\/db\/prisma["']/
    );
  });

  it("contains the useConsumable tool under test", () => {
    expect(useConsumableSource).toContain("useConsumable");
  });

  it("does not call prisma.$transaction directly from useConsumable", () => {
    expect(useConsumableSource).not.toMatch(/\bprisma\.\$transaction\s*\(/);
  });

  it("does not update character HP directly from useConsumable", () => {
    expect(useConsumableSource).not.toMatch(/\btx\.character\.update\s*\(/);
  });

  it("does not decrement inventory quantity directly from useConsumable", () => {
    expect(useConsumableSource).not.toMatch(/\btx\.inventoryItem\.update\s*\(/);
  });

  it("does not delete inventory items directly from useConsumable", () => {
    expect(useConsumableSource).not.toMatch(/\btx\.inventoryItem\.delete\s*\(/);
  });

  it("does not persist character.hp directly from useConsumable", () => {
    expect(useConsumableSource).not.toMatch(
      /\btx\.character\.update\s*\([\s\S]*?\bdata\s*:\s*{[\s\S]*?\bhp\s*:/
    );
  });

  it("does not persist InventoryItem.quantity directly from useConsumable", () => {
    expect(useConsumableSource).not.toMatch(
      /\btx\.inventoryItem\.update\s*\([\s\S]*?\bdata\s*:\s*{[\s\S]*?\bquantity\s*:/
    );
  });

  it("does not remove InventoryItem rows directly from useConsumable", () => {
    expect(useConsumableSource).not.toMatch(
      /\btx\.inventoryItem\.delete\s*\([\s\S]*?\bwhere\s*:/
    );
  });
});
