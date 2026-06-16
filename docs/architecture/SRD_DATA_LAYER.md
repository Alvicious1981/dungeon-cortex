# SRD Data Layer Architecture

## Purpose

This document describes the current and target architecture for Dungeon Cortex's SRD data layer. It is documentary only: it does not introduce runtime behavior, Prisma schema changes, migrations, scripts, or tests.

Dungeon Cortex uses **D&D 5e/SRD 2014** as its only active rules baseline. The canonical project decision is `docs/DECISION_5E_SRD_API.md`; this document explains how the data layer should evolve under that decision.

## Current state

The SRD layer currently exists in three overlapping forms:

1. **External API client** — `lib/dnd-api/client.ts` reads list endpoints from `https://www.dnd5eapi.co/api` for character creation choices such as races and classes, with small static fallbacks when the remote API is unavailable.
2. **Database-backed lookup layer** — `lib/ai/tools/srd-lookup.ts` reads Prisma SRD tables for narrator/tool lookups. It exposes typed helpers for spells, monsters, items, equipment, monster queries, spell queries, and SRD-derived combat helper data.
3. **Bundled local JSON snapshot** — `lib/rules/srd.ts` validates and indexes files under `data/srd-es/` at module load time. This module is explicitly marked as a Spanish 5e SRD snapshot that is historical, derived, and transitional until the technical migration is complete.

These paths should be treated as a transitional architecture, not as three equal sources of truth.

## Source map

| Source | Current files | Current role | Authority level |
| --- | --- | --- | --- |
| dnd5eapi.co | `lib/dnd-api/client.ts` | Remote API access for selected lists. | Canonical external source. |
| Prisma SRD tables | `SrdMonster`, `SrdSpell`, `SrdItem`, `SrdCondition`, `SrdEquipment` in `prisma/schema.prisma`; read by `lib/ai/tools/srd-lookup.ts`; seeded by `prisma/seed-srd.ts` | Local searchable cache and typed projection for backend tools. | Derived cache, never independent canon. |
| Local JSON snapshots | `data/srd-es/*.json`; read by `lib/rules/srd.ts`; also used by `prisma/seed-srd.ts` | Transitional offline seed/input data. | Derived/transitional dataset. |
| Canonical project docs | `docs/DECISION_5E_SRD_API.md`, `MASTER_ARCH_GUIDE.md`, `PROJECT_CONTEXT.md` | Architectural and rules-source precedence. | Documentation authority for project intent. |
| Historical references | `docs/reference/**`, older planning/milestone docs | Audit/history only unless explicitly rewritten for D&D 5e/SRD 2014 compatibility. | Non-authoritative. |

## Canonical authority: dnd5eapi.co

`https://www.dnd5eapi.co/api` is the canonical external SRD source for Dungeon Cortex.

Consequences:

- New SRD access should be traceable back to a dnd5eapi endpoint and payload shape.
- Local records may normalize, index, denormalize, translate, or precompute fields, but those records remain derived.
- If local data and dnd5eapi conflict, the adapter/sync path should reconcile from dnd5eapi rather than treating the local row or JSON file as a competing authority.
- Any shape mismatch should be represented by an explicit adapter, not by silent drift in consumers.
- AI narration must continue to consume backend-resolved facts, not invent missing SRD mechanics.

## Prisma's role: cache and derived projection

Prisma SRD models are useful because they make SRD data queryable, testable, and efficient for backend tools. Their role is still limited:

- **Cache:** store data needed for low-latency lookups and offline development.
- **Projection:** expose typed columns such as CR, armor class, spell level, school, components, equipment damage, condition slugs, and searchable names.
- **Raw provenance carrier:** keep full `data` JSON payloads so derived columns can be audited and regenerated.
- **Backend integration point:** let combat, inventory, narrator tools, and encounter generation read deterministic facts without remote network calls during normal execution.

Prisma SRD tables must not become a separate rules canon. Future schema changes should be driven by explicit adapter needs and should preserve enough provenance to identify source endpoints and refresh strategy.

## Local datasets are transitional

Files under `data/srd-es/` are currently useful for local parsing and seeding, but they should be understood as temporary implementation scaffolding:

- They can support offline development and deterministic tests.
- They can seed Prisma caches while the adapter/sync pipeline is incomplete.
- They should not be used to justify a mechanical answer that contradicts dnd5eapi or the accepted 5e/SRD 2014 decision.
- They should eventually be replaced or annotated by a source-aware sync path that records endpoint provenance and adapter version.

Until that migration lands, modules that consume these files should continue to label them derived/transitional.

## Target architecture: internal client plus adapters

The recommended target is a single internal SRD access boundary with adapters behind it:

```text
Runtime callers
  ├─ combat / inventory / encounter tools
  ├─ AI narrator tools
  └─ character creation flows
        │
        ▼
Internal SRD client interface
        │
        ├─ dnd5eapi adapter (canonical remote fetch/sync)
        ├─ Prisma cache adapter (offline/query/runtime reads)
        └─ fixture adapter (tests without internet)
```

### Internal client responsibilities

The internal client should:

- expose stable application-level operations such as `getSpell`, `getMonster`, `getEquipment`, `listRaces`, and `queryMonsters`;
- hide whether data came from the remote API, Prisma cache, or fixtures;
- return normalized application types that are explicit about derived fields;
- preserve source metadata such as endpoint, source index/slug, fetched-at timestamp, and adapter version where persistence is involved;
- make cache misses and unsupported SRD categories explicit instead of allowing the AI or UI to fill gaps.

### Adapter responsibilities

- **dnd5eapi adapter:** owns remote fetches and canonical payload parsing.
- **Prisma cache adapter:** owns local reads and writes of derived/cache records. It should not encode unrelated game mechanics.
- **Fixture adapter:** owns small deterministic test fixtures with dnd5eapi-shaped payloads. It should be the default for tests that must not use the internet.

## Testing strategy without internet

Tests should not depend on live network access. The preferred strategy is:

1. Keep unit tests around pure normalization and mapping functions using local fixtures shaped like dnd5eapi payloads.
2. Use a fixture adapter for internal-client tests so success, miss, malformed payload, and cache-fallback behavior are deterministic.
3. Test Prisma cache behavior with local database fixtures or mocked repository boundaries, not by calling dnd5eapi.
4. Reserve live dnd5eapi checks for optional/manual verification jobs, never required CI.
5. Add regression tests that prove AI-facing tools return explicit not-found/error results instead of hallucinated mechanics.

This preserves the canonical authority of dnd5eapi while keeping the automated test suite fast, deterministic, and offline-safe.

## Recommended PR order

A safe migration should happen in small PRs:

1. **Documentation PR** — add this architecture note and align future work around the accepted SRD decision.
2. **Inventory current consumers** — document all imports and call sites for `lib/dnd-api/client.ts`, `lib/rules/srd.ts`, and `lib/ai/tools/srd-lookup.ts` without changing behavior.
3. **Introduce internal interfaces** — add application-level SRD types and an internal client boundary with no runtime caller migration yet.
4. **Add fixture adapter tests** — prove the internal client can run without internet using dnd5eapi-shaped fixtures.
5. **Add dnd5eapi adapter** — implement canonical remote fetch/parse logic behind the internal boundary.
6. **Add/adjust Prisma cache adapter** — map cached records to internal types and preserve provenance fields in a later schema PR if needed.
7. **Migrate consumers incrementally** — move AI tools, combat helpers, inventory helpers, and character creation flows to the internal client in separate PRs.
8. **Retire transitional local JSON paths** — once all consumers use the internal boundary and cache/fixture paths are covered, remove or demote direct runtime imports from `data/srd-es/`.
9. **Cleanup and regression PRs** — add tests proving forbidden retro mechanics and non-canonical SRD sources are not reintroduced.

## Non-goals for this document

This document does not propose immediate changes to:

- runtime code;
- Prisma schema or generated client;
- migrations;
- seed scripts;
- tests;
- `lib/rules/srd.ts`;
- `lib/ai/tools/srd-lookup.ts`.
