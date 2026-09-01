/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import DialogueOverlayController from "@/components/social/DialogueOverlayController";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function openWith(npcId = "npc_1") {
  act(() => {
    window.dispatchEvent(
      new CustomEvent("dungeon-npc-selected", {
        detail: { npcId, name: "Greta", disposition: 5, hasMetPlayer: true },
      })
    );
  });
}

function openUnmet(npcId = "npc_1") {
  act(() => {
    window.dispatchEvent(
      new CustomEvent("dungeon-npc-selected", {
        detail: { npcId, name: "Greta", disposition: null, hasMetPlayer: false },
      })
    );
  });
}

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({
      ok: true, approach: "persuade", skill: "Persuasion", roll: 18, dc: 15,
      total: 20, success: true, attitudeBefore: "Friendly", attitudeAfter: "Friendly",
      dispositionBefore: 5, dispositionAfter: 9,
    }),
  } as Response);
});

describe("DialogueOverlayController", () => {
  it("stays closed until an NPC is selected", () => {
    render(<DialogueOverlayController campaignId="camp_1" characterId="char_1" />);
    expect(screen.queryByText(/Greta/)).toBeNull();
  });

  it("posts the social action to the campaign's social route", async () => {
    render(<DialogueOverlayController campaignId="camp_1" characterId="char_1" />);
    openWith();

    fireEvent.click(await screen.findByRole("button", { name: /persuade/i }));

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/campaign/camp_1/social");
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      npcId: "npc_1",
      approach: "persuade",
    });
  });

  it("shows the resolved roll and the new disposition", async () => {
    render(<DialogueOverlayController campaignId="camp_1" characterId="char_1" />);
    openWith();

    fireEvent.click(await screen.findByRole("button", { name: /persuade/i }));

    expect(await screen.findByText(/18/)).toBeTruthy();
    expect(await screen.findByText(/DC 15/i)).toBeTruthy();
  });

  it("posts the same route call when approaching an unmet NPC", async () => {
    render(<DialogueOverlayController campaignId="camp_1" characterId="char_1" />);
    openUnmet();

    fireEvent.click(await screen.findByRole("button", { name: /approach/i }));

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/campaign/camp_1/social");
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      npcId: "npc_1",
      approach: "persuade",
      intent: "",
    });
  });
});
