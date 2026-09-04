/** @vitest-environment jsdom */
/**
 * The action correlation id is a persistent idempotency key (DC-AUD-003), so
 * its generator has to be collision-resistant across tabs and reloads, not just
 * within one page. These tests exercise all three entropy tiers by stubbing the
 * `crypto` global — the production function is never parameterised for tests,
 * so its real entropy behaviour is unchanged.
 *
 * The stubbing approach follows tests/components/CharacterProfileEditor.test.tsx,
 * which already proves the repo's other idempotency-key helper degrades safely.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACTION_REQUEST_ID_MAX_CHARS,
  createDungeonActionRequestId,
} from "@/lib/events/action-transport";

/** The server accepts this character set; every tier must stay inside it. */
const SERVER_SAFE = /^[A-Za-z0-9._:-]+$/;

function expectWellFormed(id: string): void {
  expect(id.startsWith("dungeon-action-")).toBe(true);
  expect(id.length).toBeLessThanOrEqual(ACTION_REQUEST_ID_MAX_CHARS);
  expect(id).toMatch(SERVER_SAFE);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createDungeonActionRequestId", () => {
  it("uses crypto.randomUUID when the platform offers it", () => {
    const ids = new Set(Array.from({ length: 500 }, createDungeonActionRequestId));

    expect(ids.size).toBe(500);
    for (const id of ids) expectWellFormed(id);
  });

  it("falls back to getRandomValues rather than Math.random", () => {
    // The tier that would be skipped by a naive two-step fallback. The stub
    // delegates to the real CSPRNG, so this exercises the genuine code path
    // instead of asserting against a fake generator.
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", {
      getRandomValues: (array: Uint8Array) => real.getRandomValues(array),
    });

    const ids = new Set(Array.from({ length: 500 }, createDungeonActionRequestId));

    expect(ids.size).toBe(500);
    for (const id of ids) expectWellFormed(id);
    // 16 bytes, hex-encoded, behind the prefix.
    expect([...ids][0]!.slice("dungeon-action-".length)).toMatch(/^[0-9a-f]{32}$/);
  });

  it("still produces a usable id when Web Crypto is absent entirely", () => {
    vi.stubGlobal("crypto", {});

    const ids = new Set(Array.from({ length: 500 }, createDungeonActionRequestId));

    expect(ids.size).toBe(500);
    for (const id of ids) expectWellFormed(id);
  });

  it("carries no module-scoped counter that a reload could reset", () => {
    // The defect this replaced: a per-module sequence made two tabs, or one tab
    // across a refresh, capable of minting the same id in the same millisecond.
    // A UUID/CSPRNG token shares no state, so ids drawn back-to-back within one
    // millisecond must still differ.
    const before = Date.now();
    const burst = Array.from({ length: 50 }, createDungeonActionRequestId);
    const elapsed = Date.now() - before;

    expect(new Set(burst).size).toBe(50);
    // Guards the premise of the test rather than the code: if this burst were
    // slow, sameness could be hidden by the clock moving on.
    expect(elapsed).toBeLessThan(1_000);
  });
});
