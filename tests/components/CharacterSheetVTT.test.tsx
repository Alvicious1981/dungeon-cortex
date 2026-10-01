/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import CharacterSheetVTT, { type CharacterSheetProps } from "@/components/character/CharacterSheetVTT";
import React from 'react';

const mockProps: CharacterSheetProps = {
  identity: {
    name: "Valerius the Brave",
    className: "Fighter",
    level: 5,
    race: "Human",
    background: "Soldier",
    alignment: "Lawful Good",
  },
  core: {
    armorClass: 18,
    hitPoints: { current: 45, max: 52 },
    initiative: 2,
    speedFeet: 30,
    proficiencyBonus: 3,
    passivePerception: 14,
  },
  abilities: {
    str: { score: 18, modifier: 4, proficient: true },
    dex: { score: 14, modifier: 2 },
    con: { score: 16, modifier: 3, proficient: true },
    int: { score: 10, modifier: 0 },
    wis: { score: 12, modifier: 1 },
    cha: { score: 8, modifier: -1 },
  },
  savingThrows: [
    { label: "Strength", value: "+7", proficient: true },
    { label: "Constitution", value: "+6", proficient: true },
  ],
  skills: [
    { label: "Athletics", value: "+7", proficient: true },
    { label: "Perception", value: "+4", proficient: true },
  ],
  attacks: [
    {
      id: "atk-1",
      name: "Longsword",
      bonus: 7,
      damage: "1d8+4 slashing",
      traits: ["Versatile (1d10)"],
    },
  ],
  inventory: [
    {
      id: "inv-1",
      name: "Plate Armor",
      quantity: 1,
      category: "armor",
      equipped: true,
      summary: "AC 18",
    },
    {
      id: "inv-2",
      name: "Health Potion",
      quantity: 3,
      category: "consumable",
      summary: "2d4+2 healing",
    },
  ],
  notes: ["Owes 50gp to the local tavern.", "Searching for the lost sword of his father."],
};

describe("CharacterSheetVTT Component", () => {
  it("renders character identity correctly", () => {
    render(<CharacterSheetVTT {...mockProps} />);
    
    expect(screen.getByText("Valerius the Brave")).toBeInTheDocument();
    expect(screen.getByText(/Nivel 5 Human Fighter/i)).toBeInTheDocument();
    expect(screen.getByText(/Soldier • Lawful Good/i)).toBeInTheDocument();
  });

  it("renders core combat metrics", () => {
    render(<CharacterSheetVTT {...mockProps} />);
    
    const coreSection = screen.getByLabelText(/Estadísticas de combate/i);
    const core = within(coreSection);
    
    expect(core.getByText("18")).toBeInTheDocument(); // AC
    expect(core.getByText("45/52")).toBeInTheDocument(); // HP
    expect(core.getByText("+2")).toBeInTheDocument(); // Initiative
    expect(core.getByText("30 pies")).toBeInTheDocument(); // Speed
  });

  it("labels hit points 'PG', the abbreviation used by the rest of the interface", () => {
    render(<CharacterSheetVTT {...mockProps} />);

    const core = within(screen.getByLabelText(/Estadísticas de combate/i));

    expect(core.getByText("PG")).toBeInTheDocument();
    expect(core.queryByText("PV")).not.toBeInTheDocument();
  });

  it("renders ability scores and modifiers", () => {
    render(<CharacterSheetVTT {...mockProps} />);
    
    const strBlock = screen.getByLabelText(/Puntuación de Fuerza/i);
    const str = within(strBlock);
    
    expect(str.getByText("Fuerza")).toBeInTheDocument();
    expect(str.getByText("18")).toBeInTheDocument();
    expect(str.getByText("+4")).toBeInTheDocument();
  });

  it("renders specific attacks", () => {
    render(<CharacterSheetVTT {...mockProps} />);
    
    expect(screen.getByText("Longsword")).toBeInTheDocument();
    expect(screen.getByText("+7 al ataque")).toBeInTheDocument();
    expect(screen.getByText(/1d8\+4 slashing/i)).toBeInTheDocument();
  });

  it("renders inventory items", () => {
    render(<CharacterSheetVTT {...mockProps} />);
    
    expect(screen.getByText("Plate Armor")).toBeInTheDocument();
    expect(screen.getByText("Health Potion")).toBeInTheDocument();
    expect(screen.getByText("x3")).toBeInTheDocument(); // Quantity
    expect(screen.getByText("Equipado")).toBeInTheDocument();
  });

  it("renders character notes", () => {
    render(<CharacterSheetVTT {...mockProps} />);
    
    expect(screen.getByText(/Owes 50gp to the local tavern/i)).toBeInTheDocument();
  });
});
