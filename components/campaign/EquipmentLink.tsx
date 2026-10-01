"use client";

import { Backpack } from "lucide-react";
import { openEquipmentSheet } from "@/lib/events/campaign-ui";
import { Button } from "@/components/ui/Button";

export default function EquipmentLink() {
  return <Button variant="secondary" size="compact" onClick={openEquipmentSheet} aria-haspopup="dialog" className="w-full">
    <Backpack size={18} aria-hidden="true" />Abrir Equipo
  </Button>;
}
