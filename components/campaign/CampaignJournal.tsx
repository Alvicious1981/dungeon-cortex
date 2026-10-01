"use client";

import { useState, type ReactNode } from "react";
import { Tabs } from "@/components/ui/Tabs";

export default function CampaignJournal({ quests, characters, memories }: { quests: ReactNode; characters: ReactNode; memories: ReactNode }) {
  const [tab, setTab] = useState("quests");
  return <Tabs compact label="Secciones del diario" value={tab} onChange={setTab} items={[
    { id: "quests", label: "Misiones", content: quests },
    { id: "characters", label: "Personajes", content: characters },
    { id: "memories", label: "Memoria", content: memories },
  ]} />;
}
