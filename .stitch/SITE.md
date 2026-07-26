# Dungeon Cortex — Ciclo Stitch

## 1. Visión

Dungeon Cortex es una experiencia individual de Director de Mazmorras asistido por IA. La interfaz presenta narración y estado confirmado, y recoge intención; nunca resuelve reglas ni modifica estado mecánico por sí misma.

El ciclo es manual y requiere revisión humana entre pantallas. Stitch genera propuestas de composición; Next.js, el backend y los documentos del repositorio conservan la autoridad técnica.

## 2. Proyectos

- Proyecto fuente de referencia: `131487819236908093`.
- Proyecto de producción: `15974794171746286383` (`Dungeon Cortex — Product UI`, privado).
- Design system de producción: `assets/8784545861071306268`.
- Pantalla fuente prioritaria: instancia `d2c02b9e9ba041d4aec9554fbb8d1cfa`, pantalla `c31196fa0ee04ca8bbf943c7e636b0c3`.

El proyecto fuente no se edita. Sus 17 pantallas visibles aportan únicamente estructura y composición.

## 3. Reglas del ciclo

1. Leer `DESIGN.md`, este documento y `next-prompt.md` antes de generar.
2. Generar exclusivamente en el proyecto de producción y utilizar su design system.
3. Consultar `metadata.json` para IDs; nunca persistir URLs firmadas de descarga.
4. Descargar HTML y PNG solo a `.stitch/designs/`, que no se versiona.
5. No integrar una pantalla en React hasta que tenga revisión visual, responsive, accesible y de canon.
6. Tras cada pantalla aprobada, actualizar `metadata.json`, el sitemap y el siguiente batón.
7. No modificar API, Prisma, reglas o autenticación como efecto colateral de una iteración visual.

## 4. Sitemap

- [ ] `campaign-library` — listado y reanudación; batón actual.
- [ ] `campaign-library-mobile` — adaptación 390 × 844.
- [ ] `gameplay-hud` — narración, mecánica y acciones.
- [ ] `journal` — diario y misiones.
- [ ] `inventory` — inventario y equipo en vista de lista.
- [ ] `world-map` — mapa respaldado por datos autoritativos.
- [ ] `dialogue` — conversación y opciones legales del servidor.
- [ ] `spellbook` — información de hechizos procedente de contratos estables.
- [ ] `trade` — comercio resuelto por el backend.
- [ ] `system-outcomes` — carga, vacío, error, victoria y final de campaña.

## 5. Roadmap

1. Generar `campaign-library` para escritorio y someterla a revisión humana.
2. Crear variantes de 1024, 768 y 390 px antes de cualquier integración.
3. Definir en una tarea separada el `GET /api/campaign` autoritativo y sus pruebas.
4. Integrar la biblioteca en Next.js mediante una PR acotada.
5. Continuar con el HUD principal y después con archivo, inventario y mapa.

## 6. Inventario de referencias

| Clave | Pantalla fuente | Uso permitido |
| --- | --- | --- |
| `campaign-library` | `c31196fa0ee04ca8bbf943c7e636b0c3` | Lista + detalle; referencia prioritaria |
| `gameplay-hud` | `2be19c4723d4422a8827217ada2d52a9` | Jerarquía narración/mecánica/acciones |
| `journal` | `3e8a36aba3c646ac80b7cd0a1d04a955` | Composición editorial |
| `inventory` | `1851c9f34ce14e13b30c03f238f4e0d5` | Zonas de equipo e inventario |
| `world-map` | `023fdcf27ef44a8283f7af6a1e77a1b5` | Mapa + panel de contexto |
| `dialogue` | `7f8a67265d284c5eb8704e426318c5b5` | Narración + opciones |
| `spellbook` | `d66dd0ef41144947b9f9d6965ad520d5` | Índice + detalle |
| `trade` | `ca4108e9caf64e92928fc43c83a8edcc` | Comparación de inventarios |
| `character-class` | `9f059bf50ba844829bab16cee166efd9` | Flujo visual, no contenido |
| `character-attributes` | `14ad6bd69a8b4dca8f94f1995d9dfc46` | Flujo visual, no reparto por puntos |
| `character-skills` | `8698ceeef01b48ada06d4b5653fd3b24` | Flujo visual, no sistema de rangos |
| `character-background` | `d6d39c14079645c9b4ef874199da44cd` | Resumen editorial |
| `main-menu` | `e01db2690988419abb29b7c83be78808` | Composición, sin marca ni arte |
| `death-summary` | `af6eb697603b4cbabe83a9937af1459b` | Estado final confirmado |
| `victory-summary` | `621fda058f244775bcf744407d787917` | Estado final confirmado |
| `loot-summary` | `5f17695491c14b7a9891809c60f78acd` | Recompensa confirmada |
| `level-up` | `d5d823e257fb4aa3937f301331787c16` | Presentación, sin talentos inventados |

## 7. Libertad creativa

No se consume libertad creativa mientras existan elementos del roadmap. Toda propuesta adicional debe mantener la identidad de archivo nocturno, funcionar sin ilustraciones y declarar expresamente cualquier dato que aún no tenga contrato backend.
