/**
 * tests/ai/tool-result.test.ts
 *
 * SEC-AI-001 PR2 — common tool-result contract.
 *
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest";
import {
  TOOL_FAILURE_REASONS,
  classifyToolError,
  isToolResult,
  runLookup,
  runTool,
  toolInternalError,
  toolNotFound,
  toolRejected,
  toolSuccess,
} from "@/lib/ai/tool-result";

const SECRET = "connection string postgres://user:pw@host/db";

class FakeServiceError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "FakeServiceError";
  }
}

describe("tool result contract", () => {
  it("enumerates a closed set of failure reasons", () => {
    expect([...TOOL_FAILURE_REASONS]).toEqual(["not_found", "rejected", "internal_error"]);
  });

  it("carries data only on success", () => {
    const ok = toolSuccess({ hp: 12 });
    expect(ok).toEqual({ status: "ok", data: { hp: 12 } });

    for (const failure of [toolNotFound(), toolInternalError(), toolRejected("ITEM_NOT_FOUND")]) {
      expect(failure.status).toBe("error");
      expect(failure).not.toHaveProperty("data");
    }
  });

  it("rejects non-serialisable success data", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(toolSuccess(circular)).toEqual({ status: "error", reason: "internal_error" });
    expect(toolSuccess(undefined)).toEqual({ status: "error", reason: "internal_error" });
  });

  it("rejects data that serialises to undefined instead of emitting a dataless envelope", () => {
    // JSON.stringify returns undefined for these rather than throwing, so the
    // envelope would reach the model as a bare {"status":"ok"}.
    expect(toolSuccess(function noop() {})).toEqual({
      status: "error",
      reason: "internal_error",
    });
    expect(toolSuccess(() => undefined)).toEqual({ status: "error", reason: "internal_error" });
    expect(toolSuccess(Symbol("x"))).toEqual({ status: "error", reason: "internal_error" });
  });

  it("rejects data that throws during serialisation", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(toolSuccess(BigInt("9007199254740993"))).toEqual({
      status: "error",
      reason: "internal_error",
    });
    expect(toolSuccess({ total: BigInt(1) })).toEqual({
      status: "error",
      reason: "internal_error",
    });
    expect(toolSuccess(circular)).toEqual({ status: "error", reason: "internal_error" });
  });

  it("still accepts ordinary JSON data", () => {
    expect(toolSuccess({ gold: 12, items: ["rope"], nested: { ok: true } })).toEqual({
      status: "ok",
      data: { gold: 12, items: ["rope"], nested: { ok: true } },
    });
    expect(toolSuccess([1, 2, 3])).toEqual({ status: "ok", data: [1, 2, 3] });
    expect(toolSuccess("text")).toEqual({ status: "ok", data: "text" });
    expect(toolSuccess(0)).toEqual({ status: "ok", data: 0 });
    expect(toolSuccess(null)).toEqual({ status: "ok", data: null });
  });

  it("keeps accepting DTOs whose optional properties are undefined", () => {
    // Shape of a getMonsterInfo result: optional SRD fields are undefined when
    // the row does not carry them. JSON.stringify drops those keys but still
    // produces text, so the lookup must stay a success.
    const monster = {
      index: "goblin",
      name: "Goblin",
      hit_points: 7,
      armor_class: [{ type: "natural", value: 15 }],
      size: undefined,
      type: undefined,
      alignment: undefined,
      challenge_rating: undefined,
      xp: undefined,
      hit_dice: undefined,
      speed: undefined,
      strength: undefined,
      url: undefined,
    };

    const result = toolSuccess(monster);

    expect(result.status).toBe("ok");
    expect((result as { data: typeof monster }).data).toBe(monster);
    expect(isToolResult(result)).toBe(true);
  });
});

describe("isToolResult validation", () => {
  it("accepts well-formed results", () => {
    expect(isToolResult({ status: "ok", data: null })).toBe(true);
    expect(isToolResult({ status: "error", reason: "not_found" })).toBe(true);
    expect(isToolResult({ status: "error", reason: "rejected", code: "NPC_NOT_MET" })).toBe(true);
  });

  it("rejects malformed or leaky shapes", () => {
    expect(isToolResult(null)).toBe(false);
    expect(isToolResult("ok")).toBe(false);
    expect(isToolResult({ status: "maybe" })).toBe(false);
    expect(isToolResult({ status: "ok" })).toBe(false);
    expect(isToolResult({ status: "error" })).toBe(false);
    expect(isToolResult({ status: "error", reason: "boom" })).toBe(false);
    expect(isToolResult({ status: "error", reason: "internal_error", data: {} })).toBe(false);
    // A free-form message can never masquerade as a domain code.
    expect(isToolResult({ status: "error", reason: "rejected", code: SECRET })).toBe(false);
    expect(isToolResult({ status: "error", reason: "not_found", code: "ITEM_NOT_FOUND" })).toBe(false);
  });

  it("rejects any top-level key beyond the contract", () => {
    // Failure envelopes carrying internal information.
    expect(isToolResult({ status: "error", reason: "internal_error", message: SECRET })).toBe(false);
    expect(isToolResult({ status: "error", reason: "internal_error", detail: SECRET })).toBe(false);
    expect(isToolResult({ status: "error", reason: "internal_error", stack: "at db.query(...)" })).toBe(false);
    expect(isToolResult({ status: "error", reason: "internal_error", error: SECRET })).toBe(false);
    expect(isToolResult({ status: "error", reason: "internal_error", query: "SELECT * FROM npc" })).toBe(false);
    expect(isToolResult({ status: "error", reason: "internal_error", prompt: "## Iron Laws" })).toBe(false);
    expect(isToolResult({ status: "error", reason: "rejected", code: "NPC_NOT_MET", message: SECRET })).toBe(false);

    // Success envelopes carrying internal information.
    expect(isToolResult({ status: "ok", data: {}, message: SECRET })).toBe(false);
    expect(isToolResult({ status: "ok", data: {}, detail: SECRET })).toBe(false);
    expect(isToolResult({ status: "ok", data: {}, stack: "at db.query(...)" })).toBe(false);
    expect(isToolResult({ status: "ok", data: {}, error: SECRET })).toBe(false);
    expect(isToolResult({ status: "ok", data: {}, reason: "rejected" })).toBe(false);
    expect(isToolResult({ status: "ok", data: {}, code: "ITEM_NOT_FOUND" })).toBe(false);

    // Any unknown key at all, whatever its name or value.
    expect(isToolResult({ status: "ok", data: {}, whatever: 1 })).toBe(false);
    expect(isToolResult({ status: "error", reason: "not_found", whatever: null })).toBe(false);
    expect(isToolResult({ status: "error", reason: "internal_error", code: undefined })).toBe(false);
  });

  it("still accepts the three contract shapes exactly", () => {
    expect(isToolResult({ status: "ok", data: {} })).toBe(true);
    expect(isToolResult({ status: "error", reason: "internal_error" })).toBe(true);
    expect(isToolResult({ status: "error", reason: "rejected", code: "ITEM_NOT_FOUND" })).toBe(true);
  });
});

describe("classifyToolError", () => {
  it("keeps the stable domain code of a backend service error", () => {
    const failure = classifyToolError(new FakeServiceError("ITEM_NOT_FOUND", SECRET));

    expect(failure).toEqual({ status: "error", reason: "rejected", code: "ITEM_NOT_FOUND" });
    expect(JSON.stringify(failure)).not.toContain("postgres");
  });

  it("collapses unclassifiable throws into a safe internal error", () => {
    const unclassifiable: unknown[] = [
      new Error(SECRET),
      new TypeError(SECRET),
      SECRET,
      { message: SECRET },
      null,
      undefined,
      new FakeServiceError("not a code", SECRET),
    ];

    for (const error of unclassifiable) {
      const failure = classifyToolError(error);
      expect(failure).toEqual({ status: "error", reason: "internal_error" });
      expect(JSON.stringify(failure)).not.toContain("postgres");
    }
  });

  it("never propagates a stack trace", () => {
    const failure = classifyToolError(new FakeServiceError("NPC_NOT_MET", SECRET));
    expect(failure).not.toHaveProperty("stack");
    expect(failure).not.toHaveProperty("message");
    expect(failure).not.toHaveProperty("detail");
  });
});

describe("runTool / runLookup", () => {
  it("wraps resolved data as validated success", async () => {
    await expect(runTool(() => ({ gold: 4 }))).resolves.toEqual({
      status: "ok",
      data: { gold: 4 },
    });
    await expect(runTool(async () => "text")).resolves.toEqual({ status: "ok", data: "text" });
  });

  it("never re-interprets backend data as a failure envelope", async () => {
    const impostor = { status: "error", reason: "rejected", code: "FAKE" };

    await expect(runTool(() => impostor)).resolves.toEqual({ status: "ok", data: impostor });
  });

  it("catches every throw", async () => {
    await expect(runTool(() => { throw new Error(SECRET); })).resolves.toEqual({
      status: "error",
      reason: "internal_error",
    });
    await expect(runTool(async () => { throw new FakeServiceError("ITEM_NOT_FOUND", SECRET); })).resolves.toEqual({
      status: "error",
      reason: "rejected",
      code: "ITEM_NOT_FOUND",
    });
  });

  it("maps a nullish lookup to not_found", async () => {
    await expect(runLookup(() => null)).resolves.toEqual({ status: "error", reason: "not_found" });
    await expect(runLookup(async () => undefined)).resolves.toEqual({
      status: "error",
      reason: "not_found",
    });
    await expect(runLookup(() => ({ name: "Fireball" }))).resolves.toEqual({
      status: "ok",
      data: { name: "Fireball" },
    });
  });
});
