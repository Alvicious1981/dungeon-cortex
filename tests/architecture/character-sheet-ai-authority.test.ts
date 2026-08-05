import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const aiSource = readFileSync("lib/ai/character-profile-proposal.ts", "utf8");
const proposalRoute = readFileSync("app/api/character/[id]/proposals/route.ts", "utf8");
const contracts = readFileSync("lib/character-sheet/contracts.ts", "utf8");
const service = readFileSync("lib/character-sheet/service.ts", "utf8");

describe("editable character sheet authority boundary", () => {
  it("keeps the AI proposal generator free of Prisma and tools", () => {
    expect(aiSource).not.toMatch(/from ["']@\/lib\/db\/prisma["']/);
    expect(aiSource).not.toMatch(/\bprisma\./);
    expect(aiSource).not.toMatch(/\btools\s*:/);
    expect(aiSource).not.toMatch(/\btool\s*\(/);
  });

  it("routes AI output through the proposal service instead of a direct write", () => {
    expect(proposalRoute).toContain("createCharacterProposal");
    expect(proposalRoute).not.toMatch(/\bprisma\./);
    expect(proposalRoute).not.toContain("editCharacter(");
  });

  it("does not grant sheet write contracts for mechanical state", () => {
    for (const field of ["hp", "maxHp", "xp", "level", "stats", "inventory", "spellSlots", "conditions"]) {
      expect(contracts).not.toMatch(new RegExp(`^[ \\t]*[\"']${field}[\"'][ \\t]*,`, "m"));
    }
  });

  it("uses ownership, optimistic concurrency, idempotency, and audit on writes", () => {
    expect(service).toContain("where: { id: characterId, userId }");
    expect(service).toContain("revision: input.expectedVersion");
    expect(service).toContain("revision: { increment: 1 }");
    expect(service).toContain("actorUserId_idempotencyKey");
    expect(service).toContain("characterChangeAudit.create");
    expect(service).toContain("NAME_LOCKED_DURING_ENCOUNTER");
  });
});
