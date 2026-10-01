"use client";

import { BookOpenText, Map, ScrollText, UserRound } from "lucide-react";
import { openCharacterSheet } from "@/lib/events/campaign-ui";

const ITEMS = [
  { href: "#scene", label: "Escena", icon: Map },
  { href: "#chronicle", label: "Bitácora", icon: BookOpenText },
  { href: "#journal", label: "Diario", icon: ScrollText },
] as const;

export default function CampaignMobileNav({ onNavigate, activeArea = "adventure" }: {
  onNavigate?: (area: "scene" | "chronicle" | "journal") => void;
  activeArea?: "adventure" | "journal";
}) {
  return (
    <nav
      aria-label="Áreas de campaña"
      className="dc-campaign-mobile-nav fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t px-[max(0.5rem,env(safe-area-inset-left))] pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      {ITEMS.map(({ href, label, icon: Icon }) => (
        <a
          key={href}
          href={href}
          onClick={(event) => {
            if (!onNavigate) return;
            event.preventDefault();
            onNavigate(href.slice(1) as "scene" | "chronicle" | "journal");
          }}
          aria-current={href === "#journal" && activeArea === "journal" ? "page" : undefined}
          className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-sm text-[10px] font-semibold uppercase tracking-wider"
        >
          <Icon aria-hidden="true" size={19} strokeWidth={1.6} />
          {label}
        </a>
      ))}
      <button type="button" onClick={openCharacterSheet} className="flex min-h-16 flex-col items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-wider">
        <UserRound aria-hidden="true" size={19} strokeWidth={1.6} />
        Personaje
      </button>
    </nav>
  );
}
