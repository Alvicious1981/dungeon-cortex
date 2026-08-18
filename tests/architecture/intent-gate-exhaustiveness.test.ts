/**
 * Contrato intención → puerta.
 *
 * Motivación: el PR #80 restauró el clasificador determinista, pero dejó dos
 * valores en el enum (`explore` y `travel`) que ninguna puerta de
 * `/api/campaign/[id]/action` consumía. Toda acción clasificada así atravesaba
 * la ruta sin tirada, sin mutación y sin evento, y llegaba al narrador — la
 * violación literal de la regla no negociable del proyecto.
 *
 * Es el mismo fallo que ya ocurrió una vez en su forma simétrica: entonces el
 * clasificador no distinguía nada; ahora distinguía más de lo que la ruta
 * resolvía. Ninguna prueba lo detectó porque `tests/api/action.test.ts` mockea
 * `parseIntent` y, por tanto, nunca comprueba que lo que el clasificador emite
 * tenga quien lo atienda.
 *
 * Esta comprobación es estática: importa el esquema real y lee el código fuente
 * de la ruta. No necesita base de datos ni servidor.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { IntentSchema } from "@/lib/ai/intent";

const ROOT = join(__dirname, "..", "..");
const ROUTE_PATH = join(ROOT, "app", "api", "campaign", "[id]", "action", "route.ts");
const ROUTE_SOURCE = readFileSync(ROUTE_PATH, "utf8");

/**
 * Tipos de acción que legítimamente no tienen puerta mecánica.
 *
 * Solo `general`: es la clasificación de diálogo y rol puro, donde no hay nada
 * que resolver y la narración es la respuesta correcta. Cualquier otra adición
 * a esta lista debe justificarse aquí, porque equivale a autorizar que la IA
 * narre algo que el backend no resolvió.
 */
const NON_MECHANICAL: readonly string[] = ["general"];

/** Valores de `actionType` que el esquema puede producir. */
function schemaActionTypes(): string[] {
  return [...IntentSchema.shape.actionType.options];
}

/** Valores de `actionType` que la ruta compara explícitamente. */
function gatedActionTypes(): string[] {
  const matches = ROUTE_SOURCE.matchAll(
    /intent\.actionType\s*===\s*"([a-z_]+)"/g
  );
  return [...new Set([...matches].map((m) => m[1]))];
}

describe("contrato intención → puerta en /action", () => {
  it("toda clasificación mecánica del esquema tiene una puerta en la ruta", () => {
    const mechanical = schemaActionTypes().filter(
      (type) => !NON_MECHANICAL.includes(type)
    );
    const gated = gatedActionTypes();

    const unhandled = mechanical.filter((type) => !gated.includes(type));

    expect(
      unhandled,
      `Estas clasificaciones llegarían al narrador sin que el backend las ` +
        `resuelva ni las rechace: ${unhandled.join(", ")}. Dales una puerta en ` +
        `route.ts, o quítalas del enum para que caigan en ` +
        `"mechanical_ambiguous" y se rechacen explícitamente.`
    ).toEqual([]);
  });

  it("ninguna puerta compara contra un actionType que el esquema no puede emitir", () => {
    // Protege contra el reverso: una puerta escrita sobre un valor inexistente
    // (un typo, o un valor retirado del enum) es código muerto que aparenta
    // cobertura.
    const declared = schemaActionTypes();
    const orphaned = gatedActionTypes().filter((type) => !declared.includes(type));

    expect(
      orphaned,
      `Estas puertas nunca se ejecutarán porque IntentSchema no puede producir ` +
        `su valor: ${orphaned.join(", ")}.`
    ).toEqual([]);
  });

  it("el rechazo por ambigüedad sigue siendo la vía de fallo cerrado", () => {
    // El valor por defecto del parser. Si desapareciera del esquema o de la
    // ruta, el parser dejaría de tener a dónde fallar.
    expect(schemaActionTypes()).toContain("mechanical_ambiguous");
    expect(ROUTE_SOURCE).toContain("MECHANICAL_CLARIFICATION_REQUIRED");
  });
});
