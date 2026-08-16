import { z } from "zod";

export const CHARACTER_EDITABLE_FIELDS = [
  "name",
  "appearance",
  "backstory",
  "personalityTraits",
  "ideals",
  "bonds",
  "flaws",
] as const;

export const CHARACTER_NARRATIVE_FIELDS = CHARACTER_EDITABLE_FIELDS.filter(
  (field) => field !== "name"
) as Exclude<(typeof CHARACTER_EDITABLE_FIELDS)[number], "name">[];

export type CharacterEditableField = (typeof CHARACTER_EDITABLE_FIELDS)[number];
export type CharacterNarrativeField = (typeof CHARACTER_NARRATIVE_FIELDS)[number];

export const CHARACTER_FIELD_LABELS: Record<CharacterEditableField, string> = {
  name: "Nombre",
  appearance: "Aspecto",
  backstory: "Historia",
  personalityTraits: "Rasgos de personalidad",
  ideals: "Ideales",
  bonds: "Vínculos",
  flaws: "Defectos",
};

export const CHARACTER_FIELD_LIMITS: Record<CharacterEditableField, number> = {
  name: 60,
  appearance: 1_000,
  backstory: 6_000,
  personalityTraits: 1_000,
  ideals: 1_000,
  bonds: 1_000,
  flaws: 1_000,
};

const forbiddenControlCharacters = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export function normalizeCharacterText(value: string, field: CharacterEditableField): string {
  const normalized = value.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").trim();
  return field === "name" ? normalized.replace(/\s+/g, " ") : normalized;
}

export const characterEditableFieldSchema = z.enum(CHARACTER_EDITABLE_FIELDS);

export const characterChangeSchema = z
  .object({
    field: characterEditableFieldSchema,
    value: z.string(),
  })
  .strict()
  .transform(({ field, value }) => ({ field, value: normalizeCharacterText(value, field) }))
  .superRefine(({ field, value }, context) => {
    if (forbiddenControlCharacters.test(value)) {
      context.addIssue({ code: "custom", message: "El texto contiene caracteres de control no permitidos." });
    }
    if (field === "name" && value.length === 0) {
      context.addIssue({ code: "custom", message: "El nombre no puede quedar vacío." });
    }
    if (value.length > CHARACTER_FIELD_LIMITS[field]) {
      context.addIssue({
        code: "custom",
        message: `${CHARACTER_FIELD_LABELS[field]} supera el máximo de ${CHARACTER_FIELD_LIMITS[field]} caracteres.`,
      });
    }
  });

const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/, "La clave de idempotencia contiene caracteres no permitidos.");

export const characterEditRequestSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    idempotencyKey: idempotencyKeySchema,
    change: characterChangeSchema,
    reason: z.string().max(500).optional(),
  })
  .strict();

export const characterAiProposalRequestSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    idempotencyKey: idempotencyKeySchema,
    field: characterEditableFieldSchema,
    instruction: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const characterProposalDecisionSchema = z
  .object({
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const characterUndoRequestSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const generatedProfileSuggestionSchema = z
  .object({
    value: z.string(),
    reason: z.string().trim().min(1).max(500),
    warnings: z.array(z.string().trim().min(1).max(300)).max(8).default([]),
  })
  .strict();

export type CharacterChange = z.infer<typeof characterChangeSchema>;
export type CharacterEditRequest = z.infer<typeof characterEditRequestSchema>;
export type CharacterAiProposalRequest = z.infer<typeof characterAiProposalRequestSchema>;
export type GeneratedProfileSuggestion = z.infer<typeof generatedProfileSuggestionSchema>;

export interface CharacterNarrativeProfile {
  appearance: string;
  backstory: string;
  personalityTraits: string;
  ideals: string;
  bonds: string;
  flaws: string;
}

export interface CharacterEditableSnapshot extends CharacterNarrativeProfile {
  id: string;
  name: string;
  revision: number;
  updatedAt: string;
}

export interface CharacterChangeProposalDto {
  proposalId: string;
  characterId: string;
  expectedVersion: number;
  actor: "AI" | "PDF_IMPORT";
  reason: string;
  changes: CharacterChange[];
  previousValues: CharacterChange[];
  validationStatus: "VALID" | "REJECTED";
  warnings: string[];
  requiresPlayerConfirmation: true;
  status: "PENDING" | "ACCEPTED" | "REJECTED" | "STALE" | "EXPIRED";
  createdAt: string;
  expiresAt: string;
}

export interface CharacterAuditDto {
  id: string;
  field: CharacterEditableField;
  previousValue: string;
  newValue: string;
  source: "PLAYER" | "AI_PROPOSAL" | "PDF_IMPORT" | "UNDO";
  reason: string | null;
  revisionBefore: number;
  revisionAfter: number;
  proposalId: string | null;
  createdAt: string;
  canUndo: boolean;
}
