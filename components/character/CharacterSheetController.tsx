"use client";

import { useState, useCallback, useRef } from "react";
import { User, X } from "lucide-react";
import CharacterSheetVTT, { type CharacterSheetProps } from "./CharacterSheetVTT";
import { type ItemType } from "@/lib/rules/inventory";
import { useModalFocus } from "@/lib/hooks/useModalFocus";

interface CharacterSheetControllerProps {
  character: {
    id: string;
    name: string;
    race: string;
    class: string;
    level: number;
    hp: number;
    maxHp: number;
    xp: number;
    stats: unknown; // Json
    spellSlots?: unknown; // Json
  };
  inventory: Array<{
    id: string;
    name: string;
    type: string;
    quantity: number;
    equipped?: boolean;
    equippedSlot?: string | null;
    properties: unknown; // Json
  }>;
}

interface CharacterWeaponProperties {
  damageDice?: string;
  damageType?: string;
  properties?: string[];
}

function getModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

function formatModifier(mod: number): string {
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

export default function CharacterSheetController({ character, inventory }: CharacterSheetControllerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeSheet = useCallback(() => setIsOpen(false), []);
  const toggleSheet = useCallback(() => setIsOpen(prev => !prev), []);
  useModalFocus({ open: isOpen, onClose: closeSheet, dialogRef, initialFocusRef: closeRef, returnFocusRef: triggerRef });

  // ─── Data Mapping ───────────────────────────────────────────────────────────
  
  const stats = (character.stats as Record<string, number>) || {
    STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10
  };

  const proficiencyBonus = 2 + Math.floor((character.level - 1) / 4);
  const dexMod = getModifier(stats.DEX || 10);
  const wisMod = getModifier(stats.WIS || 10);

  // Basic AC calculation: 10 + DEX (plus armor if we had logic for it, but let's keep it simple for now or check inventory)
  let armorClass = 10 + dexMod;
  const equippedArmor = inventory.find(i => i.type === "armor" && i.equipped);
  if (equippedArmor?.properties) {
    const props = equippedArmor.properties as { baseAC?: number; addDexModifier?: boolean; maxDexBonus?: number };
    if (props.baseAC) {
      armorClass = props.baseAC;
      if (props.addDexModifier) {
        const bonus = props.maxDexBonus !== undefined ? Math.min(dexMod, props.maxDexBonus) : dexMod;
        armorClass += bonus;
      }
    }
  }

  const sheetProps: CharacterSheetProps = {
    identity: {
      name: character.name,
      className: character.class,
      level: character.level,
      race: character.race,
      // background and alignment not in DB yet
    },
    core: {
      armorClass,
      hitPoints: { current: character.hp, max: character.maxHp },
      initiative: dexMod,
      speedFeet: 30, // Human fallback
      proficiencyBonus,
      passivePerception: 10 + wisMod,
    },
    abilities: {
      str: { score: stats.STR, modifier: getModifier(stats.STR) },
      dex: { score: stats.DEX, modifier: getModifier(stats.DEX) },
      con: { score: stats.CON, modifier: getModifier(stats.CON) },
      int: { score: stats.INT, modifier: getModifier(stats.INT) },
      wis: { score: stats.WIS, modifier: getModifier(stats.WIS) },
      cha: { score: stats.CHA, modifier: getModifier(stats.CHA) },
    },
    savingThrows: [
      { label: "Strength", value: formatModifier(getModifier(stats.STR)) },
      { label: "Dexterity", value: formatModifier(getModifier(stats.DEX)) },
      { label: "Constitution", value: formatModifier(getModifier(stats.CON)) },
      { label: "Intelligence", value: formatModifier(getModifier(stats.INT)) },
      { label: "Wisdom", value: formatModifier(getModifier(stats.WIS)) },
      { label: "Charisma", value: formatModifier(getModifier(stats.CHA)) },
    ],
    skills: [
      { label: "Athletics", value: formatModifier(getModifier(stats.STR)) },
      { label: "Acrobatics", value: formatModifier(getModifier(stats.DEX)) },
      { label: "Stealth", value: formatModifier(getModifier(stats.DEX)) },
      { label: "Perception", value: formatModifier(getModifier(stats.WIS)) },
      { label: "Insight", value: formatModifier(getModifier(stats.WIS)) },
      { label: "Persuasion", value: formatModifier(getModifier(stats.CHA)) },
    ],
    attacks: inventory.filter(i => i.type === "weapon").map(w => {
      const props = w.properties as CharacterWeaponProperties;
      const isFinesse = (props.properties as string[])?.includes("finesse");
      const attackMod = isFinesse ? Math.max(getModifier(stats.STR), getModifier(stats.DEX)) : getModifier(stats.STR);
      
      return {
        id: w.id,
        name: w.name,
        bonus: attackMod + proficiencyBonus,
        damage: `${props.damageDice || "1d6"}${formatModifier(attackMod)} ${props.damageType || "slashing"}`,
        traits: props.properties || [],
      };
    }),
    inventory: inventory.map(i => ({
      id: i.id,
      name: i.name,
      quantity: i.quantity,
      category: i.type as ItemType,
      equipped: i.equipped,
      summary: i.name, // Fallback
    })),
    notes: [],
  };

  return (
    <>
      {/* Floating Toggle Button */}
      <button
        ref={triggerRef}
        type="button"
        onClick={toggleSheet}
        className="fixed bottom-20 right-4 z-40 lg:bottom-6 lg:right-6 flex h-14 w-14 items-center justify-center rounded-full shadow-2xl transition-all hover:scale-110 active:scale-95"
        style={{
          background: "linear-gradient(135deg, #B38B2D 0%, #8A6510 100%)",
          border: "2px solid rgba(232,200,74,0.4)",
          boxShadow: "0 0 20px rgba(179,139,45,0.4), inset 0 1px 0 rgba(255,255,255,0.2)",
        }}
        aria-label={isOpen ? "Close character sheet" : "View character sheet"}
      >
        {isOpen ? (
          <X className="h-7 w-7 text-amber-50" />
        ) : (
          <User className="h-7 w-7 text-amber-50" />
        )}
      </button>

      {/* Overlay Sheet */}
      {isOpen && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="character-sheet-dialog-title"
          tabIndex={-1}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
          style={{ background: "rgba(5,5,10,0.85)", backdropFilter: "blur(8px)" }}
        >
          <div 
            className="relative w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-xl shadow-[0_0_50px_rgba(0,0,0,0.5)]"
            style={{ 
              background: "#0A0A14",
              border: "1px solid rgba(179,139,45,0.3)",
            }}
          >
            <h2 id="character-sheet-dialog-title" className="sr-only">Character sheet for {character.name}</h2>
            {/* Close button inside modal */}
            <button
              ref={closeRef}
              type="button"
              onClick={closeSheet}
              className="absolute top-4 right-4 z-[60] p-2 rounded-full hover:bg-neutral-800 transition-colors"
              aria-label="Close character sheet"
            >
              <X className="h-6 w-6 text-neutral-400" />
            </button>

            <div className="p-1 sm:p-4">
              <CharacterSheetVTT {...sheetProps} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
