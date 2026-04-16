import React from "react";

export interface HavenHUDProps {
  currentWealth: number;
  havenUpkeep: number;
  retainerMorale: string;
}

export function HavenHUD({
  currentWealth,
  havenUpkeep,
  retainerMorale,
}: HavenHUDProps) {
  return (
    <div className="flex flex-col gap-2 p-4 border rounded shadow-sm bg-stone-900 text-stone-300">
      <h2 className="text-xl font-bold text-stone-100">Haven Status</h2>
      <div className="flex justify-between">
        <span className="font-semibold">Current Wealth:</span>
        <span>{currentWealth} GP</span>
      </div>
      <div className="flex justify-between">
        <span className="font-semibold">Haven Upkeep:</span>
        <span>{havenUpkeep} GP/day</span>
      </div>
      <div className="flex justify-between">
        <span className="font-semibold">Retainer Morale:</span>
        <span className="capitalize">{retainerMorale}</span>
      </div>
    </div>
  );
}
