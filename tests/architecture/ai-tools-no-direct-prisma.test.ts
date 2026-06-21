import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const worldToolPath = join(process.cwd(), "lib", "ai", "tools", "world.ts");
const worldToolSource = readFileSync(worldToolPath, "utf8");

function extractManageEquipmentSource(source: string): string {
  const start = source.indexOf("manageEquipment: tool({");
  if (start === -1) return "";

  const nextTool = source.indexOf("\n    }),\n  };", start);
  return nextTool === -1 ? source.slice(start) : source.slice(start, nextTool);
}

describe("AI tools architecture: manageEquipment must not own persistence", () => {
  const manageEquipmentSource = extractManageEquipmentSource(worldToolSource);

  it("does not import prisma directly from the world AI tool", () => {
    expect(worldToolSource).not.toMatch(
      /import\s*{\s*prisma\s*}\s*from\s*["']@\/lib\/db\/prisma["']/
    );
  });

  it("contains the manageEquipment tool under test", () => {
    expect(manageEquipmentSource).toContain("manageEquipment");
  });

  it("does not call prisma.inventoryItem.update directly from manageEquipment", () => {
    expect(manageEquipmentSource).not.toMatch(/\bprisma\.inventoryItem\.update\s*\(/);
  });

  it("does not call tx.inventoryItem.update directly from manageEquipment", () => {
    expect(manageEquipmentSource).not.toMatch(/\btx\.inventoryItem\.update\s*\(/);
  });

  it("does not persist equippedSlot directly from manageEquipment", () => {
    expect(manageEquipmentSource).not.toMatch(
      /\b(?:prisma|tx)\.inventoryItem\.update\s*\([\s\S]*?\bdata\s*:\s*{[\s\S]*?\bequippedSlot\s*:/
    );
  });
});
