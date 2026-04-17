import { describe, it, expect } from "vitest";
import { calculateVisibilityBatch } from "../../lib/rules/map-logic";

describe("Wilderness Map Logic", () => {
  describe("calculateVisibilityBatch", () => {
    it("returns 7 updates for a single position (1 discovered + 6 neighbors scouted)", () => {
      const updates = calculateVisibilityBatch(0, 0);
      expect(updates).toHaveLength(7);
    });

    it("marks the current position as 'discovered'", () => {
      const updates = calculateVisibilityBatch(10, 20);
      const center = updates.find(u => u.q === 10 && u.r === 20);
      expect(center?.status).toBe("discovered");
    });

    it("marks neighbors as 'scouted'", () => {
      const updates = calculateVisibilityBatch(0, 0);
      // Northeast neighbor at (1, -1)
      const ne = updates.find(u => u.q === 1 && u.r === -1);
      expect(ne?.status).toBe("scouted");
    });

    it("does not return status other than 'discovered' or 'scouted'", () => {
      const updates = calculateVisibilityBatch(5, 5);
      updates.forEach(u => {
        expect(["discovered", "scouted"]).toContain(u.status);
      });
    });

    it("includes all 6 neighbors of (0,0)", () => {
      const updates = calculateVisibilityBatch(0, 0);
      const neighborCoords = updates.filter(u => u.status === "scouted");
      expect(neighborCoords).toContainEqual(expect.objectContaining({ q: 1, r: -1 }));
      expect(neighborCoords).toContainEqual(expect.objectContaining({ q: 1, r: 0 }));
      expect(neighborCoords).toContainEqual(expect.objectContaining({ q: 0, r: 1 }));
      expect(neighborCoords).toContainEqual(expect.objectContaining({ q: -1, r: 1 }));
      expect(neighborCoords).toContainEqual(expect.objectContaining({ q: -1, r: 0 }));
      expect(neighborCoords).toContainEqual(expect.objectContaining({ q: 0, r: -1 }));
    });
  });
});
