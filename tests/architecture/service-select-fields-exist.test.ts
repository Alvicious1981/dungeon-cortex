/**
 * tests/architecture/service-select-fields-exist.test.ts
 *
 * `rest-service.ts` must not ask Prisma for a `Character` field the schema
 * does not have.
 *
 * The contract tests cannot catch this. The service reaches Prisma through a
 * hand-written interface and `resolveDb` casts `prisma as unknown as RestDb`,
 * so TypeScript checks the select against the wrapper's own shape and never
 * against the database. Its tests then inject a fake `tx` that answers
 * whatever it is asked. A select naming a column that does not exist is green
 * in every test and a 500 on the first real request.
 *
 * That is what happened: the select carried `campaignId`, which `Character`
 * does not have — only a `campaigns Campaign[]` relation — so
 * `POST /api/campaign/[id]/rest` and the action route's rest gate both threw
 * `Unknown field campaignId` against real Prisma, with 45 tests passing. It
 * was found by taking a rest in a running game, not by the suite.
 *
 * Scope, deliberately: this checks one call site in one file. A general guard
 * over every `select` in every service wrapper is the right shape and is worth
 * building — a first attempt found a second, dormant instance in
 * `navigation-service.ts:268` — but attributing a nested relation select to
 * the right model needs a real parser, and a guard that mis-attributes fails
 * on correct code, which is worse than not having one. Left as follow-up
 * rather than shipped half-working.
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

describe("rest-service selects only Character fields the schema has", () => {
  it("names no field Character lacks", () => {
    const source = readFileSync(
      join(process.cwd(), "lib", "rules", "rest-service.ts"),
      "utf8"
    );

    const call = source.match(
      /db\.character\.findUnique\(\{[\s\S]*?select:\s*\{([\s\S]*?)\},/
    );
    expect(call, "the character lookup this guards has moved or been renamed")
      .not.toBeNull();

    const selected = [...call![1]!.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:\s*true/g)].map(
      (field) => field[1]!
    );
    // Guards the guard: an empty list would pass the assertion below forever.
    expect(selected.length).toBeGreaterThan(3);

    const known = fieldsOf("Character");
    expect(selected.filter((field) => !known.has(field))).toEqual([]);
  });
});
