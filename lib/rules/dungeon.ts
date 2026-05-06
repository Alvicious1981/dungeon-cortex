import * as ROT from "rot-js"

export type TileType = "wall" | "floor" | "door"

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

/** FNV-1a 32-bit hash — converts string seed to integer for ROT.RNG */
function seedToInt(seed: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0
  }
  return h
}

export function generateDungeon(
  seed: string,
  options: { width?: number; height?: number; nodeCount?: number } = {}
): DungeonMap {
  const width = options.width ?? 80
  const height = options.height ?? 40

  // ROT.RNG is global state — setSeed must be called immediately before new Map.Digger
  // to guarantee determinism. No async awaits between setSeed and create().
  ROT.RNG.setSeed(seedToInt(seed))

  const tiles: TileType[][] = Array.from({ length: height }, () =>
    Array<TileType>(width).fill("wall")
  )

  const digger = new ROT.Map.Digger(width, height, {
    roomWidth: [3, 12] as [number, number],
    roomHeight: [3, 9] as [number, number],
    dugPercentage: 0.4,
    timeLimit: 2000,
  })

  digger.create((x: number, y: number, wall: number) => {
    tiles[y][x] = wall === 0 ? "floor" : "wall"
  })

  const rawRooms = digger.getRooms()

  const rooms: DungeonRoom[] = rawRooms.map((r, i) => ({
    id: i,
    x: r.getLeft(),
    y: r.getTop(),
    width: r.getRight() - r.getLeft() + 1,
    height: r.getBottom() - r.getTop() + 1,
    centerX: Math.floor((r.getLeft() + r.getRight()) / 2),
    centerY: Math.floor((r.getTop() + r.getBottom()) / 2),
    nodeIndex: i,
  }))

  // Mark door tiles
  for (const r of rawRooms) {
    r.getDoors((x: number, y: number) => {
      tiles[y][x] = "door"
    })
  }

  // Build corridor adjacency from raw corridors
  const rawCorridors = digger.getCorridors()
  const corridors: Array<{ fromRoomId: number; toRoomId: number }> = []

  for (const corridor of rawCorridors) {
    // rot-js Corridor exposes private fields _startX/_startY/_endX/_endY
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = corridor as any
    const startX: number = c._startX
    const startY: number = c._startY
    const endX: number = c._endX
    const endY: number = c._endY

    const nearest = (px: number, py: number) =>
      rooms.reduce(
        (best, room) => {
          const d = Math.abs(room.centerX - px) + Math.abs(room.centerY - py)
          return d < best.dist ? { id: room.id, dist: d } : best
        },
        { id: 0, dist: Infinity }
      )

    const from = nearest(startX, startY)
    const to = nearest(endX, endY)
    if (from.id !== to.id) {
      corridors.push({ fromRoomId: from.id, toRoomId: to.id })
    }
  }

  return { seed, width, height, tiles, rooms, corridors }
}

export function getTile(map: DungeonMap, x: number, y: number): TileType {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return "wall"
  const override = map.modifications?.[`${x},${y}`]
  if (override !== undefined) return override
  return map.tiles[y][x]
}

export function computeFOV(
  map: DungeonMap,
  originX: number,
  originY: number,
  radius = 8
): Set<string> {
  const visible = new Set<string>()

  // RecursiveShadowcasting enforces strict euclidean distance (tiles stay within radius+1).
  // PreciseShadowcasting can return diagonal tiles at radius*sqrt(2) which violates the
  // radius+1 tolerance expected by callers.
  const fov = new ROT.FOV.RecursiveShadowcasting(
    (x: number, y: number) => getTile(map, x, y) !== "wall"
  )

  fov.compute(originX, originY, radius, (x: number, y: number) => {
    visible.add(`${x},${y}`)
  })

  return visible
}

export function hasLineOfSight(
  map: DungeonMap,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): boolean {
  // Bresenham's line algorithm — stop at first wall
  let x = x1
  let y = y1
  const dx = Math.abs(x2 - x1)
  const dy = Math.abs(y2 - y1)
  const sx = x1 < x2 ? 1 : -1
  const sy = y1 < y2 ? 1 : -1
  let err = dx - dy

  while (true) {
    if (x === x2 && y === y2) return true
    if (getTile(map, x, y) === "wall") return false
    const e2 = 2 * err
    if (e2 > -dy) {
      err -= dy
      x += sx
    }
    if (e2 < dx) {
      err += dx
      y += sy
    }
  }
}
