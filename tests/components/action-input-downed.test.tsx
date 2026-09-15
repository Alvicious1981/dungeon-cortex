/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import ActionInput from "@/app/campaign/[id]/ActionInput";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(() => cleanup());

describe("ActionInput for a player who cannot act (death-saves spec §7.4)", () => {
  it("disables free-text actions and says why", () => {
    render(
      <ActionInput
        campaignId="camp-1"
        disabledReason="Estás inconsciente: solo puedes usar «Tirada de muerte» o «Esperar»."
      />
    );

    const input = screen.getByLabelText("Tu acción") as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.placeholder).toContain("Estás inconsciente");
    expect((screen.getByRole("button", { name: "Actuar" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps the input enabled without a reason", () => {
    render(<ActionInput campaignId="camp-1" />);
    expect((screen.getByLabelText("Tu acción") as HTMLInputElement).disabled).toBe(false);
  });
});
