import { describe, expect, it } from "vitest";
import {
  characterChangeSchema,
  characterEditRequestSchema,
  CHARACTER_EDITABLE_FIELDS,
} from "@/lib/character-sheet/contracts";

describe("character sheet edit contract", () => {
  it("allows only identity and narrative fields", () => {
    expect(CHARACTER_EDITABLE_FIELDS).toEqual([
      "name",
      "appearance",
      "backstory",
      "personalityTraits",
      "ideals",
      "bonds",
      "flaws",
    ]);
    expect(characterChangeSchema.safeParse({ field: "hp", value: "999" }).success).toBe(false);
    expect(characterChangeSchema.safeParse({ field: "level", value: "20" }).success).toBe(false);
    expect(characterChangeSchema.safeParse({ field: "spellSlots", value: "unlimited" }).success).toBe(false);
  });

  it("normalizes safe text and rejects an empty name", () => {
    expect(characterChangeSchema.parse({ field: "name", value: "  Mira   Vale  " })).toEqual({
      field: "name",
      value: "Mira Vale",
    });
    expect(characterChangeSchema.safeParse({ field: "name", value: "   " }).success).toBe(false);
  });

  it("rejects oversized and control-character payloads", () => {
    expect(characterChangeSchema.safeParse({ field: "appearance", value: "a".repeat(1_001) }).success).toBe(false);
    expect(characterChangeSchema.safeParse({ field: "backstory", value: "safe\u0000unsafe" }).success).toBe(false);
  });

  it("requires optimistic concurrency and an idempotency key", () => {
    expect(characterEditRequestSchema.safeParse({
      expectedVersion: 3,
      idempotencyKey: "manual:12345678",
      change: { field: "ideals", value: "Protect the helpless." },
    }).success).toBe(true);
    expect(characterEditRequestSchema.safeParse({
      expectedVersion: 0,
      idempotencyKey: "short",
      change: { field: "ideals", value: "Protect the helpless." },
    }).success).toBe(false);
  });
});
