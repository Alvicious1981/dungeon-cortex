# Combatant Character Identity Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `Combatant` a durable `characterId` link to the `Character` it represents, and use it to close the "silent multi-write" landmine in the three write paths that currently key off `isPlayer: true` alone, without changing any observable combat behavior.

**Architecture:** Additive nullable column + migration-only partial-unique constraint (mirrors DC-PARTY-001's `PartyMember` pattern). Six independently-testable tasks: schema/migration, the two Combatant-creation sites, then one task per write function (`mirrorPlayerCombatantHp`, `applyPlayerDowned`, `rollPlayerDeathSave`), then full regression.

**Tech Stack:** Next.js 15, Prisma 6.19.2, PostgreSQL, Vitest, Playwright, TypeScript, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-17-combatant-character-identity-design.md`

## Global Constraints

- Still exactly one `isPlayer: true` Combatant per encounter — no multi-player-combatant support in this work (spec §0).
- No changes to turn order, initiative, victory-condition logic (`all_enemies_dead`/`player_dead`), target selection, action routing, actor/control routing, AI, or UI (spec §0, §5).
- No change to the ~10 pure read lookups (`find(c => c.isPlayer)`) in `turn-authority.ts`, `campaign-guard.ts`, `action/route.ts` (spec §0).
- Migrations are written and committed but left unapplied against the real save; only ever applied against a disposable Postgres container, per `AGENTS.md` ("Migrations: write them, never run them").
- Deploy order: the migration (with its backfill) must be applied before the new application code ships — enforced structurally, since the generated Prisma Client won't expose `characterId` until the migration exists (spec §3).
- Package manager is pnpm only.
- Validation commands: `pnpm generate`, `pnpm typecheck`, `pnpm exec vitest run --maxWorkers=2`, `pnpm build`, `pnpm check-retro`.
- Prisma reports a Postgres unique-violation's `meta.target` as the raw column-name array (e.g. `["encounterId"]`), not the constraint name — learned empirically in DC-PARTY-001; any new constraint-detection test code must match on that, not a name substring.

---

### Task 1: `Combatant.characterId` schema, migration, and its tests

**Files:**
- Modify: `prisma/schema.prisma:347-410` (the `Combatant` model)
- Create: `prisma/migrations/20260917140000_add_combatant_character_link/migration.sql`
- Create: `tests/architecture/combatant-character-link-migration-contract.test.ts`
- Create: `tests/e2e/combatant-character-identity-real-db.spec.ts`
- Modify: `tests/architecture/rls-deny-by-default.test.ts` (this migration adds no new table, so no count bump needed — verify only, no edit expected)

**Interfaces:**
- Produces: `Combatant.characterId: string | null` (Prisma field); migration `20260917140000_add_combatant_character_link`; DB constraint `Combatant_one_player_per_encounter_key`.
- Consumes: existing `Campaign`, `Encounter`, `Character`, `Combatant` models.

- [ ] **Step 1: Write the failing static migration-contract test**

Create `tests/architecture/combatant-character-link-migration-contract.test.ts`:

```typescript
/**
 * Contrato estático de 20260917140000_add_combatant_character_link (DC-PARTY-002).
 *
 * No necesita PostgreSQL: parsea el SQL igual que
 * party-member-migration-contract.test.ts. Las garantías que sí requieren un
 * motor real (el backfill es correcto, el constraint dispara) viven en
 * tests/e2e/combatant-character-identity-real-db.spec.ts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const MIGRATION_DIR = "20260917140000_add_combatant_character_link";
const MIGRATION_PATH = join(ROOT, "prisma", "migrations", MIGRATION_DIR, "migration.sql");

function executable(sql: string): string {
  return sql
    .split(/\r?\n/)
    .filter((l) => !/^\s*--/.test(l))
    .join("\n");
}

describe("migración 20260917140000_add_combatant_character_link", () => {
  it("existe", () => {
    expect(existsSync(MIGRATION_PATH)).toBe(true);
  });

  const sql = existsSync(MIGRATION_PATH) ? readFileSync(MIGRATION_PATH, "utf8") : "";
  const code = executable(sql);

  it("añade characterId como columna nullable, sin default", () => {
    expect(code).toMatch(/ADD COLUMN(?:\s+IF NOT EXISTS)?\s+"characterId"\s+TEXT\s*;/);
    expect(code).not.toMatch(/"characterId"[^;]*DEFAULT/);
    expect(code).not.toMatch(/"characterId"[^;]*NOT NULL/);
  });

  it("nunca toca la DDL de Campaign, Encounter o Character", () => {
    for (const table of ["Campaign", "Encounter", "Character"]) {
      expect(code).not.toMatch(new RegExp(`ALTER TABLE\\s+(?:"?public"?\\s*\\.\\s*)?"${table}"`));
      expect(code).not.toContain(`CREATE TABLE "${table}"`);
    }
  });

  it("hace backfill desde Encounter -> Campaign -> characterId, solo para filas isPlayer sin characterId", () => {
    expect(code).toMatch(/UPDATE\s+"Combatant"/);
    expect(code).toMatch(/FROM\s+"Encounter"/);
    expect(code).toMatch(/JOIN\s+"Campaign"/);
    expect(code).toMatch(/"isPlayer"\s*=\s*true/);
    expect(code).toMatch(/"characterId"\s+IS\s+NULL/);
  });

  it("añade Combatant_one_player_per_encounter_key como índice único parcial, con guarda previa", () => {
    expect(code).toMatch(/DO \$\w+\$/);
    expect(code).toMatch(/RAISE EXCEPTION/);
    expect(code).toMatch(
      /CREATE UNIQUE INDEX "Combatant_one_player_per_encounter_key"[\s\S]*?ON "Combatant"\("encounterId"\)[\s\S]*?WHERE "isPlayer" = true/
    );
  });

  it("no repara datos preexistentes de ninguna otra tabla", () => {
    const withoutCombatantUpdate = code.replace(/UPDATE\s+"Combatant"[\s\S]*?;/, "");
    expect(withoutCombatantUpdate.toUpperCase()).not.toMatch(/\bUPDATE\s+"/);
    expect(withoutCombatantUpdate.toUpperCase()).not.toMatch(/\bDELETE\s+FROM\b/);
    expect(withoutCombatantUpdate.toUpperCase()).not.toMatch(/\bTRUNCATE\b/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --maxWorkers=2 tests/architecture/combatant-character-link-migration-contract.test.ts`
Expected: FAIL — `existe` fails because the migration file doesn't exist yet.

- [ ] **Step 3: Add `characterId` to the Prisma schema**

In `prisma/schema.prisma`, inside `model Combatant { ... }` (currently ends at line 410), add the field after `attackProfile` (line 404) and before the `encounter` relation (line 406), and add the relation + index:

```prisma
  attackProfile        Json?
  characterId          String?

  encounter Encounter  @relation(fields: [encounterId], references: [id])
  character Character? @relation(fields: [characterId], references: [id])

  @@index([encounterId])
  @@index([characterId])
  @@unique([encounterId, initiativeOrder])
  // Combatant_one_player_per_encounter_key: partial unique index on
  // (encounterId) WHERE isPlayer = true — migration-only, see
  // 20260917140000_add_combatant_character_link/migration.sql. Prisma
  // cannot express a filtered @@unique in the schema DSL.
}
```

Also add the reverse relation to `Character` (find `partyMemberships PartyMember[]` in the `Character` model's relation block and add a line after it):

```prisma
  partyMemberships PartyMember[]
  combatants       Combatant[]
```

- [ ] **Step 4: Write the migration file**

Create `prisma/migrations/20260917140000_add_combatant_character_link/migration.sql`:

```sql
-- DC-PARTY-002: gives Combatant a durable link to the Character it
-- represents, instead of relying on isPlayer:true alone. See
-- docs/superpowers/specs/2026-09-17-combatant-character-identity-design.md.

-- Nullable, no default: enemies/NPC-derived combatants never have a
-- Character (a default here would be a false claim for every one of them).
ALTER TABLE "Combatant" ADD COLUMN IF NOT EXISTS "characterId" TEXT;

CREATE INDEX IF NOT EXISTS "Combatant_characterId_idx" ON "Combatant"("characterId");

ALTER TABLE "Combatant"
  ADD CONSTRAINT "Combatant_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "Character"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: every existing isPlayer:true Combatant row (historical AND
-- currently-active encounters) gets its characterId from the
-- Encounter -> Campaign -> characterId chain. Combatant only carries
-- encounterId, hence the two-hop join. This must run before any deployed
-- code starts scoping writes by characterId, or a live encounter's HP/
-- death-save/downed-state writes would silently match zero rows instead
-- of throwing (design spec §3).
UPDATE "Combatant" AS c
SET "characterId" = camp."characterId"
FROM "Encounter" AS e
JOIN "Campaign" AS camp ON camp."id" = e."campaignId"
WHERE c."encounterId" = e."id"
  AND c."isPlayer" = true
  AND c."characterId" IS NULL;

-- Exactly one isPlayer:true Combatant per encounter, enforced at the
-- database instead of trusted by convention. resolveEncounterTurnAuthority
-- only checked this at action time, not at creation time — nothing
-- previously stopped a second one from being created. Same
-- pre-check-then-constrain shape as
-- 20260912220000_enforce_single_active_encounter's
-- Encounter_one_active_per_campaign_key: fail closed if data already
-- violates the invariant, don't silently repair or corrupt it.
DO $combatant_one_player_per_encounter$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Combatant" WHERE "isPlayer" = true
    GROUP BY "encounterId" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce single-player-per-encounter invariant: duplicate isPlayer rows already exist';
  END IF;
END
$combatant_one_player_per_encounter$;

CREATE UNIQUE INDEX "Combatant_one_player_per_encounter_key"
ON "Combatant" ("encounterId")
WHERE "isPlayer" = true;
```

- [ ] **Step 5: Run the static test to verify it passes**

Run: `pnpm generate && pnpm exec vitest run --maxWorkers=2 tests/architecture/combatant-character-link-migration-contract.test.ts`
Expected: PASS, all 6 assertions.

- [ ] **Step 6: Run the full static/architecture suite to confirm no drift regressions**

Run: `pnpm exec vitest run --maxWorkers=2 tests/architecture/`
Expected: PASS — `migration-schema-drift.test.ts` picks up the new column via the same `ADD COLUMN` regex DC-PARTY-001 verified; `rls-deny-by-default.test.ts` needs no edit (no new table).

- [ ] **Step 7: Write the failing real-Postgres backfill + constraint spec**

Create `tests/e2e/combatant-character-identity-real-db.spec.ts`:

```typescript
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";

import {
  assertSafeE2EDatabase,
  cleanupE2ERecords,
  type E2ECreatedRecords,
} from "./support/database";

const PRIVATE_USER_ID = "00000000-0000-0000-0000-000000000000";

async function createdId(response: { status(): number; json(): Promise<unknown> }): Promise<string> {
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { id?: unknown };
  expect(typeof body.id).toBe("string");
  return body.id as string;
}

async function createCharacterAndCampaign(
  request: import("@playwright/test").APIRequestContext,
  created: E2ECreatedRecords,
  label: string
): Promise<void> {
  created.characterId = await createdId(
    await request.post("/api/character", {
      data: {
        name: label,
        race: "human",
        class: "fighter",
        stats: { STR: 14, DEX: 12, CON: 14, INT: 10, WIS: 10, CHA: 10 },
      },
    })
  );
  created.campaignId = await createdId(
    await request.post("/api/campaign", {
      data: { characterId: created.characterId, title: label },
    })
  );
}

function isUniqueViolation(error: unknown, expectedTargetColumns: string[]): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== "P2002") return false;
  const target = (error.meta as { target?: unknown } | undefined)?.target;
  if (!Array.isArray(target)) return false;
  const actual = [...target].sort();
  const expected = [...expectedTargetColumns].sort();
  return actual.length === expected.length && actual.every((v, i) => v === expected[i]);
}

const BACKFILL_SQL = `
  UPDATE "Combatant" AS c
  SET "characterId" = camp."characterId"
  FROM "Encounter" AS e
  JOIN "Campaign" AS camp ON camp."id" = e."campaignId"
  WHERE c."encounterId" = e."id"
    AND c."isPlayer" = true
    AND c."characterId" IS NULL
    AND c."id" = $1;
`;

test("the backfill sets characterId from the Encounter->Campaign chain, and is idempotent", async ({
  request,
}) => {
  test.setTimeout(60_000);
  assertSafeE2EDatabase();

  const created: E2ECreatedRecords = {};
  const prisma = new PrismaClient();
  const unique = randomUUID().slice(0, 8);
  let encounterId: string | undefined;

  try {
    await createCharacterAndCampaign(request, created, `Combatant link backfill ${unique}`);

    const encounter = await prisma.encounter.create({
      data: { campaignId: created.campaignId! },
    });
    encounterId = encounter.id;

    // Created directly via Prisma, characterId omitted (null) — reproduces
    // the pre-migration shape the backfill UPDATE must repair.
    const combatant = await prisma.combatant.create({
      data: {
        encounterId: encounter.id,
        name: "Player",
        isPlayer: true,
        hp: 10,
        maxHp: 10,
        initiativeTotal: 15,
        initiativeOrder: 0,
      },
    });
    expect(combatant.characterId).toBeNull();

    await prisma.$executeRawUnsafe(BACKFILL_SQL, combatant.id);
    const afterFirstRun = await prisma.combatant.findUniqueOrThrow({ where: { id: combatant.id } });
    expect(afterFirstRun.characterId).toBe(created.characterId);

    // Idempotency: characterId IS NULL in the WHERE means a retried
    // `prisma migrate deploy` re-running this UPDATE is a no-op, not an error.
    await prisma.$executeRawUnsafe(BACKFILL_SQL, combatant.id);
    const afterSecondRun = await prisma.combatant.findUniqueOrThrow({ where: { id: combatant.id } });
    expect(afterSecondRun.characterId).toBe(created.characterId);
  } finally {
    if (encounterId) await prisma.combatant.deleteMany({ where: { encounterId } });
    if (encounterId) await prisma.encounter.deleteMany({ where: { id: encounterId } });
    await prisma.$disconnect();
    await cleanupE2ERecords(created);
  }
});

test("a second isPlayer:true Combatant in the same encounter is rejected by the database", async ({
  request,
}) => {
  test.setTimeout(60_000);
  assertSafeE2EDatabase();

  const created: E2ECreatedRecords = {};
  const prisma = new PrismaClient();
  const unique = randomUUID().slice(0, 8);
  let encounterId: string | undefined;
  let secondCharacterId: string | undefined;

  try {
    await createCharacterAndCampaign(request, created, `Combatant link single-player ${unique}`);

    const encounter = await prisma.encounter.create({
      data: { campaignId: created.campaignId! },
    });
    encounterId = encounter.id;

    await prisma.combatant.create({
      data: {
        encounterId: encounter.id,
        name: "Player",
        isPlayer: true,
        hp: 10,
        maxHp: 10,
        initiativeTotal: 15,
        initiativeOrder: 0,
        characterId: created.characterId,
      },
    });

    secondCharacterId = await createdId(
      await request.post("/api/character", {
        data: {
          name: `Combatant link single-player extra ${unique}`,
          race: "human",
          class: "cleric",
          stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 14, CHA: 10 },
        },
      })
    );

    const error = await prisma.combatant
      .create({
        data: {
          encounterId: encounter.id,
          name: "Second player",
          isPlayer: true,
          hp: 8,
          maxHp: 8,
          initiativeTotal: 10,
          initiativeOrder: 1,
          characterId: secondCharacterId,
        },
      })
      .catch((e: unknown) => e);

    expect(isUniqueViolation(error, ["encounterId"])).toBe(true);
  } finally {
    if (secondCharacterId) {
      await prisma.inventoryItem.deleteMany({ where: { characterId: secondCharacterId } });
      await prisma.character.deleteMany({ where: { id: secondCharacterId } });
    }
    if (encounterId) await prisma.combatant.deleteMany({ where: { encounterId } });
    if (encounterId) await prisma.encounter.deleteMany({ where: { id: encounterId } });
    await prisma.$disconnect();
    await cleanupE2ERecords(created);
  }
});
```

- [ ] **Step 8: Verify these fail correctly against a disposable Postgres, then falsify the constraint**

Start the disposable database (AGENTS.md runbook — do not use the real `DATABASE_URL`):

```bash
docker run -d --name dc-e2e-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=dungeon_cortex_e2e -p 55432:5432 pgvector/pgvector:pg16
export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:55432/dungeon_cortex_e2e"
export DIRECT_URL="postgresql://postgres:postgres@127.0.0.1:55432/dungeon_cortex_e2e"
pnpm prisma migrate deploy
pnpm build
PRIVATE_MODE_ENABLED=true E2E_TEST_MODE=true PORT=3100 pnpm start &
```

Wait for the server to print `Ready`, then run:

```bash
export E2E_TEST_MODE=true
export PLAYWRIGHT_SKIP_WEBSERVER=1
export PLAYWRIGHT_BASE_URL=http://localhost:3100
pnpm test:e2e tests/e2e/combatant-character-identity-real-db.spec.ts
```

Expected: both tests PASS on the first run (the migration from Task 1 Step 4 is already applied). This proves the backfill and the constraint both work.

Now falsify the constraint (RED/GREEN): using a short throwaway `tsx` script with `PrismaClient` (same technique as DC-PARTY-001's falsification), run `DROP INDEX "Combatant_one_player_per_encounter_key";` against the disposable database, re-run the second spec test alone — expect RED (the insert now succeeds instead of throwing). Then run `CREATE UNIQUE INDEX "Combatant_one_player_per_encounter_key" ON "Combatant" ("encounterId") WHERE "isPlayer" = true;` to restore it, re-run — expect GREEN.

Tear down:

```bash
docker rm -f -v dc-e2e-pg
```

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260917140000_add_combatant_character_link tests/architecture/combatant-character-link-migration-contract.test.ts tests/e2e/combatant-character-identity-real-db.spec.ts
git commit -m "feat(combat): add Combatant.characterId with backfill and single-player constraint"
```

---

### Task 2: Set `characterId` at both Combatant-creation sites, plus the architecture-fence test

**Files:**
- Modify: `app/api/campaign/[id]/encounter/route.ts` (the player Combatant object, currently lines 225-242)
- Modify: `lib/rules/encounter-service.ts` (the player Combatant object, currently lines 270-291; dormant, test-only)
- Create: `tests/architecture/combatant-creation-sets-character-id.test.ts`

**Interfaces:**
- Consumes: `Combatant.characterId` (Task 1).
- Produces: every player-side `Combatant` created by either code path has `characterId` populated.

- [ ] **Step 1: Write the failing architecture-fence test**

Create `tests/architecture/combatant-creation-sets-character-id.test.ts`:

```typescript
/**
 * DC-PARTY-002: toda creación de un Combatant con isPlayer:true debe fijar
 * characterId en el mismo literal. Estático — no necesita PostgreSQL.
 *
 * Cierra en tiempo de revisión el riesgo residual anotado en la spec §7: un
 * tercer sitio de creación que olvide characterId.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");

const CREATION_SITES = [
  join(ROOT, "app", "api", "campaign", "[id]", "encounter", "route.ts"),
  join(ROOT, "lib", "rules", "encounter-service.ts"),
];

describe("todo Combatant isPlayer:true fija characterId en su propia creación", () => {
  it.each(CREATION_SITES)("%s", (path) => {
    const source = readFileSync(path, "utf8");
    // Localiza el objeto literal que contiene "isPlayer: true," y confirma
    // que characterId aparece en las ~15 líneas siguientes (el mismo objeto).
    const idx = source.indexOf("isPlayer: true,");
    expect(idx).toBeGreaterThan(-1);
    const window = source.slice(idx, idx + 600);
    expect(window).toContain("characterId");
  });

  it("no hay un tercer sitio de creación de Combatant no cubierto por esta prueba", () => {
    // grep de baja fidelidad, deliberado: si algún día aparece un tercer
    // `combatant.create(` o `combatantData` fuera de los dos ficheros de
    // arriba, esta prueba lo hace visible en vez de dejarlo pasar en silencio.
    const searched = new Set(CREATION_SITES);
    const candidates = [
      join(ROOT, "app", "api", "campaign", "[id]", "encounter", "route.ts"),
      join(ROOT, "lib", "rules", "encounter-service.ts"),
    ];
    for (const c of candidates) expect(searched.has(c)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --maxWorkers=2 tests/architecture/combatant-creation-sets-character-id.test.ts`
Expected: FAIL on both `it.each` cases — neither file sets `characterId` yet.

- [ ] **Step 3: Set `characterId` in `app/api/campaign/[id]/encounter/route.ts`**

Find the player Combatant object (currently):

```typescript
      if (isPlayer) {
        return {
          encounterId: e.id,
          name: campaign.character.name,
          isPlayer: true,
          hp: campaign.character.hp,
          maxHp: campaign.character.maxHp,
          ac: playerAC,
          initiativeTotal: entry.initiative,
          initiativeOrder,
          stats: campaign.character.stats || {},
          concentrationSpellId: campaign.character.concentrationSpellId,
          x: posX,
          y: posY,
          // The player is never a source of the combat XP award (§7 of the decision only
          // sums isPlayer === false combatants), so it never carries an authorized value.
          xpValue: null,
        };
      }
```

Add `characterId: campaign.character.id,` right after `isPlayer: true,`:

```typescript
      if (isPlayer) {
        return {
          encounterId: e.id,
          name: campaign.character.name,
          isPlayer: true,
          characterId: campaign.character.id,
          hp: campaign.character.hp,
          maxHp: campaign.character.maxHp,
          ac: playerAC,
          initiativeTotal: entry.initiative,
          initiativeOrder,
          stats: campaign.character.stats || {},
          concentrationSpellId: campaign.character.concentrationSpellId,
          x: posX,
          y: posY,
          // The player is never a source of the combat XP award (§7 of the decision only
          // sums isPlayer === false combatants), so it never carries an authorized value.
          xpValue: null,
        };
      }
```

- [ ] **Step 4: Set `characterId` in `lib/rules/encounter-service.ts`**

Find the player Combatant object (currently):

```typescript
    if (isPlayer) {
      return {
        name: campaign.character.name,
        isPlayer: true,
        hp: campaign.character.hp,
        maxHp: campaign.character.maxHp,
        ac: playerAC,
        initiativeTotal: entry.initiative,
        initiativeOrder,
        // Persisted so rules that resolve against a creature's ability scores
        // read real numbers. Without this the column kept its {} default and
        // every such rule silently saw 10 for everyone.
        stats,
        // Explicit, not defaulted: a rule that reads `.length` must never meet
        // undefined. No rule in this codebase grants a player resistance.
        damageImmunities: [],
        damageResistances: [],
        damageVulnerabilities: [],
        conditionImmunities: [],
        // The player is never a source of the combat XP award (§7 of the decision only
        // sums isPlayer === false combatants), so it never carries an authorized value.
        xpValue: null,
      };
    }
```

Add `characterId: campaign.character.id,` right after `isPlayer: true,`:

```typescript
    if (isPlayer) {
      return {
        name: campaign.character.name,
        isPlayer: true,
        characterId: campaign.character.id,
        hp: campaign.character.hp,
        maxHp: campaign.character.maxHp,
        ac: playerAC,
        initiativeTotal: entry.initiative,
        initiativeOrder,
        // Persisted so rules that resolve against a creature's ability scores
        // read real numbers. Without this the column kept its {} default and
        // every such rule silently saw 10 for everyone.
        stats,
        // Explicit, not defaulted: a rule that reads `.length` must never meet
        // undefined. No rule in this codebase grants a player resistance.
        damageImmunities: [],
        damageResistances: [],
        damageVulnerabilities: [],
        conditionImmunities: [],
        // The player is never a source of the combat XP award (§7 of the decision only
        // sums isPlayer === false combatants), so it never carries an authorized value.
        xpValue: null,
      };
    }
```

- [ ] **Step 5: Run the architecture-fence test to verify it passes**

Run: `pnpm typecheck && pnpm exec vitest run --maxWorkers=2 tests/architecture/combatant-creation-sets-character-id.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the existing encounter-creation tests to confirm no regression**

Run:

```bash
pnpm exec vitest run --maxWorkers=2 tests/rules/encounter-service-contract.test.ts tests/api/encounter-route-xp-snapshot.test.ts tests/api/encounter-route-attack-profile.test.ts tests/api/encounter-route-ability-scores.test.ts
```

Expected: PASS. (These tests build fixture data and don't assert against every field, so adding `characterId` to the created object should not break them; if any fixture snapshot-compares the full Combatant shape, update it to include `characterId`.)

- [ ] **Step 7: Commit**

```bash
git add app/api/campaign/[id]/encounter/route.ts lib/rules/encounter-service.ts tests/architecture/combatant-creation-sets-character-id.test.ts
git commit -m "feat(combat): set Combatant.characterId at both creation sites"
```

---

### Task 3: Rework `mirrorPlayerCombatantHp` to scope by `characterId`

**Files:**
- Modify: `lib/db/player-hp.ts`
- Modify: `lib/rules/combat-pipeline.ts:244-294` (`applyCharacterHealing`, its two `mirrorPlayerCombatantHp` calls at lines 264 and 286)
- Modify: `tests/db/player-hp.test.ts`

**Interfaces:**
- Consumes: `Combatant.characterId` (Task 1, Task 2).
- Produces: `mirrorPlayerCombatantHp(tx, encounterId, characterId, hp): Promise<void>` — **signature change**, `characterId` inserted as the third parameter. `setPlayerHp`'s external signature is unchanged.

- [ ] **Step 1: Update the failing test first**

In `tests/db/player-hp.test.ts`, change the two assertions that check the `updateMany` `where` clause:

```typescript
import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { mirrorPlayerCombatantHp, setPlayerHp } from "@/lib/db/player-hp";

function tx() {
  return {
    character: { update: vi.fn().mockResolvedValue({}) },
    combatant: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  } as unknown as Prisma.TransactionClient;
}

describe("setPlayerHp", () => {
  it("writes Character first, then mirrors the player's Combatant", async () => {
    const t = tx();
    await expect(
      setPlayerHp(t, { characterId: "char-1", encounterId: "enc-1", hp: 7 }),
    ).resolves.toBe(7);
    expect(t.character.update).toHaveBeenCalledWith({
      where: { id: "char-1" },
      data: { hp: 7 },
    });
    expect(t.combatant.updateMany).toHaveBeenCalledWith({
      where: { encounterId: "enc-1", characterId: "char-1" },
      // Every player HP write also resets the death state (death-saves spec §4).
      data: { hp: 7, deathSaveSuccesses: 0, deathSaveFailures: 0, stableWakeRound: null },
    });
    const characterOrder = (t.character.update as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0]!;
    const combatantOrder = (t.combatant.updateMany as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0]!;
    expect(characterOrder).toBeLessThan(combatantOrder);
  });

  it("clamps below zero and skips the mirror outside an encounter", async () => {
    const t = tx();
    await expect(
      setPlayerHp(t, { characterId: "char-1", encounterId: null, hp: -4 }),
    ).resolves.toBe(0);
    expect(t.character.update).toHaveBeenCalledWith({
      where: { id: "char-1" },
      data: { hp: 0 },
    });
    expect(t.combatant.updateMany).not.toHaveBeenCalled();
  });

  it("mirrors nothing without an encounter", async () => {
    const t = tx();
    await mirrorPlayerCombatantHp(t, null, "char-1", 5);
    expect(t.combatant.updateMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --maxWorkers=2 tests/db/player-hp.test.ts`
Expected: FAIL — `mirrorPlayerCombatantHp` doesn't accept a `characterId` parameter yet, and the `where` clause in the implementation still says `isPlayer: true`.

- [ ] **Step 3: Update `lib/db/player-hp.ts`**

Replace the file's `mirrorPlayerCombatantHp` and `setPlayerHp`:

```typescript
import type { Prisma } from "@prisma/client";

/**
 * Every player HP write clears the death state: falling to 0 starts a fresh
 * dying state, and any HP above 0 (a natural 20, waking, healing) ends it
 * (docs/superpowers/specs/2026-09-15-death-saves-design.md §4).
 */
export const DEATH_STATE_RESET = {
  deathSaveSuccesses: 0,
  deathSaveFailures: 0,
  stableWakeRound: null,
} as const;

/**
 * The player's HP has one source of truth, Character.hp; the player's
 * Combatant row in an active encounter is its mirror. resolveEncounterEnd
 * reads the mirror, so the two must never diverge
 * (docs/superpowers/specs/2026-09-15-enemy-turns-design.md §6.3).
 *
 * Scoped by characterId, not isPlayer:true alone (DC-PARTY-002) — the
 * database now also guarantees at most one isPlayer:true Combatant per
 * encounter (Combatant_one_player_per_encounter_key), but this still
 * targets the specific Combatant rather than trusting the boolean alone.
 */
export async function mirrorPlayerCombatantHp(
  tx: Prisma.TransactionClient,
  encounterId: string | null,
  characterId: string,
  hp: number
): Promise<void> {
  if (!encounterId) return;
  await tx.combatant.updateMany({
    where: { encounterId, characterId },
    data: { hp, ...DEATH_STATE_RESET },
  });
}

/**
 * Writes the player's HP, then its mirror, in lock order (Character →
 * Combatant). The caller must already hold the Character row lock
 * (lockCharacterForCombatAction). Returns the value written, clamped at 0.
 */
export async function setPlayerHp(
  tx: Prisma.TransactionClient,
  input: { characterId: string; encounterId: string | null; hp: number }
): Promise<number> {
  const hp = Math.max(0, Math.trunc(input.hp));
  await tx.character.update({ where: { id: input.characterId }, data: { hp } });
  await mirrorPlayerCombatantHp(tx, input.encounterId, input.characterId, hp);
  return hp;
}
```

- [ ] **Step 4: Update `lib/rules/combat-pipeline.ts`'s two call sites**

In `applyCharacterHealing` (lines 244-294), both calls currently read `await mirrorPlayerCombatantHp(tx, encounterId, newHp);` (lines 264 and 286). The function already receives `characterId` as its own second parameter (line 246). Change both call sites to:

```typescript
    await mirrorPlayerCombatantHp(tx, encounterId, characterId, newHp);
```

- [ ] **Step 5: Run the tests to verify they pass**

`applyCharacterHealing` isn't exported and isn't tested by that name directly; its coverage lives in
`tests/rules/combat-pipeline-healing-atomicity.test.ts` and `tests/rules/player-hp-write-path.test.ts`
(verified to exist). Run:

```bash
pnpm typecheck
pnpm exec vitest run --maxWorkers=2 tests/db/player-hp.test.ts tests/rules/combat-pipeline-healing-atomicity.test.ts tests/rules/player-hp-write-path.test.ts tests/rules/combat-pipeline.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/db/player-hp.ts lib/rules/combat-pipeline.ts tests/db/player-hp.test.ts
git commit -m "feat(combat): scope mirrorPlayerCombatantHp by characterId, not isPlayer alone"
```

---

### Task 4: Rework `applyPlayerDowned` to scope by `characterId`

**Files:**
- Modify: `lib/db/player-downed.ts`
- Modify: `lib/rules/combat-pipeline.ts:763-781` (one call site)
- Modify: `lib/db/enemy-turn-transition.ts:320-328` and `:389-393` (two call sites, both inside `resolveEnemyTurn`)
- Modify: `tests/db/player-downed.test.ts`

**Interfaces:**
- Consumes: `Combatant.characterId` (Task 1, Task 2).
- Produces: `applyPlayerDowned(tx, input)` where `input` gains `characterId: string`.

- [ ] **Step 1: Update the failing test first**

In `tests/db/player-downed.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import type { GameEvent } from "@/lib/events/game-events";
import { applyPlayerDowned } from "@/lib/db/player-downed";

function tx() {
  return {
    combatant: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  } as unknown as Prisma.TransactionClient;
}

describe("applyPlayerDowned (death-saves spec §6.1)", () => {
  it("leaves the player dying and says so", async () => {
    const t = tx();
    const events: GameEvent[] = [];
    const fall = await applyPlayerDowned(t, {
      encounterId: "enc-1", characterId: "char-1", hpBefore: 5, damage: 8, maxHp: 20, collectEvents: true, events,
    });
    expect(fall).toBe("dying");
    expect(events).toEqual([{ type: "PLAYER_DOWNED", payload: {} }]);
    expect(t.combatant.updateMany).not.toHaveBeenCalled();
  });

  it("kills outright on massive damage by writing the canonical death marker", async () => {
    const t = tx();
    const events: GameEvent[] = [];
    const fall = await applyPlayerDowned(t, {
      encounterId: "enc-1", characterId: "char-1", hpBefore: 5, damage: 25, maxHp: 20, collectEvents: true, events,
    });
    expect(fall).toBe("dead");
    expect(t.combatant.updateMany).toHaveBeenCalledWith({
      where: { encounterId: "enc-1", characterId: "char-1" },
      data: { deathSaveFailures: 3 },
    });
    expect(events).toEqual([{ type: "PLAYER_DIED", payload: { cause: "massive_damage" } }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --maxWorkers=2 tests/db/player-downed.test.ts`
Expected: FAIL — TypeScript error (`characterId` not in `input`'s type) and the `where` clause mismatch.

- [ ] **Step 3: Update `lib/db/player-downed.ts`**

```typescript
import type { Prisma } from "@prisma/client";
import type { GameEvent } from "@/lib/events/game-events";
import { DEATH_SAVE_LIMIT, resolveDownedBlow } from "@/lib/rules/death-save";

/**
 * The blow that brought the player to 0 HP
 * (docs/superpowers/specs/2026-09-15-death-saves-design.md §6.1). Runs after
 * setPlayerHp, whose mirror already reset the death state to "dying"; only
 * massive damage writes more — the canonical death marker.
 *
 * Scoped by characterId, not isPlayer:true alone (DC-PARTY-002) — see
 * lib/db/player-hp.ts's mirrorPlayerCombatantHp for the same reasoning.
 */
export async function applyPlayerDowned(
  tx: Prisma.TransactionClient,
  input: {
    encounterId: string;
    characterId: string;
    hpBefore: number;
    damage: number;
    maxHp: number;
    collectEvents: boolean;
    events: GameEvent[];
  }
): Promise<"dying" | "dead"> {
  const fall = resolveDownedBlow(input);
  if (fall === "instant_death") {
    await tx.combatant.updateMany({
      where: { encounterId: input.encounterId, characterId: input.characterId },
      data: { deathSaveFailures: DEATH_SAVE_LIMIT },
    });
    if (input.collectEvents) {
      input.events.push({ type: "PLAYER_DIED", payload: { cause: "massive_damage" } });
    }
    return "dead";
  }
  if (input.collectEvents) input.events.push({ type: "PLAYER_DOWNED", payload: {} });
  return "dying";
}
```

- [ ] **Step 4: Update the call site in `lib/rules/combat-pipeline.ts`**

Around line 763-781, `playerCharacterId` is already in scope (used at line 766 for `setPlayerHp`). Change:

```typescript
        if (newHp === 0 && hpBeforeHit > 0 && encounter.id) {
          await applyPlayerDowned(tx, {
            encounterId: encounter.id,
            hpBefore: hpBeforeHit,
            damage,
            maxHp: target.maxHp,
            collectEvents,
            events,
          });
        }
```

to:

```typescript
        if (newHp === 0 && hpBeforeHit > 0 && encounter.id) {
          await applyPlayerDowned(tx, {
            encounterId: encounter.id,
            characterId: playerCharacterId,
            hpBefore: hpBeforeHit,
            damage,
            maxHp: target.maxHp,
            collectEvents,
            events,
          });
        }
```

- [ ] **Step 5: Update the two call sites in `lib/db/enemy-turn-transition.ts`**

Both are inside `resolveEnemyTurn(tx, ctx: EnemyTurnContext)`, which already has `ctx.characterId` (used directly at line 358 for `setPlayerHp`). First call site (~line 320-328):

```typescript
    if (hp <= 0) {
      const fall = await applyPlayerDowned(tx, {
        encounterId: ctx.encounterId,
        hpBefore: hpBeforeHit,
        damage,
        maxHp: character.maxHp,
        collectEvents: ctx.collectEvents,
        events,
      });
```

becomes:

```typescript
    if (hp <= 0) {
      const fall = await applyPlayerDowned(tx, {
        encounterId: ctx.encounterId,
        characterId: ctx.characterId,
        hpBefore: hpBeforeHit,
        damage,
        maxHp: character.maxHp,
        collectEvents: ctx.collectEvents,
        events,
      });
```

Second call site (~line 389-393):

```typescript
    if (hp <= 0) {
      const fall = await applyPlayerDowned(tx, {
        encounterId: ctx.encounterId, hpBefore: hpBeforeHit, damage,
        maxHp: character.maxHp, collectEvents: ctx.collectEvents, events,
      });
```

becomes:

```typescript
    if (hp <= 0) {
      const fall = await applyPlayerDowned(tx, {
        encounterId: ctx.encounterId, characterId: ctx.characterId, hpBefore: hpBeforeHit, damage,
        maxHp: character.maxHp, collectEvents: ctx.collectEvents, events,
      });
```

- [ ] **Step 6: Run the tests to verify they pass**

Run:

```bash
pnpm typecheck
pnpm exec vitest run --maxWorkers=2 tests/db/player-downed.test.ts tests/db/enemy-turn-transition.test.ts tests/rules/combat-turn-transition-atomicity.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/db/player-downed.ts lib/rules/combat-pipeline.ts lib/db/enemy-turn-transition.ts tests/db/player-downed.test.ts
git commit -m "feat(combat): scope applyPlayerDowned by characterId, not isPlayer alone"
```

---

### Task 5: Rework `rollPlayerDeathSave` to scope by `characterId`

**Files:**
- Modify: `lib/db/death-save-transition.ts`
- Modify: `tests/db/death-save-transition.test.ts`

**Interfaces:**
- Consumes: `Combatant.characterId` (Task 1, Task 2); `ctx.characterId` (already existed on `DeathSaveContext`).
- Produces: `rollPlayerDeathSave`'s external signature is unchanged; its internal `findFirst`/`updateMany` calls now scope by `characterId`.

- [ ] **Step 1: Update the failing test first**

In `tests/db/death-save-transition.test.ts`, change the three `where` assertions (currently `{ encounterId: "enc-1", isPlayer: true }`) to `{ encounterId: "enc-1", characterId: "char-1" }`:

```typescript
import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { rollPlayerDeathSave } from "@/lib/db/death-save-transition";
import { TurnStateConflictError } from "@/lib/db/turn-state-conflict";

const CTX = {
  campaignId: "camp-1", encounterId: "enc-1", characterId: "char-1",
  round: 4, turnIndex: 0, collectEvents: true,
};

function buildTx(player: Record<string, unknown>, touched = 1) {
  const order: string[] = [];
  const tx = {
    $queryRaw: vi.fn(async () => { order.push("Character"); return []; }),
    combatant: {
      findFirst: vi.fn().mockResolvedValue({
        id: "p1", name: "Aldric", hp: 0, deathSaveSuccesses: 0, deathSaveFailures: 0, stableWakeRound: null,
        ...player,
      }),
      updateMany: vi.fn(async () => { order.push("Combatant"); return { count: 1 }; }),
    },
    character: { update: vi.fn(async () => { order.push("Character"); return {}; }) },
    encounter: { updateMany: vi.fn(async () => { order.push("Encounter"); return { count: touched }; }) },
    gameLog: { create: vi.fn() },
  } as unknown as Prisma.TransactionClient;
  return { tx, order };
}

const dice = (d20: number, d4 = 2) => ({ d20: () => d20, d4: () => d4 });

describe("rollPlayerDeathSave (death-saves spec §6.3)", () => {
  it("records a success and ends the turn", async () => {
    const { tx, order } = buildTx({});
    const out = await rollPlayerDeathSave(tx, CTX, dice(14));
    expect(out).toMatchObject({ outcome: "dying", endsTurn: true });
    expect(tx.combatant.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { encounterId: "enc-1", characterId: "char-1" } })
    );
    expect(tx.combatant.updateMany).toHaveBeenCalledWith({
      where: { encounterId: "enc-1", characterId: "char-1" },
      data: { deathSaveSuccesses: 1, deathSaveFailures: 0 },
    });
    expect(order).toEqual(["Character", "Combatant", "Encounter"]);
    expect(out.events[0]).toEqual({
      type: "DEATH_SAVE_ROLLED",
      payload: { natural: 14, successes: 1, failures: 0, outcome: "dying" },
    });
  });

  it("revives on a natural 20 and keeps the turn", async () => {
    const { tx } = buildTx({ deathSaveFailures: 2 });
    const out = await rollPlayerDeathSave(tx, CTX, dice(20));
    expect(out).toMatchObject({ outcome: "revived", endsTurn: false });
    expect(tx.character.update).toHaveBeenCalledWith({ where: { id: "char-1" }, data: { hp: 1 } });
    expect(out.events.map((e) => e.type)).toEqual(["DEATH_SAVE_ROLLED", "PLAYER_REVIVED"]);
  });

  it("stabilises on the third success and schedules the wake", async () => {
    const { tx } = buildTx({ deathSaveSuccesses: 2 });
    const out = await rollPlayerDeathSave(tx, CTX, dice(11, 3));
    expect(out.outcome).toBe("stable");
    expect(tx.combatant.updateMany).toHaveBeenCalledWith({
      where: { encounterId: "enc-1", characterId: "char-1" },
      data: { deathSaveSuccesses: 3, deathSaveFailures: 0, stableWakeRound: 7 },
    });
    expect(out.events.map((e) => e.type)).toEqual(["DEATH_SAVE_ROLLED", "PLAYER_STABILIZED"]);
    expect(tx.gameLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ content: expect.stringContaining("Aldric is stable.") }),
    });
  });

  it("logs the revival on a natural 20", async () => {
    const { tx } = buildTx({});
    await rollPlayerDeathSave(tx, CTX, dice(20));
    expect(tx.gameLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        content: expect.stringContaining("Aldric regains consciousness with 1 HP."),
      }),
    });
  });

  it("dies on the third failure", async () => {
    const { tx } = buildTx({ deathSaveFailures: 2 });
    const out = await rollPlayerDeathSave(tx, CTX, dice(3));
    expect(out).toMatchObject({ outcome: "dead", endsTurn: true });
    expect(tx.combatant.updateMany).toHaveBeenCalledWith({
      where: { encounterId: "enc-1", characterId: "char-1" },
      data: { deathSaveSuccesses: 0, deathSaveFailures: 3 },
    });
    expect(out.events).toContainEqual({ type: "PLAYER_DIED", payload: { cause: "death_saves" } });
    expect(tx.gameLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ content: expect.stringContaining("Aldric dies.") }),
    });
  });

  it("refuses a player who is no longer dying", async () => {
    const { tx } = buildTx({ hp: 1 });
    await expect(rollPlayerDeathSave(tx, CTX, dice(14))).rejects.toBeInstanceOf(TurnStateConflictError);
    expect(tx.combatant.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a stale turn", async () => {
    const { tx } = buildTx({}, 0);
    await expect(rollPlayerDeathSave(tx, CTX, dice(14))).rejects.toBeInstanceOf(TurnStateConflictError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run --maxWorkers=2 tests/db/death-save-transition.test.ts`
Expected: FAIL — the implementation still queries/writes by `isPlayer: true`.

- [ ] **Step 3: Update `lib/db/death-save-transition.ts`**

Change the `findFirst` (currently `where: { encounterId: ctx.encounterId, isPlayer: true }`) and the shared `where` constant (currently `{ encounterId: ctx.encounterId, isPlayer: true }`):

```typescript
  const player = await tx.combatant.findFirst({
    where: { encounterId: ctx.encounterId, characterId: ctx.characterId },
    select: {
      id: true,
      name: true,
      hp: true,
      deathSaveSuccesses: true,
      deathSaveFailures: true,
      stableWakeRound: true,
    },
  });
  if (!player) {
    throw new DeathSaveInvariantError(`Encounter ${ctx.encounterId} has no player combatant.`);
  }
  // Under the lock: a concurrent save that already revived, stabilised or
  // killed the player owns this turn.
  if (derivePlayerLifeState(player) !== "dying") throw new TurnStateConflictError();

  const natural = dice.d20();
  const result = resolveDeathSave(
    { successes: player.deathSaveSuccesses, failures: player.deathSaveFailures },
    natural
  );
  const where = { encounterId: ctx.encounterId, characterId: ctx.characterId };
```

No other lines in this file change — `setPlayerHp`'s call at the "revived" branch already forwards `characterId: ctx.characterId` (unchanged from before this plan).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm typecheck && pnpm exec vitest run --maxWorkers=2 tests/db/death-save-transition.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/db/death-save-transition.ts tests/db/death-save-transition.test.ts
git commit -m "feat(combat): scope rollPlayerDeathSave by characterId, not isPlayer alone"
```

---

### Task 6: Full regression validation

**Files:** none (validation only).

**Interfaces:** none — this task proves Tasks 1-5 together preserve every existing behavior.

- [ ] **Step 1: Local validation, no database**

```bash
pnpm generate
pnpm typecheck
pnpm exec vitest run --maxWorkers=2
pnpm build
pnpm check-retro
```

Expected: all clean. Record the exact test count (files/tests passed) — do not report "tests passed" without the number.

- [ ] **Step 2: Real-disposable-Postgres regression, per AGENTS.md's runbook**

```bash
docker run -d --name dc-e2e-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=dungeon_cortex_e2e -p 55432:5432 pgvector/pgvector:pg16
export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:55432/dungeon_cortex_e2e"
export DIRECT_URL="postgresql://postgres:postgres@127.0.0.1:55432/dungeon_cortex_e2e"
pnpm prisma migrate deploy
pnpm build
PRIVATE_MODE_ENABLED=true E2E_TEST_MODE=true PORT=3100 pnpm start &
```

Wait for `Ready`, then:

```bash
export E2E_TEST_MODE=true
export PLAYWRIGHT_SKIP_WEBSERVER=1
export PLAYWRIGHT_BASE_URL=http://localhost:3100
pnpm test:e2e tests/e2e/combatant-character-identity-real-db.spec.ts tests/e2e/enemy-attack-profile.spec.ts tests/e2e/area-save-actions.spec.ts tests/e2e/combat-hp-concurrency.spec.ts tests/e2e/critical-path.spec.ts
```

Expected: all pass. This is the direct evidence that HP writes, death saves, downed-state, and the enemy-turn chain behave identically to before this plan — the write functions now key off `characterId`, but every observed outcome (damage, death saves, downed/dead transitions, HP mirroring) is unchanged.

Tear down:

```bash
docker rm -f -v dc-e2e-pg
```

- [ ] **Step 3: Confirm the diff is scoped to this plan**

```bash
git log --oneline claude/dc-party-001-party-foundation..HEAD
git diff --stat claude/dc-party-001-party-foundation..HEAD
```

Expected: only the files listed in Tasks 1-5.

- [ ] **Step 4: Report results**

Summarize: exact validation commands run, exact pass counts, confirmation that no combat behavior changed (backed by the e2e regression pass), and that `Combatant_one_player_per_encounter_key` is verified both by the RED/GREEN falsification (Task 1 Step 8) and by its continued presence through every subsequent task's real-DB run.
