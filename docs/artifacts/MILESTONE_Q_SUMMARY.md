# Milestone Q: Haven & Downtime Engine — Architecture Closure Report

## 1. Executive Summary
Milestone Q implements the "Haven & Downtime Engine," a critical layer for post-exploration recovery and character progression. This system enforces the strictly deterministic OSR-style rules for converting gold to experience points (XP), managing living expenses for the party and their retainers, and resolving retainer morale through a 2d6-based loyalty system.

## 2. Technical Implementation Details

### 2.1. Rule Engine (`lib/rules/downtime.ts`)
The core logic resides in a pure, I/O-free library:
- **XP Conversion**: Strictly enforces a 1:1 ratio for gold deposited into a Haven.
- **Living Expenses**: Calculates upkeep costs based on Haven prosperity and party size (base 10gp/day/character).
- **Retainer Morale**: Implements a 2d6 check against a retainer's `loyaltyScore`, influenced by modifiers such as unpaid wages, leader charisma, and previous trauma.

### 2.2. Vercel AI SDK Tool (`lib/ai/tools/downtime.ts`)
The `executeDowntime` tool provides the bridge between the AI Narrator and the database. It utilizes a `prisma.$transaction` block to guarantee atomic updates:
- **Wealth Mutation**: Deducts expenses and deposited gold from `Campaign.gold`.
- **XP Progression**: Increments `Character.xp` based on the 1:1 conversion.
- **Refinement Cycle**: Updates `Retainer.moraleState` across multiple retainers in a single call.

### 2.3. VTT UI Integration (`components/downtime/HavenHUD.tsx`)
A high-fidelity React component for the VTT HUD that displays:
- **Party Wealth**: Current gold pieces in the campaign.
- **Haven Upkeep**: Projected daily costs.
- **Retainer Morale**: Real-time status of hired companions.

### 2.4. Memory & Continuity (`lib/memory/formatter.ts`)
- **HavenHUDContext**: Injects live downtime state into the AI's system prompt.
- **Downtime Mandate**: Appended to the "Iron Laws," forbidding the AI from narrating wealth or XP changes without the tool.

## 3. Database Schema Utilization
The implementation leverages the following models in `schema.prisma`:
- **Haven**: Tracks prosperity, base upkeep, and association with the campaign.
- **Retainer**: Tracks level, wage, loyalty, and current morale state.
- **Campaign**: Central repository for party gold and downtime state tracking.

## 4. Verification & Validation
- **Type Safety**: Passed `tsc --noEmit` with zero diagnostics in the downtime modules.
- **Persistence**: Verified via Prisma transactions ensuring "Code is Law" across XP and Currency boundaries.
- **Test Integrity**: Suite remains green (excluding pre-existing `loot.test.ts` drift).

---
*Report Generated: 2026-04-16*
*Status: SEALED / ARCHITECTURE SECURED*
