"use client";

import { useState, useEffect } from "react";
import type {
  InventoryItem,
  ItemType,
  WeaponProperties,
  ArmorProperties,
  ConsumableProperties,
  SpellProperties,
} from "@/lib/rules/inventory";

interface Props {
  campaignId: string;
}

// Display order and labels for each item type
const TYPE_ORDER: ItemType[] = ["weapon", "armor", "spell", "consumable", "misc"];
const TYPE_LABELS: Record<ItemType, string> = {
  weapon: "Weapons",
  armor: "Armor",
  spell: "Spells",
  consumable: "Consumables",
  misc: "Miscellaneous",
};

// ---------------------------------------------------------------------------
// Per-type detail lines
// ---------------------------------------------------------------------------

function WeaponDetail({ p }: { p: WeaponProperties }) {
  const bonus = p.damageBonus !== 0
    ? ` ${p.damageBonus >= 0 ? "+" : ""}${p.damageBonus}`
    : "";
  const tags = p.weaponProperties?.join(", ");
  return (
    <span className="text-neutral-400">
      {p.damageDice}{bonus} {p.damageType}
      {tags ? <span className="ml-1 text-neutral-500">· {tags}</span> : null}
    </span>
  );
}

function ArmorDetail({ p }: { p: ArmorProperties }) {
  const dex = p.addDexModifier
    ? p.maxDexBonus !== null ? ` + DEX (max ${p.maxDexBonus})` : " + DEX"
    : "";
  return (
    <span className="text-neutral-400">
      AC {p.baseAC}{dex}
      <span className="ml-1 text-neutral-500 capitalize">· {p.armorClass}</span>
    </span>
  );
}

function ConsumableDetail({ p }: { p: ConsumableProperties }) {
  const healing = p.healingDice
    ? `Heals ${p.healingDice}${p.healingBonus ? ` +${p.healingBonus}` : ""}`
    : null;
  const effects = p.effects?.join(", ");
  const charges = p.charges !== undefined ? `${p.charges} charge${p.charges !== 1 ? "s" : ""}` : null;
  const parts = [healing, effects, charges].filter(Boolean).join(" · ");
  return <span className="text-neutral-400">{parts || "—"}</span>;
}

function SpellDetail({ p }: { p: SpellProperties }) {
  const level = p.spellLevel === 0 ? "Cantrip" : `Level ${p.spellLevel}`;
  const dmg = p.damageDice ? ` · ${p.damageDice} ${p.damageType ?? ""}`.trim() : "";
  const components = p.components?.join("") ?? "";
  return (
    <span className="text-neutral-400">
      {level}{dmg}
      {components && <span className="ml-1 text-neutral-500">· {components}</span>}
      {p.castingTime && <span className="ml-1 text-neutral-500">· {p.castingTime}</span>}
    </span>
  );
}

function ItemDetail({ item }: { item: InventoryItem }) {
  const p = item.properties as unknown;
  switch (item.type as ItemType) {
    case "weapon":
      return <WeaponDetail p={p as WeaponProperties} />;
    case "armor":
      return <ArmorDetail p={p as ArmorProperties} />;
    case "consumable":
      return <ConsumableDetail p={p as ConsumableProperties} />;
    case "spell":
      return <SpellDetail p={p as SpellProperties} />;
    default:
      return <span className="text-neutral-500">{((p as Record<string, unknown>).description as string) ?? "—"}</span>;
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function InventoryPanel({ campaignId }: Props) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchInventory() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/campaign/${campaignId}/inventory`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          if (!cancelled) setError((data as { error?: string }).error ?? `Error ${res.status}`);
          return;
        }
        const data: InventoryItem[] = await res.json();
        if (!cancelled) setItems(data);
      } catch {
        if (!cancelled) setError("Network error. Could not load inventory.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchInventory();
    return () => { cancelled = true; };
  }, [campaignId]);

  // Group items by type, preserving TYPE_ORDER
  const grouped = TYPE_ORDER.reduce<Record<ItemType, InventoryItem[]>>(
    (acc, t) => {
      acc[t] = items.filter((i) => i.type === t);
      return acc;
    },
    { weapon: [], armor: [], spell: [], consumable: [], misc: [] }
  );

  const hasItems = items.length > 0;

  // --- Loading state ---
  if (loading) {
    return (
      <section aria-label="Inventory" aria-busy="true">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-neutral-400">
          Inventory
        </h2>
        <div className="space-y-1.5">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="h-9 animate-pulse rounded-md bg-neutral-800/60"
              aria-hidden="true"
            />
          ))}
        </div>
      </section>
    );
  }

  // --- Error state ---
  if (error) {
    return (
      <section aria-label="Inventory">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-neutral-400">
          Inventory
        </h2>
        <p role="alert" className="rounded-md bg-red-950/40 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      </section>
    );
  }

  // --- Empty state ---
  if (!hasItems) {
    return (
      <section aria-label="Inventory">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-neutral-400">
          Inventory
        </h2>
        <div className="rounded-lg border border-dashed border-neutral-700 bg-neutral-900/50 px-4 py-6 text-center">
          <p className="text-sm text-neutral-500">No items in inventory.</p>
        </div>
      </section>
    );
  }

  // --- Populated state ---
  return (
    <section aria-label="Inventory">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-neutral-400">
        Inventory
      </h2>
      <div className="space-y-5">
        {TYPE_ORDER.map((type) => {
          const group = grouped[type];
          if (group.length === 0) return null;
          return (
            <div key={type}>
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wider text-neutral-500">
                {TYPE_LABELS[type]}
              </h3>
              <ul className="space-y-1">
                {group.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-baseline gap-2 rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm"
                  >
                    {/* Quantity badge */}
                    {item.quantity > 1 && (
                      <span className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-xs text-neutral-400">
                        ×{item.quantity}
                      </span>
                    )}
                    {/* Name */}
                    <span className="flex-1 font-medium text-neutral-100">{item.name}</span>
                    {/* Per-type detail */}
                    <span className="shrink-0 text-xs">
                      <ItemDetail item={item} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
