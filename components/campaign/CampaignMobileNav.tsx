"use client";

import { BookOpenText, Crosshair, Map, ScrollText, UserRound } from "lucide-react";
import { openCharacterSheet } from "@/lib/events/campaign-ui";

const ITEMS = [
  { href: "#scene", label: "Escena", icon: Map },
  { href: "#chronicle", label: "Bitácora", icon: BookOpenText },
  { href: "#commands", label: "Actuar", icon: Crosshair },
  { href: "#journal", label: "Diario", icon: ScrollText },
] as const;

export default function CampaignMobileNav({ onNavigate, activeArea = "chronicle" }: {
  onNavigate?: (area: "scene" | "chronicle" | "commands" | "journal") => void;
  activeArea?: "scene" | "chronicle" | "commands" | "journal";
}) {
  return (
    <nav
      aria-label="Áreas de campaña"
      className="dc-campaign-mobile-nav fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t px-[max(0.25rem,env(safe-area-inset-left))] pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      {ITEMS.map(({ href, label, icon: Icon }) => (
        <a
          key={href}
          href={href}
          onClick={(event) => {
            if (!onNavigate) return;
            event.preventDefault();
            onNavigate(href.slice(1) as "scene" | "chronicle" | "commands" | "journal");
          }}
          aria-current={href.slice(1) === activeArea ? "page" : undefined}
          className="flex min-h-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-sm text-[9px] font-semibold uppercase tracking-wide transition-colors duration-200"
        >
          <Icon aria-hidden="true" size={19} strokeWidth={1.6} />
          {label}
        </a>
      ))}
      <button type="button" onClick={openCharacterSheet} className="flex min-h-16 cursor-pointer flex-col items-center justify-center gap-1 text-[9px] font-semibold uppercase tracking-wide transition-colors duration-200">
        <UserRound aria-hidden="true" size={19} strokeWidth={1.6} />
        Personaje
      </button>
    </nav>
  );
}
