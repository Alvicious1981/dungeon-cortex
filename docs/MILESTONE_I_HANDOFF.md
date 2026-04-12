# Hito I: Mundo Dinámico y Entidades — Resumen de Entrega

## 1. Resumen Ejecutivo
El **Hito I (Mundo Dinámico y Entidades)** ha sido completado, estableciendo las bases para un mundo de juego vivo, persistente y mecánicamente robusto. Se han implementado sistemas deterministas para la generación de NPCs, misiones procedimentales y una integración profunda con el Bestiario de D&D 5e (SRD).

Este hito cumple con el dogma fundamental del proyecto: **"Code is Law"**. El Narrador IA actúa como un intérprete creativo, pero todas las entidades y desafíos están respaldados por datos sólidos y lógica de código.

---

## 2. Bestiario (SrdMonster)

### Estado de la Base de Datos
- **Modelo `SrdMonster`**: Almacena datos completos del SRD de D&D 5e, incluyendo Clase de Armadura (AC), Puntos de Golpe (HP), Valor de Desafío (CR), acciones y habilidades especiales.
- **Consultas Tipadas**: Soporte para búsquedas por nombre, CR y tipo de criatura (non-dead, beast, dragon, etc.).

### Mecánicas de Encuentro
- **Generador de Encuentros (`buildEncounter`)**: Calcula un presupuesto de CR basado en el nivel del jugador y selecciona enemigos de forma balanceada.
- **Iniciativa Automática**: El sistema tira iniciativa para todos los combatientes y ordena los turnos mecánicamente.
- **Derivación de AC y HP**: Los valores de combate se extraen directamente del SRD, evitando que la IA "invente" estadísticas durante el juego.

---

## 3. NPCs Procedimentales

### Generador Determinista (`generateNPC`)
- **Semillas Estables (`seed`)**: El mismo par (semilla, rol) siempre produce el mismo NPC. Un "Guardia de la Puerta Norte" será el mismo individuo cada vez que el jugador regrese, manteniendo la coherencia del mundo.
- **Riqueza de Datos**: Los NPCs no son solo nombres; poseen:
  - **Identidad**: Raza, profesión y alineamiento moral.
  - **Estadísticas 5e**: Seis puntuaciones de habilidad (STR, DEX, CON, INT, WIS, CHA) derivadas del *Standard Array*.
  - **Personalidad**: Cuatro pilares fundamentales (Personalidad, Ideal, Vínculo y Defecto).

### Persistencia y Memoria
- **Herramienta `trackNPC`**: Permite a la IA persistir NPCs en la base de datos de la campaña para recordarlos en futuras sesiones.
- **Notas del DM**: Los NPCs almacenan notas sobre su actitud hacia el jugador y su relevancia en la trama.

---

## 4. Sistema de Misiones (Quests)

### Generación de Misiones (`generateQuest`)
- **Estructura Narrativa**: Cada misión incluye un **Gancho** (Hook), una **Ubicación** (Location), un **Objetivo** (Objective) y una **Recompensa** (Reward).
- **Tono Dark Fantasy**: Las tablas de generación están diseñadas para mantener una atmósfera de fantasía oscura y ambigüedad moral.

### Ciclo de Vida de la Misión
- **Registro (`generateAndTrackQuest`)**: La IA puede generar y registrar misiones cuando el jugador interactúa con tableros de anuncios o NPCs.
- **Seguimiento de Estado**: Las misiones pueden estar en estado `active`, `completed` o `failed`.
- **Autoridad de XP**: La IA tiene la autoridad para otorgar experiencia (XP) mediante la herramienta `awardXP` al completar misiones o hitos narrativos.

---

## 5. El Narrador IA y su Interacción con el Sistema

La IA (`gpt-4o-mini`) interactúa con estos sistemas como un **DM (Dungeon Master)** que consulta libros de reglas y notas de campaña.

### Flujo de Trabajo de la IA
1. **Detección de Intento**: Si el jugador busca problemas, la IA decide si activar un encuentro.
2. **Uso de Herramientas**:
   - `spawnEncounter`: Invoca enemigos reales del bestiario.
   - `getNPCDetails`: Obtiene la "verdad" sobre un NPC antes de describirlo.
   - `generateAndTrackQuest`: Crea objetivos tangibles en el mundo.
3. **Narra con Autoridad**: La IA usa los datos devueltos por las herramientas de forma literal (nombres de NPCs, objetivos de misiones) para asegurar que la narración coincida exactamente con el estado de la base de datos.

### Restricciones Críticas
- La IA **no puede crear** misiones o NPCs fuera del sistema de herramientas si desea que sean persistentes.
- La IA **no puede ignorar** los estados de HP o AC definidos por el código durante el combate.

---

## 6. Próximos Pasos (Hito J y más allá)
Con el mundo dinámico funcionando, el enfoque se trasladará a:
- **Integración de Recursos**: Refinar cómo se vinculan los hechizos y objetos con la lógica de combate.
- **Progresión del Jugador**: Automatizar las subidas de nivel y la gestión de inventario complejo.
- **Inmersión Visual**: Añadir capas de feedback visual para misiones y estados de NPCs.
