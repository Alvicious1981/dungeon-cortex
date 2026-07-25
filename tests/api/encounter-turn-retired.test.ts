import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/campaign/[id]/encounter/turn/route";

describe("retired encounter turn route", () => {
  it("returns a deterministic migration signal without mutating state", async () => {
    const response = await POST();

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error:
        'This endpoint is retired. Send { "action": "End Turn" } to the campaign action stream.',
    });
  });
});
