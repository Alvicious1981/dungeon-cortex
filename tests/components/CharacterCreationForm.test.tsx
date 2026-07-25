/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CharacterCreationForm from "@/components/character/CharacterCreationForm";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const races = [{ index: "human", name: "Human", url: "/api/races/human" }];
const classes = [{ index: "fighter", name: "Fighter", url: "/api/classes/fighter" }];

describe("CharacterCreationForm", () => {
  beforeEach(() => {
    push.mockReset();
    vi.restoreAllMocks();
  });

  it("creates a character, creates its campaign, and navigates to the real id", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "hero-1" }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "campaign-1" }), { status: 201 }));

    render(<CharacterCreationForm races={races} classes={classes} />);
    fireEvent.change(screen.getByLabelText("Character Name"), { target: { value: "Mira" } });
    fireEvent.click(screen.getByRole("button", { name: "Begin Adventure" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/campaign/campaign-1"));
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/character", expect.objectContaining({ method: "POST" }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/campaign", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ characterId: "hero-1", title: "Mira's Chronicle" }),
    }));
  });

  it("retries only campaign creation when the hero was already saved", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "hero-1" }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Unavailable" }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "campaign-2" }), { status: 201 }));

    render(<CharacterCreationForm races={races} classes={classes} />);
    fireEvent.change(screen.getByLabelText("Character Name"), { target: { value: "Mira" } });
    fireEvent.click(screen.getByRole("button", { name: "Begin Adventure" }));

    const retry = await screen.findByRole("button", { name: "Retry opening chronicle" });
    expect(screen.getByRole("alert")).toHaveTextContent("Unavailable");
    fireEvent.click(retry);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/campaign/campaign-2"));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/character")).toHaveLength(1);
  });

  it("keeps the saved hero and offers a campaign retry after a network failure", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "hero-1" }), { status: 201 }))
      .mockRejectedValueOnce(new TypeError("Network unavailable"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "campaign-3" }), { status: 201 }));

    render(<CharacterCreationForm races={races} classes={classes} />);
    fireEvent.change(screen.getByLabelText("Character Name"), { target: { value: "Mira" } });
    fireEvent.click(screen.getByRole("button", { name: "Begin Adventure" }));

    const retry = await screen.findByRole("button", { name: "Retry opening chronicle" });
    expect(screen.getByRole("alert")).toHaveTextContent("Your hero is safe");
    fireEvent.click(retry);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/campaign/campaign-3"));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/character")).toHaveLength(1);
  });
});
