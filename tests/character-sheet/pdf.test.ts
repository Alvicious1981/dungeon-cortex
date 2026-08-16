import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { exportCharacterPdf, importCharacterProfileFromPdf } from "@/lib/character-sheet/pdf";
import type { CharacterSheetProps } from "@/components/character/CharacterSheetVTT";

const sheet: CharacterSheetProps = {
  identity: { name: "Mira", race: "Human", className: "Wizard", level: 1 },
  core: { armorClass: 12, hitPoints: { current: 8, max: 8 }, initiative: 2, speedFeet: null, proficiencyBonus: 2, passivePerception: 11 },
  abilities: {
    str: { score: 8, modifier: -1 }, dex: { score: 14, modifier: 2 }, con: { score: 12, modifier: 1 },
    int: { score: 16, modifier: 3 }, wis: { score: 12, modifier: 1 }, cha: { score: 10, modifier: 0 },
  },
  savingThrows: [], skills: [], attacks: [], inventory: [], spellSlots: [],
};

const profile = {
  id: "character-1", name: "Mira", revision: 2, updatedAt: new Date(0).toISOString(),
  appearance: "Silver hair", backstory: "A quiet archivist.", personalityTraits: "Patient",
  ideals: "Knowledge", bonds: "Her mentor", flaws: "Overcautious",
};

describe("character PDF transport", () => {
  it("exports a custom fillable PDF and imports only its allowed profile fields", async () => {
    const bytes = await exportCharacterPdf(sheet, profile);
    expect(new TextDecoder("ascii").decode(bytes.slice(0, 5))).toBe("%PDF-");
    const imported = await importCharacterProfileFromPdf(bytes);
    expect(imported.changes).toEqual(expect.arrayContaining([
      { field: "name", value: "Mira" },
      { field: "backstory", value: "A quiet archivist." },
      { field: "ideals", value: "Knowledge" },
    ]));
  });

  it("ignores populated mechanical and unknown fields from an editable PDF", async () => {
    const document = await PDFDocument.create();
    const page = document.addPage();
    const form = document.getForm();
    for (const [name, value] of [["CharacterName", "Mira Vale"], ["HPCurrent", "999"], ["XP", "999999"], ["UnknownField", "payload"]]) {
      const field = form.createTextField(name);
      field.setText(value);
      field.addToPage(page, { x: 20, y: 20, width: 100, height: 20 });
    }
    const imported = await importCharacterProfileFromPdf(await document.save());
    expect(imported.changes).toEqual([{ field: "name", value: "Mira Vale" }]);
    expect(imported.warnings.join(" ")).toContain("3 campos");
  });

  it("rejects content that is not a PDF", async () => {
    await expect(importCharacterProfileFromPdf(new TextEncoder().encode("not a pdf"))).rejects.toThrow(/cabecera PDF/i);
  });
});
