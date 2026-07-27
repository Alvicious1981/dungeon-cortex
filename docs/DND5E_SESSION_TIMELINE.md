---
title: "Línea temporal completa de una partida de Dungeons & Dragons 5e"
project: "Dungeon Cortex"
document_type: "Gameplay specification"
status: "Proposed"
rules_baseline: "D&D 5e / SRD 2014"
recommended_repository_path: "docs/DND5E_SESSION_TIMELINE.md"
codex_relevance: "Read for session flow, pacing, scene transitions, UI states, persistence checkpoints and AI/backend responsibility boundaries."
---

# Línea temporal completa de una partida de Dungeons & Dragons 5e

## 1. Propósito del documento

Este documento describe, de principio a fin, cómo puede desarrollarse una sesión completa de **Dungeons & Dragons 5e / SRD 2014** dentro de Dungeon Cortex.

Su objetivo es servir como referencia para:

- diseñar el bucle principal de juego;
- ordenar las escenas de una sesión;
- separar narración, reglas y persistencia;
- definir cambios de estado entre exploración, conversación, combate y descanso;
- diseñar una interfaz clara, especialmente en móvil;
- ayudar a Codex a comprender el comportamiento esperado antes de modificar la aplicación;
- crear pruebas de extremo a extremo que representen una partida completa.

La línea temporal no es un guion obligatorio. Una partida de rol puede cambiar de dirección por las decisiones de los jugadores. Por tanto, este documento define un **flujo de referencia flexible**, no una secuencia rígida.

---

## 2. Reglas de autoridad de Dungeon Cortex

Este documento debe interpretarse junto con las fuentes de autoridad del proyecto.

### 2.1. Autoridad mecánica

El backend o motor determinista es la única autoridad para:

- validar acciones;
- decidir si una acción es legal;
- seleccionar o calcular una Clase de Dificultad;
- realizar o aceptar tiradas;
- resolver ataques;
- calcular daño y curación;
- consumir acciones, reacciones, espacios de conjuro y objetos;
- aplicar o retirar condiciones;
- controlar puntos de golpe;
- determinar derrota, inconsciencia, muerte o estabilización;
- modificar inventario;
- generar y validar botín;
- actualizar misiones;
- otorgar experiencia, hitos o recompensas;
- guardar el estado oficial de la campaña.

### 2.2. Responsabilidad de la IA narradora

La IA puede:

- describir escenas;
- interpretar la intención escrita por el jugador;
- pedir una aclaración cuando la acción sea ambigua;
- presentar opciones;
- narrar resultados ya resueltos;
- interpretar voces y actitudes de PNJ;
- aportar detalles sensoriales;
- resumir acontecimientos;
- proponer recuerdos para que el motor los valide.

La IA no puede:

- inventar el resultado de una tirada;
- afirmar que un ataque impacta antes de la resolución;
- inventar daño, curación, objetos, experiencia o condiciones;
- decidir que una criatura muere;
- avanzar una misión por sí sola;
- modificar el estado canónico de la campaña;
- revelar información oculta no autorizada por el motor;
- decidir las acciones internas o emocionales del personaje jugador.

### 2.3. Regla de conflicto

Cuando exista una contradicción entre:

1. la narración;
2. una sugerencia de la IA;
3. el estado almacenado;
4. el resultado del motor;

siempre prevalece el resultado mecánico confirmado por el backend.

---

## 3. Modelo de sesión de referencia

La siguiente estructura representa una sesión típica de aproximadamente **4 horas reales**, pensada para:

- 3 a 5 personajes jugadores;
- una aventura autoconclusiva o un capítulo de campaña;
- una combinación de narración, interacción social, exploración y combate;
- uno o dos encuentros peligrosos;
- un cierre con consecuencias y guardado.

### 3.1. Duraciones orientativas

| Fase | Tiempo aproximado | Tipo principal |
|---|---:|---|
| 1. Preparación y recapitulación | 15 min | Preparación |
| 2. Presentación del conflicto | 30 min | Narración y conversación |
| 3. Investigación y planificación | 40 min | Social y exploración |
| 4. Viaje o entrada en la zona de peligro | 35 min | Exploración |
| 5. Pausa y revisión del estado | 10 min | Pausa |
| 6. Primer desafío importante | 45 min | Combate o desafío |
| 7. Revelación y decisión | 25 min | Narración, social y exploración |
| 8. Clímax | 50 min | Combate, negociación o desafío |
| 9. Epílogo y recompensas | 20 min | Resolución |
| **Duración total orientativa** | **4 h 30 min** | Sesión completa |

El ritmo puede comprimirse a unas 3 horas o ampliarse a 5 horas. La aplicación no debe depender de estos minutos para validar reglas; son una referencia de diseño y experiencia de usuario.

---

# 4. Línea temporal detallada

## Fase 1 — Preparación, bienvenida y recapitulación

**Tiempo orientativo:** 00:00–00:15
**Modo:** preparación de sesión
**Objetivo:** asegurar que todos comprenden el estado inicial.

### 4.1. Acciones del sistema

Antes de mostrar la primera escena, Dungeon Cortex debe cargar y comprobar:

- campaña activa;
- localización actual;
- personajes activos;
- puntos de golpe actuales y máximos;
- Clase de Armadura;
- condiciones;
- recursos consumibles;
- espacios de conjuro;
- dados de golpe disponibles;
- inventario;
- equipo equipado;
- misiones activas;
- PNJ relevantes;
- enemigos persistentes;
- recuerdos y decisiones importantes;
- último resumen de campaña.

### 4.2. Contenido visible para el jugador

La interfaz debe mostrar un resumen breve:

- dónde está el grupo;
- qué ocurrió en la sesión anterior;
- cuál es el objetivo actual;
- qué peligros o compromisos siguen activos;
- qué personajes o PNJ están presentes.

### 4.3. Responsabilidad de la IA

La IA puede redactar el resumen, pero solo a partir de datos persistidos.

Ejemplo seguro:

> La última vez, el grupo encontró ceniza negra junto al viejo molino y descubrió que Mara había oído cánticos bajo tierra. La entrada al santuario todavía no ha sido localizada.

### 4.4. Resultado esperado

La fase termina cuando:

- la campaña se ha cargado correctamente;
- el jugador conoce su situación;
- no existen inconsistencias críticas;
- la escena inicial puede comenzar.

### 4.5. Error posible

Si faltan datos esenciales, la aplicación debe mostrar un mensaje claro y conservar el último estado válido.

Ejemplo:

> No se ha podido reconstruir la escena porque falta la localización actual. La campaña no se modificará hasta resolver el problema.

---

## Fase 2 — Presentación del conflicto o gancho de aventura

**Tiempo orientativo:** 00:15–00:45
**Modo:** narración y conversación
**Objetivo:** presentar un problema concreto que requiera una decisión.

El conflicto puede aparecer mediante:

- un PNJ que solicita ayuda;
- una criatura que ataca;
- una desaparición;
- una pista;
- una amenaza ambiental;
- un objeto extraño;
- una misión ya activa que alcanza una nueva etapa;
- una consecuencia de decisiones anteriores.

### 4.6. Estructura recomendada de la escena

1. El sistema presenta la situación.
2. La IA añade ambiente y contexto permitido.
3. El jugador pregunta, observa o responde.
4. El motor determina si hace falta una prueba.
5. Si existe incertidumbre significativa, el motor resuelve la tirada.
6. La IA narra el resultado confirmado.
7. La interfaz presenta nuevas opciones.

### 4.7. Pruebas habituales

Según la intención del jugador, el motor puede resolver:

- Persuasión;
- Engaño;
- Intimidación;
- Intuición;
- Investigación;
- Historia;
- Religión;
- Arcana;
- Percepción.

No debe pedirse una tirada cuando:

- la acción es trivial;
- el resultado es evidente;
- no existe riesgo ni consecuencia;
- la información debe entregarse obligatoriamente para que la aventura continúe.

### 4.8. Fallo con progreso

Una prueba fallida no debería bloquear automáticamente toda la partida.

Alternativas seguras:

- información incompleta;
- información recibida a cambio de un coste;
- pérdida de tiempo;
- aumento del peligro;
- desconfianza de un PNJ;
- acceso a una ruta más difícil;
- una complicación adicional.

### 4.9. Resultado esperado

Al finalizar esta fase, el grupo debe conocer:

- el problema;
- el objetivo inmediato;
- al menos una ruta posible;
- una razón para actuar;
- los riesgos conocidos.

El motor puede crear o actualizar una misión, pero la IA no debe marcarla como activa o completada sin una operación validada.

---

## Fase 3 — Investigación, conversación y planificación

**Tiempo orientativo:** 00:45–01:25
**Modo:** social y exploración
**Objetivo:** conseguir pistas y elegir un enfoque.

### 4.10. Acciones posibles del jugador

- interrogar a un testigo;
- examinar un objeto;
- buscar documentos;
- consultar conocimientos;
- estudiar un mapa;
- seguir huellas;
- pedir ayuda;
- comprar suministros;
- preparar conjuros o equipo;
- dividir tareas;
- crear una estrategia.

### 4.11. Pistas

Las pistas deben clasificarse, al menos conceptualmente, como:

- **esenciales:** necesarias para avanzar;
- **opcionales:** aportan contexto o ventaja;
- **secretas:** requieren descubrimiento válido;
- **engañosas:** deben estar justificadas por el mundo, no usarse arbitrariamente;
- **confirmadas:** ya forman parte del estado conocido;
- **sospechas:** todavía no son hechos.

La interfaz debe distinguir entre un hecho confirmado y una interpretación del jugador.

### 4.12. Información oculta

La IA no puede revelar:

- trampas no detectadas;
- enemigos ocultos;
- tesoros secretos;
- debilidades no descubiertas;
- motivaciones reales de un PNJ;
- habitaciones no exploradas.

Sí puede narrar señales autorizadas por el motor:

- un ruido;
- una corriente de aire;
- olor a humo;
- huellas;
- una expresión nerviosa;
- marcas en una pared.

### 4.13. Plan del grupo

El sistema debe permitir que el jugador elija un enfoque, por ejemplo:

- infiltración;
- negociación;
- ataque frontal;
- distracción;
- investigación adicional;
- ruta alternativa.

El plan no garantiza el éxito. Sirve para orientar futuras acciones y conservar intención narrativa.

### 4.14. Resultado esperado

El grupo debería obtener:

- una ruta viable;
- una advertencia;
- una ventaja potencial;
- una decisión sobre cómo proceder;
- una actualización del diario o de la memoria si se descubrió algo relevante.

---

## Fase 4 — Viaje, desplazamiento o entrada en la zona de peligro

**Tiempo orientativo:** 01:25–02:00
**Modo:** exploración
**Objetivo:** transformar el plan en acciones dentro de un entorno con riesgos.

### 4.15. Elementos de exploración

La escena puede incluir:

- rutas;
- puertas;
- corredores;
- terreno difícil;
- obstáculos;
- iluminación;
- trampas;
- mecanismos;
- patrullas;
- sonidos;
- rastros;
- zonas de cobertura;
- caminos alternativos;
- recursos limitados.

### 4.16. Bucle de exploración

1. El motor informa del estado observable.
2. La IA lo describe sin revelar datos ocultos.
3. El jugador declara una intención.
4. El motor valida alcance, recursos y contexto.
5. El motor decide si hace falta una prueba.
6. Se resuelve el resultado.
7. Se actualizan posición, tiempo, recursos y memoria.
8. La IA narra la consecuencia.
9. Se presentan nuevas opciones.

### 4.17. Pruebas habituales

- Percepción;
- Investigación;
- Supervivencia;
- Sigilo;
- Atletismo;
- Acrobacias;
- herramientas de ladrón;
- pruebas de característica asociadas a herramientas u objetos.

### 4.18. Consecuencias de fallo

Un fallo puede producir:

- ruido;
- pérdida de tiempo;
- daño validado;
- consumo de recursos;
- separación del grupo;
- activación de una trampa;
- posición desfavorable;
- alerta de enemigos;
- acceso a una ruta peor.

Nunca debe producir consecuencias mecánicas inventadas por la narración.

### 4.19. Resultado esperado

La fase termina cuando el grupo:

- alcanza el área principal;
- activa un encuentro;
- descubre una nueva escena;
- decide retirarse;
- encuentra una ruta alternativa;
- necesita descansar.

---

## Fase 5 — Pausa real y posible descanso dentro de la ficción

**Tiempo orientativo:** 02:00–02:10
**Modo:** revisión
**Objetivo:** reducir fatiga real y revisar el estado del grupo.

La pausa fuera del juego no equivale automáticamente a un descanso mecánico.

### 4.20. Descanso corto

En D&D 5e/SRD 2014, un descanso corto requiere normalmente al menos una hora dentro de la ficción.

El motor debe validar:

- duración;
- seguridad del lugar;
- interrupciones;
- dados de golpe disponibles;
- capacidades que se recuperan;
- efectos que permanecen.

### 4.21. Descanso largo

Un descanso largo requiere normalmente al menos ocho horas dentro de la ficción y está sujeto a las reglas implementadas por el proyecto.

El motor debe decidir:

- si el descanso es válido;
- qué recursos se recuperan;
- si existe una interrupción;
- si las condiciones permiten descansar;
- cómo afecta al tiempo de campaña.

### 4.22. Revisión del estado

La interfaz puede mostrar:

- puntos de golpe;
- dados de golpe;
- espacios de conjuro;
- consumibles;
- condiciones;
- misión activa;
- peligros conocidos;
- objetivo inmediato.

---

## Fase 6 — Primer enfrentamiento o desafío importante

**Tiempo orientativo:** 02:10–02:55
**Modo:** combate, persecución o desafío
**Objetivo:** poner a prueba el plan y consumir recursos.

El primer desafío no tiene que ser un combate. Puede ser:

- una persecución;
- una trampa compleja;
- un ritual que debe detenerse;
- una negociación peligrosa;
- una infiltración;
- una defensa por turnos;
- un rescate.

---

# 5. Subflujo completo de combate

## 5.1. Inicio del combate

El combate comienza cuando el backend confirma que existe una amenaza activa y crea un encuentro.

Datos mínimos:

- participantes;
- facciones;
- puntos de golpe;
- Clase de Armadura;
- posición o distancia;
- condiciones;
- velocidad;
- recursos;
- acciones disponibles;
- iniciativa.

## 5.2. Iniciativa

Cada participante realiza una tirada de iniciativa según las reglas implementadas, normalmente:

- d20;
- modificador de Destreza;
- modificadores adicionales válidos.

El backend ordena los turnos y resuelve empates conforme a la política del proyecto.

## 5.3. Inicio de turno

Al comenzar un turno, el motor debe:

- identificar al participante activo;
- aplicar efectos de inicio de turno;
- comprobar condiciones;
- actualizar recursos temporales;
- habilitar acciones legales;
- informar a la interfaz.

## 5.4. Decisión del jugador

El jugador expresa una intención:

- atacar;
- lanzar un conjuro;
- usar un objeto;
- ayudar;
- esconderse;
- correr;
- retirarse;
- empujar;
- agarrar;
- preparar una acción;
- interactuar con el escenario.

La intención debe transformarse en una acción estructurada y validable.

## 5.5. Validación

Antes de resolver, el backend comprueba:

- que es el turno correcto;
- que el personaje puede actuar;
- que tiene el arma, conjuro u objeto;
- que el objetivo existe;
- que el objetivo es válido;
- que está dentro del alcance;
- que hay línea de visión si corresponde;
- que existe movimiento suficiente;
- que la acción no ha sido consumida;
- que se cumplen componentes y recursos;
- que las condiciones no lo impiden.

## 5.6. Economía de acciones

En una estructura estándar de D&D 5e, un turno puede incluir:

- movimiento hasta la velocidad disponible;
- una acción;
- una acción adicional únicamente cuando una regla o capacidad la permite;
- interacción limitada con objetos según la implementación;
- una reacción fuera del turno cuando se activa un desencadenante válido.

El motor debe registrar el consumo. La IA no puede conceder acciones extra.

## 5.7. Resolución de ataque

Flujo recomendado:

1. Validar atacante, arma y objetivo.
2. Resolver ventaja o desventaja.
3. Tirar d20.
4. Añadir modificadores válidos.
5. Comparar con la Clase de Armadura.
6. Determinar impacto o fallo.
7. Resolver crítico cuando corresponda.
8. Tirar daño si impacta.
9. Aplicar resistencias, inmunidades o vulnerabilidades.
10. Restar puntos de golpe.
11. Resolver condiciones adicionales.
12. Determinar estado de derrota o supervivencia.
13. Emitir un evento mecánico.
14. Solicitar narración.

## 5.8. Conjuros y salvaciones

El backend debe comprobar:

- conjuro conocido o preparado;
- espacio disponible;
- tiempo de lanzamiento;
- alcance;
- componentes;
- concentración;
- objetivos;
- área de efecto;
- tirada de ataque o salvación;
- CD;
- daño, curación o condición;
- duración;
- consumo de recursos.

La IA solo narra el resultado devuelto.

## 5.9. Cero puntos de golpe

El estado a 0 puntos de golpe depende del tipo de criatura y de las reglas implementadas.

Para personajes jugadores, el backend debe gestionar correctamente:

- inconsciencia;
- tiradas de salvación contra muerte;
- estabilización;
- curación;
- daño recibido a 0 PG;
- muerte instantánea cuando proceda.

Para monstruos y PNJ, el backend determina derrota, muerte, inconsciencia o captura según las reglas y decisiones autorizadas.

La narración nunca debe declarar una muerte sin el estado confirmado.

## 5.10. Fin de turno

El backend:

- aplica efectos de fin de turno;
- actualiza duraciones;
- registra eventos;
- pasa al siguiente participante;
- guarda un punto de recuperación cuando corresponda.

## 5.11. Fin del combate

El encuentro termina cuando el backend confirma una condición, por ejemplo:

- todos los enemigos han sido derrotados;
- el grupo ha sido derrotado;
- un bando huye;
- se cumple un objetivo alternativo;
- se completa una negociación;
- se destruye o protege un objeto;
- termina el número requerido de asaltos.

## 5.12. Narración posterior

La IA puede describir:

- el silencio tras el combate;
- heridas visibles coherentes;
- reacciones de PNJ;
- cambios ambientales;
- consecuencias confirmadas.

No puede inventar:

- botín;
- experiencia;
- objetos mágicos;
- supervivientes;
- refuerzos;
- final de misión.

---

## Fase 7 — Revelación, giro y decisión significativa

**Tiempo orientativo:** 02:55–03:20
**Modo:** narración, conversación y exploración
**Objetivo:** cambiar el significado del conflicto y preparar el clímax.

Ejemplos:

- el villano no es el responsable principal;
- el objeto buscado está maldito;
- el supuesto monstruo protege algo;
- un aliado ha ocultado información;
- destruir el objetivo tendrá un coste;
- existen dos objetivos incompatibles;
- el tiempo se está agotando.

### 7.1. Requisitos del giro

La revelación debe:

- estar apoyada por pistas o acontecimientos;
- respetar la memoria;
- no contradecir el estado;
- no quitar agencia al jugador;
- generar una decisión comprensible.

### 7.2. Opciones

La interfaz debe presentar opciones como sugerencias, no límites absolutos.

Ejemplo:

- negociar con el guardián;
- destruir el foco del ritual;
- rescatar a los cautivos;
- buscar otra salida;
- intentar una acción libre.

### 7.3. Consecuencias acumuladas

El sistema debe considerar decisiones anteriores:

- PNJ ayudados;
- alarmas activadas;
- rutas descubiertas;
- recursos gastados;
- promesas;
- enemigos alertados;
- objetos obtenidos;
- tiempo consumido.

---

## Fase 8 — Clímax

**Tiempo orientativo:** 03:20–04:10
**Modo:** combate, negociación o desafío compuesto
**Objetivo:** resolver el conflicto central de la sesión.

El clímax debe permitir más de una forma de éxito cuando la ficción lo admita.

### 8.1. Posibles objetivos

- derrotar a un enemigo;
- impedir un ritual;
- sobrevivir cierto número de asaltos;
- escapar;
- rescatar a un PNJ;
- proteger un objeto;
- cerrar un portal;
- convencer a un adversario;
- elegir entre dos consecuencias.

### 8.2. Escenario dinámico

El entorno puede cambiar por eventos validados:

- derrumbes;
- fuego;
- zonas peligrosas;
- refuerzos ya definidos;
- cuenta atrás;
- objetivos secundarios;
- cambios de fase de un jefe.

Cada cambio debe generarse mediante estado y eventos del backend antes de narrarse.

### 8.3. Derrota y éxito parcial

La derrota no siempre debe finalizar la campaña.

Posibles resoluciones:

- captura;
- retirada;
- pérdida de un objetivo;
- daño a una facción;
- misión fallida;
- victoria con coste;
- nueva deuda;
- cambio de localización.

La consecuencia debe ser explícita y persistirse.

---

## Fase 9 — Epílogo, consecuencias, recompensas y cierre

**Tiempo orientativo:** 04:10–04:30
**Modo:** resolución
**Objetivo:** cerrar la sesión sin perder información importante.

### 9.1. Consecuencias

El backend debe actualizar:

- estado de la misión;
- objetivos;
- PNJ;
- relaciones;
- localizaciones;
- enemigos;
- inventario;
- experiencia o hitos;
- recompensas;
- tiempo de campaña;
- condiciones;
- recuerdos.

### 9.2. Botín

El botín debe ser generado o validado por el motor.

Secuencia:

1. El motor determina qué objetos existen.
2. El motor crea identificadores y cantidades.
3. El jugador decide qué recoger.
4. El motor valida y actualiza inventario.
5. La IA describe los objetos confirmados.

### 9.3. Experiencia y subida de nivel

El proyecto debe usar únicamente la política de avance implementada:

- experiencia;
- hitos;
- otro método documentado compatible.

La IA no puede declarar una subida de nivel antes de que el backend la confirme.

### 9.4. Resumen de sesión

Debe incluir:

- objetivo inicial;
- decisiones principales;
- escenas superadas;
- resultado del clímax;
- recompensas confirmadas;
- misiones modificadas;
- PNJ afectados;
- localización final;
- estado del grupo;
- siguiente objetivo.

### 9.5. Guardado final

El sistema debe:

- completar la transacción de estado;
- registrar eventos;
- generar un resumen;
- crear recuerdos relevantes;
- conservar el historial mecánico;
- permitir reanudar desde un punto claro.

---

# 6. Bucle universal de una escena

Toda escena de Dungeon Cortex puede representarse mediante este ciclo:

1. **Estado observable**
   El motor proporciona hechos visibles y contexto permitido.

2. **Descripción**
   La IA convierte esos hechos en una narración clara.

3. **Intención**
   El jugador declara qué quiere hacer.

4. **Interpretación**
   La intención se transforma en una acción estructurada o se solicita una aclaración mínima.

5. **Validación**
   El motor comprueba legalidad, objetivos, recursos y condiciones.

6. **Resolución**
   Si existe incertidumbre relevante, el motor resuelve tiradas y consecuencias.

7. **Actualización**
   Se actualiza el estado canónico.

8. **Evento**
   Se emite un registro mecánico determinista.

9. **Narración del resultado**
   La IA describe únicamente los hechos confirmados.

10. **Persistencia**
    Se guardan cambios importantes.

11. **Nuevas opciones**
    La interfaz presenta acciones posibles y mantiene entrada libre.

Este ciclo se repite durante exploración, conversación, combate, descanso, inventario y resolución de misiones.

---

# 7. Transiciones de modo

Dungeon Cortex debe gestionar de forma explícita los cambios entre modos.

## 7.1. Exploración → combate

Se produce cuando:

- el backend detecta una amenaza;
- se confirma hostilidad;
- se crea un encuentro;
- se cargan participantes;
- se inicia iniciativa.

## 7.2. Combate → exploración

Se produce cuando:

- termina el encuentro;
- se aplican consecuencias;
- se actualiza el estado;
- se habilita interacción con la escena.

## 7.3. Exploración → conversación

Se produce cuando:

- el jugador inicia diálogo;
- existe un PNJ válido;
- el PNJ puede responder;
- se carga su actitud y memoria.

## 7.4. Cualquier modo → inventario

La apertura del inventario no debe cambiar mecánicas por sí sola.

Usar, equipar, entregar o soltar objetos sí requiere validación.

## 7.5. Exploración → descanso

El sistema debe comprobar:

- lugar;
- seguridad;
- tiempo;
- interrupciones;
- reglas de recuperación.

## 7.6. Resolución → nueva escena

Después de una consecuencia importante:

- persistir;
- resumir;
- determinar localización;
- presentar el siguiente problema;
- evitar avanzar demasiado sin decisión del jugador.

---

# 8. Puntos de guardado recomendados

La campaña debe guardarse después de:

- cargar y normalizar una campaña;
- aceptar una misión;
- descubrir una pista esencial;
- cambiar de localización;
- modificar inventario;
- gastar un recurso importante;
- aplicar daño o curación;
- cambiar una condición;
- terminar un turno;
- terminar un combate;
- completar o fallar una misión;
- recibir una recompensa;
- realizar un descanso;
- cerrar la sesión.

Para evitar estados parciales, las operaciones relacionadas deben agruparse en transacciones cuando corresponda.

---

# 9. Requisitos de interfaz para móvil

La línea temporal debe reflejarse en una interfaz legible en pantallas pequeñas.

## 9.1. Prioridad visual

Orden recomendado:

1. narración actual;
2. acción o pregunta pendiente;
3. opciones rápidas;
4. personaje activo;
5. recursos esenciales;
6. registro reciente;
7. accesos secundarios.

## 9.2. Elementos recomendados

- tarjetas verticales;
- texto de tamaño legible;
- botones grandes;
- paneles plegables;
- barra de acciones fija o fácilmente accesible;
- indicador claro del modo actual;
- indicador de turno;
- puntos de golpe visibles en combate;
- filtros para el registro;
- avisos que no dependan solo del color;
- confirmación para acciones destructivas.

## 9.3. Registro narrativo

Cada entrada debería poder mostrar:

- tipo de evento;
- actor;
- objetivo;
- resultado;
- tirada cuando sea visible;
- cambio mecánico;
- narración;
- hora o número de escena.

## 9.4. Combate en móvil

Debe evitarse una tabla horizontal extensa.

Alternativa:

- una tarjeta por participante;
- orden de iniciativa vertical;
- personaje activo destacado;
- acciones agrupadas;
- objetivos seleccionables;
- detalle de tirada expandible.

---

# 10. Estados y eventos sugeridos

Esta sección no impone nombres técnicos definitivos, pero describe los conceptos que Codex debe buscar o modelar.

## 10.1. Estados de sesión

- `preparing`
- `narrative`
- `social`
- `exploration`
- `combat`
- `rest`
- `resolution`
- `paused`
- `completed`

## 10.2. Eventos relevantes

- `session_started`
- `scene_started`
- `player_intent_received`
- `action_validated`
- `action_rejected`
- `ability_check_resolved`
- `attack_resolved`
- `saving_throw_resolved`
- `damage_applied`
- `healing_applied`
- `condition_applied`
- `resource_consumed`
- `combat_started`
- `turn_started`
- `turn_ended`
- `combat_ended`
- `item_added`
- `item_removed`
- `quest_updated`
- `location_changed`
- `rest_completed`
- `memory_recorded`
- `session_summary_created`
- `session_ended`

Los nombres reales deben alinearse con la implementación existente. Codex debe inspeccionar los contratos actuales antes de crear otros nuevos.

---

# 11. Ejemplo completo: La capilla de ceniza

## 11.1. Inicio

El grupo reanuda la campaña junto al viejo molino.

Estado confirmado:

- Mara sigue viva;
- existe una misión activa;
- se encontró ceniza negra;
- la entrada subterránea no está localizada.

La IA resume sin añadir hechos.

## 11.2. Conflicto

Mara informa de que los cánticos han comenzado antes del anochecer.

El motor actualiza el objetivo:

> Encontrar la entrada bajo el molino antes de que termine el ritual.

## 11.3. Investigación

El jugador examina la maquinaria.

El backend decide que la acción requiere Investigación, resuelve la tirada y confirma que existe una palanca oculta.

La IA narra el descubrimiento.

## 11.4. Exploración

El grupo baja por un túnel y avanza con sigilo.

El backend resuelve una prueba y confirma que una patrulla no los detecta.

La IA describe pasos que se alejan, sin inventar enemigos adicionales.

## 11.5. Primer combate

El backend crea un encuentro con criaturas ya definidas.

Se resuelve iniciativa, turnos, ataques, daño y recursos.

La IA narra cada evento después de recibirlo.

## 11.6. Revelación

Tras el combate, una inscripción confirmada revela que el ritual mantiene sellada una entidad.

El jugador debe decidir:

- detener a los cultistas sin romper el sello;
- destruir el foco;
- negociar;
- retirarse.

## 11.7. Clímax

El grupo intenta detener al líder mientras protege tres anclajes.

El backend controla:

- asaltos;
- integridad de anclajes;
- enemigos;
- concentración;
- daño;
- objetivo alternativo.

## 11.8. Epílogo

El grupo gana, pero un anclaje queda destruido.

El backend registra:

- misión completada con coste;
- relación con Mara;
- nueva amenaza;
- objetos confirmados;
- recursos finales;
- siguiente objetivo.

La IA crea un epílogo coherente y un resumen.

---

# 12. Casos de error y recuperación

## 12.1. Acción ambigua

Entrada:

> Lo ataco.

Problema: existen varios objetivos.

Respuesta:

> Elige qué criatura quieres atacar.

No debe seleccionarse un objetivo arbitrario.

## 12.2. Acción imposible

Entrada:

> Uso una poción.

Problema: el personaje no tiene pociones.

Resultado:

- el motor rechaza;
- el inventario no cambia;
- la IA no inventa una poción.

## 12.3. Narración contradictoria

El motor indica que el enemigo conserva 3 PG, pero la IA afirma que muere.

Resultado:

- descartar o regenerar la parte contradictoria;
- conservar el estado;
- registrar el error;
- mostrar una narración segura.

## 12.4. Error de persistencia

Si falla el guardado:

- no afirmar que la operación terminó correctamente;
- conservar el último estado válido;
- evitar duplicar recompensas o consumo;
- informar con lenguaje comprensible;
- permitir reintento seguro.

## 12.5. Respuesta de IA inválida

Si la IA no respeta el contrato:

- no aplicar campos mecánicos;
- usar una respuesta de reserva;
- registrar el fallo;
- continuar desde el estado confirmado.

---

# 13. Criterios de aceptación

Una implementación de “partida completa” debe demostrar:

## Preparación

- carga consistente de campaña;
- resumen basado en datos;
- detección de estado incompleto.

## Narración

- la IA no inventa mecánicas;
- no roba agencia;
- no revela secretos;
- presenta opciones claras.

## Exploración

- acciones validadas;
- pruebas solo cuando proceden;
- consecuencias persistidas;
- transiciones correctas.

## Combate

- iniciativa;
- turnos;
- economía de acciones;
- ataques;
- salvaciones;
- daño;
- condiciones;
- derrota;
- fin de encuentro;
- narración posterior a resolución.

## Inventario

- recogida y consumo validados;
- ausencia de objetos inventados;
- auditoría de cambios.

## Misiones

- creación y actualización por el backend;
- ausencia de spoilers;
- cierre y consecuencias persistidas.

## Memoria

- hechos importantes guardados;
- detalles irrelevantes no saturan la memoria;
- continuidad entre sesiones.

## Cierre

- recompensas confirmadas;
- resumen;
- guardado final;
- punto de reanudación claro.

## Móvil

- sin desbordamiento horizontal esencial;
- botones accesibles;
- registro legible;
- turno y estado visibles;
- paneles secundarios plegables.

---

# 14. Pruebas recomendadas para Codex

## 14.1. Prueba de extremo a extremo

Simular:

1. cargar campaña;
2. mostrar resumen;
3. iniciar conversación;
4. aceptar misión;
5. investigar;
6. cambiar de localización;
7. iniciar combate;
8. completar varios turnos;
9. consumir un objeto;
10. terminar combate;
11. actualizar misión;
12. generar recompensa;
13. crear resumen;
14. guardar;
15. recargar y comparar estado.

## 14.2. Pruebas de límites

- atacar un objetivo inexistente;
- usar un recurso agotado;
- lanzar un conjuro sin espacio;
- actuar fuera de turno;
- intentar descansar en lugar no válido;
- recoger dos veces el mismo objeto;
- completar una misión sin cumplir objetivo;
- narrar muerte sin confirmación;
- recuperar una campaña tras fallo de guardado.

## 14.3. Pruebas de canon

Verificar que no aparecen como mecánicas activas:

- THAC0;
- Clase de Armadura descendente;
- salvaciones de AD&D;
- oro por experiencia;
- reacción o moral OSR como autoridad;
- reglas D&D 2024 no aprobadas.

---

# 15. Uso de este documento por Codex

Antes de modificar el flujo de sesión, Codex debe:

1. leer `AGENTS.md`;
2. leer `docs/DECISION_5E_SRD_API.md`;
3. leer `MASTER_ARCH_GUIDE.md`;
4. leer `PROJECT_CONTEXT.md`;
5. leer este documento;
6. inspeccionar el código y los tests reales;
7. informar de cualquier diferencia entre documentación e implementación;
8. proponer el cambio mínimo;
9. ejecutar la validación adecuada.

Este documento es una **especificación de comportamiento y experiencia**. No sustituye las decisiones canónicas del proyecto ni demuestra por sí solo que una función ya esté implementada.

---

# 16. Ruta recomendada dentro del repositorio

Guardar este archivo como:

```text
docs/DND5E_SESSION_TIMELINE.md
```

Esta ruta se recomienda porque:

- el repositorio ya concentra la documentación técnica activa en `docs/`;
- el contenido describe comportamiento funcional y de jugabilidad;
- no debe confundirse con una decisión arquitectónica superior;
- es fácil de enlazar desde `README.md`, `AGENTS.md` y futuras especificaciones.

## 16.1. Referencia recomendada en AGENTS.md

Para que Codex lo tenga en cuenta en tareas relacionadas con el bucle de juego, escenas, combate, persistencia o interfaz, añadir bajo `## First read` o en una subsección de documentación relevante:

```markdown
6. `docs/DND5E_SESSION_TIMELINE.md` cuando la tarea afecte al bucle de sesión, escenas, transiciones de modo, combate, recompensas, persistencia o experiencia móvil.
```

No es recomendable convertirlo en autoridad superior a:

- `docs/DECISION_5E_SRD_API.md`;
- `MASTER_ARCH_GUIDE.md`;
- `PROJECT_CONTEXT.md`.

## 16.2. Referencia recomendada en README.md

Añadir a “Quick links” o “Documentation map”:

```markdown
- Complete D&D 5e session flow: `docs/DND5E_SESSION_TIMELINE.md`
```

---

# 17. Prompt recomendado para Codex

```text
Read AGENTS.md, docs/DECISION_5E_SRD_API.md, MASTER_ARCH_GUIDE.md, PROJECT_CONTEXT.md, docs/DND5E_SESSION_TIMELINE.md, package.json, and the code directly related to this task.

First produce a truth check comparing the current implementation with the documented full-session flow. Identify missing states, transitions, validation boundaries, persistence checkpoints, tests, and mobile UI risks. Do not edit files until you present a small implementation plan. Preserve backend mechanical authority and D&D 5e/SRD 2014 canon.
```

---

# 18. Resumen operativo

Una partida completa de Dungeon Cortex debe seguir este patrón:

**cargar estado → presentar situación → recibir intención → validar → resolver → actualizar → narrar → persistir → ofrecer nuevas opciones → cerrar y resumir.**

La IA hace que la partida resulte evocadora y comprensible.

El backend garantiza que la partida sea válida, repetible, auditable y coherente.
