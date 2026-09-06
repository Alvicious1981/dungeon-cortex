/**
 * tests/architecture/service-select-fields-exist.test.ts
 *
 * Known simple Character selects in rule services must only name fields that
 * exist on the real Prisma Character model.
 *
 * Hand-written DB interfaces can hide schema drift: TypeScript validates the
 * service wrapper, while injected unit-test doubles answer fields Prisma would
 * reject at runtime. That previously allowed both rest-service and
 * magic-service to carry `campaignId`, even though Character has no such field.
 *
 * Scope is deliberately narrow. These two call sites have flat Character
 * selects that this lightweight guard can attribute safely. A repository-wide
 * guard still needs a real parser before it can reason about nested relation
 * selects without false positives; navigation-service remains separate
 * follow-up work.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Field names declared on a model in schema.prisma. */
function fieldsOf(model: string): Set<string> {
  const lines = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8")
    .split("\n")
    .map((line) => line.trimEnd());

  const start = lines.findIndex((line) => line.trim() === `model ${model} {`);
  if (start === -1) throw new Error(`Model ${model} not found in schema.prisma`);

  const fields = new Set<string>();
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "}") break;
    const match = line.match(/^\s+([A-Za-z_][A-Za-z0-9_]*)\s+\S/);
    if (match) fields.add(match[1]!);
  }
  return fields;
}

function assertCharacterSelectUsesKnownFields(fileName: string): void {
  const source = readFileSync(
    join(process.cwd(), "lib", "rules", fileName),
    "utf8"
  );

  const call = source.match(
    /db\.character\.findUnique\(\{[\s\S]*?select:\s*\{([\s\S]*?)\},/
  );
  expect(call, `${fileName} character lookup has moved or been renamed`).not.toBeNull();

  const selected = [...call![1]!.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:\s*true/g)].map(
    (field) => field[1]!
  );
  // Guards the guard: an empty list would pass the schema assertion forever.
  expect(selected.length).toBeGreaterThan(3);

  const known = fieldsOf("Character");
  expect(selected.filter((field) => !known.has(field))).toEqual([]);
}

describe.each(["rest-service.ts", "magic-service.ts"])(
  "%s selects only Character fields the schema has",
  (fileName) => {
    it("names no field Character lacks", () => {
      assertCharacterSelectUsesKnownFields(fileName);
    });
  }
);
