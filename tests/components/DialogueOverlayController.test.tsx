/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act, within } from "@testing-library/react";
import DialogueOverlayController from "@/components/social/DialogueOverlayController";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function openWith(npcId = "npc_1", disposition: number | null = 5) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent("dungeon-npc-selected", {
        detail: { npcId, name: "Greta", disposition, hasMetPlayer: true },
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

// The quick-action "Persuade" button and the free-text approach-selector
// share the accessible name "persuade" — scope to the quick-actions group so
// findByRole doesn't throw on ambiguity.
function findPersuadeQuickAction() {
  return within(screen.getByRole("group", { name: /quick actions/i })).findByRole("button", {
    name: /persuade/i,
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

    fireEvent.click(await findPersuadeQuickAction());

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

    fireEvent.click(await findPersuadeQuickAction());

    expect(await screen.findByText(/18/)).toBeTruthy();
    expect(await screen.findByText(/DC 15/i)).toBeTruthy();
    expect(await screen.findByText(/\+9 Engagement/)).toBeTruthy();
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

  it("shows the route's error message on a failed check and leaves disposition unchanged", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "NPC not found." }),
    } as Response);

    render(<DialogueOverlayController campaignId="camp_1" characterId="char_1" />);
    openWith();

    fireEvent.click(await findPersuadeQuickAction());

    expect(await screen.findByText("NPC not found.")).toBeTruthy();
    // The disposition meter still reads the value from the selection event.
    expect(screen.getByText(/\+5 Engagement/)).toBeTruthy();
  });

  it("shows a generic error and no unhandled rejection when fetch itself fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    render(<DialogueOverlayController campaignId="camp_1" characterId="char_1" />);
    openWith();

    fireEvent.click(await findPersuadeQuickAction());

    expect(await screen.findByText(/could not reach the server/i)).toBeTruthy();
    expect(screen.getByText(/\+5 Engagement/)).toBeTruthy();

    // Give any unhandled rejection a tick to surface before asserting none did.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(unhandled).not.toHaveBeenCalled();
    process.off("unhandledRejection", unhandled);
  });

  // The "keeps Gather Rumors disabled" test stood here while no route
  // resolved rumours, so the control would not look live and swallow clicks.
  // It has one now, so the assertion is deliberately gone rather than skipped.
});

describe("DialogueOverlayController — rumours", () => {
  /**
   * Whether the NPC actually talks is the rules' call, not the button's: the
   * route answers a refusal with 200 and a `refusalReason`. The control is
   * enabled whenever the party can ask, and asking is what surfaces the no.
   */
  it("asks the rumours route and lists what comes back", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        npcName: "Greta",
        disposition: 7,
        attitude: "Friendly",
        rumors: [
          {
            nodeId: "n1",
            nodeName: "Cave",
            feature: "treasure",
            rumor: "Something worth finding in Cave.",
            source: "spatial",
          },
        ],
      }),
    } as Response);

    render(<DialogueOverlayController campaignId="camp_1" characterId="char_1" />);
    openWith("npc_1", 7);

    fireEvent.click(await screen.findByRole("button", { name: /gather rumors/i }));

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/campaign/camp_1/social/rumors");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ npcId: "npc_1" });

    expect(await screen.findByText(/Something worth finding in Cave/)).toBeTruthy();
  });

  it("shows the NPC's refusal rather than an empty list", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        npcName: "Greta",
        disposition: 0,
        attitude: "Indifferent",
        rumors: [],
        refusalReason: "This NPC is indifferent and unwilling to share information freely.",
      }),
    } as Response);

    render(<DialogueOverlayController campaignId="camp_1" characterId="char_1" />);
    openWith("npc_1", 0);

    fireEvent.click(await screen.findByRole("button", { name: /gather rumors/i }));

    expect(await screen.findByText(/unwilling to share/)).toBeTruthy();
  });
});
