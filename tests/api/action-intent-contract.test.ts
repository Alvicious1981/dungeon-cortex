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
    range: "150 pies",
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

async function post(action: string, extra: Record<string, unknown> = {}) {
  const res = await POST(
    new NextRequest(`http://localhost/api/campaign/${campaignId}/action`, {
      method: "POST",
      body: JSON.stringify({ action, ...extra }),
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
  // finalizeEncounterTurn claims the active -> resolved transition with an
  // updateMany and reads the campaign's character to award XP. Real Prisma
  // returns a count; an unstubbed vi.fn() returns undefined and the claim
  // throws. Only tests that end an encounter reach this, which is why it went
  // unnoticed until an area spell caught the last living combatant.
  (prisma.encounter.updateMany as any).mockResolvedValue({ count: 1 });
  (prisma.encounter.findUnique as any).mockResolvedValue({ campaign: { characterId } });
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

  it("un hostil sin características no abarata la acción por debajo de la banda", async () => {
    // La regresión que encontró la revisión: los enemigos creados por la ruta de
    // encuentro se guardaban con stats vacío, y tratarlos como criatura promedio
    // daba CD 10 — más fácil que esconderse sin nadie delante (CD 15).
    withHostiles([
      { id: "t1", name: "Unknown", isPlayer: false, hp: 8, maxHp: 8, conditions: [], stats: {} },
    ]);
    const watched = await checkPayload("I hide behind the crates");

    (buildCampaignContext as any).mockResolvedValue(contextFor());
    const alone = await checkPayload("I hide behind the crates");

    expect(watched.dcSource).toBe("band");
    expect(watched.dc).toBe(alone.dc);
  });

  it("sin encuentro activo no hay contienda y manda la banda", async () => {
    (buildCampaignContext as any).mockResolvedValue(contextFor());

    const payload = await checkPayload("I hide behind the crates");
    expect(payload.dcSource).toBe("band");
    expect(payload.band).toBe("medium");
  });

  it("un observador inconsciente no vigila, aunque siga en pie", async () => {
    // hp > 0 no basta: un centinela dormido por un conjuro conserva sus puntos
    // de golpe y no se entera de nada. Antes fijaba la CD completa.
    withHostiles([
      { id: "t1", name: "Drunk", isPlayer: false, hp: 8, maxHp: 8, conditions: [], stats: { WIS: 6 } },
      { id: "t2", name: "Sentry", isPlayer: false, hp: 8, maxHp: 8, conditions: ["unconscious"], stats: { WIS: 18 } },
    ]);

    expect((await checkPayload("I hide behind the crates")).dc).toBe(8);
  });

  it("un observador aturdido sí vigila: no puede actuar, pero mira", async () => {
    withHostiles([
      { id: "t1", name: "Sentry", isPlayer: false, hp: 8, maxHp: 8, conditions: ["stunned"], stats: { WIS: 18 } },
    ]);

    expect((await checkPayload("I hide behind the crates")).dc).toBe(14);
  });

  it("robar a alguien lo resiste ese alguien, no el testigo más agudo", async () => {
    // El SRD enfrenta el hurto a la Percepción del propio incauto. Antes la CD
    // salía del guardia de al lado, que ni siquiera era el objetivo.
    withHostiles([
      { id: "t1", name: "Merchant", isPlayer: false, hp: 8, maxHp: 8, conditions: [], stats: { WIS: 8 } },
      { id: "t2", name: "Guard", isPlayer: false, hp: 8, maxHp: 8, conditions: [], stats: { WIS: 20 } },
    ]);

    const payload = await checkPayload("I pickpocket the Merchant");
    expect(payload.dcSource).toBe("contest");
    expect(payload.dc).toBe(9); // Merchant WIS 8 → 10 - 1
  });

  it("mentir lo resiste quien escucha, no un hostil ajeno", async () => {
    withHostiles([
      { id: "t1", name: "Innkeeper", isPlayer: false, hp: 8, maxHp: 8, conditions: [], stats: { WIS: 10 } },
      { id: "t2", name: "Inquisitor", isPlayer: false, hp: 8, maxHp: 8, conditions: [], stats: { WIS: 20 } },
    ]);

    expect((await checkPayload("I lie to the Innkeeper")).dc).toBe(10);
  });

  it("esconderse sigue siendo cosa de todos: nombrar a uno no ciega al otro", async () => {
    // Contraste deliberado con los dos anteriores. Decir de quién te escondes no
    // impide que el segundo centinela te vea.
    withHostiles([
      { id: "t1", name: "Drunk", isPlayer: false, hp: 8, maxHp: 8, conditions: [], stats: { WIS: 6 } },
      { id: "t2", name: "Sentry", isPlayer: false, hp: 8, maxHp: 8, conditions: [], stats: { WIS: 18 } },
    ]);

    expect((await checkPayload("I hide from the Drunk")).dc).toBe(14);
  });

  it("un objetivo nombrado que no existe cae a la banda, no adivina", async () => {
    withHostiles([
      { id: "t1", name: "Goblin", isPlayer: false, hp: 8, maxHp: 8, conditions: [], stats: { WIS: 18 } },
    ]);

    expect((await checkPayload("I pickpocket the Merchant")).dcSource).toBe("band");
  });

  it("nombrar al empujado lo distingue entre varios candidatos", async () => {
    // Antes de extraer objetivo, dos hostiles bastaban para renunciar a la
    // contienda. El nombre resuelve la ambigüedad: se empuja al goblin, y la CD
    // sale de la Fuerza del goblin, no de la del orco.
    withHostiles([
      { id: "t1", name: "Goblin", isPlayer: false, hp: 8, maxHp: 8, conditions: [], stats: { STR: 18, DEX: 8 } },
      { id: "t2", name: "Orc", isPlayer: false, hp: 8, maxHp: 8, conditions: [], stats: { STR: 4, DEX: 4 } },
    ]);

    const payload = await checkPayload("I shove the Goblin");
    expect(payload.dcSource).toBe("contest");
    expect(payload.dc).toBe(14);
  });

  it("dos criaturas con el mismo nombre siguen siendo ambiguas", async () => {
    // El nombre ya no basta para distinguirlas, así que no se contiende contra
    // una suposición — la regla que ya aplica la puerta de ataque.
    withHostiles([
      { id: "t1", name: "Goblin", isPlayer: false, hp: 8, maxHp: 8, conditions: [], stats: { STR: 18 } },
      { id: "t2", name: "Goblin", isPlayer: false, hp: 8, maxHp: 8, conditions: [], stats: { STR: 4 } },
    ]);

    expect((await checkPayload("I shove the Goblin")).dcSource).toBe("band");
  });

  it("sin nombrar objetivo, un único candidato es inequívoco", async () => {
    withHostiles([
      { id: "t1", name: "Goblin", isPlayer: false, hp: 8, maxHp: 8, conditions: [], stats: { STR: 18 } },
    ]);

    const payload = await checkPayload("I shove");
    expect(payload.dcSource).toBe("contest");
    expect(payload.dc).toBe(14);
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

describe("una armadura sin competencia penaliza la prueba, no la habilidad entera", () => {
  // Mira es maga: sin competencia en ninguna armadura. El inventario del
  // fixture está vacío por defecto, así que aquí se equipa una armadura
  // pesada a mano para forzar la penalización.
  const HEAVY_ARMOR_UNPROFICIENT = [
    {
      type: "armor",
      equippedSlot: "ARMOR",
      properties: { baseAC: 16, armorClass: "heavy", addDexModifier: false },
    },
  ];

  it("una prueba de Destreza (Sigilo) sale con desventaja", async () => {
    (buildCampaignContext as any).mockResolvedValue(
      contextFor({ inventory: HEAVY_ARMOR_UNPROFICIENT })
    );

    const { frames } = await post("I hide behind the crates");
    const payload = frames.find((f) => f.e?.type === "ABILITY_CHECK_RESOLVED").e.payload;

    expect(payload.rollMode).toBe("disadvantage");
  });

  it("la misma armadura no toca una prueba que no es de Fuerza ni Destreza", async () => {
    // Misma maga, misma armadura pesada sin competencia, pero Investigación es
    // una prueba de Inteligencia: la SRD no la penaliza. Esta es la prueba que
    // le da sentido a la anterior — junto demuestran que la puerta lee la
    // habilidad de la prueba, no que aplique la penalización a todo.
    (buildCampaignContext as any).mockResolvedValue(
      contextFor({ inventory: HEAVY_ARMOR_UNPROFICIENT })
    );

    const { frames } = await post("I search the room");
    const payload = frames.find((f) => f.e?.type === "ABILITY_CHECK_RESOLVED").e.payload;

    expect(payload.rollMode).toBe("normal");
  });
});

describe("una armadura sin competencia impide lanzar, no solo penaliza", () => {
  // SRD: no es desventaja, es que no se puede lanzar en absoluto. El rechazo
  // llega antes de cualquier resolución, así que no se gasta espacio ni se
  // tira nada.
  const HEAVY_ARMOR_UNPROFICIENT = [
    {
      type: "armor",
      equippedSlot: "ARMOR",
      properties: { baseAC: 16, armorClass: "heavy", addDexModifier: false },
    },
  ];

  it("rechaza el conjuro de una maga con armadura que no sabe usar", async () => {
    (buildCampaignContext as any).mockResolvedValue(
      contextFor({ inventory: HEAVY_ARMOR_UNPROFICIENT })
    );

    const { res } = await post("I cast Fireball");

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/armour|armor/i);

    // Rechazo declarado, no silencioso.
    expect(systemLogs().some((line) => /armou?r/i.test(line))).toBe(true);

    // Nada se gastó ni se tiró: el rechazo llegó antes de cualquier resolución.
    expect(prisma.character.update).not.toHaveBeenCalled();
    expect(streamNarrative).not.toHaveBeenCalled();
  });

  it("la misma maga lanza en cuanto se quita la armadura", async () => {
    (buildCampaignContext as any).mockResolvedValue(contextFor({ inventory: [] }));

    const { res } = await post("I cast Fireball");

    expect(res.status).not.toBe(400);
  });

  it("un clérigo con armadura ligera —que sí sabe usar— lanza igual", async () => {
    // Sin este caso, una puerta escrita como "lleva armadura ⇒ rechazo" pasaría
    // los dos tests anteriores: uno lleva armadura, el otro no lleva ninguna.
    // Este es el único que obliga a la puerta a leer la clase.
    (buildCampaignContext as any).mockResolvedValue(
      contextFor({
        class: "cleric",
        inventory: [
          {
            type: "armor",
            equippedSlot: "ARMOR",
            properties: { baseAC: 11, armorClass: "light", addDexModifier: true },
          },
        ],
      })
    );

    const { res } = await post("I cast Fireball");

    expect(res.status).not.toBe(400);
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

describe("un conjuro puede alcanzar a varias criaturas", () => {
  /** Magic Missile as the SRD cache stores it: level 1, damage, no save. */
  const MAGIC_MISSILE = {
    id: "spell_magic_missile",
    indexSlug: "magic-missile",
    name: "Magic Missile",
    level: 1,
    concentration: false,
    data: {
      damage: {
        damage_at_slot_level: { "1": "1d4+1", "2": "2d4+2" },
        damage_type: { index: "force" },
      },
      area_of_effect: { type: "sphere", size: 20 },
      range: "120 pies",
    },
  };

  it("alcanza a las dos criaturas que caen dentro del área", async () => {
    // Antes este test pasaba targetIds sin posiciones y afirmaba que ambas
    // recibían daño: documentaba el agujero, igual que aquel test que afirmaba
    // que "search" llegaba a una puerta inexistente. Ahora ambas están dentro
    // del radio y el daño lo decide la geometría, no la lista del cliente.
    const hostiles = [
      { id: "t1", name: "Goblin One", isPlayer: false, hp: 10, maxHp: 10, ac: 12, conditions: [], concentrationSpellId: null, stats: { DEX: 10 }, x: 1, y: 0, size: "Medium" },
      { id: "t2", name: "Goblin Two", isPlayer: false, hp: 10, maxHp: 10, ac: 12, conditions: [], concentrationSpellId: null, stats: { DEX: 10 }, x: 1, y: 1, size: "Medium" },
    ];
    const base = contextFor();
    (buildCampaignContext as any).mockResolvedValue({
      ...base,
      activeEncounter: {
        id: "enc_1", round: 1, currentTurnIndex: 0, totalDamageDealt: 0,
        combatants: [
          // Deliberately far from the aim point: this test measures that both
          // hostiles inside the radius are hit, and a caster caught in their own
          // blast — correct, and covered separately — would be a second reason
          // for it to fail.
          { id: "p1", name: "Mira", isPlayer: true, hp: 20, maxHp: 20, ac: 14, conditions: [], concentrationSpellId: null, stats: {}, x: 10, y: 10, size: "Medium" },
          ...hostiles,
        ],
      },
    });
    (prisma.srdSpell.findMany as any).mockResolvedValue([MAGIC_MISSILE]);
    (prisma.combatant.findMany as any).mockResolvedValue(hostiles);

    const { res, frames } = await post("I cast Magic Missile", {
      targetIds: ["t1", "t2"],
      targetX: 1,
      targetY: 0,
    });

    expect(res.status).toBe(200);

    // Ambas criaturas reciben una escritura de estado, no solo la primera.
    const updated = (prisma.combatant.update as any).mock.calls
      .map((c: any[]) => c[0]?.where?.id)
      .filter(Boolean);
    expect(new Set(updated)).toEqual(new Set(["t1", "t2"]));

    // Y la consecuencia que viaja al narrador nombra a las dos.
    const consequence = frames.find((f) => f.e?.type === "COMBAT_CONSEQUENCE");
    expect(consequence).toBeDefined();
    expect(consequence.e.payload.targets).toHaveLength(2);
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

describe("el área decide a quién alcanza un conjuro, no el cliente", () => {
  /** Fireball as the SRD cache stores it: a 20 ft radius sphere. */
  const FIREBALL_AREA = {
    id: "spell_fireball_area",
    indexSlug: "fireball",
    name: "Fireball",
    level: 3,
    concentration: false,
    data: {
      damage: {
        damage_at_slot_level: { "3": "8d6" },
        damage_type: { index: "fire" },
      },
      dc: { dc_type: { index: "dex" }, dc_success: "half" },
      area_of_effect: { type: "sphere", size: 20 },
      range: "150 pies",
    },
  };

  const hostile = (id: string, name: string, x: number, y: number) => ({
    id, name, isPlayer: false, hp: 20, maxHp: 20, ac: 12,
    conditions: [], concentrationSpellId: null, stats: { DEX: 10 },
    x, y, size: "Medium",
  });

  /** The caster, placed far from every aim point these tests use. */
  const caster = {
    id: "p1", name: "Mira", isPlayer: true, hp: 20, maxHp: 20, ac: 14,
    conditions: [], concentrationSpellId: null, stats: {},
    x: 10, y: 0, size: "Medium",
  };

  function encounterWith(combatants: Array<Record<string, unknown>>) {
    (buildCampaignContext as any).mockResolvedValue({
      ...contextFor(),
      activeEncounter: {
        id: "enc_1", round: 1, currentTurnIndex: 0, totalDamageDealt: 0,
        combatants,
      },
    });
    (prisma.srdSpell.findMany as any).mockResolvedValue([FIREBALL_AREA]);
    (prisma.combatant.findMany as any).mockResolvedValue(combatants);
  }

  /** Every combatant the route wrote state for. */
  function damaged(): string[] {
    return (prisma.combatant.update as any).mock.calls
      .map((c: any[]) => c[0]?.where?.id)
      .filter(Boolean);
  }

  it("ignora un objetivo que el cliente nombró pero está fuera del radio", async () => {
    const near = hostile("t1", "Goblin Cerca", 1, 0);
    const far = hostile("t2", "Goblin Lejos", 40, 0);
    encounterWith([caster, near, far]);

    const { res } = await post("I cast Fireball", {
      targetIds: ["t1", "t2"],
      targetX: 1,
      targetY: 0,
    });

    expect(res.status).toBe(200);
    expect(damaged()).toContain("t1");
    expect(damaged()).not.toContain("t2");
  });

  it("alcanza a quien está dentro del radio aunque el cliente no lo nombrara", async () => {
    const named = hostile("t1", "Goblin Uno", 1, 0);
    const unnamed = hostile("t2", "Goblin Dos", 1, 1);
    encounterWith([caster, named, unnamed]);

    const { res } = await post("I cast Fireball", {
      targetIds: ["t1"],
      targetX: 1,
      targetY: 0,
    });

    expect(res.status).toBe(200);
    expect(damaged()).toContain("t2");
  });

  it("rechaza cuando el nombre encaja con varias criaturas", async () => {
    // Distinto de "sin punto de mira": aquí el jugador sí apuntó, pero a algo
    // que no identifica una casilla. Elegir una por él sería adivinar.
    encounterWith([caster, hostile("t1", "Goblin", 1, 0), hostile("t2", "Goblin", 5, 0)]);

    const { res } = await post("I cast Fireball on the Goblin");

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: "AIM_AMBIGUOUS" });
    expect(streamNarrative).not.toHaveBeenCalled();
  });

  it("rechaza un conjuro de área sin punto al que apuntar", async () => {
    encounterWith([caster, hostile("t1", "Goblin Uno", 1, 0)]);

    const { res } = await post("I cast Fireball");

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: "AIM_REQUIRED" });
    expect(streamNarrative).not.toHaveBeenCalled();
  });

  it("rechaza un conjuro cuya forma de área el motor no conoce", async () => {
    // Tratarla como "sin área" devolvería la elección al cliente, que es
    // exactamente el agujero que esto viene a cerrar.
    encounterWith([caster, hostile("t1", "Goblin Uno", 1, 0)]);
    (prisma.srdSpell.findMany as any).mockResolvedValue([
      { ...FIREBALL_AREA, data: { ...FIREBALL_AREA.data, area_of_effect: { type: "hipercubo", size: 20 } } },
    ]);

    const { res } = await post("I cast Fireball", { targetX: 1, targetY: 0 });

    expect(res.status).toBe(400);
    expect(prisma.combatant.update).not.toHaveBeenCalled();
    expect(streamNarrative).not.toHaveBeenCalled();
  });
});

describe("una explosión no distingue de quién es", () => {
  // The design flagged both of these as unverified rather than assuming them.
  const FIREBALL_AREA = {
    id: "spell_fireball_self", indexSlug: "fireball", name: "Fireball",
    level: 3, concentration: false,
    data: {
      damage: { damage_at_slot_level: { "3": "8d6" }, damage_type: { index: "fire" } },
      dc: { dc_type: { index: "dex" }, dc_success: "half" },
      area_of_effect: { type: "sphere", size: 20 },
      range: "150 pies",
    },
  };

  function encounterWith(combatants: Array<Record<string, unknown>>) {
    (buildCampaignContext as any).mockResolvedValue({
      ...contextFor(),
      activeEncounter: {
        id: "enc_1", round: 1, currentTurnIndex: 0, totalDamageDealt: 0,
        combatants,
      },
    });
    (prisma.srdSpell.findMany as any).mockResolvedValue([FIREBALL_AREA]);
    (prisma.combatant.findMany as any).mockResolvedValue(combatants);
  }

  it("alcanza al propio lanzador si se sitúa dentro de su radio", async () => {
    // Correct by the rules and until now unreachable: the client chose the set
    // and never included itself.
    const player = {
      id: "p1", name: "Mira", isPlayer: true, hp: 20, maxHp: 20, ac: 14,
      conditions: [], concentrationSpellId: null, stats: {}, x: 0, y: 0, size: "Medium",
    };
    encounterWith([player]);

    const { res } = await post("I cast Fireball", { targetX: 0, targetY: 0 });

    expect(res.status).toBe(200);
    const updated = (prisma.combatant.update as any).mock.calls
      .map((c: any[]) => c[0]?.where?.id)
      .filter(Boolean);
    expect(updated).toContain("p1");
  });

  it("alcanza a una criatura ya a 0 pv dentro del radio", async () => {
    const downed = {
      id: "t1", name: "Goblin Caído", isPlayer: false, hp: 0, maxHp: 10, ac: 12,
      conditions: [], concentrationSpellId: null, stats: { DEX: 10 },
      x: 1, y: 0, size: "Medium",
    };
    encounterWith([
      { id: "p1", name: "Mira", isPlayer: true, hp: 20, maxHp: 20, ac: 14,
        conditions: [], concentrationSpellId: null, stats: {}, x: 10, y: 0, size: "Medium" },
      downed,
    ]);

    const { res } = await post("I cast Fireball", { targetX: 1, targetY: 0 });

    expect(res.status).toBe(200);
  });
});

describe("el alcance del conjuro lo comprueba el backend", () => {
  /** Fireball as the SRD stores it: 150 ft range, 20 ft radius sphere. */
  const FIREBALL_RANGED = {
    id: "spell_fireball_ranged",
    indexSlug: "fireball",
    name: "Fireball",
    level: 3,
    concentration: false,
    data: {
      damage: { damage_at_slot_level: { "3": "8d6" }, damage_type: { index: "fire" } },
      dc: { dc_type: { index: "dex" }, dc_success: "half" },
      area_of_effect: { type: "sphere", size: 20 },
      range: "150 pies",
    },
  };

  /** Cure Wounds: touch, no area. */
  const CURE_WOUNDS = {
    id: "spell_cure_wounds",
    indexSlug: "cure-wounds",
    name: "Cure Wounds",
    level: 1,
    concentration: false,
    data: {
      heal_at_slot_level: { "1": "1d8" },
      range: "Toque",
    },
  };

  const caster = {
    id: "p1", name: "Mira", isPlayer: true, hp: 20, maxHp: 20, ac: 14,
    conditions: [], concentrationSpellId: null, stats: {}, x: 0, y: 0, size: "Medium",
  };

  const hostile = (id: string, x: number, y: number) => ({
    id, name: `Goblin ${id}`, isPlayer: false, hp: 20, maxHp: 20, ac: 12,
    conditions: [], concentrationSpellId: null, stats: { DEX: 10 },
    x, y, size: "Medium",
  });

  function encounterWith(spell: unknown, combatants: Array<Record<string, unknown>>) {
    (buildCampaignContext as any).mockResolvedValue({
      ...contextFor(),
      activeEncounter: {
        id: "enc_1", round: 1, currentTurnIndex: 0, totalDamageDealt: 0,
        combatants,
      },
    });
    (prisma.srdSpell.findMany as any).mockResolvedValue([spell]);
    (prisma.combatant.findMany as any).mockResolvedValue(combatants);
  }

  it("rechaza un punto de mira más allá del alcance", async () => {
    // (0,0) to (40,0) is 200 ft; Fireball reaches 150.
    encounterWith(FIREBALL_RANGED, [caster, hostile("t1", 40, 0)]);

    const { res } = await post("I cast Fireball", { targetX: 40, targetY: 0 });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: "OUT_OF_RANGE" });
    expect(prisma.combatant.update).not.toHaveBeenCalled();
    expect(streamNarrative).not.toHaveBeenCalled();
  });

  it("permite un punto de mira al límite, y el radio alcanza más allá", async () => {
    // The aim is exactly 150 ft away; the 20 ft radius legitimately catches a
    // creature 170 ft out. An implementation gating targets instead of the
    // origin refuses this.
    const atLimit = hostile("t1", 30, 0);   // 150 ft — the aim square
    const beyond = hostile("t2", 33, 0);    // 165 ft, inside the 20 ft radius
    encounterWith(FIREBALL_RANGED, [caster, atLimit, beyond]);

    const { res } = await post("I cast Fireball", { targetX: 30, targetY: 0 });

    expect(res.status).toBe(200);
    const updated = (prisma.combatant.update as any).mock.calls
      .map((c: any[]) => c[0]?.where?.id)
      .filter(Boolean);
    expect(updated).toContain("t2");
  });

  it("un conjuro de toque exige un objetivo adyacente", async () => {
    encounterWith(CURE_WOUNDS, [caster, hostile("t1", 4, 0)]);

    const { res } = await post("I cast Cure Wounds on Goblin t1", {
      targetIds: ["t1"],
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: "OUT_OF_RANGE" });
  });

  it("deja constancia cuando el alcance no se pudo comprobar", async () => {
    encounterWith(
      { ...FIREBALL_RANGED, data: { ...FIREBALL_RANGED.data, range: "Ilimitado" } },
      [caster, hostile("t1", 40, 0)]
    );

    const { res } = await post("I cast Fireball", { targetX: 40, targetY: 0 });

    expect(res.status).toBe(200);
    expect(
      systemLogs().some((line) => line.includes("Ilimitado"))
    ).toBe(true);
  });
});

describe("un conjuro lanzador-solo no se puede redirigir a otra criatura", () => {
  const caster = {
    id: "p1", name: "Mira", isPlayer: true, hp: 20, maxHp: 20, ac: 14,
    conditions: [], concentrationSpellId: null, stats: {}, x: 0, y: 0, size: "Medium",
  };

  const hostile = (id: string, x: number, y: number) => ({
    id, name: `Goblin ${id}`, isPlayer: false, hp: 20, maxHp: 20, ac: 12,
    conditions: [], concentrationSpellId: null, stats: { DEX: 10 },
    x, y, size: "Medium",
  });

  function encounterWith(spell: unknown, combatants: Array<Record<string, unknown>>) {
    (buildCampaignContext as any).mockResolvedValue({
      ...contextFor(),
      activeEncounter: {
        id: "enc_1", round: 1, currentTurnIndex: 0, totalDamageDealt: 0,
        combatants,
      },
    });
    (prisma.srdSpell.findMany as any).mockResolvedValue([spell]);
    (prisma.combatant.findMany as any).mockResolvedValue(combatants);
  }

  function damaged(): string[] {
    return (prisma.combatant.update as any).mock.calls
      .map((c: any[]) => c[0]?.where?.id)
      .filter(Boolean);
  }

  /** Espíritus Guardianes as the SRD stores it: caster-only, 15 ft radius. */
  const ESPIRITUS_GUARDIANES = {
    id: "spell_espiritus", indexSlug: "espiritus-guardianes", name: "Espiritus Guardianes",
    level: 3, concentration: true,
    data: {
      damage: { damage_at_slot_level: { "3": "3d8" }, damage_type: { index: "radiant" } },
      range: "Personal (radio de 15 pies)",
    },
  };

  it("una esfera lanzador-solo se centra en el lanzador, ignorando un punto de mira lejano", async () => {
    // Reproduced from the finding: an aim 200 ft away used to be applied
    // verbatim, detonating a 15 ft caster-emanation across the map.
    const near = hostile("t1", 2, 0);   // 10 ft — inside the 15 ft radius
    const far = hostile("t2", 40, 0);   // 200 ft — where the client aimed
    encounterWith(ESPIRITUS_GUARDIANES, [caster, near, far]);

    const { res } = await post("I cast Espiritus Guardianes", {
      targetX: 40, targetY: 0,
    });

    expect(res.status).toBe(200);
    expect(damaged()).toContain("t1");
    expect(damaged()).not.toContain("t2");
  });

  it("no exige punto de mira: un conjuro lanzador-solo no tiene casilla que elegir", async () => {
    // The same spell cast with no coordinates at all used to refuse with
    // AIM_REQUIRED, for a spell that has no square to choose.
    encounterWith(ESPIRITUS_GUARDIANES, [caster, hostile("t1", 2, 0)]);

    const { res } = await post("I cast Espiritus Guardianes");

    expect(res.status).toBe(200);
  });

  /** A caster-only spell with no area at all — no sphere to hide behind. */
  const RESPLANDOR_PERSONAL = {
    id: "spell_resplandor", indexSlug: "resplandor-personal", name: "Resplandor Personal",
    level: 1, concentration: false,
    data: {
      damage: { damage_at_slot_level: { "1": "1d6" }, damage_type: { index: "fire" } },
      range: "Personal",
    },
  };

  it("un conjuro lanzador-solo sin área no daña a un objetivo nombrado por el cliente", async () => {
    const enemy = hostile("t1", 2, 0);
    encounterWith(RESPLANDOR_PERSONAL, [caster, enemy]);

    const { res } = await post("I cast Resplandor Personal", {
      targetIds: ["t1"],
    });

    expect(res.status).toBe(200);
    expect(damaged()).not.toContain("t1");
  });
});

describe("un nombre que encaja con varias criaturas no las alcanza a todas", () => {
  /** Magic Missile: no area, single-target by rule even though the SRD cache
   *  stores no target count to validate against. */
  const MAGIC_MISSILE = {
    id: "spell_magic_missile", indexSlug: "magic-missile", name: "Magic Missile",
    level: 1, concentration: false,
    data: {
      damage: { damage_at_slot_level: { "1": "1d4+1" }, damage_type: { index: "force" } },
      range: "120 pies",
    },
  };

  const caster = {
    id: "p1", name: "Mira", isPlayer: true, hp: 20, maxHp: 20, ac: 14,
    conditions: [], concentrationSpellId: null, stats: {}, x: 0, y: 0, size: "Medium",
  };

  const hostile = (id: string, x: number, y: number) => ({
    id, name: "Goblin", isPlayer: false, hp: 20, maxHp: 20, ac: 12,
    conditions: [], concentrationSpellId: null, stats: { DEX: 10 },
    x, y, size: "Medium",
  });

  it("tres criaturas con el mismo nombre: solo una recibe la escritura de estado", async () => {
    // Reproduced from the finding: three hostiles all named "Goblin" used to
    // produce three combatant.update calls, one for each name match, where a
    // single-target spell should hit exactly one.
    const combatants = [
      caster,
      hostile("t1", 1, 0),
      hostile("t2", 1, 1),
      hostile("t3", 1, 2),
    ];
    (buildCampaignContext as any).mockResolvedValue({
      ...contextFor(),
      activeEncounter: {
        id: "enc_1", round: 1, currentTurnIndex: 0, totalDamageDealt: 0,
        combatants,
      },
    });
    (prisma.srdSpell.findMany as any).mockResolvedValue([MAGIC_MISSILE]);
    (prisma.combatant.findMany as any).mockResolvedValue(combatants);

    const { res } = await post("I cast Magic Missile on the Goblin");

    expect(res.status).toBe(200);
    const updated = (prisma.combatant.update as any).mock.calls
      .map((c: any[]) => c[0]?.where?.id)
      .filter(Boolean);
    expect(updated).toHaveLength(1);
    expect(["t1", "t2", "t3"]).toContain(updated[0]);
  });
});

describe("sin combatiente jugador identificable, el lanzamiento se rechaza", () => {
  const FIREBALL_AREA = {
    id: "spell_fireball_noplayer", indexSlug: "fireball", name: "Fireball",
    level: 3, concentration: false,
    data: {
      damage: { damage_at_slot_level: { "3": "8d6" }, damage_type: { index: "fire" } },
      dc: { dc_type: { index: "dex" }, dc_success: "half" },
      area_of_effect: { type: "sphere", size: 20 },
      range: "150 pies",
    },
  };

  it("un encuentro sin ningun isPlayer=true rechaza el lanzamiento en vez de resolver desde (0,0)", async () => {
    // Nothing in this encounter carries isPlayer, so there is no combatant to
    // measure range or the area origin from. The old fallback resolved from
    // the map corner (0,0) with the range gate silently skipped.
    const combatants = [
      { id: "t1", name: "Goblin", isPlayer: false, hp: 20, maxHp: 20, ac: 12,
        conditions: [], concentrationSpellId: null, stats: { DEX: 10 }, x: 1, y: 0, size: "Medium" },
    ];
    (buildCampaignContext as any).mockResolvedValue({
      ...contextFor(),
      activeEncounter: {
        id: "enc_1", round: 1, currentTurnIndex: 0, totalDamageDealt: 0,
        combatants,
      },
    });
    (prisma.srdSpell.findMany as any).mockResolvedValue([FIREBALL_AREA]);
    (prisma.combatant.findMany as any).mockResolvedValue(combatants);

    const { res } = await post("I cast Fireball", { targetX: 1, targetY: 0 });

    expect(res.status).toBe(400);
    expect(prisma.combatant.update).not.toHaveBeenCalled();
    expect(streamNarrative).not.toHaveBeenCalled();
  });
});


describe("la linea de alcance no verificado no se escribe si el lanzamiento se rechaza despues", () => {
  const caster = {
    id: "p1", name: "Mira", isPlayer: true, hp: 20, maxHp: 20, ac: 14,
    conditions: [], concentrationSpellId: null, stats: {}, x: 0, y: 0, size: "Medium",
  };

  /** An area spell with an unenforceable range, so checkSpellRange passes and
   *  flags it for the log — but no aim point is supplied, so the area gate
   *  that runs afterwards refuses the cast outright. */
  const FIREBALL_UNLIMITED = {
    id: "spell_fireball_unlimited", indexSlug: "fireball", name: "Fireball",
    level: 3, concentration: false,
    data: {
      damage: { damage_at_slot_level: { "3": "8d6" }, damage_type: { index: "fire" } },
      dc: { dc_type: { index: "dex" }, dc_success: "half" },
      area_of_effect: { type: "sphere", size: 20 },
      range: "Ilimitado",
    },
  };

  it("un area sin punto de mira se rechaza sin dejar el aviso de alcance no verificado en el registro", async () => {
    const combatants = [
      caster,
      { id: "t1", name: "Goblin", isPlayer: false, hp: 20, maxHp: 20, ac: 12,
        conditions: [], concentrationSpellId: null, stats: { DEX: 10 }, x: 1, y: 0, size: "Medium" },
    ];
    (buildCampaignContext as any).mockResolvedValue({
      ...contextFor(),
      activeEncounter: {
        id: "enc_1", round: 1, currentTurnIndex: 0, totalDamageDealt: 0,
        combatants,
      },
    });
    (prisma.srdSpell.findMany as any).mockResolvedValue([FIREBALL_UNLIMITED]);
    (prisma.combatant.findMany as any).mockResolvedValue(combatants);

    const { res } = await post("I cast Fireball");

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: "AIM_REQUIRED" });
    // The range gate itself passed (unenforceable, not out of range) and would
    // have logged that fact — but the cast never actually went ahead, so the
    // log must stay silent about a spell that was never resolved.
    expect(
      systemLogs().some((line) => line.includes("range not verified"))
    ).toBe(false);
  });
});

describe("la puerta de equipar enruta por categoría, no por tipo", () => {
  // Las Ashwalker Boots son `type: "armor"` en data/loot-tables.json y no
  // llevan categoría de armadura. Antes de la regla de slots iban a ARMOR, lo
  // que desequipaba la armadura de cuerpo y apagaba en silencio la penalización
  // por competencia sobre ataques, pruebas de FUE/DES y lanzamiento.
  const CON_BOTAS = [
    {
      id: "mail",
      name: "Chain Mail",
      type: "armor",
      quantity: 1,
      properties: { baseAC: 16, armorClass: "heavy", addDexModifier: false },
      equippedSlot: "ARMOR",
    },
    {
      id: "boots",
      name: "Ashwalker Boots",
      type: "armor",
      quantity: 1,
      properties: { effect: "ignore_difficult_terrain_ash" },
      equippedSlot: null,
    },
  ];

  it("no desaloja la armadura de cuerpo al equipar unas botas", async () => {
    (buildCampaignContext as any).mockResolvedValue(
      contextFor({ inventory: CON_BOTAS })
    );

    // "don" es uno de los verbos que el clasificador reconoce para `equip`;
    // "put on" no lo es, así que el texto se elige para llegar de verdad a la
    // puerta en vez de fallar en la clasificación.
    await post("I don the Ashwalker Boots");

    // Confirma primero que la puerta se alcanzó, para no confundir un fallo de
    // clasificación con el defecto que este test busca.
    expect(prisma.inventoryItem.update).toHaveBeenCalled();

    // La colocación va al slot de accesorio.
    expect(prisma.inventoryItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "boots" },
        data: { equippedSlot: "ACCESSORY" },
      })
    );

    // Y el desalojo apunta a ACCESSORY, así que la cota de malla sigue puesta.
    // Esta es la aserción que falla si se revierte todo el incremento.
    expect(prisma.inventoryItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ equippedSlot: "ACCESSORY" }),
      })
    );
    expect(prisma.inventoryItem.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ equippedSlot: "ARMOR" }),
      })
    );
  });

  it("manda el escudo a la mano libre, no al slot de armadura", async () => {
    (buildCampaignContext as any).mockResolvedValue(
      contextFor({
        inventory: [
          {
            id: "shield",
            name: "Shield",
            type: "armor",
            quantity: 1,
            properties: { baseAC: 2, armorClass: "shield" },
            equippedSlot: null,
          },
        ],
      })
    );

    await post("I equip the Shield");

    expect(prisma.inventoryItem.update).toHaveBeenCalled();

    expect(prisma.inventoryItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "shield" },
        data: { equippedSlot: "OFF_HAND" },
      })
    );
  });
});
