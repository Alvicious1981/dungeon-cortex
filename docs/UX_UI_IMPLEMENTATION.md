# Implementación de la auditoría UX/UI

Fecha: 2026-10-01 a 2026-10-03. Base: `master`, `8ffacd4`. Alcance autorizado: todas las mejoras de presentación, excluyendo las dependencias mecánicas pendientes.

## Cambios entregados

- **Combate:** panel dentro del flujo de la escena, una iniciativa y un conjunto de acciones con objetivo. Se conservan los atajos; se ignoran cuando hay un modal o se escribe en un campo. La iniciativa muestra el total persistido, sin fabricar dado ni modificador.
- **Resultado y relato:** la bitácora recibe la respuesta provisional y los eventos del transporte existente. Presenta hechos mecánicos antes del relato y detalles desplegables; daño cero no se convierte en fallo o inmunidad. Las consecuencias sin tirada no muestran el cero de ausencia como dado natural. Los reintentos conservan identidad y no duplican eventos. Un intento rechazado no puede apropiarse del registro de una acción posterior idéntica.
- **Lectura:** párrafos preservados, texto de 17–18 px, ancho cercano a 70 caracteres, filtros sobre lo cargado y botón para volver al presente. Se conserva la paginación explícita, deduplicación y posición al cargar entradas anteriores; las entradas nuevas no fuerzan el desplazamiento.
- **Equipo:** sección accesible desde la ficha con cuatro slots reales, silueta orientativa en escritorio y filas en móvil. Mochila con búsqueda, categorías y detalle seleccionable. Se conserva ID y slot en la proyección. «Preparar equipar» escribe una intención revisable; el jugador confirma su envío y el equipo cambia tras la respuesta del servidor.
- **Accesibilidad:** colores legibles para recursos, inventario y memoria; etiquetas españolas y condiciones visibles; controles principales de 44 px. Ficha y subida de nivel aíslan el fondo, contienen y devuelven el foco, incluyendo desplegables nativos. La subida se puede aplazar y reabrir; no se cierra durante una petición pendiente.
- **Adaptación:** tres columnas desde 1280 px, aventura y panel auxiliar seleccionable desde 768 px, una superficie principal y navegación inferior en móvil. Resumen compacto persistente, acceso a la ficha y a actuar; preparar equipo desde el diario vuelve al comando visible. Audio integrado de 44 px. Escena vacía compacta, misiones archivadas y fichas de PNJ desplegables.
- **Mapa:** selección de origen y destino por toque, ratón o teclado, seguida de confirmación o cancelación. Arrastrar también prepara una propuesta; no aplica movimiento directamente. La legalidad continúa en el servidor.

## Validación

- `pnpm typecheck`: correcto.
- `pnpm exec vitest run --maxWorkers=2 tests/components tests/app tests/character-sheet`: **44 archivos, 383 pruebas correctas**.
- Regresiones de iniciativa, intentos rechazados y foco comprobadas con fallo previo y éxito tras el cambio.
- Regresión de tirada ausente falsificada temporalmente: permitir cero hizo fallar la prueba; se restauró la fuente y pasaron las nueve pruebas de integración de bitácora.
- `pnpm build`: correcto (salida 0), sin avisos de dependencias de hooks. Las consultas externas durante prerender emitieron `UNABLE_TO_VERIFY_LEAF_SIGNATURE`; no se ha desactivado la verificación TLS.
- `git diff --check`: sin errores de espacios.
- `pnpm check-retro`: correcto.
- Navegador Chromium con componentes reales y datos desechables servidos desde una fixture local sin base de datos: 1440, 1024 y 390 px sin desbordamiento horizontal; preparación de equipo desde diario móvil visible y enfocada; movimiento por toque y cancelación; devolución de foco; aplazamiento de subida y bloqueo de Escape durante su petición; inventario alcanzable con Tab y abierto con Enter; comprobación adicional de ampliación CSS al 200 %. Sin errores JavaScript en esos recorridos.
- Herramientas locales de revisión visual en `scratch/ux-preview/` (ignorado por Git): `check.mjs`, `edge-cases.mjs`, `keyboard-sheet.mjs` y capturas PNG.

## Límites y entrega

No se ejecutó `pnpm test:e2e`: Docker no estaba disponible para preparar PostgreSQL desechable. La fixture visual verifica composición e interacción de componentes, no autenticación, persistencia o el recorrido completo de campaña. La ampliación CSS no equivale a probar todos los zooms de navegador, teclados virtuales o lectores de pantalla.

El historial existente continúa siendo texto. Los resultados estructurados recibidos durante la sesión no se reconstruyen tras recargar. La correlación local con entradas persistidas usa texto nuevo y orden temporal; una identificación inequívoca necesitaría ampliar el contrato del historial.

Permanecen fuera de alcance: equipar por ID, selección autoritativa de candidatos, anticipación exacta de costes, desequipar sin reemplazo, nuevas ranuras, arma secundaria, búsqueda global, bestiario y barra de grupo sin experiencia funcional existente. La UI prepara el comando por nombre admitido actualmente y no decide si un objeto es equipable.

No se modificaron reglas, rutas API, persistencia, esquema, migraciones, dependencias, lockfiles, configuración de despliegue, secretos ni `.env`. No se crearon ramas, commits, etiquetas ni PR; no hubo operaciones sobre la partida real.

Siguiente paso recomendado: revisar el diff y repetir el recorrido de campaña completo con una base de datos desechable cuando Docker esté disponible.

## Archivos de la entrega

La lista siguiente incluye fuentes y pruebas; este informe se añade a ella.

- `components/campaign/MapSurface.tsx`
- `tests/components/MapSurface.test.tsx`
- `components/campaign/EquipmentLink.tsx`
- `tests/components/QuestTracker.test.tsx`

- `app/campaign/[id]/ActionInput.tsx`
- `app/campaign/[id]/campaign.css`
- `app/campaign/[id]/CampaignStoryProvider.tsx`
- `app/campaign/[id]/page.tsx`
- `app/campaign/[id]/StoryLog.tsx`
- `app/campaign/[id]/StoryResults.tsx`
- `components/campaign/CampaignLayout.tsx`
- `components/campaign/CampaignMobileNav.tsx`
- `components/character/CharacterSheetController.tsx`
- `components/character/CharacterSheetVTT.tsx`
- `components/character/ExhaustionIndicator.tsx`
- `components/character/LevelUpConfirmation.tsx`
- `components/character/sheet/CharacterProfileEditor.tsx`
- `components/character/sheet/CharacterSheetSidebar.tsx`
- `components/character/sheet/EquipmentTab.tsx`
- `components/character/sheet/InventoryGrid.tsx`
- `components/character/sheet/StatBlock.tsx`
- `components/character/XPProgressBar.tsx`
- `components/combat/BattleGrid.tsx`
- `components/combat/CombatHUD.tsx`
- `components/combat/CombatHUDController.tsx`
- `components/combat/ConsequenceLog.tsx`
- `components/combat/GameEventHandler.tsx`
- `components/combat/InitiativeTracker.tsx`
- `components/combat/MacroDeck.tsx`
- `components/exploration/DungeonMapVTT.tsx`
- `components/exploration/ExplorationMap.tsx`
- `components/exploration/ExplorationPanel.tsx`
- `components/exploration/NodeDetail.tsx`
- `components/MemoryJournal.tsx`
- `components/NPCRoster.tsx`
- `components/QuestTracker.tsx`
- `lib/character-sheet/condition-labels.ts`
- `lib/character-sheet/view-model.ts`
- `lib/events/campaign-ui.ts`
- `lib/hooks/useModalFocus.ts`
- `tests/app/campaign-page-exhaustion.test.ts`
- `tests/app/campaign-page-log-limit.test.ts`
- `tests/character-sheet/view-model.test.ts`
- `tests/components/BattleGrid.test.tsx`
- `tests/components/campaign-story-integration.test.tsx`
- `tests/components/CampaignChrome.test.tsx`
- `tests/components/CampaignCombatPanel.test.tsx`
- `tests/components/CharacterSheetEquipment.test.tsx`
- `tests/components/CharacterSheetVTT.test.tsx`
- `tests/components/combat-hud-downed.test.tsx`
- `tests/components/combat-hud-keybinds.test.tsx`
- `tests/components/DungeonMapVTT.test.tsx`
- `tests/components/ExplorationMap.test.tsx`
- `tests/components/ExplorationPanel.test.tsx`
- `tests/components/hud-attack-target-selection.test.tsx`
- `tests/components/InitiativeTracker.test.tsx`
- `tests/components/LevelUpConfirmation.test.tsx`
- `tests/components/ModalFocus.test.tsx`
- `tests/components/XPProgressBar.test.tsx`

## Continuación: diario y acceso a Equipo

- Misiones seleccionables con un único objetivo visible, descripción y gancho conservados en el detalle, archivo plegable y estados expresados con texto. La selección es local; las actualizaciones del servidor sustituyen los hechos mostrados y la desaparición de una misión selecciona una disponible.
- Acceso «Abrir Equipo» desde el inventario lateral: abre esa sección de la ficha y devuelve el foco al control de origen al cerrar.
- Archivos de esta continuación: `components/QuestTracker.tsx`, `components/campaign/EquipmentLink.tsx`, `components/character/CharacterSheetController.tsx`, `lib/events/campaign-ui.ts`, `app/campaign/[id]/page.tsx`, `tests/components/QuestTracker.test.tsx`, `tests/components/CharacterSheetEquipment.test.tsx` y este informe.
- Validación dirigida: `pnpm exec vitest run --maxWorkers=2 tests/components/QuestTracker.test.tsx tests/components/CharacterSheetEquipment.test.tsx tests/components/CampaignChrome.test.tsx tests/app/campaign-page-log-limit.test.ts`: 4 archivos y 15 pruebas correctas. La anulación temporal de la selección hizo fallar ambas pruebas del diario; fuente restaurada y pruebas repetidas correctamente.
- `pnpm typecheck` y `git diff --check`: correctos. Chromium volvió a comprobar 1440, 1024 y 390 px sin desbordamiento, preparación de equipo visible y enfocada, y selección táctil de misiones activas/archivadas mediante `scratch/ux-preview/quest-journal.mjs`.
- Se mantienen los límites y exclusiones anteriores. No se añadió ninguna operación de escritura de datos ni cambio de reglas.
- Compilación final de esta continuación: `pnpm build` correcto (salida 0), con los mismos avisos de certificado externo durante prerender.

## Continuación: consulta ampliada de mapas

- Nueva `components/campaign/MapSurface.tsx`, integrada en la página de campaña alrededor de exploración, plano de mazmorra y combate. La ampliación cambia la composición sin desmontar el mapa: mantiene zoom, selección y movimiento preparado. Aísla el fondo, contiene el foco, cierra con Escape y devuelve el foco al control de origen.
- `components/exploration/DungeonMapVTT.tsx`: cuatro botones de dirección de 44 px permiten desplazar la vista sin arrastrar. No solicitan movimiento del personaje.
- Pruebas nuevas/actualizadas: `tests/components/MapSurface.test.tsx` y `tests/components/DungeonMapVTT.test.tsx`. Junto con BattleGrid, ModalFocus y la proyección de página: 5 archivos y 22 pruebas correctas. La mutación temporal que desmontaba el mapa hizo fallar la conservación del destino; fuente restaurada.
- `pnpm typecheck`: correcto. Chromium en 390 y 1440 px verifica pantalla ampliada, conservación del destino táctico y retorno de foco; sin errores JavaScript (`scratch/ux-preview/expanded-map.mjs`). Capturas disponibles en esa carpeta ignorada.
- No cambian los contratos de juego ni las limitaciones de E2E ya descritas.
- Cierre de la continuación de mapas: `pnpm build` correcto (salida 0), con los avisos conocidos de certificados externos; `git diff --check` correcto. Sin cambios en datos, dependencias, secretos o reglas, ni commits.

## Continuación: componentes compartidos de UI

- `Button` admite referencias de foco de React 19, muestra un indicador de carga compatible con movimiento reducido y usa `type="button"` por defecto. Los envíos reales conservan `type="submit"` explícito. Los consumidores existentes se revisaron antes de cambiar el valor predeterminado.
- Mapa ampliable, acceso a Equipo, acceso a Actuar, preparación de equipo y botones de acción/reintento usan ahora el componente compartido. Se conservan los manejadores y el transporte existentes.
- `StatusMessage` añade iconos decorativos junto al título textual y se utiliza para errores de acción y de respuesta. Mantiene una única alerta por bloque. El diario de misiones reutiliza `Panel`.
- Archivos: `components/ui/Button.tsx`, `components/ui/StatusMessage.tsx`, `components/campaign/EquipmentLink.tsx`, `components/campaign/MapSurface.tsx`, `components/campaign/CampaignLayout.tsx`, `components/character/sheet/EquipmentTab.tsx`, `components/QuestTracker.tsx`, `app/campaign/[id]/ActionInput.tsx`, `tests/components/UiPrimitives.test.tsx` y este informe.
- `pnpm typecheck`: correcto. La prueba de envío implícito falló al mutar temporalmente el tipo del botón a submit; fuente restaurada. Se mantienen las tres pruebas anteriores de primitivas y se añaden dos de interacción.
- Chromium verifica los tres anchos, preparación de equipo y conservación de destino/foco al ampliar el mapa sin errores JavaScript.
- Sin cambios en contratos mecánicos, datos, dependencias o secretos; sin commits. Se conserva la limitación de E2E completo descrita arriba.
- Suite final de componentes, página y modelo: `pnpm exec vitest run --maxWorkers=2 tests/components tests/app tests/character-sheet`, 46 archivos y 390 pruebas correctas.
- `pnpm build`: correcto (salida 0), con avisos conocidos de certificados externos; `git diff --check`: correcto.

## Continuación: página principal, pestañas e ilustración generada

- Se generó una ilustración mediante el modelo de imágenes integrado (`imagegen`), guardada como fuente en `public/artwork/campaign-journal.png` (2172 × 724 px, aproximadamente 1,97 MB) y optimizada para la interfaz en `public/artwork/campaign-journal.webp` (aproximadamente 139 KB). La versión WebP se usa como fondo decorativo de la cabecera; no representa hechos de la campaña ni sustituye texto, navegación o controles accesibles. El original también se conserva en el directorio de imágenes de Codex.
- Nuevo `components/ui/Tabs.tsx`: pestañas con flechas, Inicio/Fin, foco itinerante y relaciones ARIA. Los paneles ocultos permanecen montados para conservar estado local.
- `CampaignAdventure.tsx` organiza Bitácora y Escena y mapas, con acciones comunes debajo. La navegación móvil, preparar una acción y el enlace de salto revelan el panel correspondiente.
- `CampaignJournal.tsx` organiza Misiones, Personajes y Memoria. Personaje mantiene sus secciones existentes de Mecánica, Equipo, Perfil e Historial.
- `StoryLog.tsx` permite buscar texto en las entradas cargadas, combinándolo con sus filtros. Informa del alcance local; volver al presente limpia la búsqueda y mantiene paginación y deduplicación.
- Integración en `app/campaign/[id]/page.tsx`, estilos en `campaign.css` y evento de presentación en `lib/events/campaign-ui.ts`. `CampaignLayout.tsx` conecta la navegación móvil con las pestañas.
- Pruebas: nuevo `tests/components/CampaignWorkspace.test.tsx`, búsqueda en `campaign-story-integration.test.tsx` y adaptación del recorrido de proyección de `campaign-page-log-limit.test.ts` a los slots nombrados. La prueba conserva sus aserciones de límite, orden y paginación.
- Chromium: 1440, 1024 y 390 px, pestañas, búsqueda, conservación de filtros y consulta de diario sin errores JavaScript ni desbordamiento horizontal. Fixture y capturas `scratch/ux-preview/workspace-tabs.mjs` y `workspace-*.png`.
- Se mantienen las exclusiones de contratos mecánicos, datos, dependencias y secretos, y el límite de validación E2E contra base desechable.
- Validación: 47 archivos y 393 pruebas correctas en la suite de componentes/página/modelo; 18 pruebas dirigidas repetidas tras el ajuste del enlace de salto. La eliminación temporal de paneles ocultos hizo fallar la prueba de conservación; restaurado el código y repetida correctamente. `pnpm typecheck` correcto.

## Continuación: acción móvil y optimización de cabecera

- La navegación inferior ofrece cinco destinos de 44 px: Escena, Bitácora, Actuar, Diario y Personaje. El destino visible se expresa con `aria-current` y un estado gráfico que no depende solo del color.
- «Actuar» vuelve a la aventura, revela la Bitácora, desplaza la zona de comandos y enfoca el campo de acción disponible. Preparar una acción desde Equipo mantiene el mismo resultado y señala «Actuar» como destino actual.
- La cabecera carga `campaign-journal.webp`; pesa 139.244 bytes frente a 1.968.420 bytes del PNG fuente. El PNG se conserva como original editable porque esta entrega no elimina archivos sin autorización.
- La primera prueba de navegador detectó que el foco terminaba en el contenedor de comandos. Se reprodujo en una prueba de componente, se rastreó a la rama de navegación móvil y se corrigió en `CampaignLayout`. La prueba pasó después de la corrección.
- Validación dirigida: `CampaignChrome`, `CampaignWorkspace` e integración de bitácora, 15 pruebas correctas. Chromium comprobó 1440, 1024 y 390 px, búsqueda, pestañas, estado activo de «Actuar», foco en el comando y ausencia de desbordamiento o errores JavaScript.
- Validación final: `pnpm exec vitest run --maxWorkers=2 tests/components tests/app tests/character-sheet`, 47 archivos y 393 pruebas correctas; `pnpm typecheck`, `pnpm check-retro` y `git diff --check`, correctos. `pnpm build` terminó con salida 0 después de aislar una caché incremental dañada de webpack; durante el prerender conserva los avisos conocidos `UNABLE_TO_VERIFY_LEAF_SIGNATURE` y no se desactivó la verificación TLS.
- La caché dañada no se eliminó: se movió de forma reversible a `scratch/ux-preview/next-server-production-cache-failed-20261003` (ignorado por Git). El build creó una caché nueva válida.
- Archivos de esta continuación: `components/campaign/CampaignMobileNav.tsx`, `components/campaign/CampaignLayout.tsx`, `components/campaign/CampaignAdventure.tsx`, `app/campaign/[id]/campaign.css`, `public/artwork/campaign-journal.webp`, `tests/components/CampaignChrome.test.tsx`, `tests/components/CampaignWorkspace.test.tsx`, `scratch/ux-preview/workspace-tabs.mjs` (ignorado por Git) y este informe.

## Continuación: celebración de nivel localizada y accesible

- `AscensionOverlay` presenta en español el nombre accesible, clase, nivel, dado de golpe, modificador de CON, PG obtenidos, PG máximos, dados de golpe y confirmación. Los identificadores mecánicos recibidos no cambian; una tabla local traduce las doce clases SRD solo para su presentación.
- La notación de dados separa cantidad y tipo (`5 × 1d10`) sin alterar los valores resueltos por el servidor.
- La celebración reutiliza `useModalFocus`: bloquea el desplazamiento del fondo, aísla el contenido situado detrás, contiene el foco, cierra con Escape y devuelve el foco al control de origen.
- El panel permite desplazamiento interno y limita su altura al viewport. Chromium verificó 1440×900, 390×900 y 390×520, con el botón enfocado y visible, sin desbordamiento horizontal ni errores JavaScript. Capturas y recorrido: `scratch/ux-preview/ascension-overlay.mjs` y `ascension-*.png` (ignorados por Git).
- Pruebas dirigidas de celebración, foco modal y confirmación de subida: 3 archivos y 51 pruebas correctas. Dos intentos iniciales con el pool de procesos no llegaron a cargar pruebas por timeout de arranque; la ejecución con el pool de hilos y el mismo límite de dos workers completó correctamente.
- `pnpm typecheck` y `pnpm build`: correctos. El build conserva los avisos conocidos de certificados externos durante prerender y termina con salida 0.
- Archivos de esta continuación: `components/character/AscensionOverlay.tsx`, `tests/components/AscensionOverlay.test.tsx`, el fixture visual ignorado y este informe. No se modificaron progresión, eventos, rutas o persistencia.

## Continuación: cierre de coherencia en diálogo y errores

Fecha: 2026-10-03. Base local de esta continuación: `master`, `5cbc773` (el worktree conserva intencionadamente el pase UX/UI sin confirmar). Este pase revisa únicamente superficies alcanzables que no formaron parte de las continuaciones anteriores. No ejecuta pruebas, E2E, typecheck ni build por instrucción expresa; esas validaciones quedan pendientes.

### Superficies revisadas

- **Diálogo social:** `NPCRoster` produce `dungeon-npc-selected`, la página de campaña monta `DialogueOverlayController` y este abre `DialogueOverlay`; por tanto, el recorrido está activo.
- **Estados de carga y error:** las fronteras de campañas y campaña ya reutilizan el sistema compartido y no necesitaron cambios. La frontera de error raíz seguía usando estilos aislados, un emoji decorativo y controles menores de 44 px, por lo que sí se actualizó.
- **Comercio:** `TradeOverlayController` está montado, pero `streamNarrative` resuelve `merchantPayload` siempre a `null`; no existe otro productor real de `dungeon-merchant`. La ventana de comercio no es alcanzable y se descartó de este pase.
- **Botín:** `SpoilsOfWar` no tiene importadores de producción; solo lo consumen pruebas. No se modificó.

### Cambios realizados

- La rama activa de diálogo presenta en español disposición, enfoques, habilidades, resultados, rumores, acciones, carga y errores. Los identificadores mecánicos (`persuade`, `intimidate`, `deceive` y actitudes del backend) permanecen intactos y solo se traducen al renderizar.
- La trampa de foco local se sustituyó por `useModalFocus`: el diálogo aísla el fondo, contiene el foco, se cierra con Escape y devuelve el foco al control que seleccionó al PNJ.
- El encabezado recibe el foco inicial y evita una línea vacía cuando raza y profesión no llegan desde el productor actual. El medidor expone nombre y valor textual en español.
- Los controles activos reutilizan `Button`, los resultados reutilizan `Panel` y los errores reutilizan `StatusMessage`. Todos los controles activos alcanzan 44 px; el campo libre tiene etiqueta visible, tamaño de texto de 16 px y composición sin anchuras rígidas.
- La zona de conversación puede desplazarse dentro del viewport; cabecera, medidor y acciones permanecen disponibles. Las acciones rápidas y el selector usan una cuadrícula compacta que cabe desde 320 px, y el movimiento no esencial respeta la preferencia de movimiento reducido.
- `app/error.tsx` adopta `Panel`, `Button`, `StatusMessage`, tokens globales e iconos Lucide, con controles de 44 px y jerarquía coherente con las demás fronteras de error.

### Componentes y ramas descartados por estar dormidos

- `components/trade/TradeWindow.tsx`: sin evento de apertura producido por el runtime actual.
- `components/combat/SpoilsOfWar.tsx`: sin consumidor de producción.
- `components/character/InventoryPanel.tsx` y `components/npc/DispositionBadge.tsx`: sin importadores de producción.
- La rama de personalidad dentro de `DialogueOverlay`: el único productor activo construye siempre `personalityTags: null`; se conservaron sus textos y controles sin modernizarlos.
- `HavenHUD`, `SurvivalHUD`, `WildernessHUD` y los mapas wilderness: sin consumidores activos y, en el caso wilderness, bloqueados además por la decisión registrada del subsistema.

### Archivos modificados en este cierre

- `components/social/DialogueOverlay.tsx`
- `components/social/DialogueOverlayController.tsx`
- `app/error.tsx`
- `tests/components/DialogueOverlayController.test.tsx` (expectativas textuales y retorno de foco; no ejecutadas)
- `docs/UX_UI_IMPLEMENTATION.md`

### Riesgos y validación pendiente

- No existe una fixture visual local de diálogo o error raíz; este pase se revisó estáticamente. Falta comprobar diálogo conocido/no conocido, resultado, error, rumores, Escape, retorno de foco y alturas cortas en 390, 768, 1024 y 1440 px.
- El texto narrativo y los rumores generados son contenido del backend, no etiquetas de interfaz; pueden conservar el idioma recibido. Este pase solo traduce las negativas estructuradas conocidas y usa una negativa genérica en español para variantes nuevas.
- Si comercio, botín o personalidad vuelven a tener un productor real, necesitarán su propio pase de idioma, foco, 44 px y adaptación móvil antes de considerarse listos.
- Ejecutar después: `pnpm typecheck`.
- Ejecutar después: `pnpm exec vitest run --maxWorkers=2 tests/components/DialogueOverlayController.test.tsx tests/components/ModalFocus.test.tsx tests/components/UiPrimitives.test.tsx`.
- Ejecutar después: `pnpm build`.
- Ejecutar después, cuando exista PostgreSQL desechable: `pnpm test:e2e` siguiendo el runbook de `AGENTS.md`.

En esta continuación no se modificaron reglas, combate, resolución mecánica, eventos autoritativos, persistencia, rutas API, Prisma, migraciones, dependencias, lockfiles, `.env`, secretos o despliegue. Tampoco se crearon commits, ramas ni PR.

## Continuación: cierre de idioma y foco en onboarding

Fecha: 2026-10-03. Segunda revisión estática del cierre final, limitada a superficies alcanzables de onboarding que no estaban cubiertas por el pase anterior. No se ejecutaron pruebas automatizadas, E2E, typecheck ni build por instrucción expresa.

### Superficies revisadas

- **Creación de personaje:** `/character/create` monta `CharacterCreationForm` con linajes y clases obtenidos de la API SRD o de sus listas de respaldo. Los nombres recibidos se mostraban en inglés aunque el formulario estuviera en español.
- **Biblioteca de campañas:** `/campaigns` mostraba directamente la clase persistida y los estados no activos (`barbarian`, `archived`, etc.). Sus estados vacío, carga, autenticación y error ya reutilizan `OnboardingShell`, `Panel`, `StatusMessage` y `Button` y no necesitaron cambios adicionales.
- **Página principal y ruta no encontrada:** ya presentan texto español, controles compartidos de 44 px y composición adaptable; se revisaron sin cambios.

### Cambios realizados

- Se añadió una tabla exclusivamente presentacional para las clases y linajes del SRD 2014. Los valores canónicos enviados al servidor y almacenados (`fighter`, `human`, etc.) no cambian.
- El formulario muestra los nombres localizados en sus opciones y la biblioteca localiza la clase del personaje. Los estados de campaña no activos se presentan como «Terminada», «Archivada», «Pausada» o «No activa» sin alterar el campo persistido.
- Los fallos de las rutas de creación se traducen según su estado HTTP en lugar de exponer mensajes internos en inglés. El reintento conserva el identificador del personaje ya creado y no repite esa escritura.
- Tras un error, el foco pasa al bloque de estado anunciado para que el mensaje sea localizable inmediatamente por teclado y tecnología de asistencia.
- El botón de envío conserva el indicador de carga compartido de `Button`; se retiró el segundo icono que duplicaba visualmente la espera.
- El acceso secundario «Crear personaje» de una biblioteca no vacía reutiliza `buttonClassName` y alcanza los 44 px mínimos en lugar de quedar como un enlace de texto pequeño.

### Componentes descartados por estar dormidos

- Se mantienen las exclusiones documentadas en el pase anterior: `TradeWindow`, `SpoilsOfWar`, `InventoryPanel`, `DispositionBadge`, la rama de personalidad de diálogo y las superficies wilderness no tienen un consumidor o productor activo que justifique editarlas.

### Archivos modificados en esta continuación

- `lib/dnd-api/presentation.ts`
- `components/character/CharacterCreationForm.tsx`
- `app/campaigns/page.tsx`
- `tests/components/CharacterCreationForm.test.tsx` (expectativas escritas, no ejecutadas)
- `tests/app/campaigns-page.test.ts` (expectativas escritas, no ejecutadas)
- `docs/UX_UI_IMPLEMENTATION.md`

### Riesgos y validación pendiente

- Una clase o linaje nuevo que no figure en el SRD 2014 conservará el nombre proporcionado por la fuente; deberá añadirse explícitamente a la tabla antes de considerarlo localizado.
- Falta comprobar en navegador el foco tras errores, los dos pasos de creación y las tarjetas activas/archivadas a 390, 768, 1024 y 1440 px. La revisión actual es estática.
- Ejecutar después: `pnpm typecheck`.
- Ejecutar después: `pnpm exec vitest run --maxWorkers=2 tests/components/CharacterCreationForm.test.tsx tests/app/campaigns-page.test.ts tests/components/UiPrimitives.test.tsx`.
- Ejecutar después: `pnpm build`.
- Ejecutar después, cuando exista PostgreSQL desechable: `pnpm test:e2e` siguiendo el runbook de `AGENTS.md`.

Esta continuación no modifica reglas, resolución mecánica, eventos, persistencia, rutas API, Prisma, migraciones, dependencias, lockfiles, `.env`, secretos o despliegue. No crea commits, ramas ni PR.

## Cierre de validación y comparación con GitHub

Fecha: 2026-10-05. La validación se repitió después de incorporar la documentación y la configuración de agentes más recientes del proyecto.

### Estado local y remoto

- Rama local: `codex/preserve-ui-work-20261004`, `HEAD 9474160`.
- Referencia actualizada de GitHub: `origin/master c17cc1b`.
- `origin/master` es ancestro de la rama local. La comparación registra 9 commits locales y 0 remotos pendientes; la diferencia material de árbol respecto a GitHub son los 20 archivos del pase UX/UI conservado en `969f68b`.
- La rama no tiene una rama remota publicada ni upstream configurado.
- El worktree contiene cuatro cambios ajenos a esta entrega en `.codex/agents/*.toml`. Se conservaron sin editarlos y no se solapan con las superficies UX.

### Validación ejecutada

- `pnpm typecheck`: correcto, salida 0.
- La primera ejecución dirigida con el pool de procesos alcanzó 7 pruebas correctas de campañas, pero dos workers no llegaron a arrancar y Vitest terminó con timeout de infraestructura antes de cargar `CharacterCreationForm` y `UiPrimitives`. No hubo aserciones fallidas.
- Repetición completa con `pnpm exec vitest run --pool=threads --maxWorkers=2 tests/components/CharacterCreationForm.test.tsx tests/app/campaigns-page.test.ts tests/components/UiPrimitives.test.tsx`: 3 archivos y 18 pruebas correctas, salida 0.
- `pnpm exec vitest run --maxWorkers=2 tests/components tests/app tests/character-sheet`: 49 archivos y 438 pruebas correctas, salida 0.
- Fixtures locales en Chromium a 390, 768, 1024 y 1440 px, incluyendo 390 × 520 px: creación, biblioteca de campañas, diálogo, pestañas, navegación móvil, ficha y equipo, diario, ascensión y mapa ampliado. No se detectaron controles activos menores de 44 px, desbordamiento horizontal ni errores de página; los modales devolvieron el foco y el error de creación recibió foco.
- Revisión manual de capturas representativas de diálogo corto, biblioteca de escritorio y campaña móvil: jerarquía, contraste, legibilidad y composición coherentes.
- El primer `pnpm build` reprodujo una corrupción de la caché incremental de Webpack en `WasmHash._updateWithBuffer`. Se movió de forma reversible `.next/cache` a `scratch/ux-preview/next-cache-failed-20261005-build-validation` y se repitió el mismo comando con caché limpia.
- Segundo `pnpm build`: correcto, salida 0. Compiló en 93 s, completó la validación integrada, generó 8 páginas estáticas y recogió las trazas. Durante el prerender la API SRD no estuvo disponible y las rutas de creación usaron las listas de respaldo previstas.

### Riesgos y validación pendiente

- La fixture basada en Vite muestra avisos de consola para los atributos `jsx` y `global` de `styled-jsx`, porque no usa la transformación de Next. No se reprodujeron como errores de página ni en el build de Next.
- La revisión visual usa datos locales desechables y no valida autenticación, persistencia ni el recorrido completo contra PostgreSQL.
- `pnpm test:e2e` estaba pendiente en este punto del registro y se completó en la continuación E2E documentada más abajo, siempre contra PostgreSQL desechable.
- Una clase o linaje futuro fuera de la tabla presentacional seguirá mostrando el valor recibido hasta que se añada una traducción explícita.

### Archivos y límites de este cierre

- Archivo modificado en este cierre: `docs/UX_UI_IMPLEMENTATION.md`.
- Artefactos ignorados actualizados: capturas y caché aislada dentro de `scratch/ux-preview/`.
- No se modificaron reglas, combate, resolución mecánica, eventos autoritativos, persistencia, rutas API, Prisma, migraciones, dependencias, lockfiles, `.env`, secretos o despliegue. No se crearon commits, ramas ni PR y no se accedió a la partida real.

## Continuación: validación E2E aislada

Fecha: 2026-10-05. La suite actual contiene 82 pruebas en 34 archivos, no las cinco especificaciones que figuraban en el resumen anterior. Se ejecutó completa contra PostgreSQL 16 con pgvector en un contenedor desechable.

### Aislamiento y preparación

- Contenedor exclusivo: `dc-e2e-pg`, base `dungeon_cortex_e2e`, publicada solo en `127.0.0.1:55432`.
- Se comprobó que los puertos 3000, 3001, 3100 y 55432 estaban libres antes de iniciar el entorno.
- Se aplicaron las 42 migraciones con `pnpm exec prisma migrate deploy` y Prisma confirmó explícitamente el destino `127.0.0.1:55432/dungeon_cortex_e2e`.
- Antes de Playwright se arrancó temporalmente el servidor con `DATABASE_URL` apuntando a `127.0.0.1:1`; una lectura devolvió el error Prisma contra ese mismo host. Esto confirmó que las variables del proceso prevalecían sobre `.env` y que el servidor no podía alcanzar la partida real.
- El servidor definitivo usó `pnpm start` en `127.0.0.1:3100`, `PRIVATE_MODE_ENABLED=true`, `E2E_TEST_MODE=true`, `PLAYWRIGHT_SKIP_WEBSERVER=1` y las dos URL de Prisma dirigidas a la base desechable.

### Hallazgos y corrección mínima

- La primera suite terminó con 81 pruebas correctas y un timeout de `critical-path`: la captura mostraba el resultado `Roll 1d20` inmediatamente después del límite de 5 s. La repetición aislada volvió a completar la acción después de superar el timeout de respuesta de 10 s.
- `tests/e2e/critical-path.spec.ts` conserva el timeout total de 90 s y amplía únicamente a 30 s la espera de la respuesta de acción y del resultado visible. La prueba aislada pasó después del ajuste.
- Una segunda suite acumuló tres timeouts de infraestructura. Los logs mostraron esperas `WALSync` y transacciones Prisma expiradas a 5 s; los tres archivos afectados pasaron aislados sin cambios: `enemy-turns` 4/4, `equipment-action-economy` 9/9 y `turn-advance-concurrency` 4/4.
- Para la ejecución final se configuró `synchronous_commit=off` solo en `dungeon_cortex_e2e`. Esta optimización elimina la espera de durabilidad en disco de una base descartable, pero mantiene transacciones, restricciones y bloqueos que verifican las pruebas de concurrencia.

### Resultado y limpieza

- `pnpm test:e2e`: 82/82 pruebas correctas, salida 0, un worker, 47,5 s.
- El servidor se detuvo y se verificó que el puerto 3100 quedara libre.
- `docker rm -f -v dc-e2e-pg` eliminó exclusivamente el contenedor desechable y su volumen anónimo. No queda ningún contenedor con ese nombre.
- No se conectó a la base real, no se ejecutaron seeds y no se modificaron reglas, rutas, persistencia, esquema, migraciones, dependencias, lockfiles, `.env`, secretos o despliegue.

Archivos modificados en esta continuación: `tests/e2e/critical-path.spec.ts` y `docs/UX_UI_IMPLEMENTATION.md`.

## Revisión final independiente

Fecha: 2026-10-05. Una segunda lectura completa de `origin/master..HEAD` y del worktree confirmó que el alcance material sigue limitado a presentación, pruebas y documentación. No detectó cambios en reglas, API, persistencia, Prisma, dependencias o despliegue.

- Se hizo explícito el objetivo táctil mínimo de 44 px en la confirmación de `AscensionOverlay` y se sustituyó su tabla duplicada de clases por `classDisplayName`. La fixture a 390 × 520 midió 58,35 px de alto, mantuvo el control dentro del viewport y no detectó desbordamiento horizontal.
- `CampaignAdventure` notifica también los cambios originados por enlaces internos y `hashchange`; `CampaignLayout` toma el fragmento inicial. La pestaña visible y `aria-current` permanecen así sincronizados al entrar por `#scene` o `#chronicle` y al usar el enlace de salto.
- Se añadieron aserciones dirigidas para el mínimo táctil y para el indicador activo tras navegar por fragmento.
- Las cuatro modificaciones preexistentes de `.codex/agents/*.toml` continúan fuera de esta entrega y deben excluirse de cualquier commit posterior.

Validación posterior: `AscensionOverlay`, `CampaignWorkspace` y `CampaignChrome`, 3 archivos y 26 pruebas correctas con pool de hilos y dos workers; `pnpm typecheck`, `pnpm build` y `git diff --check`, correctos. El build generó las 8 páginas estáticas y usó las listas de respaldo previstas al no estar disponible la API SRD. No se repitió E2E porque no cambiaron rutas, transporte ni persistencia.
