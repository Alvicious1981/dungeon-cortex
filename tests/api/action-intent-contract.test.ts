/**
 * Contrato de extremo a extremo entre el clasificador real y las puertas reales.
 *
 * `tests/api/action.test.ts` mockea `@/lib/ai/intent`, así que verifica las
 * puertas contra intenciones inventadas a mano. Eso dejó sin cubrir justo el
 * acoplamiento donde vivían los defectos: el clasificador emitía `explore` y
 * `travel`, que ninguna puerta consumía, y la puerta de conjuros se saltaba
 * entera si el jugador no declaraba nivel de espacio.
 *
 * Este archivo NO mockea `parseIntent`. Recorre texto del jugador -> puerta ->
 * mutación o rechazo, que es el único recorrido donde ese acoplamiento se ve.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/campaign/[id]/action/route";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/session";
import { NextRequest } from "next/server";
import { buildCampaignContext } from "@/lib/memory/context";
import { streamNarrative } from "@/lib/ai/narrator";
import { DIFFICULTY_BANDS, DIFFICULTY_DC } from "@/lib/rules/ability-check";

vi.mock("next/server", async (importActual) => {
  const actual = await importActual<any>();
  return { ...actual, after: vi.fn((fn) => fn()) };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    gameLog: { create: vi.fn(), count: vi.fn(() => 1), findMany: vi.fn(() => []) },
    encounter: { update: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
    combatant: { findMany: vi.fn(() => []), update: vi.fn() },
    inventoryItem: { delete: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    character: { findUnique: vi.fn(), update: vi.fn() },
    srdSpell: { findUnique: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(async (cb) => cb(prisma)),
  },
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: vi.fn(),
  AuthError: class extends Error {
    constructor(msg: string) { super(msg); this.name = "AuthError"; }
  },
}));

vi.mock("@/lib/memory/context", () => ({ buildCampaignContext: vi.fn() }));

vi.mock("@/lib/ai/narrator", () => ({
  streamNarrative: vi.fn(() => ({
    textStream: new ReadableStream({ start: (c) => c.close() }),
    textPromise: Promise.resolve("Done"),
    levelUpPayload: Promise.resolve(null),
    merchantPayload: Promise.resolve(null),
  })),
}));

const campaignId = "camp_1";
const characterId = "char_1";
const mockUser = { id: "user_1" };

/** Fireball as the SRD cache stores it: a level 3 damage spell with a save. */
const FIREBALL = {
  id: "spell_fireball",
  indexSlug: "fireball",
  name: "Fireball",
  level: 3,
  concentration: false,
  data: {
    damage: {
      damage_at_slot_level: { "3": "8d6", "4": "9d6", "5": "10d6" },
      damage_type: { index: "fire" },
    },
    dc: { dc_type: { index: "dex" }, dc_success: "half" },
  },
};

function contextFor(overrides: Record<string, unknown> = {}) {
  return {
    character: {
      id: characterId,
      name: "Mira",
      class: "wizard",
      level: 5,
      hp: 20,
      maxHp: 20,
      xp: 0,
      hitDiceTotal: 5,
      hitDiceRemaining: 5,
      exhaustionLevel: 0,
      stats: { STR: 14, DEX: 12, CON: 12, INT: 16, WIS: 10, CHA: 10 },
      spellSlots: { "1": { current: 4, max: 4 }, "3": { current: 2, max: 2 } },
      concentrationSpellId: null,
      skillProficiencies: ["Investigation", "Stealth"],
      inventory: [],
      ...overrides,
    },
    relevantMemories: [],
    recentLogs: [],
    quests: [],
    currentExploration: null,
    activeEncounter: null,
  };
}

async function post(action: string) {
  const res = await POST(
    new NextRequest(`http://localhost/api/campaign/${campaignId}/action`, {
      method: "POST",
      body: JSON.stringify({ action }),
    }),
    { params: Promise.resolve({ id: campaignId }) }
  );
  const body = res.status === 200 ? await res.text() : "";
  const frames = body
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice(6)));
  return { res, frames };
}

/** Every `role: "system"` line the route wrote, i.e. the resolved-fact ledger. */
function systemLogs(): string[] {
  return (prisma.gameLog.create as any).mock.calls
    .map((call: any[]) => call[0]?.data)
    .filter((data: any) => data?.role === "system")
    .map((data: any) => data.content as string);
}

beforeEach(() => {
  vi.clearAllMocks();
  (getAuthUser as any).mockResolvedValue(mockUser);
  (prisma.campaign.findUnique as any).mockResolvedValue({
    id: campaignId, userId: mockUser.id, status: "active",
  });
  (prisma.character.findUnique as any).mockResolvedValue({
    id: characterId, class: "wizard", level: 5, xp: 0, maxHp: 20,
    hitDiceTotal: 5, stats: { CON: 12 },
  });
  (prisma.srdSpell.findUnique as any).mockResolvedValue(null);
  (prisma.srdSpell.findMany as any).mockResolvedValue([FIREBALL]);
  (buildCampaignContext as any).mockResolvedValue(contextFor());
});

describe("una acción de exploración se resuelve con dados, no con prosa", () => {
  it.each([
    ["I search the room", "Investigation"],
    ["busco trampas", "Investigation"],
    ["I hide behind the crates", "Stealth"],
  ])("%s produce una tirada registrada antes de narrar", async (action, skill) => {
    const { res, frames } = await post(action);

    expect(res.status).toBe(200);

    // El hecho queda escrito como resuelto...
    expect(systemLogs().some((line) => line.includes(`${skill} check`))).toBe(true);

    // ...y viaja al cliente como evento mecánico, antes del primer token.
    const check = frames.find((f) => f.e?.type === "ABILITY_CHECK_RESOLVED");
    expect(check).toBeDefined();
    expect(check.e.payload.skill).toBe(skill);
  });

  it.each([
    "I explore",
    "I scout ahead",
    "I travel to the north",
    "viajo al norte",
  ])("%s se rechaza en vez de narrarse sin resolver", async (action) => {
    const { res } = await post(action);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      code: "MECHANICAL_CLARIFICATION_REQUIRED",
    });
    expect(streamNarrative).not.toHaveBeenCalled();
  });
});

describe("la dificultad depende de la acción, no es una constante", () => {
  /** El evento mecánico que la puerta emite antes del primer token narrativo. */
  async function checkEvent(action: string) {
    const { res, frames } = await post(action);
    expect(res.status).toBe(200);
    const event = frames.find((f) => f.e?.type === "ABILITY_CHECK_RESOLVED");
    expect(event).toBeDefined();
    return event.e.payload;
  }

  it("dos acciones de la misma habilidad resuelven contra CD distinta", async () => {
    // La regresión concreta que esto cierra: antes ambas eran CD 15, porque la
    // puerta nunca pasaba banda y resolveAbilityCheck caía en "medium".
    const climb = await checkEvent("I climb the wall");
    const force = await checkEvent("I force the door");

    expect(climb.skill).toBe("Athletics");
    expect(force.skill).toBe("Athletics");
    expect(climb.dc).not.toBe(force.dc);
    expect(force.dc).toBeGreaterThan(climb.dc);
  });

  it("la CD nunca sale de los seis valores legales", async () => {
    const legal = Object.values(DIFFICULTY_DC);
    for (const action of ["I climb the wall", "I force the door", "I listen at the door"]) {
      const payload = await checkEvent(action);
      expect(legal).toContain(payload.dc);
      expect(DIFFICULTY_BANDS).toContain(payload.band);
    }
  });

  it("la línea del registro dice de dónde sale la CD", async () => {
    await post("I force the door");
    // Sin la banda, el jugador recibe un número sin procedencia y no puede
    // auditar la resolución.
    expect(systemLogs().some((line) => line.includes("(hard)"))).toBe(true);
  });
});

describe("una contienda deriva la CD del que se resiste", () => {
  const player = {
    id: "p1", name: "Mira", isPlayer: true, hp: 20, maxHp: 20,
    conditions: [], concentrationSpellId: null, stats: {},
  };

  function withHostiles(hostiles: Array<Record<string, unknown>>) {
    const base = contextFor();
    (buildCampaignContext as any).mockResolvedValue({
      ...base,
      activeEncounter: {
        id: "enc_1", round: 1, currentTurnIndex: 0, totalDamageDealt: 0,
        combatants: [player, ...hostiles],
      },
    });
  }

  async function checkPayload(action: string) {
    const { res, frames } = await post(action);
    expect(res.status).toBe(200);
    const event = frames.find((f) => f.e?.type === "ABILITY_CHECK_RESOLVED");
    expect(event).toBeDefined();
    return event.e.payload;
  }

  it("esconderse de un centinela despierto es más difícil que de uno obtuso", async () => {
    // Lo que las puntuaciones persistidas en Combatant hacen posible: hasta
    // ahora stats era {} para todos y ambos casos habrían dado el mismo número.
    withHostiles([{ id: "t1", name: "Sentry", isPlayer: false, hp: 8, maxHp: 8, conditions: [], stats: { WIS: 18 } }]);
    const alert = await checkPayload("I hide behind the crates");

    withHostiles([{ id: "t1", name: "Drunk", isPlayer: false, hp: 8, maxHp: 8, conditions: [], stats: { WIS: 6 } }]);
    const oblivious = await checkPayload("I hide behind the crates");

    expect(alert.dcSource).toBe("contest");
    expect(alert.dc).toBe(14);
    expect(oblivious.dc).toBe(8);
  });

  it("ante varios observadores manda el más despierto", async () => {
    withHostiles([
      { id: "t1", name: "Drunk", isPlayer: false, hp: 8, maxHp: 8, conditions: [], stats: { WIS: 6 } },
      { id: "t2", name: "Sentry", isPlayer: false, hp: 8, maxHp: 8, conditions: [], stats: { WIS: 18 } },
    ]);

    expect((await checkPayload("I hide behind the crates")).dc).toBe(14);
  });

  it("ignora a los caídos: un centinela inconsciente no vigila", async () => {
    withHostiles([
      { id: "t1", name: "Drunk", isPlayer: false, hp: 8, maxHp: 8, conditions: [], stats: { WIS: 6 } },
      { id: "t2", name: "Sentry", isPlayer: false, hp: 0, maxHp: 8, conditions: [], stats: { WIS: 18 } },
    ]);

    expect((await checkPayload("I hide behind the crates")).dc).toBe(8);
  });

  it("sin encuentro activo no hay contienda y manda la banda", async () => {
    (buildCampaignContext as any).mockResolvedValue(contextFor());

    const payload = await checkPayload("I hide behind the crates");
    expect(payload.dcSource).toBe("band");
    expect(payload.band).toBe("medium");
  });

  it("un empujón con varios candidatos cae a la banda en vez de adivinar objetivo", async () => {
    // Alcance "single": con dos hostiles no se puede saber a cuál empuja, así
    // que no se contiende contra una suposición.
    withHostiles([
      { id: "t1", name: "Goblin", isPlayer: false, hp: 8, maxHp: 8, conditions: [], stats: { STR: 18 } },
      { id: "t2", name: "Orc", isPlayer: false, hp: 8, maxHp: 8, conditions: [], stats: { STR: 18 } },
    ]);
    expect((await checkPayload("I shove the goblin")).dcSource).toBe("band");

    // Con uno solo no hay ambigüedad y sí se contiende.
    withHostiles([
      { id: "t1", name: "Goblin", isPlayer: false, hp: 8, maxHp: 8, conditions: [], stats: { STR: 18 } },
    ]);
    const single = await checkPayload("I shove the goblin");
    expect(single.dcSource).toBe("contest");
    expect(single.dc).toBe(14);
  });

  it("la línea del registro distingue una contienda de una banda", async () => {
    withHostiles([{ id: "t1", name: "Sentry", isPlayer: false, hp: 8, maxHp: 8, conditions: [], stats: { WIS: 18 } }]);
    await post("I hide behind the crates");

    expect(systemLogs().some((line) => line.includes("(contested)"))).toBe(true);
  });
});

describe("el estado del personaje modula la tirada", () => {
  it("el agotamiento impone desventaja en toda prueba, también fuera de combate", async () => {
    (buildCampaignContext as any).mockResolvedValue(contextFor({ exhaustionLevel: 1 }));

    const { frames } = await post("I search the room");
    const payload = frames.find((f) => f.e?.type === "ABILITY_CHECK_RESOLVED").e.payload;

    expect(payload.rollMode).toBe("disadvantage");
    expect(systemLogs().some((line) => line.includes("with disadvantage"))).toBe(true);
  });

  it("sin agotamiento ni condiciones la tirada es normal", async () => {
    const { frames } = await post("I search the room");
    const payload = frames.find((f) => f.e?.type === "ABILITY_CHECK_RESOLVED").e.payload;

    expect(payload.rollMode).toBe("normal");
  });

  it("una condición del combatiente jugador impone desventaja", async () => {
    // Las condiciones viven en Combatant, así que esta vía solo existe con
    // encuentro activo. Fuera de combate solo actúa el agotamiento.
    const base = contextFor();
    (buildCampaignContext as any).mockResolvedValue({
      ...base,
      activeEncounter: {
        id: "enc_1",
        round: 1,
        currentTurnIndex: 0,
        totalDamageDealt: 0,
        combatants: [
          { id: "p1", name: "Mira", isPlayer: true, hp: 20, maxHp: 20, conditions: ["poisoned"] },
        ],
      },
    });

    const { frames } = await post("I search the room");
    const payload = frames.find((f) => f.e?.type === "ABILITY_CHECK_RESOLVED").e.payload;

    expect(payload.rollMode).toBe("disadvantage");
  });
});

describe("un conjuro sin nivel declarado se resuelve al nivel del propio conjuro", () => {
  it("gasta el espacio de nivel 3 al lanzar Fireball sin decir nivel", async () => {
    const { res, frames } = await post("I cast Fireball");

    expect(res.status).toBe(200);

    // El espacio se gasta de verdad: 2 -> 1 en el nivel 3, y solo en ese nivel.
    expect(prisma.character.update).toHaveBeenCalledWith({
      where: { id: characterId },
      data: {
        spellSlots: { "1": { current: 4, max: 4 }, "3": { current: 1, max: 2 } },
      },
    });

    const cast = frames.find((f) => f.e?.type === "SPELL_CAST");
    expect(cast).toBeDefined();
    expect(cast.e.payload).toMatchObject({
      spellName: "Fireball",
      spellLevel: 3,
      slotConsumed: true,
    });
  });

  it("acepta subir de nivel el conjuro y cobra el espacio superior", async () => {
    // Un lanzador con espacios de 5.o nivel: subir de nivel es legal y se cobra
    // en el espacio pedido, no en el nivel base del conjuro.
    (buildCampaignContext as any).mockResolvedValue(
      contextFor({
        spellSlots: {
          "1": { current: 4, max: 4 },
          "3": { current: 2, max: 2 },
          "5": { current: 1, max: 1 },
        },
      })
    );

    const { res, frames } = await post("I cast Fireball at level 5");

    expect(res.status).toBe(200);
    expect(frames.find((f) => f.e?.type === "SPELL_CAST").e.payload.spellLevel).toBe(5);
    expect(prisma.character.update).toHaveBeenCalledWith({
      where: { id: characterId },
      data: {
        spellSlots: {
          "1": { current: 4, max: 4 },
          "3": { current: 2, max: 2 },
          "5": { current: 0, max: 1 },
        },
      },
    });
  });

  it("rechaza bajar de nivel un conjuro en vez de cobrar el espacio equivocado", async () => {
    const { res } = await post("I cast Fireball at level 1");

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining("cannot be cast"),
    });
    expect(prisma.character.update).not.toHaveBeenCalled();
    expect(streamNarrative).not.toHaveBeenCalled();
  });

  it("rechaza el conjuro sin espacios disponibles, sin narrarlo", async () => {
    (buildCampaignContext as any).mockResolvedValue(
      contextFor({ spellSlots: { "1": { current: 1, max: 4 }, "3": { current: 0, max: 2 } } })
    );

    const { res } = await post("I cast Fireball");

    expect(res.status).toBe(400);
    expect(prisma.character.update).not.toHaveBeenCalled();
    expect(streamNarrative).not.toHaveBeenCalled();
  });

  it("rechaza un conjuro que no está en la caché SRD", async () => {
    (prisma.srdSpell.findMany as any).mockResolvedValue([]);

    const { res } = await post("I cast Wish");

    expect(res.status).toBe(400);
    expect(streamNarrative).not.toHaveBeenCalled();
  });
});

describe("los botones de la interfaz llegan a una puerta real", () => {
  // Las etiquetas y sus comandos canónicos son los de
  // components/combat/MacroDeck.tsx. Si allí se reescribe una etiqueta sin
  // actualizar su comando, esta prueba lo detecta aquí y no en la partida.
  it.each([
    ["Buscar trampas", "search for traps", "ABILITY_CHECK_RESOLVED"],
    ["Investigar la zona", "investigate the area", "ABILITY_CHECK_RESOLVED"],
    ["Moverse con sigilo", "sneak", "ABILITY_CHECK_RESOLVED"],
    ["Tomar descanso corto", "short rest", "REST_COMPLETED"],
  ])("el boton %s envia '%s' y el backend lo resuelve", async (_label, command, eventType) => {
    const { res, frames } = await post(command);

    expect(res.status).toBe(200);
    expect(frames.some((f) => f.e?.type === eventType)).toBe(true);
  });
});
