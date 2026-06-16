import { describe, expect, it, vi } from "vitest";

import { Dnd5eApiClientError } from "@/lib/srd/dnd5eapi/client";
import {
  adaptCondition,
  createDnd5eApiConditionsAdapter,
} from "@/lib/srd/dnd5eapi/conditions";

function jsonResponse(payload: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

const blindedCondition = {
  index: "blinded",
  name: "Blinded",
  url: "/api/2014/conditions/blinded",
  updated_at: "2025-01-01T00:00:00.000Z",
  desc: [
    "A blinded creature can't see and automatically fails any ability check that requires sight.",
    "Attack rolls against the creature have advantage, and the creature's attack rolls have disadvantage.",
  ],
};

const charmedCondition = {
  index: "charmed",
  name: "Charmed",
  url: "/api/2014/conditions/charmed",
  desc: ["A charmed creature can't attack the charmer."],
};

describe("dnd5eapi conditions adapter", () => {
  it("lists and normalizes conditions from the dnd5eapi client", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          count: 2,
          results: [
            { index: "blinded", name: "Blinded", url: "/api/2014/conditions/blinded" },
            { index: "charmed", name: "Charmed", url: "/api/2014/conditions/charmed" },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse(blindedCondition))
      .mockResolvedValueOnce(jsonResponse(charmedCondition));
    const adapter = createDnd5eApiConditionsAdapter({ fetch: fetchMock });

    await expect(adapter.listConditions()).resolves.toEqual([
      {
        index: "blinded",
        name: "Blinded",
        description: blindedCondition.desc.join("\n\n"),
        source: "dnd5eapi",
        sourceUrl: "/api/2014/conditions/blinded",
        sourceVersion: "2014",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
      {
        index: "charmed",
        name: "Charmed",
        description: "A charmed creature can't attack the charmer.",
        source: "dnd5eapi",
        sourceUrl: "/api/2014/conditions/charmed",
        sourceVersion: "2014",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://www.dnd5eapi.co/api/2014/conditions",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("gets and normalizes an individual condition", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(blindedCondition));
    const adapter = createDnd5eApiConditionsAdapter({ fetch: fetchMock });

    await expect(adapter.getCondition("blinded")).resolves.toMatchObject({
      index: "blinded",
      name: "Blinded",
      source: "dnd5eapi",
      sourceUrl: "/api/2014/conditions/blinded",
      sourceVersion: "2014",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.dnd5eapi.co/api/2014/conditions/blinded",
      expect.any(Object),
    );
  });

  it("normalizes desc arrays into a stable description string", () => {
    expect(adaptCondition(blindedCondition).description).toBe(
      `${blindedCondition.desc[0]}\n\n${blindedCondition.desc[1]}`,
    );
  });

  it("allows updated_at to be absent", () => {
    expect(adaptCondition(charmedCondition)).toEqual({
      index: "charmed",
      name: "Charmed",
      description: "A charmed creature can't attack the charmer.",
      source: "dnd5eapi",
      sourceUrl: "/api/2014/conditions/charmed",
      sourceVersion: "2014",
    });
  });

  it("propagates controlled HTTP errors from the client", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ error: "missing" }, { status: 404, statusText: "Not Found" }),
    );
    const adapter = createDnd5eApiConditionsAdapter({ fetch: fetchMock });

    await expect(adapter.getCondition("missing")).rejects.toMatchObject({
      name: "Dnd5eApiClientError",
      kind: "http",
      status: 404,
    } satisfies Partial<Dnd5eApiClientError>);
  });

  it("rejects invalid condition response shapes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        index: "blinded",
        name: "Blinded",
        url: "/api/2014/conditions/blinded",
        desc: "not an array",
      }),
    );
    const adapter = createDnd5eApiConditionsAdapter({ fetch: fetchMock });

    await expect(adapter.getCondition("blinded")).rejects.toMatchObject({
      name: "Dnd5eApiClientError",
      kind: "invalid-shape",
    } satisfies Partial<Dnd5eApiClientError>);
  });

  it("uses only the injected fetch mock and never calls global fetch", async () => {
    const globalFetchSpy = vi.spyOn(globalThis, "fetch");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(charmedCondition));
    const adapter = createDnd5eApiConditionsAdapter({ fetch: fetchMock });

    await adapter.getCondition("charmed");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(globalFetchSpy).not.toHaveBeenCalled();
    globalFetchSpy.mockRestore();
  });
});
