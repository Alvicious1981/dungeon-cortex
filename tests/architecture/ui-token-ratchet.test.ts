import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * UI-01 (docs/ui/tasks/UI-01.md) moved these surfaces from Tailwind palette
 * classes and literal colours to the semantic `--dc-*` tokens of app/globals.css.
 * PR #251 shows the debt grows back when nothing holds it: palette-class lines
 * went from 250 to 312 right after a normalization pass.
 *
 * This is a ratchet, not a ban. A file joins the list when it has been
 * normalized; a surface that keeps a domain colour on purpose (a terrain tile, an
 * item category) stays off the list and says why in place. The list only grows.
 */
const NORMALIZED_FILES = [
  "app/campaign/[id]/StoryLog.tsx",
  "app/campaign/[id]/StoryResults.tsx",
  "app/campaign/[id]/ActionInput.tsx",
  "components/QuestTracker.tsx",
  "components/character/sheet/EquipmentTab.tsx",
  "components/character/sheet/InventoryGrid.tsx",
  "components/character/LevelUpConfirmation.tsx",
  "components/campaign/CampaignLayout.tsx",
];

const PALETTES =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const UTILITIES =
  "text|bg|border|ring|from|to|via|divide|outline|fill|stroke|shadow|accent|decoration|placeholder|caret";

/** `hover:border-neutral-600`, `focus-visible:ring-blue-400`, `bg-amber-950/30` and so on. */
const PALETTE_CLASS = new RegExp(`(?<![\\w-])(?:[\\w-]+:)*(?:${UTILITIES})-(?:${PALETTES})-\\d{2,3}`);
/** Six- or eight-digit hex, rgb()/hsl() functions. Three-digit hex is skipped: `#add` is also an anchor. */
const LITERAL_COLOUR = /#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?\b|\b(?:rgba?|hsla?)\(/;

function offences(path: string): string[] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .flatMap((line, index) => {
      const hit = line.match(PALETTE_CLASS) ?? line.match(LITERAL_COLOUR);
      return hit ? [`${path}:${index + 1} → ${hit[0]}`] : [];
    });
}

describe("normalized UI surfaces stay on --dc-* tokens", () => {
  it.each(NORMALIZED_FILES)("%s uses no palette class and no literal colour", (path) => {
    expect(offences(path)).toEqual([]);
  });

  it("detects what it claims to detect", () => {
    // A guard that never fails guards nothing: pin the two shapes it exists for.
    expect(PALETTE_CLASS.test('className="text-amber-200"')).toBe(true);
    expect(PALETTE_CLASS.test('className="focus-visible:ring-blue-400"')).toBe(true);
    expect(PALETTE_CLASS.test('className="hover:border-neutral-600"')).toBe(true);
    expect(PALETTE_CLASS.test('className="text-[var(--dc-text-muted)]"')).toBe(false);
    expect(LITERAL_COLOUR.test('className="text-[#c5aa74]"')).toBe(true);
    expect(LITERAL_COLOUR.test('style={{ background: "rgba(12,12,22,0.92)" }}')).toBe(true);
    expect(LITERAL_COLOUR.test('href="#chronicle"')).toBe(false);
  });
});
