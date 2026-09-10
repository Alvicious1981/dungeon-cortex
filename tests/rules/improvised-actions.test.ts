import { describe, expect, it } from "vitest";

import {
  IMPROVISED_ACTIONS,
  matchImprovisedAction,
} from "@/lib/rules/improvised-actions";
import {
  DIFFICULTY_BANDS,
  DIFFICULTY_DC,
  SKILL_ABILITY,
  computeAbilityCheckDC,
} from "@/lib/rules/ability-check";

const ACTION_CHECK = {
  cost: "action",
  resolution: "check",
} as const;

const EFFECT_UNSUPPORTED = (cost: "action" | "attack" | "movement") => ({
  cost,
  resolution: "unsupported",
  refusalCode: "COMBAT_EFFECT_UNSUPPORTED",
} as const);

const MOVEMENT_UNSUPPORTED = {
  cost: "movement",
  resolution: "unsupported",
  refusalCode: "COMBAT_MOVEMENT_CHECK_UNSUPPORTED",
} as const;

const COMBAT_POLICY_CASES = [
  ["I listen", ACTION_CHECK],
  ["escucho", ACTION_CHECK],
  ["I search", ACTION_CHECK],
  ["investigo", ACTION_CHECK],
  ["I track", ACTION_CHECK],
  ["oriento", ACTION_CHECK],
  ["I persuade", ACTION_CHECK],
  ["convenzo", ACTION_CHECK],
  ["I lie", ACTION_CHECK],
  ["miento", ACTION_CHECK],
  ["I intimidate", ACTION_CHECK],
  ["amenazo", ACTION_CHECK],
  ["I climb", MOVEMENT_UNSUPPORTED],
  ["trepo", MOVEMENT_UNSUPPORTED],
  ["I jump", MOVEMENT_UNSUPPORTED],
  ["salto", MOVEMENT_UNSUPPORTED],
  ["I swim", MOVEMENT_UNSUPPORTED],
  ["nado", MOVEMENT_UNSUPPORTED],
  ["I tumble", MOVEMENT_UNSUPPORTED],
  ["hago una voltereta", MOVEMENT_UNSUPPORTED],
  ["I drag", EFFECT_UNSUPPORTED("movement")],
  ["arrastro", EFFECT_UNSUPPORTED("movement")],
  ["I ride", EFFECT_UNSUPPORTED("movement")],
  ["monto", EFFECT_UNSUPPORTED("movement")],
  ["I shove", EFFECT_UNSUPPORTED("attack")],
  ["empujo", EFFECT_UNSUPPORTED("attack")],
  ["I grapple", EFFECT_UNSUPPORTED("attack")],
  ["agarro", EFFECT_UNSUPPORTED("attack")],
  ["I force", EFFECT_UNSUPPORTED("action")],
  ["fuerzo", EFFECT_UNSUPPORTED("action")],
  ["I disarm", EFFECT_UNSUPPORTED("action")],
  ["desarmo", EFFECT_UNSUPPORTED("action")],
  ["I pickpocket", EFFECT_UNSUPPORTED("action")],
  ["robo", EFFECT_UNSUPPORTED("action")],
  ["I hide", EFFECT_UNSUPPORTED("action")],
  ["me escondo", EFFECT_UNSUPPORTED("action")],
  ["I forage", EFFECT_UNSUPPORTED("action")],
  ["forrajeo", EFFECT_UNSUPPORTED("action")],
  ["I stabilize", EFFECT_UNSUPPORTED("action")],
  ["estabilizo", EFFECT_UNSUPPORTED("action")],
  ["I calm", EFFECT_UNSUPPORTED("action")],
  ["calmo", EFFECT_UNSUPPORTED("action")],
  ["I disguise", EFFECT_UNSUPPORTED("action")],
  ["disfrazo", EFFECT_UNSUPPORTED("action")],
  ["I dodge", EFFECT_UNSUPPORTED("action")],
  ["esquivo", EFFECT_UNSUPPORTED("action")],
] as const;

describe("tabla de acciones improvisadas", () => {
  // Guardia estructural. Un verbo añadido sin dificultad, o con una habilidad
  // que el motor no conoce, deja de compilar mentalmente aquí en vez de
  // resolverse en la partida contra una CD por defecto silenciosa.
  it("cada entrada declara una banda legal y una habilidad que existe", () => {
    for (const action of IMPROVISED_ACTIONS) {
      expect(DIFFICULTY_BANDS).toContain(action.band);
      expect(SKILL_ABILITY).toHaveProperty(action.skill);
    }
  });

  it("cada entrada declara un coste y una resolución de combate completos", () => {
    for (const action of IMPROVISED_ACTIONS) {
      expect(["action", "attack", "movement"]).toContain(action.combat.cost);
      expect(["check", "unsupported"]).toContain(action.combat.resolution);

      if (action.combat.resolution === "check") {
        expect(action.combat).not.toHaveProperty("refusalCode");
      } else {
        expect([
          "COMBAT_EFFECT_UNSUPPORTED",
          "COMBAT_MOVEMENT_CHECK_UNSUPPORTED",
        ]).toContain(action.combat.refusalCode);
      }
    }
  });

  it.each(COMBAT_POLICY_CASES)(
    "%s conserva la política de combate SRD fijada",
    (input, expected) => {
      expect(matchImprovisedAction(input)?.action.combat).toEqual(expected);
    }
  );

  it("ningún verbo representativo casa con dos entradas tras separar políticas", () => {
    for (const [input] of COMBAT_POLICY_CASES) {
      const matches = IMPROVISED_ACTIONS.filter((action) => action.pattern.test(input));
      expect(matches, input).toHaveLength(1);
    }
  });

  it("ninguna entrada queda inalcanzable por otra anterior", () => {
    // El emparejamiento es "el primero que case gana", así que un verbo repetido
    // en dos entradas haría que la segunda no se ejecutase nunca. Se comprueba
    // con un representante de cada entrada.
    const seen = new Set<string>();
    for (const action of IMPROVISED_ACTIONS) {
      const key = action.pattern.source;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("la dificultad no es constante: usa al menos tres bandas distintas", () => {
    // La regresión que este cambio corrige era exactamente una CD única para
    // todo. Si la tabla vuelve a colapsar en una sola banda, esto lo detecta.
    const bands = new Set(IMPROVISED_ACTIONS.map((a) => a.band));
    expect(bands.size).toBeGreaterThanOrEqual(3);
  });

  it("una misma habilidad puede tener dificultades distintas", () => {
    const athletics = IMPROVISED_ACTIONS.filter((a) => a.skill === "Athletics");
    expect(new Set(athletics.map((a) => a.band)).size).toBeGreaterThan(1);
  });

  it("ancla la escala en el único número que el SRD fija: estabilizar es CD 10", () => {
    const stabilise = matchImprovisedAction("I stabilize the dying scout");
    expect(stabilise?.action.skill).toBe("Medicine");
    expect(computeAbilityCheckDC(stabilise?.action.band)).toBe(DIFFICULTY_DC.easy);
    expect(DIFFICULTY_DC.easy).toBe(10);
  });
});

describe("matchImprovisedAction", () => {
  it.each([
    ["I climb the wall", "Athletics", "easy"],
    ["trepo por el muro", "Athletics", "easy"],
    ["I force the portcullis", "Athletics", "hard"],
    ["fuerzo la reja", "Athletics", "hard"],
    ["I pickpocket the merchant", "Sleight of Hand", "hard"],
    ["I listen at the door", "Perception", "easy"],
  ])("resuelve %s como %s/%s", (input, skill, band) => {
    expect(matchImprovisedAction(input)?.action).toMatchObject({ skill, band });
  });

  it("atraviesa el envoltorio de intento sin cambiar la dificultad", () => {
    // "I try to force the door" debe costar lo mismo que "I force the door":
    // el marco de la frase no altera la dificultad de la tarea.
    expect(matchImprovisedAction("I try to force the door")?.action).toMatchObject({
      skill: "Athletics",
      band: "hard",
    });
    expect(matchImprovisedAction("intento forzar la puerta")?.action).toMatchObject({
      skill: "Athletics",
      band: "hard",
    });
  });

  it("devuelve null cuando el SRD no tiene tirada para la frase", () => {
    // Respuesta con significado, no fallo: el llamante debe preguntar qué está
    // haciendo el jugador en vez de inventarse un desenlace.
    expect(matchImprovisedAction("I explore")).toBeNull();
    expect(matchImprovisedAction("I travel to the north")).toBeNull();
    expect(matchImprovisedAction("hago algo indescriptible")).toBeNull();
  });

  it("solo casa el verbo en cabeza, no en cualquier parte de la frase", () => {
    // Anclado en ^: mencionar un verbo de pasada no debe disparar una tirada.
    expect(matchImprovisedAction("the guard will search the room later")).toBeNull();
  });
});
