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
