export type TileType = "wall" | "floor" | "door"

export interface DungeonTile {
  x: number
  y: number
  type: TileType
}

export interface DungeonRoom {
  id: number
  x: number
  y: number
  width: number
  height: number
  centerX: number
  centerY: number
  nodeIndex: number
}

export interface DungeonMap {
  seed: string
  width: number
  height: number
  tiles: TileType[][]
  rooms: DungeonRoom[]
  corridors: Array<{ fromRoomId: number; toRoomId: number }>
  modifications?: Record<string, TileType>
}

export function generateDungeon(
  seed: string,
  options?: { width?: number; height?: number; nodeCount?: number }
): DungeonMap {
  throw new Error("not implemented")
}

export function getTile(map: DungeonMap, x: number, y: number): TileType {
  throw new Error("not implemented")
}

export function computeFOV(
  map: DungeonMap,
  originX: number,
  originY: number,
  radius = 8
): Set<string> {
  throw new Error("not implemented")
}

export function hasLineOfSight(
  map: DungeonMap,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): boolean {
  throw new Error("not implemented")
}
