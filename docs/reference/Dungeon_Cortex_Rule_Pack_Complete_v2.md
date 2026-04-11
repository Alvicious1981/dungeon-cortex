ya **DUNGEON CORTEX**

**Rule Pack 2014 — Edición Completa**

Especificación Normativa para Claude Code

*D\&D 5e 2014 SRD / Basic Rules*

Versión 2.0 — Abril 2026

*Este documento tiene prioridad sobre comentarios narrativos, ejemplos aislados o inferencias del modelo.*

**PARTE I**

**REGLAS NORMATIVAS DE IMPLEMENTACIÓN**

# **1\. Propósito**

Este documento es la fuente normativa de reglas para el desarrollo de Dungeon Cortex v1.

Su objetivo es impedir que el agente de código improvise mecánicas, mezcle ediciones o resuelva por texto libre aquello que debe resolverse mediante lógica determinista.

# **2\. Reglas Globales**

## **2.1 Canon**

El ruleset de Dungeon Cortex v1 es D\&D 5e 2014 SRD / Basic Rules.

No se permiten reglas 2024/5.5e en el runtime de v1.

No se permite mezclar terminología o semántica 2024 con el motor 2014\.

## **2.2 Orden de Autoridad**

| Prioridad | Fuente |
| :---- | :---- |
| 1 | Este rule-pack-2014.md |
| 2 | Reglas 2014 abiertas soportadas por el proyecto |
| 3 | Datos estructurados del compendium compatible |
| 4 | Overrides locales versionados |
| 5 | Narrativa generada por IA |

## **2.3 Restricciones para Claude Code**

**Claude Code DEBE:**

• Implementar la lógica crítica en funciones puras o servicios deterministas

• Tratar la IA como narrador, no como árbitro mecánico

• Crear tests para cada subsistema reglado

• Rechazar casts, acciones o estados ilegales aunque la narración los sugiera

• Preferir bloqueo explícito antes que inventar una regla

**Claude Code NO DEBE:**

• Mezclar 2014 y 2024

• Usar texto libre para resolver daño, saves, slots o concentración

• Inventar spells, rasgos, monstruos o features ausentes

• Conceder reglas homebrew por defecto

• Ocultar decisiones reglamentarias ambiguas en prompts narrativos

# **3\. Superficie de Reglas Soportadas en v1**

## **3.1 Soportado**

• Creación de personaje 2014 SRD (Standard Array, Point Buy opcional)

• Razas, clases y backgrounds soportados por el compendium

• Checks, saving throws y attack rolls

• Combate por turnos con iniciativa

• Movimiento en grid cuadrado de 5 ft

• Bonus action, reaction, concentration

• Spell slots, ritual casting

• Short rest y long rest, hit dice

• Death saves, stabilization

• Exhaustion 2014, conditions del paquete v1

• Inventario básico, attunement básico

## **3.2 No Soportado en v1**

• Multiclassing, feats

• Encumbrance bloqueante, flanking opcional

• Variant human con feat inicial

• Weapon mastery, bastions

• Legacy/hybrid mode, reglas 2024

• Homebrew generativo automático

# **4\. Reglas de Creación de Personaje**

## **4.1 Flujo del Wizard**

1\. Nombre y concepto narrativo → 2\. Race → 3\. Class → 4\. Background → 5\. Ability scores → 6\. Equipo inicial → 7\. Revisión final → 8\. Creación de campaña

## **4.2 Métodos de Ability Scores**

| Método | Estado |
| :---- | :---- |
| standard\_array | Permitido (15, 14, 13, 12, 10, 8\) |
| point\_buy | Permitido (27 puntos) |
| rolled\_stats | PROHIBIDO en v1 |

## **4.3 Feats y Multiclassing**

Las feats están DESACTIVADAS en v1. Si una opción intenta ofrecer una feat, el sistema debe marcarla como not\_supported\_in\_v1.

Multiclassing PROHIBIDO en v1. class\_key es único. No debe existir UI para añadir segunda clase.

# **5\. Ability Checks, Saves y Attacks**

## **5.1 Servicios Requeridos**

El proyecto debe incluir funciones equivalentes a:

• resolveAbilityCheck() • resolveSavingThrow() • resolveAttackRoll() • resolveDamageRoll()

## **5.2 Advantage / Disadvantage**

Debe existir soporte nativo para ventaja y desventaja. No deben apilarse múltiples fuentes. Si coinciden al menos una ventaja y una desventaja, se cancelan.

## **5.3 Critical Hits**

Un 20 natural en tirada de ataque es crítico. Un 1 natural es fallo automático.

El daño crítico debe duplicar los dados de daño, NO el modificador fijo.

# **6\. Reglas de Combate**

## **6.1 Estados de Combate**

El motor debe soportar: not\_in\_combat, rolling\_initiative, round\_active, turn\_active, reaction\_window, combat\_resolved

## **6.2 Estado por Combatiente**

Cada combatiente debe almacenar: initiative, current\_hp, temp\_hp, speed, movement\_remaining, action\_used, bonus\_action\_used, reaction\_used, concentration\_effect\_id, conditions, position, cover\_level, is\_hidden

## **6.3 Economía de Turno**

Por turno: 1 action, 1 bonus action (si dispone de opción válida), movement hasta velocidad restante, 1 reaction por round fuera de su turno.

## **6.4 Acciones Soportadas en v1**

attack, cast\_spell, dash, disengage, dodge, help, hide, ready, search, use\_object

## **6.5 Cover**

| Nivel | Efecto |
| :---- | :---- |
| none | Sin modificador |
| half | \+2 AC y DEX saves |
| three\_quarters | \+5 AC y DEX saves |
| total | No puede ser objetivo directo |

## **6.6 Grid Movement**

Cada casilla mide 5 ft. La diagonal cuesta 5 ft en v1. No habrá reglas avanzadas de verticalidad en v1.

# **7\. Conditions**

## **7.1 Condiciones Obligatorias**

blinded, charmed, deafened, frightened, grappled, incapacitated, invisible, paralyzed, petrified, poisoned, prone, restrained, stunned, unconscious, exhaustion

## **7.2 Representación de Condición**

Cada instancia debe incluir: condition\_key, source\_type, source\_ref, applied\_at, duration\_type, duration\_value, removal\_trigger, notes

## **7.3 Exhaustion**

Se usa exhaustion 2014\. Debe almacenarse como nivel entero. Sus efectos deben venir de tabla interna versionada.

# **8\. HP, Daño, Curación, 0 HP y Muerte**

## **8.1 Modelo de HP**

El sistema debe distinguir: max\_hp, current\_hp, temp\_hp

## **8.2 Orden de Aplicación de Daño**

1\. El daño reduce temp HP primero → 2\. El daño restante reduce current HP → 3\. Si current HP llega a 0, se activan reglas de 0 HP

## **8.3 Death Saves**

| Resultado | Efecto |
| :---- | :---- |
| 10+ en d20 | 1 éxito |
| 9- en d20 | 1 fallo |
| 1 natural | 2 fallos |
| 20 natural | Recuperación a 1 HP |
| 3 éxitos | Stable |
| 3 fallos | Dead |

# **9\. Reglas de Spellcasting**

## **9.1 Campos Requeridos de Spell**

spell\_key, name, level, school, casting\_time, range, components, duration, requires\_concentration, is\_ritual, attack\_type, save\_ability, effect\_payload, source

## **9.2 Estado de Spellcasting del Personaje**

spellcasting\_ability, spell\_save\_dc, spell\_attack\_bonus, spell\_slots\_total\_json, spell\_slots\_used\_json, spells\_known\_json, spells\_prepared\_json, always\_prepared\_spells\_json, concentration\_effect\_id

## **9.3 Checklist de Validación de Casting**

Antes de resolver un spell, validar: spell conocido/preparado, spell soportado por compendium, slot disponible, action type disponible, objetivo válido, rango válido, línea de visión, compatibilidad con concentración, estado del lanzador compatible

## **9.4 Concentración**

Un solo efecto de concentración por criatura. Nuevo spell de concentración reemplaza el anterior. Al recibir daño: check de concentración. Al quedar incapacitado: concentración se rompe.

# **10\. Descansos y Recuperación**

## **10.1 Short Rest**

Debe existir takeShortRest() con soporte para: gasto de hit dice, recuperación de recursos de clase para short rest, persistencia del evento en sesión y diario.

## **10.2 Long Rest**

Debe existir takeLongRest() con soporte para: recuperación de recursos de long rest, recuperación de spell slots, recuperación de HP según regla 2014, actualización de tiempo/ciclo de campaña.

# **11\. Inventario y Attunement**

## **11.1 Estados de Inventario**

backpack, equipped\_main\_hand, equipped\_off\_hand, equipped\_armor, equipped\_shield, worn, stowed, attuned

## **11.2 Attunement**

Máximo 3 items attuned. Si un item requiere attunement, su activación debe estar bloqueada sin attunement.

## **11.3 Encumbrance**

El peso puede almacenarse. Encumbrance NO BLOQUEA gameplay en v1.

# **12\. Contrato de AI Tooling**

## **12.1 Operaciones Obligatorias**

La capa IA debe poder invocar: check\_mechanic, roll\_dice, resolve\_attack, resolve\_save, cast\_spell, apply\_state\_change, start\_combat, advance\_combat\_turn, search\_memory, get\_spell\_info, get\_monster\_info, get\_item\_info

## **12.2 Limitaciones Narrativas**

**La narración PUEDE:**

• Describir, dramatizar, resumir, proponer acciones, presentar consecuencias ya resueltas

**La narración NO PUEDE:**

• Cambiar HP, cambiar slots, aplicar condición, decidir éxito mecánico, alterar initiative order, saltarse death saves

# **13\. Requisitos de Testing**

Debe haber tests para: ventaja/desventaja, crítico y fallo natural, damage application con temp HP, 0 HP y unconscious, death saves, concentración, gasto de slots, rests, attunement, initiative ordering, condiciones

# **14\. Defaults de Implementación**

| Setting | Valor |
| :---- | :---- |
| ruleset | 5e\_2014\_srd |
| hybrid\_mode | false |
| feats\_enabled | false |
| multiclassing\_enabled | false |
| encumbrance\_enabled | false |
| diagonal\_cost\_mode | 5ft\_flat |
| allowed\_stat\_methods | standard\_array, point\_buy |
| concentration\_mode | strict\_single\_effect |
| unsupported\_content\_policy | block\_or\_label |

**PARTE II**

**ESPECIFICACIONES MECÁNICAS DETALLADAS**

Esta sección contiene los datos exactos, fórmulas y tablas que el agente de código necesita para implementar el motor de reglas.

# **15\. Cálculo de Armor Class**

## **15.1 Fórmulas de AC por Tipo de Armadura**

| Categoría | Fórmula AC | Restricciones |
| :---- | :---- | :---- |
| Sin armadura | 10 \+ DEX mod | — |
| Ligera | Base \+ DEX mod completo | Padded=11, Leather=11, Studded=12 |
| Media | Base \+ DEX mod (máx \+2) | Hide=12, Chain Shirt=13, Scale=14, Breastplate=14, Half Plate=15 |
| Pesada | Base fijo (sin DEX) | Ring=14, Chain=16, Splint=17, Plate=18 |
| Escudo | \+2 al AC actual | Se suma a cualquier armadura |

## **15.2 Requisitos de Fuerza (Armadura Pesada)**

Chain Mail: STR 13 | Splint: STR 15 | Plate: STR 15

Si no se cumple el requisito: velocidad reducida en 10 pies.

## **15.3 Desventaja en Stealth**

Padded, Scale Mail, Half Plate, y TODA armadura pesada imponen desventaja en Stealth.

## **15.4 Tiempos de Poner/Quitar**

| Tipo | Poner | Quitar |
| :---- | :---- | :---- |
| Ligera | 1 minuto | 1 minuto |
| Media | 5 minutos | 1 minuto |
| Pesada | 10 minutos | 5 minutos |
| Escudo | 1 acción | 1 acción |

## **15.5 AC Sin Armadura Especial por Clase**

Barbarian: 10 \+ DEX mod \+ CON mod

Monk: 10 \+ DEX mod \+ WIS mod

Draconic Bloodline Sorcerer (nivel 1): 13 \+ DEX mod

# **16\. Razas del SRD 2014**

## **16.1 Dwarf**

Ability Scores: CON \+2 | Velocidad: 25 pies (no reducida por armadura pesada)

Darkvision: 60 ft | Dwarven Resilience: Resistencia a veneno \+ ventaja en saves contra veneno

Proficiencias: battleaxe, handaxe, light hammer, warhammer

Stonecunning: Doble proficiency en History checks sobre trabajo en piedra

**Hill Dwarf (SRD subrace): WIS \+1, \+1 HP por nivel**

## **16.2 Elf**

Ability Scores: DEX \+2 | Velocidad: 30 pies

Darkvision: 60 ft | Proficiencia: Perception

Fey Ancestry: Ventaja contra charm, inmunidad mágica a sleep

Trance: 4 horas de meditación \= 8 horas de descanso

**High Elf (SRD subrace): INT \+1, 1 cantrip de wizard, proficiencia con longsword/shortsword/shortbow/longbow**

## **16.3 Halfling**

Ability Scores: DEX \+2 | Velocidad: 25 pies | Tamaño: Small

Lucky: Reroll en 1 natural en attack rolls, ability checks, saving throws

Brave: Ventaja en saves contra frightened

Halfling Nimbleness: Puede moverse a través del espacio de criaturas más grandes

**Lightfoot (SRD subrace): CHA \+1, Naturally Stealthy (puede esconderse detrás de criaturas Medium+)**

## **16.4 Human**

Ability Scores: \+1 a TODAS las ability scores | Velocidad: 30 pies

Sin traits adicionales en SRD.

## **16.5 Dragonborn**

Ability Scores: STR \+2, CHA \+1 | Velocidad: 30 pies

Breath Weapon: DC \= 8 \+ CON mod \+ proficiency bonus

Daño escala: 2d6 (nivel 1\) → 3d6 (nivel 6\) → 4d6 (nivel 11\) → 5d6 (nivel 16\)

Resistencia: Al tipo de daño del ancestro dracónico

| Dragón | Tipo Daño | Forma Aliento / Save |
| :---- | :---- | :---- |
| Black | Acid | 5×30 ft línea / DEX |
| Blue | Lightning | 5×30 ft línea / DEX |
| Brass | Fire | 5×30 ft línea / DEX |
| Bronze | Lightning | 5×30 ft línea / DEX |
| Copper | Acid | 5×30 ft línea / DEX |
| Gold | Fire | 15 ft cono / DEX |
| Green | Poison | 15 ft cono / CON |
| Red | Fire | 15 ft cono / DEX |
| Silver | Cold | 15 ft cono / CON |
| White | Cold | 15 ft cono / CON |

## **16.6 Gnome**

Ability Scores: INT \+2 | Velocidad: 25 pies | Tamaño: Small

Darkvision: 60 ft

Gnome Cunning: Ventaja en TODOS los saves INT/WIS/CHA contra magia

**Rock Gnome (SRD subrace): CON \+1, Artificer's Lore, Tinker**

## **16.7 Half-Elf**

Ability Scores: CHA \+2, más \+1 a dos abilities diferentes a elección

Velocidad: 30 pies | Darkvision: 60 ft

Fey Ancestry: Ventaja contra charm, inmunidad mágica a sleep

Skill Versatility: Proficiencia en 2 skills a elección

## **16.8 Half-Orc**

Ability Scores: STR \+2, CON \+1 | Velocidad: 30 pies | Darkvision: 60 ft

Menacing: Proficiencia en Intimidation

Relentless Endurance: 1/long rest, caer a 1 HP en vez de 0

Savage Attacks: En crítico melee, añadir un dado de daño del arma extra

## **16.9 Tiefling**

Ability Scores: INT \+1, CHA \+2 | Velocidad: 30 pies | Darkvision: 60 ft

Hellish Resistance: Resistencia a daño de fuego

Infernal Legacy: thaumaturgy cantrip a nivel 1, hellish rebuke (2nd-level) a nivel 3, darkness a nivel 5 (CHA para spellcasting)

# **17\. Clases del SRD 2014**

## **17.1 Hit Dice por Clase**

| Hit Die | Clases |
| :---- | :---- |
| d12 | Barbarian |
| d10 | Fighter, Paladin, Ranger |
| d8 | Bard, Cleric, Druid, Monk, Rogue, Warlock |
| d6 | Sorcerer, Wizard |

## **17.2 Saving Throw Proficiencies**

| Clase | Saving Throws |
| :---- | :---- |
| Barbarian | STR, CON |
| Bard | DEX, CHA |
| Cleric | WIS, CHA |
| Druid | INT, WIS |
| Fighter | STR, CON |
| Monk | STR, DEX |
| Paladin | WIS, CHA |
| Ranger | STR, DEX |
| Rogue | DEX, INT |
| Sorcerer | CON, CHA |
| Warlock | WIS, CHA |
| Wizard | INT, WIS |

## **17.3 Niveles de ASI (Ability Score Improvement)**

Mayoría de clases: niveles 4, 8, 12, 16, 19

Fighter: niveles 4, 6, 8, 12, 14, 16, 19 (7 ASIs total)

Rogue: niveles 4, 8, 10, 12, 16, 19 (6 ASIs total)

Cada ASI: \+2 a una ability O \+1 a dos abilities (máximo 20\)

## **17.4 Subclases SRD (una por clase)**

| Clase | Subclase SRD |
| :---- | :---- |
| Barbarian | Path of the Berserker |
| Bard | College of Lore |
| Cleric | Life Domain |
| Druid | Circle of the Land |
| Fighter | Champion |
| Monk | Way of the Open Hand |
| Paladin | Oath of Devotion |
| Ranger | Hunter |
| Rogue | Thief |
| Sorcerer | Draconic Bloodline |
| Warlock | The Fiend |
| Wizard | School of Evocation |

# **18\. Spellcasting Detallado**

## **18.1 Fórmulas de Spell Save DC y Spell Attack**

Spell Save DC \= 8 \+ proficiency bonus \+ spellcasting ability modifier

Spell Attack Bonus \= proficiency bonus \+ spellcasting ability modifier

## **18.2 Fórmulas de Spells Preparados/Conocidos**

| Clase | Fórmula |
| :---- | :---- |
| Wizard | INT mod \+ Wizard level (de su spellbook) |
| Cleric | WIS mod \+ Cleric level (de toda la lista Cleric) |
| Druid | WIS mod \+ Druid level (de toda la lista Druid) |
| Paladin | CHA mod \+ ½ Paladin level (redondeado abajo) |
| Bard/Sorcerer/Ranger | Tabla fija de spells known por nivel |
| Warlock | Tabla fija de spells known por nivel |

## **18.3 Tabla de Spell Slots (Full Caster)**

Aplica a: Bard, Cleric, Druid, Sorcerer, Wizard

| Nivel | 1st/2nd/3rd | 4th/5th/6th/7th/8th/9th |
| :---- | :---- | :---- |
| 1 | 2/—/— | —/—/—/—/—/— |
| 2 | 3/—/— | —/—/—/—/—/— |
| 3 | 4/2/— | —/—/—/—/—/— |
| 4 | 4/3/— | —/—/—/—/—/— |
| 5 | 4/3/2 | —/—/—/—/—/— |
| 6 | 4/3/3 | —/—/—/—/—/— |
| 7 | 4/3/3 | 1/—/—/—/—/— |
| 8 | 4/3/3 | 2/—/—/—/—/— |
| 9 | 4/3/3 | 3/1/—/—/—/— |
| 10 | 4/3/3 | 3/2/—/—/—/— |
| 11 | 4/3/3 | 3/2/1/—/—/— |
| 12 | 4/3/3 | 3/2/1/—/—/— |
| 13 | 4/3/3 | 3/2/1/1/—/— |
| 14 | 4/3/3 | 3/2/1/1/—/— |
| 15 | 4/3/3 | 3/2/1/1/1/— |
| 16 | 4/3/3 | 3/2/1/1/1/— |
| 17 | 4/3/3 | 3/2/1/1/1/1 |
| 18 | 4/3/3 | 3/3/1/1/1/1 |
| 19 | 4/3/3 | 3/3/2/1/1/1 |
| 20 | 4/3/3 | 3/3/2/2/1/1 |

## **18.4 Half Casters (Paladin, Ranger)**

Spell slots comienzan a nivel 2\. Máximo nivel de spell: 5th.

Usar la tabla de slots de nivel (Paladin/Ranger level \- 1\) / 2, redondeado arriba.

## **18.5 Warlock Pact Magic**

Sistema DIFERENTE: 1-4 slots todos del mismo nivel, recargados en SHORT REST.

| Nivel Warlock | Slots | Nivel de Slot |
| :---- | :---- | :---- |
| 1 | 1 | 1st |
| 2 | 2 | 1st |
| 3-4 | 2 | 2nd |
| 5-6 | 2 | 3rd |
| 7-8 | 2 | 4th |
| 9-10 | 2 | 5th |
| 11-16 | 3 | 5th |
| 17-20 | 4 | 5th |

Mystic Arcanum (niveles 11+): 1 spell de 6th/7th/8th/9th, 1/long rest cada uno.

## **18.6 Concentración**

Save de CON con DC \= 10 o mitad del daño recibido (lo que sea MAYOR).

Save separado por cada fuente de daño en el mismo turno.

Solo 1 spell de concentración activo a la vez.

## **18.7 Cantrip Scaling**

Los cantrips escalan por nivel de PERSONAJE (no de clase):

Nivel 5: \+1 dado | Nivel 11: \+1 dado | Nivel 17: \+1 dado

Ejemplo: Fire Bolt \= 1d10 → 2d10 (5) → 3d10 (11) → 4d10 (17)

## **18.8 Ritual Casting**

\+10 minutos de casting time, sin gastar slot.

Wizard: No necesita tener el spell preparado (solo en spellbook).

Cleric/Druid: SÍ necesitan tenerlo preparado.

Bard: Debe conocerlo.

Paladin, Ranger, Sorcerer: NO tienen ritual casting.

# **19\. Acciones de Combate Detalladas**

## **19.1 Two-Weapon Fighting**

Ambas armas deben tener la propiedad Light.

Bonus action attack con la segunda arma.

NO se añade ability modifier al daño del off-hand (salvo Fighting Style).

Solo un ataque bonus, independiente de Extra Attack.

## **19.2 Grapple**

Reemplaza UN ataque dentro del Attack action.

Contest: Tu Athletics vs Athletics o Acrobatics del target (target elige).

Requisitos: mano libre, target máximo 1 tamaño mayor que tú.

Éxito: velocidad del target \= 0\.

Mover target: tu velocidad a la mitad.

Escapar: action del target, mismo contest.

## **19.3 Shove**

Reemplaza UN ataque dentro del Attack action.

Mismo contest que grapple.

Opciones de éxito: tirar prone O empujar 5 pies.

## **19.4 Ready Action**

Declarar trigger \+ acción.

Usar reacción cuando ocurra el trigger.

Readying un spell: requiere concentración y gasta el slot aunque no se active.

## **19.5 Help Action**

Da ventaja al siguiente ability check o attack roll de un aliado.

El aliado debe actuar antes de tu próximo turno.

Para ataques: debes estar a 5 pies del enemigo.

## **19.6 Free Object Interaction**

Una interacción gratuita por turno (desenvainar, abrir puerta, etc.).

Segunda interacción con objeto en el mismo turno \= Use an Object action.

# **20\. Skills y Ability Checks**

## **20.1 Las 18 Skills**

| Ability | Skills | Notas |
| :---- | :---- | :---- |
| STR | Athletics | — |
| DEX | Acrobatics, Sleight of Hand, Stealth | — |
| INT | Arcana, History, Investigation, Nature, Religion | — |
| WIS | Animal Handling, Insight, Medicine, Perception, Survival | — |
| CHA | Deception, Intimidation, Performance, Persuasion | — |

## **20.2 Fórmulas de Skill Check**

Skill Check \= d20 \+ ability modifier \+ proficiency bonus (si proficiente)

Expertise (Rogue/Bard) \= doble proficiency bonus

Passive Check \= 10 \+ todos los modificadores (ventaja \+5, desventaja −5)

## **20.3 DCs Estándar**

| Dificultad | DC |
| :---- | :---- |
| Very Easy | 5 |
| Easy | 10 |
| Medium | 15 |
| Hard | 20 |
| Very Hard | 25 |
| Nearly Impossible | 30 |

## **20.4 Contests**

Ambos tiran, el mayor gana.

Empate \= statu quo (el defensor/situación actual prevalece).

## **20.5 Group Checks**

Si al menos la mitad del grupo tiene éxito, el grupo tiene éxito.

# **21\. Progresión y Level Up**

## **21.1 Tabla de XP**

| Nivel | XP Requerido | Prof Bonus |
| :---- | :---- | :---- |
| 1 | 0 | \+2 |
| 2 | 300 | \+2 |
| 3 | 900 | \+2 |
| 4 | 2,700 | \+2 |
| 5 | 6,500 | \+3 |
| 6 | 14,000 | \+3 |
| 7 | 23,000 | \+3 |
| 8 | 34,000 | \+3 |
| 9 | 48,000 | \+4 |
| 10 | 64,000 | \+4 |
| 11 | 85,000 | \+4 |
| 12 | 100,000 | \+4 |
| 13 | 120,000 | \+5 |
| 14 | 140,000 | \+5 |
| 15 | 165,000 | \+5 |
| 16 | 195,000 | \+5 |
| 17 | 225,000 | \+6 |
| 18 | 265,000 | \+6 |
| 19 | 305,000 | \+6 |
| 20 | 355,000 | \+6 |

## **21.2 Fórmula de Proficiency Bonus**

Proficiency Bonus \= floor((level \- 1\) / 4\) \+ 2

Cambia en niveles 5, 9, 13, 17\.

## **21.3 Al Subir de Nivel**

1\. Añadir 1 hit die del tipo de la clase

2\. Calcular HP nuevo: roll del hit die \+ CON mod (o fixed: die/2 \+ 1 \+ CON mod)

3\. Desbloquear features de clase del nuevo nivel

4\. Actualizar spell slots si corresponde

5\. Verificar si cambia proficiency bonus

6\. Permitir nuevos spells known/prepared según clase

7\. Verificar si toca ASI

## **21.4 HP Retroactivo**

Si CON mod aumenta, HP max aumenta retroactivamente (+1 por nivel ya alcanzado).

# **22\. Armas y Propiedades**

## **22.1 Propiedades de Armas**

| Propiedad | Efecto |
| :---- | :---- |
| Ammunition | Requiere munición, carga una pieza por ataque |
| Finesse | Puede usar STR o DEX para ataque y daño |
| Heavy | Criaturas Small tienen desventaja |
| Light | Puede usarse para two-weapon fighting |
| Loading | Máximo 1 disparo por acción/bonus/reacción |
| Range | Dos números: normal/máximo con desventaja |
| Reach | \+5 pies al alcance (afecta opportunity attacks) |
| Special | Ver descripción específica del arma |
| Thrown | Puede lanzarse, usa mismo ability que melee |
| Two-Handed | Requiere dos manos para atacar |
| Versatile | Dado de daño mayor a dos manos |

## **22.2 Armas Simples Melee**

Club (1d4 B, Light), Dagger (1d4 P, Finesse/Light/Thrown), Greatclub (1d8 B, Two-Handed), Handaxe (1d6 S, Light/Thrown), Javelin (1d6 P, Thrown), Light Hammer (1d4 B, Light/Thrown), Mace (1d6 B), Quarterstaff (1d6 B, Versatile 1d8), Sickle (1d4 S, Light), Spear (1d6 P, Thrown/Versatile 1d8)

## **22.3 Armas Marciales Melee (selección)**

Longsword (1d8 S, Versatile 1d10), Greatsword (2d6 S, Heavy/Two-Handed), Rapier (1d8 P, Finesse), Shortsword (1d6 P, Finesse/Light), Battleaxe (1d8 S, Versatile 1d10), Greataxe (1d12 S, Heavy/Two-Handed), Warhammer (1d8 B, Versatile 1d10)

# **23\. Tipos de Daño**

## **23.1 Los 13 Tipos de Daño**

Acid, Bludgeoning, Cold, Fire, Force, Lightning, Necrotic, Piercing, Poison, Psychic, Radiant, Slashing, Thunder

## **23.2 Orden de Operaciones de Daño**

1\. Aplicar todos los modificadores al daño base

2\. Si hay resistencia: dividir entre 2 (redondear abajo)

3\. Si hay vulnerabilidad: multiplicar por 2

Múltiples instancias del mismo tipo cuentan como una.

## **23.3 Instant Death**

Si el daño restante tras llegar a 0 HP iguala o supera HP máximo \= muerte instantánea.

# **24\. Vision y Lighting**

## **24.1 Niveles de Luz**

| Nivel | Efecto |
| :---- | :---- |
| Bright light | Visión normal |
| Dim light | Lightly obscured \= desventaja en Perception basada en vista |
| Darkness | Heavily obscured \= efectivamente Blinded |

## **24.2 Darkvision**

Razas con Darkvision 60ft: Dwarf, Elf, Gnome, Half-Elf, Half-Orc, Tiefling

Ve en darkness como dim light (escala de grises).

Ve en dim light como bright light.

NO elimina desventaja en Perception por oscuridad — solo reduce heavily obscured a lightly obscured.

# **25\. Background SRD**

## **25.1 Acolyte (único background en SRD)**

Skill Proficiencies: Insight, Religion

Languages: 2 idiomas a elección

Equipment: Holy symbol, prayer book/wheel, 5 sticks incense, vestments, common clothes, 15 gp

Feature: Shelter of the Faithful — templos de tu fe proveen alojamiento y apoyo

# **26\. Reglas Ambientales**

## **26.1 Difficult Terrain**

Cada pie de movimiento cuesta 2 pies.

Ejemplos: escombros, vegetación densa, escaleras, espacio de otra criatura.

## **26.2 Trepar, Nadar, Arrastrarse**

Mismo coste extra que difficult terrain (1 pie cuesta 2 pies).

Se ignora con climbing/swimming speed.

## **26.3 Jumping**

Long jump con carrera: STR score en pies.

Long jump standing: mitad.

High jump con carrera: 3 \+ STR mod pies.

High jump standing: mitad.

## **26.4 Falling**

1d6 bludgeoning por cada 10 pies, máximo 20d6.

Aterriza prone.

## **26.5 Suffocation**

Aguantar respiración: 1 \+ CON mod minutos (mínimo 30 segundos).

Sin aliento: CON mod rondas (mínimo 1).

Luego: 0 HP.

# **27\. Directiva Final para Claude Code**

*Si existe una duda entre: "hacerlo flexible", "hacerlo híbrido", "dejar que la IA lo resuelva", o "implementar una sola regla clara y testeable" — Claude Code debe elegir SIEMPRE la última opción.*

El objetivo de Dungeon Cortex v1 no es soportar todas las mesas posibles.

El objetivo es construir un AI-DM coherente, estable, testeable y legalista sobre D\&D 5e 2014 SRD.

Este documento contiene TODO lo que el agente de código necesita para implementar el motor de reglas sin improvisación.

**— FIN DEL DOCUMENTO —**