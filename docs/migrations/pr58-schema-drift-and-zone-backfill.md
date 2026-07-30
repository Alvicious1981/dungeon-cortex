# PR #58 migration runbook

Tracking issue: #65

This runbook covers the two migration risks addressed during PR #58 stabilization:

1. schema objects that may already exist because an environment previously used `prisma db push`;
2. legacy tactical coordinates stored through `Combatant.zoneId -> Zone.x/y`.

Do not run these steps against a production database without a verified backup and an approved deployment plan.

## 1. Classify the database before applying migrations

Use an isolated copy of the target database. Record the current migration state:

```bash
pnpm prisma migrate status
```

Generate a schema comparison without applying changes:

```bash
pnpm prisma migrate diff \
  --from-url "$DIRECT_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --script
```

Classify the result:

- **Clean migration history:** the drift-reconciliation objects do not exist and the migration is pending. Apply normally in the isolated database.
- **Fully reconciled by previous `db push`:** the objects and constraints match the migration exactly, but Prisma does not record the migration. Verify the complete diff before marking anything as applied.
- **Partial or incompatible drift:** only some objects exist, types/defaults differ, or constraints/indexes do not match. Stop. Do not run the migration and do not mark it as applied.

`prisma migrate resolve --applied` is bookkeeping, not a schema repair. Use it only after an exact schema comparison proves that the migration's complete result is already present.

## 2. Preflight legacy tactical data

Run these read-only checks before `20260725180000_replace_zones_with_encounter_map`:

```sql
-- Must return zero rows. The migration also aborts on this condition.
SELECT c."id", c."encounterId", c."zoneId"
FROM "Combatant" c
LEFT JOIN "Zone" z ON z."id" = c."zoneId"
WHERE c."zoneId" IS NOT NULL
  AND z."id" IS NULL;

-- Capture the expected coordinate backfill for comparison after migration.
SELECT
  c."id" AS "combatantId",
  c."encounterId",
  c."zoneId",
  z."x" AS "expectedX",
  z."y" AS "expectedY"
FROM "Combatant" c
JOIN "Zone" z ON z."id" = c."zoneId"
ORDER BY c."id";
```

Save the second query result as migration evidence.

## 3. Apply only in an isolated database first

Apply pending migrations using the same command and environment used by deployment. Do not use `migrate reset` against an environment containing persistent data.

After migration, compare the saved coordinate evidence with:

```sql
SELECT "id" AS "combatantId", "encounterId", "x", "y"
FROM "Combatant"
ORDER BY "id";
```

Every combatant that previously had a non-null `zoneId` must have the saved `expectedX/expectedY` values.

Verify the legacy structures were removed and the new maps exist:

```sql
SELECT to_regclass('public."Zone"') AS "zoneTable";

SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'Combatant'
  AND column_name = 'zoneId';

SELECT e."id" AS "encounterId", m."id" AS "mapId", m."width", m."height", m."cellSize"
FROM "Encounter" e
LEFT JOIN "EncounterMap" m ON m."encounterId" = e."id"
ORDER BY e."id";
```

Expected results:

- `zoneTable` is null;
- the `zoneId` column query returns no rows;
- every encounter has exactly one map;
- map dimensions are positive and include all migrated combatant footprints.

## 4. Required evidence before deployment approval

Attach to issue #65 or the deployment record:

- backup identifier and checksum;
- commit SHA being deployed;
- `prisma migrate status` before and after;
- complete `migrate diff` result before applying or resolving drift;
- legacy coordinate export and post-migration comparison;
- migration command and exit status;
- application CI results.

If any preflight or comparison differs from expectations, stop and restore the isolated database. Do not continue by deleting objects, resetting migration history, or force-marking migrations as applied.
