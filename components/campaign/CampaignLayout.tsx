"use client";

import { useEffect, useState, type ReactNode } from "react";
import CampaignMobileNav from "./CampaignMobileNav";
import { Button } from "@/components/ui/Button";
import { DUNGEON_PREPARE_ACTION, DUNGEON_SHOW_ACTION, DUNGEON_ADVENTURE_VIEW } from "@/lib/events/campaign-ui";

export function CampaignActionLink() {
  return <Button variant="secondary" size="compact"
    onClick={() => window.dispatchEvent(new CustomEvent(DUNGEON_SHOW_ACTION))}>Actuar</Button>;
}

export default function CampaignLayout({ character, journal, children }: {
  character: ReactNode;
  journal: ReactNode;
  children: ReactNode;
}) {
  const [auxiliary, setAuxiliary] = useState<"character" | "journal">("journal");
  const [mobileArea, setMobileArea] = useState<"adventure" | "journal">("adventure");
  const [activeDestination, setActiveDestination] = useState<"scene" | "chronicle" | "commands" | "journal">("chronicle");
  const [preparedActionSequence, setPreparedActionSequence] = useState(0);
  const [navigation, setNavigation] = useState<{ area: string } | null>(null);

  useEffect(() => {
    function showPreparedAction() {
      setMobileArea("adventure");
      setActiveDestination("commands");
      setPreparedActionSequence((sequence) => sequence + 1);
    }
    function showAdventureView(event: Event) {
      setActiveDestination((event as CustomEvent).detail === "scene" ? "scene" : "chronicle");
    }
    window.addEventListener(DUNGEON_PREPARE_ACTION, showPreparedAction);
    window.addEventListener(DUNGEON_SHOW_ACTION, showPreparedAction);
    window.addEventListener(DUNGEON_ADVENTURE_VIEW, showAdventureView);
    if (location.hash === "#scene") setActiveDestination("scene");
    else if (location.hash === "#chronicle") setActiveDestination("chronicle");
    return () => {
      window.removeEventListener(DUNGEON_PREPARE_ACTION, showPreparedAction);
      window.removeEventListener(DUNGEON_SHOW_ACTION, showPreparedAction);
      window.removeEventListener(DUNGEON_ADVENTURE_VIEW, showAdventureView);
    };
  }, []);

  useEffect(() => {
    if (preparedActionSequence === 0) return;
    // Focus after React has exposed the adventure surface, including when the
    // request originated from the character dialog above the mobile journal.
    const input = document.getElementById("action-input") as HTMLInputElement | null;
    const target = input && !input.disabled ? input : document.getElementById("commands");
    target?.scrollIntoView({ block: "center" });
    target?.focus({ preventScroll: true });
  }, [preparedActionSequence]);

  function navigate(area: "scene" | "chronicle" | "commands" | "journal") {
    if (area !== "journal") window.dispatchEvent(new CustomEvent(DUNGEON_ADVENTURE_VIEW, { detail: area }));
    setMobileArea(area === "journal" ? "journal" : "adventure");
    if (area === "journal") setAuxiliary("journal");
    setActiveDestination(area);
    setNavigation({ area });
  }

  useEffect(() => {
    if (!navigation) return;
    const actionInput = document.getElementById("action-input") as HTMLInputElement | null;
    const target = navigation.area === "commands" && actionInput && !actionInput.disabled
      ? actionInput
      : document.getElementById(navigation.area);
    target?.scrollIntoView({ block: "start" });
    target?.focus({ preventScroll: true });
  }, [navigation]);

  return (
    <>
      <div className="dc-campaign-layout" data-auxiliary={auxiliary} data-mobile-area={mobileArea}>
        <div className="dc-campaign-character min-w-0">{character}</div>
        <div className="dc-campaign-adventure min-w-0">{children}</div>
        <div className="dc-auxiliary-selector" role="group" aria-label="Panel auxiliar">
          <button type="button" aria-pressed={auxiliary === "character"} onClick={() => setAuxiliary("character")}>Estado</button>
          <button type="button" aria-pressed={auxiliary === "journal"} onClick={() => setAuxiliary("journal")}>Diario</button>
        </div>
        <div className="dc-campaign-journal min-w-0">{journal}</div>
      </div>
      <CampaignMobileNav onNavigate={navigate} activeArea={activeDestination} />
    </>
  );
}
