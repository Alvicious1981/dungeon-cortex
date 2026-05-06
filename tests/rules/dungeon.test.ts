import { generateDungeon, getTile, computeFOV, hasLineOfSight, type DungeonMap } from "../../lib/rules/dungeon"

const SEED = "test-dungeon-alpha"

describe("generateDungeon", () => {
  it("returns a map with expected dimensions", () => {
    const map = generateDungeon(SEED, { width: 80, height: 40 })
    expect(map.width).toBe(80)
    expect(map.height).toBe(40)
    expect(map.tiles).toHaveLength(40)
    expect(map.tiles[0]).toHaveLength(80)
  })

  it("is deterministic — same seed yields identical tiles", () => {
    const a = generateDungeon(SEED)
    const b = generateDungeon(SEED)
    expect(a.tiles).toEqual(b.tiles)
    expect(a.rooms.map(r => r.id)).toEqual(b.rooms.map(r => r.id))
  })

  it("different seeds yield different maps", () => {
    const a = generateDungeon("seed-one")
    const b = generateDungeon("seed-two")
    expect(a.seed).toBe("seed-one")
    expect(b.seed).toBe("seed-two")
    expect(a.rooms[0].centerX).not.toEqual(b.rooms[0].centerX)
  })

  it("all rooms have floors at their center tile", () => {
    const map = generateDungeon(SEED)
    for (const room of map.rooms) {
      expect(getTile(map, room.centerX, room.centerY)).toBe("floor")
    }
  })

  it("tile grid borders are all walls", () => {
    const map = generateDungeon(SEED, { width: 40, height: 20 })
    for (let x = 0; x < map.width; x++) {
      expect(map.tiles[0][x]).toBe("wall")
      expect(map.tiles[map.height - 1][x]).toBe("wall")
    }
    for (let y = 0; y < map.height; y++) {
      expect(map.tiles[y][0]).toBe("wall")
      expect(map.tiles[y][map.width - 1]).toBe("wall")
    }
  })

  it("generates at least 2 rooms", () => {
    const map = generateDungeon(SEED)
    expect(map.rooms.length).toBeGreaterThanOrEqual(2)
  })

  it("nodeIndex values are unique non-negative integers", () => {
    const map = generateDungeon(SEED, { nodeCount: 6 })
    const indices = map.rooms.map(r => r.nodeIndex)
    const unique = new Set(indices)
    expect(unique.size).toBe(indices.length)  // all unique
    expect(indices.every(i => i >= 0)).toBe(true)  // all non-negative
  })
})

describe("getTile", () => {
  it("returns 'wall' for out-of-bounds coordinates", () => {
    const map = generateDungeon(SEED, { width: 40, height: 20 })
    expect(getTile(map, -1, 0)).toBe("wall")
    expect(getTile(map, 0, -1)).toBe("wall")
    expect(getTile(map, 40, 0)).toBe("wall")
    expect(getTile(map, 0, 20)).toBe("wall")
  })

  it("applies modifications over base tiles", () => {
    const map = generateDungeon(SEED)
    const room = map.rooms[0]
    const modifiedMap: DungeonMap = {
      ...map,
      modifications: { [`${room.centerX},${room.centerY}`]: "door" },
    }
    expect(getTile(modifiedMap, room.centerX, room.centerY)).toBe("door")
  })
})

describe("computeFOV", () => {
  it("includes the origin tile in visible set", () => {
    const map = generateDungeon(SEED)
    const room = map.rooms[0]
    const visible = computeFOV(map, room.centerX, room.centerY)
    expect(visible.has(`${room.centerX},${room.centerY}`)).toBe(true)
  })

  it("does not include tiles beyond radius", () => {
    const map = generateDungeon(SEED, { width: 80, height: 40 })
    const room = map.rooms[0]
    const radius = 3
    const visible = computeFOV(map, room.centerX, room.centerY, radius)
    for (const key of visible) {
      const [x, y] = key.split(",").map(Number)
      const dx = x - room.centerX
      const dy = y - room.centerY
      expect(Math.sqrt(dx * dx + dy * dy)).toBeLessThanOrEqual(radius + 1)
    }
  })
})

describe("hasLineOfSight", () => {
  it("is true between two points in the same room", () => {
    const map = generateDungeon(SEED)
    const room = map.rooms[0]
    expect(
      hasLineOfSight(map, room.x + 1, room.y + 1, room.centerX, room.centerY)
    ).toBe(true)
  })

  it("is false when a wall is directly between two floor tiles", () => {
    const syntheticMap: DungeonMap = {
      seed: "synthetic",
      width: 5,
      height: 1,
      tiles: [["floor", "floor", "wall", "floor", "floor"]],
      rooms: [],
      corridors: [],
    }
    expect(hasLineOfSight(syntheticMap, 0, 0, 4, 0)).toBe(false)
  })
})
