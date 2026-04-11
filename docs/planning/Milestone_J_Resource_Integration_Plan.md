# Milestone J: Resource Integration Plan

## Goal Description
Integrate deterministic external data sources and procedural generators into Dungeon Cortex's modular monolith. This plan ensures strict adherence to the "Code is Law" and "State is Truth" dogmas by completely preventing the LLM from inventing mechanics, monster stats, or spatial layouts.

Based on the research document, we will filter out all sources that rely on dynamic generative hallucination for mechanics. We will ingest only structured, deterministic data and algorithms that our TypeScript backend can securely consume and evaluate.

## Viable Deterministic Resources

**Selected for Integration:**
1. **JSON SRD Data (Magical20-ai/5e-database-spanish & Open5e)**: 
   - Static, structured JSON compendiums for monsters, spells, classes, and rules in the target language.
   - Provides absolute mechanical truth (e.g., exact armor classes, damage types) that the system uses to execute checks before the LLM narrates.
2. **Procedural Generators (Donjon-style)**:
   - **Loot & Treasure tables**: Deterministic d100 arrays based on Challenge Rating (CR).
   - **Markov Chain Name Generators**: Local dictionaries of racial phonemes to procedurally assign names to NPCs without LLM hallucination.
   - **Cellular Automata / Topological Grids**: Algorithms that yield a 2D matrix of coordinates for environments, ensuring spatial consistency across turns.
   - **Encounter Calculators**: Deterministic, math-based evaluation of XP thresholds (Easy/Medium/Hard/Deadly) prior to combat generation.

**Excluded Resources:**
- Anything relying on "generative LLM Oracles" or models acting as black-box arbiters of rules, events, or ungrounded statistics.

---

## Phased Roadmap

### Phase J.1: SRD Data Ingestion & Seeding
- **Goal:** Ingest the JSON static data (from `5e-database-spanish` or Open5e) into our backend.
- **Action:** Create an ingestion/seed script (`scripts/seed-srd.ts`) that pulls the structured JSON data (Spells, Monsters, Equipment) into our local PostgreSQL database via Prisma. This data will serve as the unchangeable canonical reference for the TypeScript rules engine.

### Phase J.2: Procedural TypeScript Engines
- **Goal:** Implement the logic for spatial, loot, and demographic generation without AI.
- **Action:** 
  - Develop `lib/rules/generators/names.ts` for Markov-based names.
  - Develop `lib/rules/generators/loot.ts` mapping CR to treasure tables.
  - Develop `lib/rules/generators/topology.ts` for 2D matrix cellular automata to map out physical spaces deterministically.

### Phase J.3: Narrative Context Wiring (Read-Only AI)
- **Goal:** Wire the ingested resources securely to the narrative LLM pipeline.
- **Action:** Establish a retrieval layer (`lib/context/srd-retrieval.ts`) that pulls precise mechanical data (e.g., Fireball's 8d6 damage, a Goblin's 15 AC) and securely bundles it into the system prompt. The LLM will only read this context to flavor its descriptions, barred from overriding it.

---

## Prisma Schema Implications

To ingest the static JSON data into our relational PostgreSQL structure without mixing it with dynamic player state (like Campaigns or Characters), we will introduce dedicated, read-only `SRD` models:

```prisma
// -----------------------------------------
// NEW MODELS FOR STATIC DETERMINISTIC DATA
// -----------------------------------------

model SRDMonster {
  id              String   @id @default(cuid())
  slug            String   @unique
  name            String
  challengeRating Float
  armorClass      Int
  hitPoints       Int
  statsJson       Json     // Full static payload (Actions, Saves, Immunities)
  createdAt       DateTime @default(now())

  @@index([challengeRating])
}

model SRDSpell {
  id              String   @id @default(cuid())
  slug            String   @unique
  name            String
  level           Int
  school          String
  dataJson        Json     // Static payload (Casting time, range, components)
  createdAt       DateTime @default(now())

  @@index([level, school])
}

model SRDEquipment {
  id              String   @id @default(cuid())
  slug            String   @unique
  name            String
  type            String
  dataJson        Json     // Static payload (Cost, weight, item properties)
  createdAt       DateTime @default(now())
}
```
*Note: These tables will only be populated via seeding and must remain strictly read-only within the runtime environment.*

---

## Strict AI Boundaries

To honor the "Code is Law" principle, we establish the following concrete boundaries for the LLM narrator regarding external resources:

1. **Absolute Data Isolation:**
   The AI (Vercel AI SDK/Claude/Gemini) will never be given access to Prisma `create`, `update`, or `delete` methods for the `SRD` tables, `Combatant` records, or any state variables.
   
2. **One-Way Context Injection:**
   The AI does not decide which monster stats to use. When an encounter starts, `lib/rules/combat.ts` directly queries the `SRDMonster` table. The mechanical engine resolves the combat math completely independently of the AI.

3. **Narrator As Translator:**
   The LLM will only receive the *results* of the procedural generation and mechanical resolution. For example, the system will pass a strict JSON object: `{"event": "damage", "target": "Goblin", "amount": 8, "remaining_hp": 0, "status": "dead"}`. The AI must construct its narrative strictly around this immutable payload.

---

## User Review Required

> [!IMPORTANT]
> **Database Scaling Question:** 
> For Phase J.1, is it acceptable to store the full `5e-database-spanish` JSON dictionaries as `Json` columns inside PostgreSQL via the Prisma schema defined above? Alternatively, would you prefer a separate NoSQL/Redis cache strictly for SRD lookups, ensuring PostgreSQL is used *only* for dynamic relational session state? 

> [!WARNING]
> Please confirm if you approve the filtered deterministic resources and schema implications before we integrate them into the `lib/rules/` directory.
