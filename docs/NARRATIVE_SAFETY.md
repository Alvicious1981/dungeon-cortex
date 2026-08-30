# Narrative Safety and Boundaries Specification

This document records the implemented narrative trust boundary. Rules canon remains authoritative in `docs/DECISION_5E_SRD_API.md`, and architecture law remains authoritative in `MASTER_ARCH_GUIDE.md`.

## 1. Authority and data flow

The backend is the only authority for legality, rolls, Armor Class comparisons, damage, healing, resources, rewards, conditions, movement, persistence, and deterministic events. Narration may describe only outcomes already resolved by backend code.

Deterministic SSE state frames must be emitted before narrative text. The user interface consumes those frames as state truth; prose is never a state transition.

| Prompt source | Trust classification | Handling |
| --- | --- | --- |
| Static narrator instructions | Trusted application code | Kept outside all data tags. |
| Backend campaign snapshot | Authoritative facts, untrusted text fields | Stored under `canonicalState` in the single JSON `GAME_DATA` user message. |
| Memories and prior logs | Advisory and untrusted | Stored under separate `memory` and `recentDialogue` keys in `GAME_DATA`, below canonical state in the declared authority hierarchy. |
| Current player action | Untrusted | Runtime length-checked and stored under `playerAction` in `GAME_DATA`. |
| Resolved narrative facts | Backend-authoritative event types, untrusted descriptive strings | Runtime schema-checked, mechanically numeric fields removed, and stored under the highest-authority `backendResolvedFacts` key. |
| Memory-consolidation logs | Untrusted historical records | Speaker-allowlisted, clipped, and serialized as a JSON `GAME_LOGS` payload. |
| SRD tool results | Read-only reference data | May clarify canonical names or descriptions but cannot authorize outcomes or mutations. |

All variable narrator values share one JSON data message; no variable text is interpolated into the system message. JSON string encoding prevents quotes, newlines, role labels, commands, or apparent closing tags from becoming a new model message or instruction channel.

## 2. Runtime controls

- Player actions are trimmed, must contain text, and are capped at 2,000 characters.
- Resolved-fact contexts and narrative output use strict Zod schemas with count and length limits.
- Narrator data is bounded before serialization: canonical state to 24,000 characters, backend facts to 32,000, player action to 2,000, and memory/dialogue to the most recent 20 bounded entries per tier.
- Memory consolidation accepts at most 20 recent records, clips each record to 600 characters, and requests a strict `{ summary, sourceLogIds }` object capped at 1,200 summary characters.
- A memory consolidation is persisted only when every cited source ID belongs to the exact bounded input batch; unverifiable or malformed output fails closed.
- The narrator registers only read-only SRD lookup tools. Every implemented non-SRD tool is catalogued as unavailable, omitted from the model boundary, and rejected if its internal name appears in generated prose.
- Every generated response is buffered and validated before it is emitted. Raw output length is checked before whitespace normalization. With resolved combat facts, it also receives fact-alignment checks and invalid text is replaced with deterministic prose derived only from those facts. Deterministic fallback prose is validated by the same contract and collapses to the neutral `La escena continúa.` if interpolated data makes it unsafe. Without a combat-fact context, universal output-contract, injection, tool-syntax, forbidden-terminology, and mechanical-number checks still apply.
- Every path rejects mechanical-number leakage, prompt-disclosure language, internal boundary markup, mutation-tool references or tool-call syntax, and forbidden alternate-rules terminology. When resolved combat facts exist, validation additionally rejects invented rewards, unconfirmed death or conditions, and hit/miss contradictions.

Fallback prose must remain qualitative. It must not expose numerical damage or HP values even when those values exist in backend facts.

## 3. Adversarial regression coverage

`tests/security/prompt-injection.test.ts` executes the production builders, narrator wiring, memory-consolidation boundary, output validator, and fallback path against:

- direct player injection;
- stored injection in names, quests, memories, and logs;
- forged closing tags and combined prompt-context leakage;
- requests for unavailable mutation tools;
- oversized and escape-amplifying context;
- instruction-like memory summaries; and
- English and Spanish validator evasions.

The focused narrative and memory suites retain lower-level contract coverage. `pnpm check-retro` separately checks protected production and narrative paths for forbidden terminology.

`evals/narrative` is a deterministic Promptfoo fixture harness. Its negative cases declare exact expected failure codes. It does not call a model and must not be reported as evidence of live-model injection resistance.

## 4. Residual risk and limitations

The controls reduce risk; they do not make model prompts a security boundary.

- No live-model red-team evaluation is part of the local suite. Adaptive, multi-turn, provider-specific, and tool-selection behavior remains unmeasured.
- Regex validation is finite. Homoglyphs, zero-width characters, novel paraphrases, unsupported languages, and indirect semantic disclosures may evade it.
- Context clipping is based on logical characters before JSON escaping, not provider tokens or final encoded bytes. Escape-heavy input remains bounded but can expand in the serialized prompt.
- The Promptfoo assertion is intentionally independent of the TypeScript validator and can drift. Production Vitest tests are authoritative for application behavior.
- Buffer-before-emit removes token-level narrative delivery: the existing SSE contract remains, but narration arrives as one verified text chunk after generation completes.
- A turn without combat facts still blocks prompt leakage, tool syntax, forbidden terminology, and mechanical-number disclosure, but it does not apply combat-only keyword checks for XP, loot, death, hit/miss, or conditions. Those checks require resolved combat facts; qualitative noncombat prose therefore remains possible, and semantic hallucinations outside structured facts remain a residual model risk.
- The broader campaign snapshot contains authoritative mechanical numbers for continuity. The resolved-facts prompt removes combat amounts, and output-number enforcement applies to every narrative path.
- Retrieved or cached text should never contain secrets. Prompt non-disclosure instructions cannot guarantee secrecy if sensitive values are inserted into model context.

Any future live evaluation requires explicit approval and a separate plan for provider selection, credentials, cost, data retention, reproducibility, success thresholds, and rollback.
