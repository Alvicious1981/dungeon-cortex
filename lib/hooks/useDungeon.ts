"use client"

import { useMemo } from "react"
import { generateDungeon, computeFOV, type DungeonMap } from "../rules/dungeon"

export interface UseDungeonResult {
  dungeon: DungeonMap | null
  fov: Set<string>
  isReady: boolean
}

export function useDungeon(
  seed: string | null,
  playerX: number,
  playerY: number,
  options?: { width?: number; height?: number; nodeCount?: number }
): UseDungeonResult {
  const dungeon = useMemo(() => {
    if (!seed) return null
    return generateDungeon(seed, options)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, options?.width, options?.height, options?.nodeCount])

  const fov = useMemo(() => {
    if (!dungeon) return new Set<string>()
    return computeFOV(dungeon, playerX, playerY)
  }, [dungeon, playerX, playerY])

  return { dungeon, fov, isReady: dungeon !== null }
}
