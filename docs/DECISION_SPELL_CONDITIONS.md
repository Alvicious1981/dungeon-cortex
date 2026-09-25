---
title: Decision — Spell Conditions from a Curated SRD Table
status: Accepted — Phase 1 (restrained: Entangle, Web, Black Tentacles)
date: 2026-09-25
scope: Spell resolution, combat pipeline, condition lifecycle, AI narration boundary
---

# Decision — Spell Conditions from a Curated SRD Table

## 0. Status and precedence

Subordinate to `docs/DECISION_5E_SRD_API.md` and `MASTER_ARCH_GUIDE.md`; where
anything here could be read as conflicting with them, they govern. Chosen by the
project owner on 2026-09-25 from three options (§2).

## 1. The problem

`resolveSpellEffect` returned `condition: null` on every path, so no spell
applied any condition. `CONDITION_REGISTRY`, `applyCondition`,
`lib/rules/condition-immunity.ts` and `Combatant.conditionImmunities` were all
built and unreachable.

The blocker was the data, not the code. Neither the SRD cache
(`data/srd-es/spells.json`, 316 spells) nor the dnd5eapi.co spell schema carries
a spell's condition as a field: no condition key and no `/api/conditions`
reference. The condition exists only inside `desc`, and this project does not
derive mechanics from prose.

## 2. Options considered

1. **A curated table, recorded as this decision — chosen.** Each SRD spell that
   imposes a condition gets a hand-written row, bound to the cache by tests.
2. **Another structured source** (Open5e, a VTT compendium). Rejected:
   `DECISION_5E_SRD_API.md` names Open5e as non-canonical, and none of them
   models how a condition ends either.
3. **Recognising exact sentences in `desc`**, the way `damage-clauses.ts`
   recognises damage clauses. Rejected: it is still reading prose, the cache
   mixes Spanish and English, every spell is worded differently (so it would be
   a table in disguise, only more fragile), and a condition's end is not in the
   sentence at all.

## 3. The decision

`lib/rules/spell-conditions.ts` holds `SPELL_CONDITIONS`, keyed by SRD index.
Each row is a transcription of the SRD 5.1 rules text: the condition, the save
that resists it, whether it ends with concentration, and its duration in rounds.

**The table only adds what the data lacks. It never overrides a structured
field the data holds.** `tests/rules/spell-conditions.test.ts` enforces that:

- every row names a spell in the cache and a key of `CONDITION_REGISTRY`;
- where the cache has a save (`dc.dc_type`), the row's save must equal it;
  where it has none (Web), the row supplies it;
- the row's concentration flag must equal the cache's;
- a spell resolves with a condition if and only if it has a row;
- the cache is pinned at 316 spells, so a refreshed cache forces a review of
  the table and of the deferred list.

`DEFERRED_SPELL_CONDITIONS` lists the other condition-imposing spells in the
cache with the reason each is not applied yet. The gap is a list somebody
shortens on purpose, not an absence nobody can see.

## 4. Lifecycle: how a condition ends

A condition that cannot end lasts the rest of the fight: nothing called
`removeCondition`. So every spell condition carries its end, and the pipeline
refuses a condition that arrives without one.

`Combatant.spellConditions` (migration `20260925120000`) holds one
`SpellConditionRecord` per spell-imposed condition: the condition, the spell's
SRD index, the caster's `Combatant.id`, whether it is held by concentration,
and `endsAtRound`. It is written in the same update as `Combatant.conditions`,
which stays the list every rule reads (LAW-05).

A record ends, and its condition with it unless another record still holds the
same condition, when:

- **the caster's concentration ends**: replaced by a new concentration spell,
  broken by damage from their own spell or an enemy's, or lost when they fall
  unconscious;
- **its duration runs out**: at the start of the caster's turn in
  `endsAtRound` (1 minute = 10 rounds). A concentration spell's duration is
  also the most its concentration lasts, so concentration ends with it;
- **the encounter ends**: conditions live on the encounter's combatant rows.

Each end writes a system log line, which reaches the narrator through the
campaign log. No new event type was added.

## 5. Phase 1 scope and its approximations

Applied: **Entangle** (1st level, castable today), **Web** (2nd), **Evard's
Black Tentacles** (4th): restrained, with a save, held by concentration.

Restrained now has its full SRD effect. Attack advantage and disadvantage
already existed; this phase adds speed 0 (`speedZero` in the registry), which
stops an enemy's move in `planEnemyTurn` and the player's Move.

Deliberately not modelled, in the caster's favour:

- a restrained creature cannot use its action to break free with a check;
- a creature that enters the area after the cast, or starts its turn there, is
  not affected. Only the creatures in the area when the spell is cast are.

## 6. Deferred (reason codes in `DEFERRED_SPELL_CONDITIONS`)

- `repeat_save`: Hold Person, Hold Monster, Tasha's Hideous Laughter,
  Phantasmal Killer, Power Word Stun. This is the next phase.
- `caster_choice`: Command, Blindness/Deafness.
- `ends_on_event`: Fear, Hypnotic Pattern.
- `charmed_unread`: Charm Person, Animal Friendship, the Dominate spells, Geas,
  Modify Memory.
- `hit_point_pool`: Sleep, Color Spray.
- `prone_stand_up`: Grease, Earthquake.
- `self_or_ally`: Invisibility, Greater Invisibility.
- `removes_target`: Banishment.
- `multi_stage`: Flesh to Stone, Contagion, Eyebite, Divine Word, Symbol,
  Prismatic Spray, Prismatic Wall, Weird, Storm of Vengeance.

Sunbeam, Sunburst and Sleet Storm are SRD spells missing from the cache
entirely.

## 7. AI boundary

The narrator receives `conditionsApplied` in `targets[]` (LAW-01) and the
system log lines. It never decides whether a condition lands or ends. A target
with a condition and no damage is no longer reported as "Attack missed". Every
creature that rolled a save against a condition spell gets a `targets[]` entry,
so a resisted spell is reported, not silent.

## 8. Deploy order

Apply migration `20260925120000_add_combatant_spell_conditions` **before**
deploying the code: Prisma selects every scalar column of `Combatant`, so new
code against the old schema fails every query on that table. Old code ignores
the new column.
