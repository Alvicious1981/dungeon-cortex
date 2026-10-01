"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Tabs } from "@/components/ui/Tabs";
import { DUNGEON_PREPARE_ACTION, DUNGEON_SHOW_ACTION, DUNGEON_ADVENTURE_VIEW } from "@/lib/events/campaign-ui";

export default function CampaignAdventure({ scene, story, children }: { scene: ReactNode; story: ReactNode; children: ReactNode }) {
  const [view, setView] = useState("story");
  const [anchor, setAnchor] = useState<{ id: string } | null>(null);
  useEffect(() => {
    if (!anchor) return;
    const target = document.getElementById(anchor.id);
    target?.scrollIntoView?.({ block: "start" });
    target?.focus({ preventScroll: true });
  }, [anchor]);
  useEffect(() => {
    const showStory = () => setView("story");
    const navigate = (event: Event) => setView((event as CustomEvent).detail === "scene" ? "scene" : "story");
    const hash = () => { if (location.hash === "#scene") setView("scene"); else if (location.hash === "#chronicle") setView("story"); };
    const followAnchor = (event: MouseEvent) => {
      if (event.defaultPrevented || !(event.target instanceof Element)) return;
      const link = event.target.closest('a[href="#chronicle"], a[href="#scene"]');
      if (!link) return;
      const id = link.getAttribute("href")!.slice(1);
      setView(id === "scene" ? "scene" : "story");
      setAnchor({ id });
    };
    hash();
    window.addEventListener(DUNGEON_ADVENTURE_VIEW, navigate);
    window.addEventListener(DUNGEON_PREPARE_ACTION, showStory);
    window.addEventListener(DUNGEON_SHOW_ACTION, showStory);
    window.addEventListener("hashchange", hash);
    document.addEventListener("click", followAnchor);
    return () => {
      window.removeEventListener(DUNGEON_ADVENTURE_VIEW, navigate);
      window.removeEventListener(DUNGEON_PREPARE_ACTION, showStory);
      window.removeEventListener(DUNGEON_SHOW_ACTION, showStory);
      window.removeEventListener("hashchange", hash);
      document.removeEventListener("click", followAnchor);
    };
  }, []);
  return <div className="min-w-0 space-y-4">
    <Tabs label="Vista de aventura" value={view} onChange={setView} items={[
      { id: "story", label: "Bitácora", content: story },
      { id: "scene", label: "Escena y mapas", content: scene },
    ]} />
    {children}
  </div>;
}
