# Guía del operador — Flujo de interfaz con Claude Code Desktop

Para quien dirige el trabajo sin necesidad de dominar Git. Los documentos para Claude están en inglés; esta guía, en español.

## Qué es esto

`docs/ui/` contiene el orden de trabajo **UI-01 → UI-10**: una tarea por sesión, con un prompt listo para pegar en cada una.

- Claude **implementa y comprueba**. Tú **decides** si una PR se integra.
- **Claude nunca fusiona** una PR (hacer "merge") ni activa **Auto-merge**.
- Estos documentos solo ordenan el trabajo. Mandan siempre por encima de ellos las reglas del proyecto (`AGENTS.md`), la
  especificación de interfaz (`docs/UI_SPEC.md`) y el sistema de diseño (`docs/DESIGN.md`).

## Antes de empezar (una sola vez)

Este flujo llega al repositorio mediante una PR de instalación. Tienes que haberla revisado e integrado tú en `origin/master`
(la rama principal). Hasta entonces, los archivos de `docs/ui/` no existen para una sesión nueva.

## Para cada tarea UI

Usa **una sesión nueva por tarea**, en este orden.

1. En Claude Desktop, abre **Code** y crea una **New session**.
2. Selecciona el repositorio **Dungeon Cortex**.
3. Activa la opción **worktree**: aísla la sesión en su propia copia de trabajo.
4. Elige el modo **Plan**.
5. Abre `docs/ui/prompts/START-UI-XX.md` (la tarea que toca), copia **todo lo que hay debajo de la línea** y pégalo.
6. Claude comprobará el repositorio, leerá los documentos y te presentará un **plan**. Léelo: ¿se queda dentro de la tarea?
   Si sí, permite que implemente (cambia a **Accept edits** o **Manual**). Si no, pídele que lo recorte.
7. Mientras trabaja te pedirá permiso para algunos comandos (por ejemplo `git add`, `git commit`, `git push`, `pnpm exec`).
   Es normal. Aprueba solo si el comando coincide con lo que dijo el plan.
8. Al terminar verás `STOP — READY FOR HUMAN REVIEW`. Abre el panel **Diff** de Desktop y usa **Review code**. Comprueba que los
   cambios son únicamente de esa tarea.
9. Espera al resultado de **CI** en la PR y revísala.
10. Si todo está bien, **integras tú la PR**. No empieces la siguiente UI hasta que esta ya esté en `origin/master`.

## Orden y prioridades

El orden por defecto es el de la tabla. La columna "Prioridad" sale de `docs/UI_SPEC.md`.

| Tarea | Prompt | Prioridad en `UI_SPEC` |
| --- | --- | --- |
| UI-01 Normalizar el sistema de diseño | `prompts/START-UI-01.md` | transversal |
| UI-02 Evolución del HUD de combate | `prompts/START-UI-02.md` | P0 |
| UI-03 Barra de acciones reutilizable | `prompts/START-UI-03.md` | P0 |
| UI-04 Reorganizar la hoja de personaje | `prompts/START-UI-04.md` | P0 |
| UI-05 Equipo (muñeco de equipamiento) | `prompts/START-UI-05.md` | P1 (mejora de la vista de lista) |
| UI-06 Inventario espacial | `prompts/START-UI-06.md` | **P2** |
| UI-07 Minimapa contextual | `prompts/START-UI-07.md` | **P2** |
| UI-08 Panel narrativo unificado | `prompts/START-UI-08.md` | **P0** |
| UI-09 Descanso corto | `prompts/START-UI-09.md` | sin clasificar |
| UI-10 Descanso largo | `prompts/START-UI-10.md` | sin clasificar |

UI-06 y UI-07 son P2: puedes **aplazarlas**. Para registrarlo, escribe tu decisión en la sección **Maintainer decisions** al
final del prompt START antes de pegarlo, por ejemplo: `UI-06 y UI-07 se aplazan.` Claude nunca lo hará por su cuenta.
(La otra opción que existía, hacer UI-08 justo después de UI-04, ya no hace falta: UI-08 está entregada.)

## Estado tras la PR #251

La PR #251 entregó de una vez buena parte de esta lista, con un título que no empieza por `UI-0N:`. Por eso el estado real ya
no es "todo por hacer". Cada tarea tiene ahora una sección "Baseline after PR #251" con lo que existe, medido contra el código.

| Tarea | Estado | Qué hacer |
| --- | --- | --- |
| UI-01 | Residual | Queda pasar clases de paleta y colores sueltos a tokens `--dc-*`. Tres componentes sin uso quedan fuera. |
| UI-02 | Residual (pequeña) | Solo faltan los recursos del jugador en el HUD. |
| UI-03 | Residual, cambió la premisa | Los botones de acción ahora están en `MacroDeck`. **Decide antes** si aún quieres una barra aparte. |
| UI-04 | Residual | Falta reorganizar la hoja en sí; la sección "Equipo" ya existe. |
| UI-05 | **Entregada** | No la lances. |
| UI-06 | Sin tocar | Igual que antes. |
| UI-07 | Sin tocar | Igual que antes. |
| UI-08 | **Entregada** | No la lances; hay seguimientos abiertos. |
| UI-09, UI-10 | Sin tocar | Igual que antes; el resultado de un descanso ya sale como texto en la bitácora. |

Qué significa para ti:

- Una tarea **entregada** cuenta como hecha para la siguiente (UI-06 ya no espera a UI-05). Si pegas su prompt, Claude se
  detendrá en el plan y te dirá que ya está entregada.
- Una tarea **residual** sigue siendo tuya: decide si la lanzas, la recortas o la saltas y escríbelo en **Maintainer
  decisions**. Claude nunca cierra una tarea por su cuenta.
- Una tarea residual que es prerrequisito de otra sigue siéndolo: UI-02 espera a UI-01 salvo que tú aplaces UI-01.
- La lista de hallazgos abiertos de la revisión de la #251 está en `docs/ui/UI-WORKFLOW.md` §3.1.

## Si Claude se detiene (STOP)

Claude se detiene, no improvisa, y te entrega un documento de traspaso (`HANDOFF-EXTENDED`). Guárdalo. Códigos frecuentes:

| Código | Qué significa | Qué hacer |
| --- | --- | --- |
| `STOP-PREREQ` | falta la tarea anterior en `origin/master` | integra la anterior, o registra un aplazamiento |
| `STOP-DIRTY` | hay cambios que no son de esta tarea | no los borres; revísalos tú |
| `STOP-SCOPE` | la tarea se sale de su alcance | recorta el plan o divide la PR |
| `STOP-AUTHORITY` | falta un dato o una regla que la interfaz no puede inventar | es una decisión de backend: tarea aparte |
| `STOP-DEPENDENCY` | haría falta una dependencia nueva | decides tú; por defecto, no |
| `STOP-VERIFY` / `STOP-REGRESSION` / `STOP-RETRY` | una prueba o la compilación fallan y no se ha podido arreglar | revisa el traspaso; sesión nueva |
| `STOP-SECURITY` | tocaría secretos, producción o algo destructivo | no lo apruebes sin entenderlo |
| `STOP-MERGE` | se pidió fusionar | Claude no fusiona; lo haces tú |

Para continuar tras un STOP, abre una **sesión nueva**, pega el `START-UI-XX.md` y añade debajo el traspaso. La sesión nueva
vuelve a comprobar el repositorio antes de tocar nada.

## Contexto y sesiones

- Si la sesión sigue siendo la correcta pero el contexto se llena: pide un resumen breve y usa `/compact`. Sigues en la misma sesión.
- Cambia a una sesión nueva cuando la tarea ya tenga un punto de guardado válido, el contexto esté degradado, un STOP necesite
  decisión, o toque otra UI.
- **No abandones una sesión con trabajo sin guardar** (sin commit): ese trabajo solo existe en su worktree. Hazlo solo si el
  traspaso explica exactamente cómo recuperarlo.

## Qué no hacer

- **No uses Bypass permissions** en este flujo.
- No pidas "fusiona" ni actives **Auto-merge**.
- No empieces dos tareas UI a la vez.
- No borres un worktree que tenga cambios sin guardar.
- En un worktree nuevo, instalar dependencias (`pnpm install`) puede tardar mucho. Claude preguntará antes de hacerlo y no debe
  cambiar el archivo de bloqueo (`pnpm-lock.yaml`).
