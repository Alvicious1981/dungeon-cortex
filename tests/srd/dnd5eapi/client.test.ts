import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  createDnd5eApiClient,
  Dnd5eApiClientError,
} from "@/lib/srd/dnd5eapi/client";

function jsonResponse(payload: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("createDnd5eApiClient", () => {
  it("reads and validates index responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        count: 1,
        results: [{ index: "wizard", name: "Wizard", url: "/api/classes/wizard" }],
      }),
    );
    const client = createDnd5eApiClient({ fetch: fetchMock });

    await expect(client.getIndex("/classes")).resolves.toEqual({
      count: 1,
      results: [{ index: "wizard", name: "Wizard", url: "/api/classes/wizard" }],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.dnd5eapi.co/api/classes",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("reads resource responses with an optional schema", async () => {
    const resourceSchema = z.object({
      index: z.string(),
      name: z.string(),
      level: z.number(),
    });
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ index: "magic-missile", name: "Magic Missile", level: 1 }),
    );
    const client = createDnd5eApiClient({ fetch: fetchMock });

    await expect(
      client.getResource("/spells/magic-missile", resourceSchema),
    ).resolves.toEqual({ index: "magic-missile", name: "Magic Missile", level: 1 });
  });

  it("throws a typed error for HTTP failures", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "missing" }, { status: 404, statusText: "Not Found" }));
    const client = createDnd5eApiClient({ fetch: fetchMock });

    await expect(client.getIndex("/missing")).rejects.toMatchObject({
      name: "Dnd5eApiClientError",
      kind: "http",
      status: 404,
      statusText: "Not Found",
    });
  });

  it("throws a typed error for invalid JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("not json", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = createDnd5eApiClient({ fetch: fetchMock });

    await expect(client.getIndex("/classes")).rejects.toMatchObject({
      kind: "invalid-json",
    } satisfies Partial<Dnd5eApiClientError>);
  });

  it("throws a typed error for invalid response shapes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ count: 1, results: [{ index: "wizard", name: "Wizard" }] }),
    );
    const client = createDnd5eApiClient({ fetch: fetchMock });

    await expect(client.getIndex("/classes")).rejects.toMatchObject({
      kind: "invalid-shape",
    } satisfies Partial<Dnd5eApiClientError>);
  });

  it("uses a custom base URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ count: 0, results: [] }));
    const client = createDnd5eApiClient({
      baseUrl: "https://fixture.test/api/2014/",
      fetch: fetchMock,
    });

    await client.getIndex("classes");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://fixture.test/api/2014/classes",
      expect.any(Object),
    );
  });
});
