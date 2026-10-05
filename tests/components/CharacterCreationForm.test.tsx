/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CharacterCreationForm from "@/components/character/CharacterCreationForm";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const races = [{ index: "human", name: "Human", url: "/api/races/human" }];
const classes = [
  { index: "fighter", name: "Fighter", url: "/api/classes/fighter" },
];

describe("CharacterCreationForm", () => {
  beforeEach(() => {
    push.mockReset();
    vi.restoreAllMocks();
  });

  it("presenta linajes y clases en español sin cambiar sus valores canónicos", () => {
    render(<CharacterCreationForm races={races} classes={classes} />);

    expect(screen.getByRole("option", { name: "Humano" })).toHaveValue("human");
    expect(screen.getByRole("option", { name: "Guerrero" })).toHaveValue("fighter");
    expect(screen.queryByRole("option", { name: "Human" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Fighter" })).not.toBeInTheDocument();
  });

  it("crea un personaje, crea su campaña y navega al identificador real", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "hero-1" }), { status: 201 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "campaign-1" }), { status: 201 })
      );

    render(<CharacterCreationForm races={races} classes={classes} />);
    fireEvent.change(screen.getByLabelText("Nombre del personaje"), {
      target: { value: "Mira" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Comenzar aventura" })
    );

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/campaign/campaign-1")
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/character",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/campaign",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          characterId: "hero-1",
          title: "Crónica de Mira",
        }),
      })
    );
  });

  it("presenta en español los errores de creación recibidos de la API", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "name is required." }), {
        status: 400,
      })
    );

    render(<CharacterCreationForm races={races} classes={classes} />);
    fireEvent.change(screen.getByLabelText("Nombre del personaje"), {
      target: { value: "Mira" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Comenzar aventura" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Revisa el nombre, el linaje, la clase y las características antes de continuar."
    );
    expect(alert).not.toHaveTextContent("name is required.");
  });

  it("reintenta solo la campaña cuando el personaje ya está guardado", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "hero-1" }), { status: 201 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Unavailable" }), { status: 503 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "campaign-2" }), { status: 201 })
      );

    render(<CharacterCreationForm races={races} classes={classes} />);
    fireEvent.change(screen.getByLabelText("Nombre del personaje"), {
      target: { value: "Mira" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Comenzar aventura" })
    );

    const retry = await screen.findByRole("button", {
      name: "Reintentar apertura",
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "El personaje se ha guardado, pero no se pudo abrir la campaña."
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent("Unavailable");
    await waitFor(() =>
      expect(document.getElementById("creation-status")).toHaveFocus()
    );
    fireEvent.click(retry);

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/campaign/campaign-2")
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      fetchMock.mock.calls.filter(([url]) => url === "/api/character")
    ).toHaveLength(1);
  });

  it("conserva el personaje y ofrece reintento tras un fallo de red", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "hero-1" }), { status: 201 })
      )
      .mockRejectedValueOnce(new TypeError("Network unavailable"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "campaign-3" }), { status: 201 })
      );

    render(<CharacterCreationForm races={races} classes={classes} />);
    fireEvent.change(screen.getByLabelText("Nombre del personaje"), {
      target: { value: "Mira" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Comenzar aventura" })
    );

    const retry = await screen.findByRole("button", {
      name: "Reintentar apertura",
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "El personaje está a salvo"
    );
    fireEvent.click(retry);

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/campaign/campaign-3")
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      fetchMock.mock.calls.filter(([url]) => url === "/api/character")
    ).toHaveLength(1);
  });

  it("muestra un único indicador mientras guarda", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>(() => undefined)
    );

    render(<CharacterCreationForm races={races} classes={classes} />);
    fireEvent.change(screen.getByLabelText("Nombre del personaje"), {
      target: { value: "Mira" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Comenzar aventura" }));

    const submit = await screen.findByRole("button", {
      name: "Guardando personaje…",
    });
    expect(submit.querySelectorAll(".animate-spin")).toHaveLength(1);
  });
});
