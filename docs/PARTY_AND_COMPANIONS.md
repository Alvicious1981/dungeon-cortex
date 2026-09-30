---
title: Party & AI Companions — Persistent Party Foundation
status: Accepted — Foundation only (DC-PARTY-001)
date: 2026-09-17
scope: Party/companion data model, Campaign↔Character membership, affiliation vs. control, backwards compatibility with Campaign.characterId
---

# Party & AI Companions — Persistent Party Foundation

## 0. Status and scope

This decision is **subordinate to** `docs/DECISION_5E_SRD_API.md` and `MASTER_ARCH_GUIDE.md` and does
not amend either. Where anything here could be read as conflicting with those documents, they
govern.

Precedence order for this document, unchanged from the project canon:

1. Explicit user instruction in the active conversation.
2. `docs/DECISION_5E_SRD_API.md`.
3. `MASTER_ARCH_GUIDE.md`.
4. `PROJECT_CONTEXT.md`.
5. This document.
6. Current implementation and tests.
7. Historical planning artifacts.

**In scope:** the persistent data model that lets the app answer "which Characters belong to this
Campaign's party, in what role, under whose control" — nothing else.

**Out of scope** (restated fully in §9): combat integration, actor/control routing, companion AI,
Party UI, rest/XP/inventory/spell party-awareness, recruitment, dismissal. This document describes
what DC-PARTY-001 actually implements, not the full Party & AI Companions milestone.

## 1. Product objective

Dungeon Cortex currently revolves around one main player Character per Campaign. The target is a
party of up to **3** mechanically complete Characters:

```
PARTY
├── Main Character   — USER controlled
├── Companion 1       — AI controlled by default, later switchable to USER
└── Companion 2       — AI controlled by default, later switchable to USER
```

DC-PARTY-001 does not build that combat/AI/UI experience. It builds only the persistent,
backwards-compatible domain foundation later work builds on: **"this Campaign has a Party."** It does
not yet change **how** that Party acts.

## 2. Vocabulary

- **Party** — the up-to-3 Characters associated with one Campaign. Not a table; a concept expressed
  by the set of `PartyMember` rows for a `campaignId`.
- **`PartyMember`** — one row = one Character seated in one Campaign's party. Fields: `campaignId`,
  `characterId`, `role`, `control`.
- **`role` (`MAIN` | `COMPANION`)** — **AFFILIATION**. Exactly one `MAIN` row per campaign, enforced
  at the database level.
- **`control` (`AI` | `USER`)** — **CONTROL**. Who currently plays this seat.
- **AFFILIATION vs. CONTROL** — deliberately independent axes. A companion's `control` can flip
  `AI` → `USER` later by updating its `PartyMember` row in place; the Character it references is
  never cloned, copied, or transformed. Affiliation must never be inferred from control, and control
  must never be inferred from `Combatant.isPlayer` (which this decision does not touch — see §9).

## 3. Why not `NPC`

`NPC` (`prisma/schema.prisma`) represents narrative/world characters — seeded, disposition-tracked,
rumor-bearing — and is not mechanically complete (no class, level, stats, inventory, spells). A party
companion must eventually support the full mechanical surface a main Character has. `PartyMember`
therefore references `Character`, never `NPC`, and this decision does not touch the `NPC` model at
all. The two remain separate concepts.

## 4. Why not a revived `Retainer`

An earlier, now-obsolete design (`docs/MILESTONE_Q_SPEC.md`, marked obsolete) modeled hired
companions as `Retainer`: wage, 2d6 loyalty score, morale state — an AD&D/OSR-flavored hireling
concept, excluded from the schema (along with `PartyInventory`, `WildernessMap`, `TravelState`,
`CampaignTime`, `Haven`) by migration `20260805090000_reconcile_nonlegacy_schema_preserving_combat_state`,
"pending a separate 5e/SRD 2014 decision." **This document is plausibly that decision, and explicitly
declines to revive `Retainer`.** A companion is a full `Character` — not a lightweight hireling with
wage/loyalty/morale, and not an AD&D/OSR mechanic. `docs/DECISION_5E_SRD_API.md` already forbids
gold-for-XP and retainer/hireling loyalty as active mechanics; this decision does not reopen that.

## 5. Relationship to the deferred `PartyInventory` decision

The same excluding migration deferred `PartyInventory` (shared party gold/rations for a wilderness
system that was never built) pending that same separate decision. This document scopes itself to
**party composition only** — who is in the party, in what role, under whose control. Whether the
party ever shares gold, rations, or other resources remains undecided and is not addressed here.

## 6. Data model

```prisma
enum PartyRole {
  MAIN
  COMPANION
}

enum PartyControlMode {
  AI
  USER
}

model PartyMember {
  id          String           @id @default(cuid())
  campaignId  String
  characterId String
  role        PartyRole
  control     PartyControlMode
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt

  campaign  Campaign  @relation(fields: [campaignId], references: [id])
  character Character @relation(fields: [characterId], references: [id])

  @@unique([campaignId, characterId])
  @@index([campaignId], map: "PartyMember_campaignId_idx")
  @@index([characterId], map: "PartyMember_characterId_idx")
}
```

Constraints and why each lives where it does:

| Invariant | Enforcement |
|---|---|
| A Character cannot appear twice in the same Party | `@@unique([campaignId, characterId])` — database |
| Exactly one MAIN per Campaign | Partial unique index `PartyMember_one_main_per_campaign_key` on `(campaignId) WHERE role = 'MAIN'` — database, migration-only (Prisma's schema DSL cannot express a filtered `@@unique`; same limitation as the existing `Encounter_one_active_per_campaign_key`) |
| Up to 3 active members | `MAX_ACTIVE_PARTY_MEMBERS` in `lib/party/roster.ts` — **application layer**, deliberately not a DB trigger. A hard cap enforced by a trigger is fragile and disproportionate for a foundation PR with no code path that can yet add a 4th member; a future recruitment task enforces this at the point where membership can actually grow. |
| Role explicit / Control explicit | Real Postgres enums (`PartyRole`, `PartyControlMode`), not `String` + comment. Closed-set classification on a narrow join entity, matching this schema's `CharacterChangeSource` precedent rather than the broad-lifecycle `String @default("active")` convention used by `Campaign`/`Encounter`/`Quest`. An enum makes an illegal value structurally unrepresentable. |
| Character/user ownership cannot be bypassed | `PartyMember` rows are only ever created after the existing `character.userId !== user.id` ownership check in `app/api/campaign/route.ts` |

No `active` or `position` column. Every row this foundation creates (backfill and campaign-creation
insert) is unconditionally active, and nothing in this PR orders or displays party members — either
column would have zero real writer or reader today. A future task adds either the moment it has one.

## 7. The `Campaign.characterId` compatibility phase

`Campaign.characterId` (required scalar FK, `ON DELETE RESTRICT ON UPDATE CASCADE`, non-unique) is
**unchanged by this decision** and **stays authoritative** for "the current main Character." Every
existing reader of `Campaign.characterId` continues to work exactly as before.

`PartyMember` is an additive, normalized mirror of the same fact, kept in sync by two mechanisms:

1. **Backfill** — migration `20260917130000_add_party_members` inserts a `role=MAIN, control=USER`
   `PartyMember` row for every Campaign that already existed when it runs, idempotently
   (`ON CONFLICT DO NOTHING`).
2. **Campaign creation** — `app/api/campaign/route.ts` now creates the Campaign row and its MAIN
   `PartyMember` row inside one `$transaction`, so every Campaign created after this PR ships also
   satisfies the invariant immediately, not just historical data.

This compatibility phase ends when a future task switches some reader from `Campaign.characterId` to
`PartyMember` as its source of truth. No such switch happens in this decision.

## 8. Single-player reconciliation

`PROJECT_CONTEXT.md` states: "Single-player first: Multiplayer complexity is out of scope unless
explicitly requested." Party & AI Companions is **not multiplayer** — still one human user, one
account, one session. It adds up to three mechanically-tracked Characters that one user's Campaign
can have, not additional human players. This decision does not conflict with that pillar.

## 9. What this decision does not do (explicitly deferred)

**Combat** — `Combatant.isPlayer` semantics, the enemy-turn chain (`resolveEnemyTurn`,
`finalizeEncounterTurn`), initiative, action economy, target selection, encounter-turn ownership,
death saves, HP combat authority. `Combatant` has no `characterId` FK at all today; `PartyMember`
introduces none. Nothing in combat reads this table.

**Companion AI** — LLM companion agents, prompts, autonomous tactical decisions, automatic spell
selection or movement, AI personalities, AI tool calling.

**User control** — actor switching, manual companion turns, action routing for a selected companion.

**UI** — party portraits, HUD, companion cards, character selector, options toggle, party management
or recruitment screens.

**Other systems** — rest semantics, XP distribution, progression, inventory/equipment transfers,
spell sharing, recruitment, dismissal, resurrection rules all remain exactly as they are today.

## 10. Relationship to `docs/DECISION_XP_AWARD_AUTHORITY.md`

That decision's §4 states the current contract is "one mechanical Character per Campaign" and
explicitly defers "party composition and XP distribution among multiple player characters" (§15) as
undefined. **This decision defines party composition.** XP *distribution* among party members remains
separately undefined and is not addressed here — a future task must still decide which participants
of an encounter are authoritative for an XP award and how it splits among them.

## 11. Future work not authorized by this decision

Control routing (switching a companion between AI and USER control in a live session), companion AI
behavior, recruitment/dismissal flows, party UI, combat integration (`Combatant` gaining a reference
to the `Character`/`PartyMember` it represents, multi-Combatant turn ownership), and rest/magic/XP
guards becoming party-aware (`lib/rules/rest-service.ts` and `lib/rules/magic-service.ts` already
accept an optional `characterId`, but their membership guard only accepts `campaign.characterId` —
extending it to "any party member" is future work, not this decision).

## 12. Definition of done

- [x] `PartyMember`, `PartyRole`, `PartyControlMode` added to `prisma/schema.prisma`; `Campaign.characterId` unchanged.
- [x] Migration `20260917130000_add_party_members` creates the table, both constraints, RLS, and backfills existing Campaigns idempotently.
- [x] `app/api/campaign/route.ts` creates the MAIN `PartyMember` row atomically with new Campaigns.
- [x] Tests prove: no duplicate membership, exactly one MAIN, `Campaign.characterId` untouched, control-mode persistence, existing single-character Campaigns unaffected, backfill correctness and idempotency — the database-level guarantees against real disposable PostgreSQL, not mocks.
- [x] This document.
