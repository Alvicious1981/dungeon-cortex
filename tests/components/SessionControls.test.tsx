/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import SessionControls from "@/components/campaign/SessionControls";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

describe("SessionControls", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    refresh.mockReset();
  });

  it("shows the durable mode and pauses through the authenticated route", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ session: { status: "PAUSED" } }), { status: 200 })
    );
    render(<SessionControls campaignId="campaign-1" session={{
      sessionNumber: 2,
      status: "ACTIVE",
      mode: "EXPLORATION",
    }} />);

    expect(screen.getByText(/Session 2 · exploration/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith("/api/campaign/campaign-1/session", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ action: "pause" }),
    }));
  });

  it("offers resume instead of pause for a paused session", () => {
    render(<SessionControls campaignId="campaign-1" session={{
      sessionNumber: 2,
      status: "PAUSED",
      mode: "PAUSED",
    }} />);
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
  });
});
