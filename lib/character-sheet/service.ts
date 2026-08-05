import {
  CharacterChangeSource,
  CharacterProfileField,
  CharacterProposalStatus,
  CharacterProposalValidationStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  characterChangeSchema,
  type CharacterAuditDto,
  type CharacterChange,
  type CharacterChangeProposalDto,
  type CharacterEditableField,
  type CharacterEditableSnapshot,
  type CharacterNarrativeField,
  type CharacterNarrativeProfile,
} from "@/lib/character-sheet/contracts";

export type CharacterSheetServiceErrorCode =
  | "CHARACTER_NOT_FOUND"
  | "CONFLICT"
  | "IDEMPOTENCY_REUSE"
  | "NO_CHANGE"
  | "NAME_LOCKED_DURING_ENCOUNTER"
  | "PROPOSAL_NOT_FOUND"
  | "PROPOSAL_NOT_PENDING"
  | "PROPOSAL_EXPIRED"
  | "PROPOSAL_INVALID"
  | "UNDO_NOT_AVAILABLE";

export class CharacterSheetServiceError extends Error {
  constructor(
    public readonly code: CharacterSheetServiceErrorCode,
    message: string
  ) {
    super(message);
    this.name = "CharacterSheetServiceError";
  }
}

function isIdempotencyRace(error: unknown): boolean {
  return (
    (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") ||
    (error instanceof CharacterSheetServiceError && error.code === "CONFLICT")
  );
}

const FIELD_TO_DB: Record<CharacterEditableField, CharacterProfileField> = {
  name: CharacterProfileField.NAME,
  appearance: CharacterProfileField.APPEARANCE,
  backstory: CharacterProfileField.BACKSTORY,
  personalityTraits: CharacterProfileField.PERSONALITY_TRAITS,
  ideals: CharacterProfileField.IDEALS,
  bonds: CharacterProfileField.BONDS,
  flaws: CharacterProfileField.FLAWS,
};

const DB_TO_FIELD: Record<CharacterProfileField, CharacterEditableField> = {
  NAME: "name",
  APPEARANCE: "appearance",
  BACKSTORY: "backstory",
  PERSONALITY_TRAITS: "personalityTraits",
  IDEALS: "ideals",
  BONDS: "bonds",
  FLAWS: "flaws",
};

const EMPTY_PROFILE: CharacterNarrativeProfile = {
  appearance: "",
  backstory: "",
  personalityTraits: "",
  ideals: "",
  bonds: "",
  flaws: "",
};

const characterWithProfileSelect = {
  id: true,
  userId: true,
  name: true,
  revision: true,
  updatedAt: true,
  profile: {
    select: {
      appearance: true,
      backstory: true,
      personalityTraits: true,
      ideals: true,
      bonds: true,
      flaws: true,
    },
  },
} satisfies Prisma.CharacterSelect;

type CharacterWithProfile = Prisma.CharacterGetPayload<{
  select: typeof characterWithProfileSelect;
}>;

function profileOf(character: CharacterWithProfile): CharacterNarrativeProfile {
  return character.profile ?? EMPTY_PROFILE;
}

function editableValue(character: CharacterWithProfile, field: CharacterEditableField): string {
  return field === "name" ? character.name : profileOf(character)[field];
}

function toSnapshot(character: CharacterWithProfile): CharacterEditableSnapshot {
  return {
    id: character.id,
    name: character.name,
    revision: character.revision,
    updatedAt: character.updatedAt.toISOString(),
    ...profileOf(character),
  };
}

function jsonString(value: Prisma.JsonValue): string {
  return typeof value === "string" ? value : "";
}

function parseChanges(value: Prisma.JsonValue): CharacterChange[] {
  const parsed = characterChangeSchema.array().min(1).max(7).safeParse(value);
  if (!parsed.success || new Set(parsed.data.map((change) => change.field)).size !== parsed.data.length) {
    throw new CharacterSheetServiceError("PROPOSAL_INVALID", "La propuesta almacenada no cumple el contrato permitido.");
  }
  return parsed.data;
}

function proposalToDto(proposal: {
  id: string;
  characterId: string;
  expectedVersion: number;
  reason: string;
  changes: Prisma.JsonValue;
  previousValues: Prisma.JsonValue;
  validationStatus: CharacterProposalValidationStatus;
  warnings: string[];
  requiresPlayerConfirmation: boolean;
  status: CharacterProposalStatus;
  source: CharacterChangeSource;
  createdAt: Date;
  expiresAt: Date;
}): CharacterChangeProposalDto {
  const actor = proposal.source === CharacterChangeSource.PDF_IMPORT ? "PDF_IMPORT" : "AI";
  return {
    proposalId: proposal.id,
    characterId: proposal.characterId,
    expectedVersion: proposal.expectedVersion,
    actor,
    reason: proposal.reason,
    changes: parseChanges(proposal.changes),
    previousValues: parseChanges(proposal.previousValues),
    validationStatus: proposal.validationStatus,
    warnings: proposal.warnings,
    requiresPlayerConfirmation: true,
    status:
      proposal.status === CharacterProposalStatus.PENDING && proposal.expiresAt.getTime() <= Date.now()
        ? "EXPIRED"
        : proposal.status,
    createdAt: proposal.createdAt.toISOString(),
    expiresAt: proposal.expiresAt.toISOString(),
  };
}

async function ownedCharacter(
  tx: Prisma.TransactionClient,
  characterId: string,
  userId: string
): Promise<CharacterWithProfile> {
  const character = await tx.character.findFirst({
    where: { id: characterId, userId },
    select: characterWithProfileSelect,
  });
  if (!character) {
    throw new CharacterSheetServiceError("CHARACTER_NOT_FOUND", "Personaje no encontrado.");
  }
  return character;
}

async function assertNameEditable(tx: Prisma.TransactionClient, characterId: string): Promise<void> {
  const activeEncounters = await tx.encounter.count({
    where: { status: "active", campaign: { characterId } },
  });
  if (activeEncounters > 0) {
    throw new CharacterSheetServiceError(
      "NAME_LOCKED_DURING_ENCOUNTER",
      "El nombre no puede cambiar durante un encuentro activo."
    );
  }
}

function profileUpdate(changes: CharacterChange[]): Partial<Record<CharacterNarrativeField, string>> {
  return Object.fromEntries(
    changes
      .filter((change) => change.field !== "name")
      .map((change) => [change.field, change.value])
  ) as Partial<Record<CharacterNarrativeField, string>>;
}

interface ApplyChangesInput {
  tx: Prisma.TransactionClient;
  userId: string;
  characterId: string;
  expectedVersion: number;
  changes: CharacterChange[];
  source: CharacterChangeSource;
  reason?: string;
  idempotencyKey: string;
  proposalId?: string;
}

async function applyChanges(input: ApplyChangesInput): Promise<CharacterEditableSnapshot> {
  const current = await ownedCharacter(input.tx, input.characterId, input.userId);
  if (current.revision !== input.expectedVersion) {
    throw new CharacterSheetServiceError("CONFLICT", "La hoja cambió en otra pestaña. Recarga antes de continuar.");
  }

  const previousValues = input.changes.map((change) => ({
    field: change.field,
    value: editableValue(current, change.field),
  }));
  const changed = input.changes.filter(
    (change, index) => change.value !== previousValues[index]?.value
  );
  if (changed.length === 0) {
    throw new CharacterSheetServiceError("NO_CHANGE", "La propuesta no cambia ningún valor.");
  }
  if (changed.some((change) => change.field === "name")) {
    await assertNameEditable(input.tx, input.characterId);
  }

  const nameChange = changed.find((change) => change.field === "name");
  const updated = await input.tx.character.updateMany({
    where: { id: input.characterId, userId: input.userId, revision: input.expectedVersion },
    data: {
      ...(nameChange ? { name: nameChange.value } : {}),
      revision: { increment: 1 },
    },
  });
  if (updated.count !== 1) {
    throw new CharacterSheetServiceError("CONFLICT", "La hoja cambió antes de poder guardar.");
  }

  const narrativeChanges = changed.filter((change) => change.field !== "name");
  if (narrativeChanges.length > 0) {
    const data = profileUpdate(narrativeChanges);
    await input.tx.characterProfile.upsert({
      where: { characterId: input.characterId },
      create: { characterId: input.characterId, ...data },
      update: data,
    });
  }

  const revisionAfter = input.expectedVersion + 1;
  for (const change of changed) {
    const previous = previousValues.find((entry) => entry.field === change.field)?.value ?? "";
    await input.tx.characterChangeAudit.create({
      data: {
        characterId: input.characterId,
        actorUserId: input.userId,
        field: FIELD_TO_DB[change.field],
        previousValue: previous,
        newValue: change.value,
        source: input.source,
        reason: input.reason,
        revisionBefore: input.expectedVersion,
        revisionAfter,
        proposalId: input.proposalId,
        idempotencyKey:
          changed.length === 1 ? input.idempotencyKey : `${input.idempotencyKey}:${change.field}`,
      },
    });
  }

  const result = await input.tx.character.findUniqueOrThrow({
    where: { id: input.characterId },
    select: characterWithProfileSelect,
  });
  return toSnapshot(result);
}

export async function getCharacterEditableSnapshot(
  characterId: string,
  userId: string
): Promise<CharacterEditableSnapshot> {
  return prisma.$transaction(async (tx) => toSnapshot(await ownedCharacter(tx, characterId, userId)));
}

export async function getCharacterProposalContext(characterId: string, userId: string) {
  const character = await prisma.character.findFirst({
    where: { id: characterId, userId },
    select: {
      ...characterWithProfileSelect,
      race: true,
      class: true,
      level: true,
    },
  });
  if (!character) {
    throw new CharacterSheetServiceError("CHARACTER_NOT_FOUND", "Personaje no encontrado.");
  }
  return {
    snapshot: toSnapshot(character),
    identity: {
      name: character.name,
      race: character.race,
      className: character.class,
      level: character.level,
    },
  };
}

export async function editCharacter(input: {
  characterId: string;
  userId: string;
  expectedVersion: number;
  idempotencyKey: string;
  change: CharacterChange;
  reason?: string;
}): Promise<{ snapshot: CharacterEditableSnapshot; idempotent: boolean }> {
  try {
    return await prisma.$transaction(async (tx) => {
    const existing = await tx.characterChangeAudit.findUnique({
      where: {
        actorUserId_idempotencyKey: {
          actorUserId: input.userId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existing) {
      if (existing.characterId !== input.characterId) {
        throw new CharacterSheetServiceError("IDEMPOTENCY_REUSE", "La clave de idempotencia ya se usó en otra operación.");
      }
      return {
        snapshot: toSnapshot(await ownedCharacter(tx, input.characterId, input.userId)),
        idempotent: true,
      };
    }
    const snapshot = await applyChanges({
      tx,
      userId: input.userId,
      characterId: input.characterId,
      expectedVersion: input.expectedVersion,
      changes: [input.change],
      source: CharacterChangeSource.PLAYER,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
    });
    return { snapshot, idempotent: false };
    });
  } catch (error) {
    if (isIdempotencyRace(error)) {
      const existing = await prisma.characterChangeAudit.findUnique({
        where: {
          actorUserId_idempotencyKey: {
            actorUserId: input.userId,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (existing?.characterId === input.characterId) {
        return {
          snapshot: await getCharacterEditableSnapshot(input.characterId, input.userId),
          idempotent: true,
        };
      }
    }
    throw error;
  }
}

export async function createCharacterProposal(input: {
  characterId: string;
  userId: string;
  expectedVersion: number;
  idempotencyKey: string;
  changes: CharacterChange[];
  reason: string;
  warnings?: string[];
  source: "AI_PROPOSAL" | "PDF_IMPORT";
}): Promise<{ proposal: CharacterChangeProposalDto; idempotent: boolean }> {
  try {
    return await prisma.$transaction(async (tx) => {
    const existing = await tx.characterChangeProposal.findUnique({
      where: {
        actorUserId_idempotencyKey: {
          actorUserId: input.userId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existing) {
      if (existing.characterId !== input.characterId) {
        throw new CharacterSheetServiceError("IDEMPOTENCY_REUSE", "La clave de idempotencia ya se usó en otra propuesta.");
      }
      return { proposal: proposalToDto(existing), idempotent: true };
    }

    const character = await ownedCharacter(tx, input.characterId, input.userId);
    if (character.revision !== input.expectedVersion) {
      throw new CharacterSheetServiceError("CONFLICT", "La hoja cambió antes de crear la propuesta.");
    }
    const parsedChanges = parseChanges(input.changes as unknown as Prisma.JsonValue);
    const candidatePreviousValues = parsedChanges.map((change) => ({
      field: change.field,
      value: editableValue(character, change.field),
    }));
    const effectiveChanges = parsedChanges.filter(
      (change, index) => change.value !== candidatePreviousValues[index]?.value
    );
    if (effectiveChanges.length === 0) {
      throw new CharacterSheetServiceError("NO_CHANGE", "La propuesta no cambia ningún valor.");
    }
    const previousValues = effectiveChanges.map((change) => ({
      field: change.field,
      value: editableValue(character, change.field),
    }));

    const proposal = await tx.characterChangeProposal.create({
      data: {
        characterId: input.characterId,
        actorUserId: input.userId,
        expectedVersion: input.expectedVersion,
        reason: input.reason,
        changes: effectiveChanges,
        previousValues,
        validationStatus: CharacterProposalValidationStatus.VALID,
        warnings: input.warnings ?? [],
        requiresPlayerConfirmation: true,
        status: CharacterProposalStatus.PENDING,
        source: CharacterChangeSource[input.source],
        idempotencyKey: input.idempotencyKey,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
      },
    });
    return { proposal: proposalToDto(proposal), idempotent: false };
    });
  } catch (error) {
    if (isIdempotencyRace(error)) {
      const existing = await prisma.characterChangeProposal.findUnique({
        where: {
          actorUserId_idempotencyKey: {
            actorUserId: input.userId,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (existing?.characterId === input.characterId) {
        return { proposal: proposalToDto(existing), idempotent: true };
      }
    }
    throw error;
  }
}

export async function listCharacterProposals(
  characterId: string,
  userId: string
): Promise<CharacterChangeProposalDto[]> {
  await getCharacterEditableSnapshot(characterId, userId);
  const proposals = await prisma.characterChangeProposal.findMany({
    where: { characterId, character: { userId } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return proposals.map(proposalToDto);
}

export async function acceptCharacterProposal(input: {
  characterId: string;
  proposalId: string;
  userId: string;
  idempotencyKey: string;
}): Promise<{ snapshot: CharacterEditableSnapshot; idempotent: boolean }> {
  let outcome:
    | { snapshot: CharacterEditableSnapshot; idempotent: boolean; expired?: false }
    | { expired: true };
  try {
    outcome = await prisma.$transaction(async (tx) => {
    const proposal = await tx.characterChangeProposal.findFirst({
      where: { id: input.proposalId, characterId: input.characterId, character: { userId: input.userId } },
    });
    if (!proposal) {
      throw new CharacterSheetServiceError("PROPOSAL_NOT_FOUND", "Propuesta no encontrada.");
    }
    if (proposal.status === CharacterProposalStatus.ACCEPTED) {
      return {
        snapshot: toSnapshot(await ownedCharacter(tx, input.characterId, input.userId)),
        idempotent: true,
      };
    }
    if (proposal.status !== CharacterProposalStatus.PENDING) {
      throw new CharacterSheetServiceError("PROPOSAL_NOT_PENDING", "La propuesta ya no está pendiente.");
    }
    if (proposal.expiresAt.getTime() <= Date.now()) {
      await tx.characterChangeProposal.update({
        where: { id: proposal.id },
        data: { status: CharacterProposalStatus.EXPIRED, decidedAt: new Date() },
      });
      return { expired: true as const };
    }

    const snapshot = await applyChanges({
      tx,
      userId: input.userId,
      characterId: input.characterId,
      expectedVersion: proposal.expectedVersion,
      changes: parseChanges(proposal.changes),
      source: proposal.source,
      reason: proposal.reason,
      idempotencyKey: input.idempotencyKey,
      proposalId: proposal.id,
    });
    const decision = await tx.characterChangeProposal.updateMany({
      where: { id: proposal.id, status: CharacterProposalStatus.PENDING },
      data: {
        status: CharacterProposalStatus.ACCEPTED,
        decisionIdempotencyKey: input.idempotencyKey,
        decidedAt: new Date(),
      },
    });
    if (decision.count !== 1) {
      throw new CharacterSheetServiceError("CONFLICT", "La propuesta fue resuelta en otra pestaña.");
    }
    return { snapshot, idempotent: false, expired: false as const };
    });
  } catch (error) {
    if (isIdempotencyRace(error)) {
      const accepted = await prisma.characterChangeProposal.findFirst({
        where: {
          id: input.proposalId,
          characterId: input.characterId,
          character: { userId: input.userId },
          status: CharacterProposalStatus.ACCEPTED,
        },
      });
      if (accepted) {
        return {
          snapshot: await getCharacterEditableSnapshot(input.characterId, input.userId),
          idempotent: true,
        };
      }
    }
    throw error;
  }
  if ("expired" in outcome && outcome.expired) {
    throw new CharacterSheetServiceError("PROPOSAL_EXPIRED", "La propuesta ha caducado.");
  }
  return { snapshot: outcome.snapshot, idempotent: outcome.idempotent };
}

export async function rejectCharacterProposal(input: {
  characterId: string;
  proposalId: string;
  userId: string;
  idempotencyKey: string;
}): Promise<{ status: "REJECTED"; idempotent: boolean }> {
  try {
    return await prisma.$transaction(async (tx) => {
    const proposal = await tx.characterChangeProposal.findFirst({
      where: { id: input.proposalId, characterId: input.characterId, character: { userId: input.userId } },
    });
    if (!proposal) {
      throw new CharacterSheetServiceError("PROPOSAL_NOT_FOUND", "Propuesta no encontrada.");
    }
    if (proposal.status === CharacterProposalStatus.REJECTED) {
      return { status: "REJECTED", idempotent: true };
    }
    if (proposal.status !== CharacterProposalStatus.PENDING) {
      throw new CharacterSheetServiceError("PROPOSAL_NOT_PENDING", "La propuesta ya no está pendiente.");
    }
    const updated = await tx.characterChangeProposal.updateMany({
      where: { id: proposal.id, status: CharacterProposalStatus.PENDING },
      data: {
        status: CharacterProposalStatus.REJECTED,
        decisionIdempotencyKey: input.idempotencyKey,
        decidedAt: new Date(),
      },
    });
    if (updated.count !== 1) {
      throw new CharacterSheetServiceError("CONFLICT", "La propuesta fue resuelta en otra pestaña.");
    }
    return { status: "REJECTED", idempotent: false };
    });
  } catch (error) {
    if (isIdempotencyRace(error)) {
      const rejected = await prisma.characterChangeProposal.findFirst({
        where: {
          id: input.proposalId,
          characterId: input.characterId,
          character: { userId: input.userId },
          status: CharacterProposalStatus.REJECTED,
        },
      });
      if (rejected) return { status: "REJECTED", idempotent: true };
    }
    throw error;
  }
}

export async function listCharacterHistory(
  characterId: string,
  userId: string
): Promise<CharacterAuditDto[]> {
  await getCharacterEditableSnapshot(characterId, userId);
  const events = await prisma.characterChangeAudit.findMany({
    where: { characterId, character: { userId } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const latestByField = new Map<CharacterProfileField, string>();
  for (const event of events) {
    if (!latestByField.has(event.field)) latestByField.set(event.field, event.id);
  }
  return events.map((event) => ({
    id: event.id,
    field: DB_TO_FIELD[event.field],
    previousValue: jsonString(event.previousValue),
    newValue: jsonString(event.newValue),
    source: event.source,
    reason: event.reason,
    revisionBefore: event.revisionBefore,
    revisionAfter: event.revisionAfter,
    proposalId: event.proposalId,
    createdAt: event.createdAt.toISOString(),
    canUndo: latestByField.get(event.field) === event.id,
  }));
}

export async function undoCharacterChange(input: {
  characterId: string;
  auditId: string;
  userId: string;
  expectedVersion: number;
  idempotencyKey: string;
}): Promise<{ snapshot: CharacterEditableSnapshot; idempotent: boolean }> {
  return prisma.$transaction(async (tx) => {
    const existingUndo = await tx.characterChangeAudit.findUnique({
      where: {
        actorUserId_idempotencyKey: {
          actorUserId: input.userId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existingUndo) {
      if (existingUndo.characterId !== input.characterId) {
        throw new CharacterSheetServiceError("IDEMPOTENCY_REUSE", "La clave de idempotencia ya se usó.");
      }
      return {
        snapshot: toSnapshot(await ownedCharacter(tx, input.characterId, input.userId)),
        idempotent: true,
      };
    }

    const event = await tx.characterChangeAudit.findFirst({
      where: { id: input.auditId, characterId: input.characterId, character: { userId: input.userId } },
    });
    if (!event) {
      throw new CharacterSheetServiceError("UNDO_NOT_AVAILABLE", "El cambio no está disponible para deshacer.");
    }
    const latest = await tx.characterChangeAudit.findFirst({
      where: { characterId: input.characterId, field: event.field },
      orderBy: { createdAt: "desc" },
    });
    const current = await ownedCharacter(tx, input.characterId, input.userId);
    const field = DB_TO_FIELD[event.field];
    if (latest?.id !== event.id || editableValue(current, field) !== jsonString(event.newValue)) {
      throw new CharacterSheetServiceError("UNDO_NOT_AVAILABLE", "Existe un cambio posterior en ese campo.");
    }

    const change = characterChangeSchema.parse({ field, value: jsonString(event.previousValue) });
    const snapshot = await applyChanges({
      tx,
      userId: input.userId,
      characterId: input.characterId,
      expectedVersion: input.expectedVersion,
      changes: [change],
      source: CharacterChangeSource.UNDO,
      reason: `Deshacer cambio ${event.id}`,
      idempotencyKey: input.idempotencyKey,
    });
    return { snapshot, idempotent: false };
  });
}
