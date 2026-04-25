# Dungeon Cortex — Informe ampliado de recursos accionables para agente de IA

**Proyecto base:** Dungeon Cortex  
**Versión del TDD usada como contexto:** v5.0 — abril de 2026  
**Canon mecánico objetivo:** D&D 5e 2014 SRD / Basic Rules  
**Uso previsto:** archivo de conocimiento para un agente de IA de desarrollo, auditoría o implementación.

---

## 0. Principios obligatorios para el agente de IA

Dungeon Cortex no debe tratar D&D como “texto narrativo libre”. Debe tratarlo como un dominio reglado con una capa narrativa encima.

### Reglas de decisión

1. **La IA no es autoridad mecánica.**
   - La IA puede narrar, proponer, dramatizar y resumir.
   - La IA no debe resolver HP, daño, slots, condiciones, descansos, concentración, death saves, attunement ni legalidad de conjuros por texto libre.

2. **Las APIs son fuentes de datos, no árbitros finales.**
   - dnd5eapi y Open5e sirven para compendium, normalización y caché.
   - El rules engine local decide.

3. **Canon único v1: D&D 5e 2014 SRD.**
   - No mezclar especies 2024 con razas 2014.
   - No mezclar Weapon Mastery 2024.
   - No mezclar exhaustion 2024.
   - No usar textos no SRD o scraping de D&D Beyond.

4. **Toda integración debe ser pequeña, testeable y reversible.**
   - Añadir primero adaptadores.
   - Después normalizadores.
   - Después tests.
   - Después UI.

5. **Preferencia técnica para Dungeon Cortex v1.**
   - Next.js App Router.
   - SQLite + Drizzle.
   - FTS5 para memoria.
   - SSE para streaming.
   - Dados 3D como capa visual, no como fuente de verdad mecánica.
   - Caché local de compendium.

---

## 1. Recursos CORE recomendados

Estos recursos son los más alineados con Dungeon Cortex v1.

---

## 1.1 D&D 5e SRD API / dnd5eapi

### URL principal

https://www.dnd5eapi.co/

### Documentación

https://5e-bits.github.io/docs/

### Endpoint base 2014

https://www.dnd5eapi.co/api/2014/

### Repositorios oficiales/comunitarios

API:

https://github.com/5e-bits/5e-srd-api

Base de datos:

https://github.com/5e-bits/5e-database

Docs:

https://github.com/5e-bits/docs

### Qué aporta

API abierta para consultar contenido SRD 2014:

- ability scores
- classes
- conditions
- damage types
- equipment
- features
- languages
- magic schools
- monsters
- proficiencies
- races
- skills
- spells
- subclasses
- subraces
- traits
- weapon properties

### Uso recomendado en Dungeon Cortex

Usar como **fuente primaria de compendium SRD 2014**.

Debe integrarse así:

1. `lib/dnd-api/client.ts`
2. `lib/dnd-api/endpoints.ts`
3. `lib/data/cache/api-cache.repository.ts`
4. `lib/data/compendium/normalizers/*`
5. tests de normalización
6. persistencia en SQLite

### Endpoints útiles

```txt
GET https://www.dnd5eapi.co/api/2014/
GET https://www.dnd5eapi.co/api/2014/classes
GET https://www.dnd5eapi.co/api/2014/races
GET https://www.dnd5eapi.co/api/2014/backgrounds
GET https://www.dnd5eapi.co/api/2014/equipment
GET https://www.dnd5eapi.co/api/2014/spells
GET https://www.dnd5eapi.co/api/2014/monsters
GET https://www.dnd5eapi.co/api/2014/conditions
GET https://www.dnd5eapi.co/api/2014/features
```

### Ejemplo de uso para agente

```txt
Cuando necesites obtener datos SRD 2014:
1. consulta primero api_cache;
2. si no existe, llama a dnd5eapi /api/2014/;
3. normaliza a modelo interno;
4. guarda payload original y payload normalizado;
5. nunca inventes campos mecánicos ausentes.
```

### Advertencias

- No usar como rules engine.
- No rellenar datos faltantes por IA.
- No mezclar con SRD 2024.
- Si un dato no existe, marcar `not_supported` o buscar override local versionado.

### Prioridad

CORE.

---

## 1.2 Open5e API

### URL principal

https://open5e.com/

### API root

https://api.open5e.com/

### API docs

https://open5e.com/api-docs

### GitHub

Site:

https://github.com/open5e/open5e

API:

https://github.com/open5e/open5e-api

### Endpoints útiles

```txt
https://api.open5e.com/v2/search/?query=goblin
https://api.open5e.com/v2/creatures/?name__icontains=goblin
https://api.open5e.com/v2/spells/
https://api.open5e.com/v2/conditions/
https://api.open5e.com/v2/equipment/
https://api.open5e.com/v2/classes/
https://api.open5e.com/v2/species/
https://api.open5e.com/v2/backgrounds/
```

### Qué aporta

Open5e ofrece un dataset más amplio que dnd5eapi y permite:

- búsqueda global
- filtros por campos
- paginación
- selección de campos
- filtrado por fuente/documento
- datos OGL adicionales

### Uso recomendado en Dungeon Cortex

Usar como **fuente secundaria o comparativa**, no como fuente canónica primaria.

Casos de uso:

- búsqueda rápida en compendium
- referencia cruzada
- validación de campos ausentes
- prototipado de buscador
- inspiración para filtros avanzados

### Ejemplo de consulta compacta

```txt
https://api.open5e.com/v2/creatures/?name__icontains=goblin&fields=name,key,challenge_rating,document
```

### Integración sugerida

```txt
lib/open5e/client.ts
lib/open5e/search.ts
lib/open5e/normalizers/*
```

### Advertencias

- No usar material no compatible con SRD 2014 sin etiquetarlo.
- No mezclar documentos 2024 si el proyecto está en modo 2014-only.
- Verificar `document.key` antes de importar contenido.

### Prioridad

OPTIONAL / SECONDARY.

---

## 1.3 5e-bits / 5e-database local

### URL

https://github.com/5e-bits/5e-database

### Qué aporta

Base de datos del proyecto dnd5eapi. Permite trabajar con datos SRD localmente.

### Uso recomendado

Útil para:

- generar seed local de compendium
- auditar datos
- crear fixtures de tests
- evitar llamadas externas durante desarrollo
- preparar modo offline-first

### Integración sugerida

1. Clonar repositorio.
2. Extraer JSON/datos relevantes.
3. Crear script `scripts/import-srd-2014.ts`.
4. Normalizar a tablas internas.
5. Crear tests snapshot.

### Estructura sugerida

```txt
scripts/
  import-srd-2014.ts
  validate-srd-2014.ts

lib/data/compendium/
  importers/
  normalizers/
  validators/
```

### Advertencia

Comprobar licencia y atribución antes de redistribuir assets o contenido.

### Prioridad

CORE para offline-first.

---

## 2. Motores de reglas y referencias de arquitectura

---

## 2.1 dnd-5e-core

### URL

https://libraries.io/pypi/dnd-5e-core

### PyPI

https://pypi.org/project/dnd-5e-core/

### Qué aporta

Biblioteca Python de reglas D&D 5e con datos empaquetados y ejecución offline.

Incluye, según su documentación:

- clases
- rasgos raciales
- subclases
- combate avanzado
- monstruos
- conjuros
- objetos mágicos
- tesoro
- condiciones
- generación de personajes

### Uso recomendado

No integrarlo directamente en Next.js salvo que se use como microservicio Python. Recomendación práctica:

- usarlo como **oráculo de validación**
- comparar resultados contra tu rules engine TypeScript
- crear casos de prueba
- estudiar edge cases de combate y condiciones

### Patrón recomendado

```txt
No portar todo el motor.
Extraer ideas y tests:
- iniciativa
- ataque
- daño
- condiciones
- concentración
- death saves
- descansos
```

### Advertencias

- Puede incluir reglas más amplias que el scope v1.
- Puede soportar multiclassing o feats, que Dungeon Cortex v1 excluye.
- No copiar comportamiento sin filtrar por canon 2014 y scope v1.

### Prioridad

REFERENCE / TEST ORACLE.

---

## 2.2 dnd_engine

### URL

https://github.com/furlat/dnd_engine

### Qué aporta

Motor de D&D 5e con arquitectura basada en eventos y entidades-componentes.

Ideas relevantes:

- registry de entidades
- valores modificables
- fases de evento
- condiciones como sistema estructurado
- action framework
- componentes para habilidad, salud, equipo, economía de acciones

### Uso recomendado

Usar como inspiración para diseñar el rules engine TypeScript de Dungeon Cortex.

### Patrón útil para Dungeon Cortex

```txt
PlayerIntent
  -> MechanicalEvent.DECLARATION
  -> RuleValidation
  -> DiceRoll
  -> MechanicalEvent.EFFECT
  -> StatePatch
  -> NarrativeComposer
```

### Adaptación sugerida

```txt
lib/rules/events/
  event.types.ts
  event-pipeline.ts

lib/rules/conditions/
  condition.schema.ts
  condition-registry.ts

lib/rules/combat/
  action-economy.ts
  attack-resolution.ts
```

### Advertencias

- Es Python/TypeScript mixto.
- No usar como dependencia principal sin auditoría.
- Extraer patrones, no acoplar el producto.

### Prioridad

ARCHITECTURE REFERENCE.

---

## 2.3 natural_20

### URL

https://github.com/jedld/natural_20

### Qué aporta

Motor Ruby para aventuras de texto con D&D 5e.

Incluye:

- reglas 5e
- línea de visión
- iluminación
- puertas
- trampas
- cofres
- cobertura
- IA básica
- pathfinding
- UI textual
- mapas en YAML

### Uso recomendado

Referencia conceptual para:

- exploración de dungeon
- mapas YAML
- iluminación y visibilidad
- trampas y puertas
- pruebas de encuentros

### Uso NO recomendado

- No usar como dependencia principal.
- No portar Ruby a TypeScript directamente salvo funciones pequeñas muy claras.

### Prioridad

REFERENCE.

---

## 2.4 Py5e

### URL

https://github.com/Carbsta/Py5e

### Qué aporta

Módulo Python orientado a recrear mecánicas de D&D 5e, por ejemplo:

- saving throws
- initiative
- cálculo de reglas
- base para bots o webapps

### Uso recomendado

Referencia secundaria para cómo aislar mecánicas en funciones reutilizables.

### Prioridad

LOW / REFERENCE.

---

## 3. Dados 3D y tiradas visuales

---

## 3.1 @3d-dice/dice-box

### URL GitHub

https://github.com/3d-dice/dice-box

### NPM

https://www.npmjs.com/package/@3d-dice/dice-box

### Docs

https://fantasticdice.games/

### Qué aporta

Módulo de dados 3D para apps JavaScript.

Stack:

- BabylonJS
- AmmoJS
- Web Workers
- OffscreenCanvas

### Instalación

```bash
npm install @3d-dice/dice-box
```

### Integración sugerida

```txt
components/dice/DiceBox.tsx
components/dice/DiceResultOverlay.tsx
lib/dice/dice-notation.ts
lib/dice/dice-visual-adapter.ts
```

### Patrón correcto en Dungeon Cortex

El resultado mecánico debe venir del rules engine. Dice-box puede:

- visualizar el resultado
- reproducir animación
- mejorar inmersión

No debe:

- decidir el resultado oficial
- sobrescribir el resultado mecánico
- tirar de forma no determinista cuando se necesita auditoría

### Flujo recomendado

```txt
rulesEngine.rollDice(seed, notation)
  -> resultado estructurado
  -> DiceBox visualiza ese resultado
  -> log mecánico persiste resultado
```

### Nota importante

Si la biblioteca no permite forzar resultados en la versión elegida, usarla sólo como animación cosmética y mostrar el resultado oficial en overlay.

### Prioridad

CORE UI / OPTIONAL MECHANICAL VISUALIZATION.

---

## 3.2 dice-box-threejs

### URL

https://github.com/3d-dice/dice-box-threejs

### NPM

https://www.npmjs.com/package/@3d-dice/dice-box-threejs

### Qué aporta

Alternativa basada en Three.js y Cannon-es.

Ventajas:

- más ligera conceptualmente
- callback `onRollComplete`
- eventos de resultado
- soporte para resultados predeterminados mediante notación especial en algunas versiones

### Uso recomendado

Evaluar si necesitas controlar resultados visuales predeterminados.

### Prioridad

ALTERNATIVE.

---

## 3.3 react-3d-dice

### URL

https://github.com/aqandrew/react-3d-dice

### Qué aporta

Ejemplo experimental de dados con React y three.js.

### Uso recomendado

Sólo para estudiar implementación visual.

### Prioridad

EXPERIMENTAL.

---

## 4. Mapas tácticos, battle maps y niebla de guerra

---

## 4.1 Dungeon Scrawl

### URL

https://www.dungeonscrawl.com/

### App

https://app.dungeonscrawl.com/

### Qué aporta

Editor web gratuito para crear mazmorras y battlemaps sin descarga ni registro.

### Uso recomendado

Fuente de mapas rápidos exportables para:

- prototipos
- encuentros tácticos
- mapas de prueba
- assets de demo

### Integración sugerida

Permitir importar:

- PNG
- JPG
- dimensiones de grid
- tamaño de celda
- metadata manual

### Prioridad

CORE TOOLING EXTERNAL.

---

## 4.2 Dungeon Map Doodler

### URL

https://dungeonmapdoodler.com/

### App

https://dungeonmapdoodler.com/doodle-now/

### Qué aporta

Editor gratuito de mapas desde navegador.

Funciones útiles:

- snap to grid
- free draw
- dynamic brushes
- stamps
- PNG export
- customizable grid
- room tool
- wall tool
- donjon importer
- world generation

### Uso recomendado

Crear mapas rápidos para testing de:

- grid 5 ft
- paredes
- obstáculos
- puertas
- salas

### Prioridad

OPTIONAL / TOOLING.

---

## 4.3 DungeonFog

### URL

https://www.dungeonfog.com/

### Qué aporta

Editor de mapas TTRPG con:

- editor vectorial
- biblioteca de assets
- exportación
- impresión
- fog of war
- comunidad de mapas

### Uso recomendado

Herramienta externa para crear mapas de mayor calidad.

### Advertencia

Ver límites del plan gratuito y licencias de uso antes de integrar assets en la app.

### Prioridad

OPTIONAL.

---

## 4.4 Inkarnate

### URL

https://inkarnate.com/

### Qué aporta

Creador de mapas de mundo, región, ciudad y batalla.

### Uso recomendado

Más útil para:

- mapas de campaña
- overworld
- regiones
- ciudades
- handouts visuales

Menos útil para:

- grid táctico mecánico si no se ajusta manualmente.

### Advertencia

El plan gratuito puede limitar assets, resolución y uso comercial.

### Prioridad

OPTIONAL.

---

## 4.5 battle-map-explorer

### URL

https://github.com/byronknoll/battle-map-explorer

### Demo / ejemplos

http://www.byronknoll.com/dungeon.html  
http://www.byronknoll.com/dungeon2.html

### Qué aporta

Librería JS / HTML5 Canvas para explorar mapas de D&D y otros TTRPG.

Incluye:

- navegación por mouse, teclado o touch
- compatibilidad móvil
- ocultación de salas no descubiertas
- polígonos de visibilidad
- integración con imágenes de mapa

### Dependencias mencionadas

https://github.com/byronknoll/visibility-polygon-js  
https://github.com/hammerjs/hammer.js/

### Uso recomendado

Referencia para:

- fog of war
- línea de visión
- exploración de dungeon
- ocultación de áreas
- navegación táctil

### Integración sugerida

No integrar directamente sin auditoría. Extraer ideas para:

```txt
components/map/FogOfWarLayer.tsx
lib/map/visibility.ts
lib/map/walls.ts
lib/map/discovered-rooms.ts
```

### Prioridad

REFERENCE / POSSIBLE INTEGRATION.

---

## 4.6 2-Minute Tabletop

### URL

https://2minutetabletop.com/

### Free maps and assets

https://2minutetabletop.com/product-category/free/

### Token editor

https://2minutetabletop.com/2-minute-token-editor/

### Token editor app

https://tools.2minutetabletop.com/token-editor/

### Qué aporta

Recursos visuales para TTRPG:

- battle maps
- map assets
- token editor
- tokens gratuitos o pay-what-you-want

### Uso recomendado

- prototipos visuales
- mapas de ejemplo
- tokens de prueba
- assets para demos privadas

### Advertencia

Comprobar licencia de cada pack antes de redistribuir.

### Prioridad

ASSET SOURCE.

---

## 4.7 Dice Grimorium

### URL

https://dicegrimorium.com/

### Free map library

https://dicegrimorium.com/free-rpg-map-library/

### Qué aporta

Biblioteca de mapas de batalla gratuitos para D&D y Pathfinder.

### Uso recomendado

Mapas de prueba o campañas privadas.

### Advertencia

Comprobar términos individuales antes de empaquetar assets dentro de la app.

### Prioridad

ASSET SOURCE.

---

## 4.8 Lost Atlas

### URL

https://lostatlas.co/

### Qué aporta

Buscador de mapas para TTRPG, incluyendo mapas gratuitos y premium.

### Uso recomendado

Búsqueda de mapas por tema:

- bosque
- dungeon
- tavern
- cave
- city
- desert

### Advertencia

No todos los resultados serán libres. Revisar licencia por recurso.

### Prioridad

DISCOVERY TOOL.

---

## 5. Tokens, retratos e iconos

---

## 5.1 The Fateful Force — VTT Token Maker

### URL

https://thefatefulforce.com/battle-resources/token-creator/

### Qué aporta

Generador gratuito de tokens PNG para VTT.

Funciones útiles:

- cargar imagen
- aplicar borde
- ajustar máscara
- descargar PNG
- batch mode
- custom border
- custom mask

### Uso recomendado

Crear tokens para:

- jugador
- NPCs
- monstruos
- summons
- bosses

### Integración sugerida

Usar como herramienta externa. No integrar scraping.

### Prioridad

TOOLING.

---

## 5.2 RollAdvantage Token Stamp

### URL

https://rolladvantage.com/tokenstamp/

### Dice Roller

https://rolladvantage.com/diceroller/

### Qué aporta

Editor de tokens simple y dice roller web.

### Licencia relevante

La propia página indica que los bordes de Token Stamp están bajo Creative Commons Attribution 4.0.

### Uso recomendado

Crear tokens rápidos a partir de imágenes generadas o assets propios.

### Prioridad

TOOLING.

---

## 5.3 2-Minute Token Editor

### URL

https://2minutetabletop.com/2-minute-token-editor/

### App

https://tools.2minutetabletop.com/token-editor/

### Uso recomendado

Tokens estilo cartoon/hand-drawn para prototipos y campañas privadas.

### Prioridad

TOOLING / ASSET SOURCE.

---

## 5.4 Kenney Assets

### URL principal

https://kenney.nl/

### Assets

https://kenney.nl/assets

### Itch.io

https://kenney.itch.io/

### Qué aporta

Miles de assets gratuitos para videojuegos.

Posibles usos:

- UI genérica
- iconos
- tiles
- props
- efectos visuales
- placeholders
- prototipos

### Uso recomendado

Usar para prototipar UI y assets no específicos de D&D.

### Advertencia

Aunque Kenney suele publicar assets con licencias muy permisivas, verificar licencia específica por pack.

### Prioridad

ASSET SOURCE.

---

## 5.5 OpenGameArt

### URL

https://opengameart.org/

### Categorías útiles

```txt
https://opengameart.org/art-search-advanced?field_art_type_tid%5B%5D=9
https://opengameart.org/art-search-advanced?field_art_type_tid%5B%5D=10
https://opengameart.org/art-search-advanced?field_art_type_tid%5B%5D=12
```

### Qué aporta

Repositorio comunitario con:

- 2D art
- 3D art
- concept art
- textures
- music
- sound effects
- documents/tutorials

### Uso recomendado

Buscar:

- iconos de inventario
- props medievales
- tiles fantasy
- UI frames
- sonidos
- música

### Advertencia

Licencias variables: CC0, CC-BY, GPL, OGA-BY, etc. El agente debe leer licencia por asset antes de recomendar redistribución.

### Prioridad

ASSET SOURCE.

---

## 6. Sonido, música y ambiente

---

## 6.1 Tabletop Audio

### URL

https://tabletopaudio.com/

### SoundPad

https://tabletopaudio.com/soundpad.html

### Qué aporta

Pistas de ambiente y música de 10 minutos para juegos de rol.

### Casos de uso

- dungeon
- forest
- tavern
- combat
- horror
- travel
- town
- temple
- ruins

### Integración recomendada

No descargar masivamente sin revisar términos. Usar como:

- referencia de diseño sonoro
- herramienta externa durante test
- fuente manual de audio si licencia lo permite

### Prioridad

AUDIO SOURCE.

---

## 6.2 Ambient Mixer

### URL

https://www.ambient-mixer.com/

### RPG section

https://rpg.ambient-mixer.com/

### Fantasy section

https://fantasy.ambient-mixer.com/

### Qué aporta

Mezclador online de sonidos ambientales.

Permite:

- escuchar atmósferas
- editar plantillas
- crear mezclas
- combinar capas de sonido

### Uso recomendado

Prototipar presets de audio:

```txt
tavern
forest-night
storm
dungeon-drip
battlefield
temple
```

### Prioridad

AUDIO TOOLING.

---

## 6.3 Freesound

### URL

https://freesound.org/

### Search

https://freesound.org/search/

### API docs

https://freesound.org/docs/api/

### Qué aporta

Gran biblioteca colaborativa de efectos de sonido.

### Uso recomendado

Buscar sonidos concretos:

- sword hit
- door creak
- fireball
- footsteps stone
- cave drip
- monster growl
- potion
- coin
- thunder

### Advertencia

Licencias variables. El agente debe revisar cada licencia.

### Prioridad

AUDIO SOURCE.

---

## 6.4 Tabletopy

### URL

https://tabletopy.com/

### Qué aporta

Panel de sonidos para TTRPG con categorías listas:

- footsteps
- camp
- tavern
- monster
- dragon
- town crowd
- heavy gate
- lock
- door
- trap
- forest
- battle theme
- sword to sword
- healing potion

### Uso recomendado

Referencia para diseñar `play_audio_cue` y catálogo de eventos sonoros.

### Ejemplo de mapping para Dungeon Cortex

```txt
COMBAT_EVENT.attack_hit -> sword_to_sword
COMBAT_EVENT.attack_miss -> blade_attack
MAP_EVENT.open_door -> door
MAP_EVENT.trigger_trap -> trap
REST.short_rest -> campfire
SCENE.tavern -> tavern
SPELL.healing -> healing_potion
```

### Prioridad

AUDIO REFERENCE.

---

## 6.5 Tabletop RPG Music

### URL

https://www.tabletoprpgmusic.com/

### Foundry VTT free module

https://foundryvtt.com/packages/tabletop-rpg-music

### Qué aporta

Música para TTRPG organizada por etiquetas de escena, mood y setting.

### Uso recomendado

Diseñar taxonomía de música para Dungeon Cortex:

```txt
scene: combat | dungeon | town | travel | suspense
mood: dark | heroic | mystical | calm | tension
setting: fantasy | arctic | forest | planar | temple
```

### Prioridad

AUDIO SOURCE / TAXONOMY REFERENCE.

---

## 7. Persistencia local, búsqueda y memoria

---

## 7.1 SQLite

### URL

https://www.sqlite.org/

### FTS5 docs

https://www.sqlite.org/fts5.html

### Qué aporta

Base de datos embebida. FTS5 permite búsqueda de texto completo.

### Uso recomendado

Base de Dungeon Cortex v1:

- campaigns
- sessions
- game_logs
- game_logs_fts
- characters
- combat_encounters
- combatants
- inventory_items
- npcs
- quests
- maps
- api_cache

### Prioridad

CORE.

---

## 7.2 sql.js / sql.js-fts5

### sql.js

https://github.com/sql-js/sql.js

### sql.js-fts5

https://www.npmjs.com/package/sql.js-fts5

### CDN

https://www.jsdelivr.com/package/npm/sql.js-fts5

### Qué aporta

SQLite compilado a WebAssembly para navegador, con posibilidad de FTS5.

### Uso recomendado

Sólo si se necesita persistencia SQLite en navegador puro. En Next.js puede ser más simple usar SQLite en servidor local o entorno Node.

### Casos de uso

- prototipo offline en navegador
- import/export `.db`
- memoria local sin backend
- test de FTS5

### Advertencias

- Revisar compatibilidad con Next.js App Router.
- Revisar tamaño del WASM.
- Revisar persistencia real en navegador.

### Prioridad

OPTIONAL / OFFLINE EXPERIMENT.

---

## 7.3 Drizzle ORM

### URL

https://orm.drizzle.team/

### GitHub

https://github.com/drizzle-team/drizzle-orm

### Qué aporta

ORM TypeScript compatible con SQLite.

### Uso recomendado

Definir schema de Dungeon Cortex:

```txt
characters
campaigns
sessions
game_logs
game_logs_fts
combat_encounters
combatants
inventory_items
npcs
quests
maps
api_cache
user_preferences
```

### Prioridad

CORE si se mantiene el stack del TDD.

---

## 8. UI, accesibilidad y componentes

---

## 8.1 shadcn/ui

### URL

https://ui.shadcn.com/

### GitHub

https://github.com/shadcn-ui/ui

### Qué aporta

Componentes accesibles y personalizables para React/Next.js.

### Uso recomendado

Construir:

- panels
- buttons
- dialogs
- tabs
- sheets
- dropdowns
- command palettes
- forms
- toast notifications

### Prioridad

CORE UI.

---

## 8.2 Radix UI

### URL

https://www.radix-ui.com/

### GitHub

https://github.com/radix-ui/primitives

### Qué aporta

Primitivas accesibles de bajo nivel.

### Uso recomendado

Base de accesibilidad para UI diegética.

### Prioridad

CORE UI.

---

## 8.3 Lucide React

### URL

https://lucide.dev/

### GitHub

https://github.com/lucide-icons/lucide

### Qué aporta

Iconos SVG limpios y ligeros.

### Uso recomendado

Iconografía para:

- combat HUD
- inventory
- journal
- spellbook
- settings
- audio cues
- map controls

### Prioridad

CORE UI.

---

## 8.4 React Aria

### URL

https://react-spectrum.adobe.com/react-aria/

### Qué aporta

Hooks de accesibilidad para React.

### Uso recomendado

Si shadcn/Radix no cubren una interacción compleja:

- grid táctico navegable por teclado
- menús avanzados
- combobox de spells
- selección de targets

### Prioridad

OPTIONAL / ACCESSIBILITY.

---

## 9. Testing y validación

---

## 9.1 Vitest

### URL

https://vitest.dev/

### Uso recomendado

Tests unitarios del rules engine:

```txt
resolveAttackRoll()
resolveSavingThrow()
resolveDamageRoll()
applyDamage()
applyHealing()
applyCondition()
castSpell()
takeShortRest()
takeLongRest()
performDeathSave()
```

### Prioridad

CORE.

---

## 9.2 Playwright

### URL

https://playwright.dev/

### Uso recomendado

E2E:

- wizard completo
- primer combate
- primer descanso
- recuperación de campaña guardada
- navegación móvil
- accesibilidad básica

### Prioridad

CORE.

---

## 9.3 fast-check

### URL

https://fast-check.dev/

### GitHub

https://github.com/dubzzz/fast-check

### Qué aporta

Property-based testing para JavaScript/TypeScript.

### Uso recomendado

Muy útil para reglas:

```txt
HP nunca baja por debajo de 0 salvo si se modela muerte explícita.
Temp HP se consume antes que HP.
Un personaje inconsciente no puede realizar acciones normales.
Concentración se rompe con incapacitated.
Death save se limpia al recuperar consciencia.
Attunement máximo = 3.
```

### Prioridad

HIGH VALUE.

---

## 10. Recursos que el agente debe evitar o usar con cautela

---

## 10.1 D&D Beyond

### URL

https://www.dndbeyond.com/

### Política para Dungeon Cortex

No scraping. No importar contenido no SRD. No depender de datos cerrados.

### Uso permitido

Sólo referencia manual del usuario si tiene derechos, nunca extracción automática.

### Prioridad

AVOID FOR DATA.

---

## 10.2 Contenido no SRD

Evitar:

- libros oficiales completos no SRD
- material de pago
- scraping de wikis no autorizadas
- monster manuals completos
- subclasses no abiertas
- feats no SRD si v1 las excluye
- reglas 2024 dentro del core 2014

### Política

Si se usa homebrew:

```txt
source = user_homebrew
requires_user_confirmation = true
mechanical_authority = local_override_only_after_review
```

---

## 11. Matriz de integración recomendada

| Área | Recurso recomendado | Prioridad |
|---|---|---|
| Compendium 2014 | dnd5eapi / 5e-bits | CORE |
| Datos offline | 5e-database | CORE |
| Búsqueda secundaria | Open5e | OPTIONAL |
| Rules engine | Implementación propia TS | CORE |
| Referencia rules engine | dnd-5e-core / dnd_engine | REFERENCE |
| Dados 3D | @3d-dice/dice-box | CORE UI |
| Mapas rápidos | Dungeon Scrawl | TOOLING |
| Mapas visuales | 2-Minute Tabletop / Dice Grimorium | ASSETS |
| Fog of war | battle-map-explorer | REFERENCE |
| Tokens | Fateful Force / Token Stamp | TOOLING |
| UI | shadcn/ui + Radix | CORE UI |
| Iconos | Lucide | CORE UI |
| Audio | TabletopAudio / Ambient Mixer / Freesound | OPTIONAL |
| Tests unitarios | Vitest | CORE |
| Tests E2E | Playwright | CORE |
| Property tests | fast-check | HIGH VALUE |
| Persistencia | SQLite + Drizzle | CORE |

---

## 12. Plan de ejecución para el agente

### Fase A — Compendium y caché

Objetivo:

```txt
Crear cliente dnd5eapi + caché SQLite + normalizadores.
```

Pasos:

1. Crear `lib/dnd-api/client.ts`.
2. Crear `lib/dnd-api/types.ts`.
3. Crear `api_cache` con Drizzle.
4. Implementar `getCachedOrFetch(endpoint)`.
5. Crear normalizadores para spells, monsters, equipment, classes, races.
6. Añadir tests unitarios con fixtures.

No modificar rules engine todavía.

---

### Fase B — Rule Pack local

Objetivo:

```txt
Crear documento y JSON interno con decisiones normativas 2014.
```

Debe incluir:

- diagonal = 5 ft.
- feats off.
- multiclass off.
- encumbrance off.
- exhaustion 2014.
- attunement max 3.
- source priority.
- missing data policy.

---

### Fase C — Rules engine mínimo

Objetivo:

```txt
Implementar funciones puras y testeables.
```

Servicios mínimos:

```txt
resolveAbilityCheck()
resolveSavingThrow()
resolveAttackRoll()
resolveDamageRoll()
applyDamage()
applyHealing()
applyCondition()
removeCondition()
rollInitiative()
performDeathSave()
```

---

### Fase D — Spellcasting

Objetivo:

```txt
Validar legalidad antes de narrar.
```

Implementar:

```txt
castSpell()
validateSpellKnownOrPrepared()
validateSlotAvailable()
validateActionType()
validateRange()
validateConcentration()
consumeSlot()
startOrReplaceConcentration()
```

---

### Fase E — Dice 3D

Objetivo:

```txt
Añadir animación visual sin alterar resultados mecánicos.
```

Regla:

```txt
Rules engine decides. Dice UI displays.
```

---

### Fase F — Map grid

Objetivo:

```txt
Mapa táctico 2D con grid 5 ft.
```

Implementar:

- coordenadas x/y
- token positions
- movement remaining
- cover level
- target selection
- basic obstacles

---

### Fase G — Audio cues

Objetivo:

```txt
Mapear eventos a sonidos locales.
```

Ejemplo:

```txt
ROLL_RESULT.critical_hit -> audio/critical-hit.mp3
COMBAT_EVENT.damage -> audio/hit.mp3
MAP_EVENT.open_door -> audio/door.mp3
REST.long_rest -> audio/campfire.mp3
```

---

## 13. Prompt operativo para el agente de IA

```txt
Actúa como agente de desarrollo para Dungeon Cortex.

Contexto obligatorio:
- Dungeon Cortex v1 usa D&D 5e 2014 SRD / Basic Rules.
- No mezcles reglas 2024.
- La IA narrativa no decide mecánicas.
- Toda mecánica crítica pasa por rules engine determinista.
- dnd5eapi /api/2014/ es fuente primaria de datos, no árbitro mecánico.
- Open5e es fuente secundaria/comparativa.
- SQLite + Drizzle es la capa de datos.
- FTS5 se usa para diario/memoria.
- Next.js App Router es el frontend/backend base.

Antes de implementar:
1. Resume el objetivo.
2. Lista archivos afectados.
3. Pide permiso explícito.
4. Implementa en pasos pequeños.
5. Añade tests.
6. Informa de riesgos, limitaciones y próximos pasos.

Reglas:
- No inventes contenido mecánico ausente.
- No hagas scraping de D&D Beyond.
- No introduzcas feats ni multiclassing en v1.
- No uses contenido no SRD salvo homebrew explícito del usuario.
- No permitas que el LLM altere HP, slots, condiciones o recursos sin tool.
```

---

## 14. Prompt para auditoría de recursos

```txt
Analiza los recursos externos propuestos para Dungeon Cortex.

Para cada recurso:
1. Identifica si es CORE, OPTIONAL, REFERENCE, TOOLING, ASSET SOURCE o AVOID.
2. Indica licencia o riesgo de licencia si está disponible.
3. Explica si encaja con D&D 5e 2014 SRD.
4. Indica cómo integrarlo sin romper la regla “Code is Law”.
5. Propón archivos concretos del proyecto donde debería integrarse.
6. Indica tests mínimos necesarios.
7. Marca cualquier riesgo de mezclar reglas 2024, contenido no SRD o scraping.

Devuelve:
- resumen ejecutivo
- matriz de prioridad
- plan de integración por fases
- riesgos
- prompts de implementación para Claude Code / Codex / Gemini Build
```

---

## 15. Checklist final para el agente

Antes de aceptar un recurso, comprobar:

```txt
[ ] ¿Es compatible con D&D 5e 2014 SRD?
[ ] ¿Tiene licencia clara?
[ ] ¿Es necesario para v1?
[ ] ¿Puede funcionar offline o cachearse?
[ ] ¿Introduce ambigüedad mecánica?
[ ] ¿Puede testearse?
[ ] ¿Respeta Tool-first rule?
[ ] ¿Evita contenido no SRD?
[ ] ¿No depende de scraping?
[ ] ¿No mezcla reglas 2024?
```

---

## 16. Selección recomendada mínima para v1

Para no sobrecargar el proyecto, usar sólo esto al principio:

```txt
CORE DATA:
- dnd5eapi /api/2014/
- 5e-database local como referencia

CORE ENGINE:
- rules engine propio en TypeScript
- dnd-5e-core sólo como referencia/test oracle

CORE UI:
- shadcn/ui
- Radix UI
- Lucide
- @3d-dice/dice-box

CORE DATA LAYER:
- SQLite
- Drizzle
- FTS5

CORE TESTING:
- Vitest
- Playwright
- fast-check

OPTIONAL ASSETS:
- Dungeon Scrawl
- 2-Minute Tabletop
- Kenney
- OpenGameArt
- TabletopAudio
```

---

## 17. Lista rápida de URLs

```txt
D&D 5e API:
https://www.dnd5eapi.co/
https://www.dnd5eapi.co/api/2014/
https://5e-bits.github.io/docs/
https://github.com/5e-bits/5e-srd-api
https://github.com/5e-bits/5e-database

Open5e:
https://open5e.com/
https://open5e.com/api-docs
https://api.open5e.com/
https://api.open5e.com/v2/search/?query=goblin
https://github.com/open5e/open5e
https://github.com/open5e/open5e-api

Rules engines:
https://libraries.io/pypi/dnd-5e-core
https://pypi.org/project/dnd-5e-core/
https://github.com/furlat/dnd_engine
https://github.com/jedld/natural_20
https://github.com/Carbsta/Py5e

Character sheet:
https://github.com/igor47/csheet
https://www.csheet.net/

Dice:
https://github.com/3d-dice/dice-box
https://www.npmjs.com/package/@3d-dice/dice-box
https://fantasticdice.games/
https://github.com/3d-dice/dice-box-threejs
https://www.npmjs.com/package/@3d-dice/dice-box-threejs
https://github.com/aqandrew/react-3d-dice

Maps:
https://www.dungeonscrawl.com/
https://app.dungeonscrawl.com/
https://dungeonmapdoodler.com/
https://www.dungeonfog.com/
https://inkarnate.com/
https://github.com/byronknoll/battle-map-explorer
https://github.com/byronknoll/visibility-polygon-js
https://github.com/hammerjs/hammer.js/

Battle maps and assets:
https://2minutetabletop.com/
https://2minutetabletop.com/product-category/free/
https://2minutetabletop.com/2-minute-token-editor/
https://tools.2minutetabletop.com/token-editor/
https://dicegrimorium.com/
https://dicegrimorium.com/free-rpg-map-library/
https://lostatlas.co/

Tokens:
https://thefatefulforce.com/battle-resources/token-creator/
https://rolladvantage.com/tokenstamp/
https://rolladvantage.com/diceroller/

Assets:
https://kenney.nl/
https://kenney.nl/assets
https://kenney.itch.io/
https://opengameart.org/

Audio:
https://tabletopaudio.com/
https://tabletopaudio.com/soundpad.html
https://www.ambient-mixer.com/
https://rpg.ambient-mixer.com/
https://fantasy.ambient-mixer.com/
https://freesound.org/
https://freesound.org/search/
https://freesound.org/docs/api/
https://tabletopy.com/
https://www.tabletoprpgmusic.com/
https://foundryvtt.com/packages/tabletop-rpg-music

Persistence:
https://www.sqlite.org/
https://www.sqlite.org/fts5.html
https://github.com/sql-js/sql.js
https://www.npmjs.com/package/sql.js-fts5
https://www.jsdelivr.com/package/npm/sql.js-fts5
https://orm.drizzle.team/
https://github.com/drizzle-team/drizzle-orm

UI:
https://ui.shadcn.com/
https://github.com/shadcn-ui/ui
https://www.radix-ui.com/
https://github.com/radix-ui/primitives
https://lucide.dev/
https://github.com/lucide-icons/lucide
https://react-spectrum.adobe.com/react-aria/

Testing:
https://vitest.dev/
https://playwright.dev/
https://fast-check.dev/
https://github.com/dubzzz/fast-check
```
