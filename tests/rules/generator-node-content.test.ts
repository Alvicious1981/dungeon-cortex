/**
 * tests/rules/generator-node-content.test.ts
 *
 * `generateNodeContent` had no suite of its own. These cover one thing: the
 * mundane object an empty room may hold, and the fact that it lands in
 * `description` — the only node field the narrator actually receives
 * (`formatter.ts` prints `currentNode.description`; `featureData` is not on
 * `ContextExploration` at all). Writing it anywhere else would have produced
 * a value with no consumer.
 *
 * Node ids are chosen, not arbitrary: generation is seeded on the id, so
 * `node-3` falls in the empty branch with its oddity gate open and `node-1`
 * falls in the empty branch with the gate shut. Both were found by evaluating
 * the real `seededFloat`, so these are the actual branches, not assumptions.
 */
import { describe, it, expect, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { generateNodeContent } from "@/lib/rules/generator";
import { MUNDANE_LOOT } from "@/lib/rules/generators";

const WITH_OBJECT = "node-3";
const WITHOUT_OBJECT = "node-1";

function buildTx() {
  return {
    locationNode: {
      findUnique: vi.fn().mockResolvedValue({
        feature: "empty",
        description: "An unremarkable stretch of corridor.",
        featureData: null,
      }),
      update: vi.fn().mockResolvedValue({}),
    },
  } as unknown as Prisma.TransactionClient;
}

const writtenDescription = (tx: Prisma.TransactionClient): string =>
  (tx.locationNode.update as ReturnType<typeof vi.fn>).mock.calls[0]![0].data.description;

const objectsIn = (text: string): readonly string[] =>
  MUNDANE_LOOT.filter((entry) => text.includes(entry));

describe("generateNodeContent — mundane object in an empty room", () => {
  it("writes the object into the description the narrator receives", async () => {
    const tx = buildTx();

    await generateNodeContent(tx, WITH_OBJECT);

    const description = writtenDescription(tx);
    expect(objectsIn(description)).toHaveLength(1);
  });

  /**
   * The control. Without it the first test could pass on a generator that
   * always appends something, which is a different rule from the one intended.
   */
  it("writes no object when the seeded gate stays shut", async () => {
    const tx = buildTx();

    await generateNodeContent(tx, WITHOUT_OBJECT);

    expect(objectsIn(writtenDescription(tx))).toHaveLength(0);
  });

  it("keeps the atmospheric line the room already had", async () => {
    const tx = buildTx();

    await generateNodeContent(tx, WITH_OBJECT);

    // The object is added to the room's own description, never instead of it.
    const description = writtenDescription(tx);
    const [object] = objectsIn(description);
    expect(description.replace(object!, "").trim().length).toBeGreaterThan(20);
  });

  /**
   * Added after falsification exposed the gap: pinning the generator to a
   * constant seed passed every other test in this file, including the
   * determinism one — which compares a node against itself, and a constant
   * satisfies that just as well. Only two different rooms holding two
   * different objects proves the object is derived from the room.
   */
  it("derives the object from the room, not from a fixed seed", async () => {
    const first = buildTx();
    const second = buildTx();

    await generateNodeContent(first, WITH_OBJECT);
    await generateNodeContent(second, "node-4"); // gate also open, different object

    expect(objectsIn(writtenDescription(first))[0]).not.toBe(
      objectsIn(writtenDescription(second))[0]
    );
  });

  it("is deterministic: the same node always holds the same object", async () => {
    const first = buildTx();
    const second = buildTx();

    await generateNodeContent(first, WITH_OBJECT);
    await generateNodeContent(second, WITH_OBJECT);

    expect(writtenDescription(first)).toBe(writtenDescription(second));
  });
});
