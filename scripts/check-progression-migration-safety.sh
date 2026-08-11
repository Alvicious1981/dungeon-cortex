#!/usr/bin/env bash
#
# Comprobación adversarial OPT-IN de la migración de progresión de Character.
#
# Aplica 20260806090000_reconcile_character_progression_columns sobre bases
# desechables en estados hostiles y verifica que:
#   - un aborto revierte el fichero entero (atomicidad sin BEGIN/COMMIT: la
#     migración es un único bloque DO);
#   - los casos cruzados con NULL se reconcilian o abortan según el contrato;
#   - una columna preexistente con tipo distinto de INTEGER aborta sin convertir;
#   - defaults y nulabilidad preexistentes acaban en 1 / 1 / 0 y NOT NULL;
#   - la migración es idempotente.
#
# No se ejecuta en `pnpm test`: necesita PostgreSQL. Su contraparte estática,
# que sí corre siempre, es tests/architecture/migration-schema-drift.test.ts.
#
# ── Configuración ────────────────────────────────────────────────────────────
#
# TODA ejecución de PostgreSQL pasa por SAFETY_PSQL. No hay ningún nombre de
# contenedor, usuario, base ni puerto fijado dentro de las funciones.
#
# Con psql local y variables libpq estándar:
#   export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGPASSWORD=<CLAVE>
#   bash scripts/check-progression-migration-safety.sh
#
# Con PostgreSQL en Docker (ejemplo, no se ejecuta):
#   SAFETY_PSQL="docker exec -i <CONTENEDOR> psql -U postgres" \
#     bash scripts/check-progression-migration-safety.sh
#
# SAFETY_PSQL se divide en palabras con `read -ra`, nunca con `eval`. Por eso
# sus elementos no pueden contener espacios; para casos complejos, envuelve la
# invocación en un script y apunta SAFETY_PSQL a él.
#
# Crea y destruye una única base llamada $SAFETY_DB (por defecto
# progression_safety_check). El usuario debe poder crear bases.
#
# Salida: 0 solo si todas las precondiciones de datos se demostraron y no hubo
# ninguna aserción fallida. Cualquier error inesperado aborta de inmediato.
#
set -euo pipefail

SAFETY_PSQL="${SAFETY_PSQL:-psql}"
SAFETY_DB="${SAFETY_DB:-progression_safety_check}"
MIG="prisma/migrations/20260806090000_reconcile_character_progression_columns/migration.sql"
GUARD="prisma/migrations/20260807090000_guard_character_hit_dice_contract/migration.sql"

for f in "$MIG" "$GUARD"; do
  if [ ! -f "$f" ]; then
    echo "No se encuentra $f. Ejecuta el script desde la raíz del repositorio." >&2
    exit 1
  fi
done

# Única abstracción de ejecución. Sin eval.
read -r -a PSQL_CMD <<< "$SAFETY_PSQL"
if [ "${#PSQL_CMD[@]}" -eq 0 ]; then
  echo "SAFETY_PSQL está vacío." >&2
  exit 1
fi

FAIL=0
QOUT=""
MIGOUT=""

die() { echo "" >&2; echo "ABORTA: $*" >&2; exit 1; }

chk() {
  if [ "$2" = "$3" ]; then
    echo "    PASA  $1 — $3"
  else
    echo "    FALLA $1 — esperado='$2' obtenido='$3'"
    FAIL=$((FAIL+1))
  fi
}

# ── Ejecución de SQL ─────────────────────────────────────────────────────────
# Todas escriben en QOUT/MIGOUT en lugar de devolver por stdout, para que `die`
# se ejecute en el shell principal y no dentro de una subshell de $( ).

# Consulta de un valor. Devuelve != 0 si psql falla; QOUT lleva salida o error.
q_raw() {
  local rc=0
  QOUT=$("${PSQL_CMD[@]}" -d "$1" -tAc "$2" 2>&1) || rc=$?
  QOUT=$(printf '%s' "$QOUT" | tr -d ' \r')
  return $rc
}

# Consulta que DEBE devolver una fila no vacía. Un vacío es un fallo duro:
# es exactamente lo que convertía este arnés en un falso verde.
qreq() {
  q_raw "$1" "$2" || die "consulta falló en la base '$1': ${QOUT:-<sin salida>} | SQL: $2"
  [ -n "$QOUT" ] || die "consulta vacía cuando debía devolver una fila. Base '$1' | SQL: $2"
}

# Consulta que puede devolver vacío legítimamente (p. ej. buscar filas que no
# deben existir). Sigue abortando si psql falla.
qopt() {
  q_raw "$1" "$2" || die "consulta falló en la base '$1': ${QOUT:-<sin salida>} | SQL: $2"
}

# Ejecuta SQL que DEBE tener éxito.
exec_sql() {
  local out rc=0
  out=$("${PSQL_CMD[@]}" -d "$1" -v ON_ERROR_STOP=1 -q -c "$2" 2>&1) || rc=$?
  [ $rc -eq 0 ] || die "SQL falló en la base '$1' (exit $rc): $out"
}

# Aplica la migración. Devuelve el código real; MIGOUT lleva stdout+stderr.
# Los ensayos que esperan un aborto lo capturan explícitamente con `|| true`.
apply_migration() {
  local rc=0
  MIGOUT=$("${PSQL_CMD[@]}" -d "$1" -v ON_ERROR_STOP=1 -q < "$MIG" 2>&1) || rc=$?
  return $rc
}

# ── Construcción de la base de pruebas ───────────────────────────────────────

build_base() {
  local db="$1"
  exec_sql postgres "DROP DATABASE IF EXISTS $db WITH (FORCE);"
  exec_sql postgres "CREATE DATABASE $db;"

  local d out rc
  for d in $(ls prisma/migrations | grep '^2' | grep -v 20260806090000 | grep -v 20260807090000 | sort); do
    rc=0
    out=$("${PSQL_CMD[@]}" -d "$db" -v ON_ERROR_STOP=1 -q < "prisma/migrations/$d/migration.sql" 2>&1) || rc=$?
    [ $rc -eq 0 ] || die "SIEMBRA: falló la migración previa '$d' (exit $rc): $out"
  done

  exec_sql "$db" \
    "INSERT INTO \"User\"(\"id\",\"email\",\"name\",\"createdAt\") VALUES ('u1','u@disposable.local','it_audit','2026-01-01');"
}

# Inserta un Character. $1=db $2=id $3=level
ins() {
  exec_sql "$1" \
    "INSERT INTO \"Character\"(\"id\",\"userId\",\"name\",\"race\",\"class\",\"level\",\"xp\",\"hp\",\"maxHp\",\"stats\",\"createdAt\") \
     VALUES ('$2','u1','it_audit_$2','human','fighter',$3,0,10,10,'{}','2026-01-01');"
}

# ── Guardas contra pruebas vacuas ────────────────────────────────────────────

# Exige que la siembra haya dejado exactamente el usuario y los personajes
# esperados. Sin esto, una siembra fallida deja consultas vacías y aserciones
# que se comparan entre sí sin significado.
assert_seeded() {
  local db="$1" expected_chars="$2"
  qreq "$db" "SELECT count(*) FROM \"User\";"
  [ "$QOUT" = "1" ] || die "SIEMBRA: se esperaba 1 usuario en '$db', hay $QOUT"
  qreq "$db" "SELECT count(*) FROM \"Character\";"
  [ "$QOUT" = "$expected_chars" ] || die "SIEMBRA: se esperaban $expected_chars personaje(s) en '$db', hay $QOUT"
}

# Exige que un identificador concreto exista antes de usarlo en un bloque.
assert_row() {
  local db="$1" id="$2"
  qreq "$db" "SELECT count(*) FROM \"Character\" WHERE \"id\"='$id';"
  [ "$QOUT" = "1" ] || die "SIEMBRA: la fila '$id' no existe en '$db' (count=$QOUT)"
}

# Instantánea verificable para idempotencia: "<nº filas>|<md5>".
# Aborta si no hay filas o si el md5 sale vacío, para que comparar dos
# instantáneas vacías no pueda dar un falso verde.
snapshot() {
  local db="$1"
  qreq "$db" "SELECT count(*)::text || '|' || coalesce(md5(string_agg(\"id\" || ':' || \"hitDiceTotal\"::text || ':' || \"hitDiceRemaining\"::text || ':' || \"exhaustionLevel\"::text, ',' ORDER BY \"id\")), '') FROM \"Character\";"
  local rows="${QOUT%%|*}" digest="${QOUT##*|}"
  [[ "$rows" =~ ^[0-9]+$ ]] || die "INSTANTÁNEA: recuento de filas no numérico ('$rows') en '$db'"
  [ "$rows" -gt 0 ] || die "INSTANTÁNEA: 0 filas en '$db'; no hay nada que comparar"
  [ -n "$digest" ] || die "INSTANTÁNEA: md5 vacío en '$db' con $rows fila(s)"
  [ "${#digest}" -eq 32 ] || die "INSTANTÁNEA: md5 con longitud inesperada (${#digest}) en '$db'"
}

cols_present() {
  qreq "$1" "SELECT count(*) FROM information_schema.columns WHERE table_name='Character' AND column_name IN ('hitDiceTotal','hitDiceRemaining','exhaustionLevel');"
}

add_progression_columns() {
  exec_sql "$1" 'ALTER TABLE "Character" ADD COLUMN "hitDiceTotal" INTEGER, ADD COLUMN "hitDiceRemaining" INTEGER, ADD COLUMN "exhaustionLevel" INTEGER;'
}

# ── Arnés de la migración de guarda (20260807090000) ─────────────────────────
#
# La guarda es guard-only: no escribe nunca. Por eso cada ensayo comprueba dos
# cosas distintas — el veredicto (pasa/aborta) y que los datos sintéticos
# siguen intactos byte a byte después. Un aborto que además hubiera modificado
# algo sería un fallo aunque el veredicto fuese el correcto.

# Aplica la migración de guarda. Devuelve el código real; MIGOUT lleva la salida.
apply_guard() {
  local rc=0
  MIGOUT=$("${PSQL_CMD[@]}" -d "$1" -v ON_ERROR_STOP=1 -q < "$GUARD" 2>&1) || rc=$?
  return $rc
}

# Base con TODAS las migraciones aplicadas, guarda incluida en el historial pero
# no ejecutada aquí: build_base excluye 20260806, así que se aplica a mano para
# dejar las columnas en su estado final (NOT NULL, defaults 1/1/0).
build_guard_base() {
  local db="$1"
  build_base "$db"
  apply_migration "$db" || die "GUARDA: la migración base 20260806 debía aplicarse: $MIGOUT"
}

# Inserta un Character con hit dice explícitos. $1=db $2=id $3=level $4=total $5=remaining
ins_hd() {
  exec_sql "$1" \
    "INSERT INTO \"Character\"(\"id\",\"userId\",\"name\",\"race\",\"class\",\"level\",\"xp\",\"hp\",\"maxHp\",\"stats\",\"createdAt\",\"hitDiceTotal\",\"hitDiceRemaining\",\"exhaustionLevel\") \
     VALUES ('$2','u1','it_audit_$2','human','fighter',$3,0,10,10,'{}','2026-01-01',$4,$5,0);"
}

# Ensayo que DEBE pasar la guarda. $1=etiqueta $2=level $3=total $4=remaining
guard_ok() {
  local label="$1" lvl="$2" tot="$3" rem="$4" db="${SAFETY_DB}_guard"
  build_guard_base "$db"
  ins_hd "$db" c_g "$lvl" "$tot" "$rem"
  assert_seeded "$db" 1
  assert_row "$db" c_g
  snapshot "$db"; local before="$QOUT"

  apply_guard "$db" || die "GUARDA: '$label' debía pasar y abortó: $MIGOUT"
  snapshot "$db"
  chk "PASA $label — sin modificar datos" "$before" "$QOUT"
  exec_sql postgres "DROP DATABASE IF EXISTS $db WITH (FORCE);"
}

# Ensayo que DEBE abortar. $1=etiqueta $2=level $3=total $4=remaining
guard_abort() {
  local label="$1" lvl="$2" tot="$3" rem="$4" db="${SAFETY_DB}_guard"
  build_guard_base "$db"
  # Viola el contrato a propósito: la guarda es justo lo que debe detectarlo.
  ins_hd "$db" c_g "$lvl" "$tot" "$rem"
  assert_seeded "$db" 1
  assert_row "$db" c_g
  snapshot "$db"; local before="$QOUT"
  qreq "$db" "SELECT \"level\"::text || ':' || \"hitDiceTotal\"::text || ':' || \"hitDiceRemaining\"::text FROM \"Character\" WHERE \"id\"='c_g';"
  local raw_before="$QOUT"

  apply_guard "$db" && die "GUARDA: '$label' debía abortar y pasó"
  chk "ABORTA $label" 1 "$(printf '%s' "$MIGOUT" | grep -c 'incumplido\|ambiguo' || true)"
  snapshot "$db"
  chk "  …y deja los datos intactos" "$before" "$QOUT"
  qreq "$db" "SELECT \"level\"::text || ':' || \"hitDiceTotal\"::text || ':' || \"hitDiceRemaining\"::text FROM \"Character\" WHERE \"id\"='c_g';"
  chk "  …incluido level/total/remaining" "$raw_before" "$QOUT"
  exec_sql postgres "DROP DATABASE IF EXISTS $db WITH (FORCE);"
}

# ─────────────────────────────────────────────────────────────────────────────

DB="$SAFETY_DB"

echo "############ 0. CONECTIVIDAD ############"
qreq postgres "SELECT 1;"
chk "psql responde a través de SAFETY_PSQL" 1 "$QOUT"

echo
echo "############ 1. ATOMICIDAD ############"
build_base "$DB"
ins "$DB" c_bad 0            # level=0 -> la validación debe abortar
assert_seeded "$DB" 1
assert_row "$DB" c_bad
cols_present "$DB"; chk "columnas antes del intento" 0 "$QOUT"

apply_migration "$DB" || true
chk "aborta con el dato inválido" 1 "$(printf '%s' "$MIGOUT" | grep -c 'No se puede reconciliar' || true)"
printf '%s\n' "$MIGOUT" | grep 'ERROR' | head -1 | sed 's/^/    /' || true
cols_present "$DB"; chk "columnas tras el aborto (0 = rollback total)" 0 "$QOUT"
qreq "$DB" "SELECT \"level\" FROM \"Character\" WHERE \"id\"='c_bad';"
chk "la fila sigue intacta (level=0)" 0 "$QOUT"

echo "  -- reintento tras corregir SOLO el dato --"
exec_sql "$DB" "UPDATE \"Character\" SET \"level\"=1 WHERE \"id\"='c_bad';"
apply_migration "$DB" || die "la migración debía aplicar tras corregir el dato: $MIGOUT"
chk "segunda aplicación sin errores" 0 "$(printf '%s' "$MIGOUT" | grep -c 'ERROR' || true)"
cols_present "$DB"; chk "columnas creadas tras el reintento" 3 "$QOUT"

echo
echo "############ 2. CASOS CRUZADOS CON NULL ############"

echo "  --- Caso A: level=3, total=NULL, remaining=99 (no reconciliable) ---"
build_base "$DB"; ins "$DB" c_a 3; assert_seeded "$DB" 1; assert_row "$DB" c_a
add_progression_columns "$DB"
exec_sql "$DB" "UPDATE \"Character\" SET \"hitDiceTotal\"=NULL, \"hitDiceRemaining\"=99 WHERE \"id\"='c_a';"
apply_migration "$DB" || true
chk "A: aborta" 1 "$(printf '%s' "$MIGOUT" | grep -c 'No se puede reconciliar' || true)"
qopt "$DB" "SELECT 'MAL' FROM \"Character\" WHERE \"id\"='c_a' AND \"hitDiceTotal\"=3 AND \"hitDiceRemaining\"=99;"
chk "A: NO deja total=3 con remaining=99" "" "$QOUT"
printf '%s\n' "$MIGOUT" | grep 'ERROR' | head -1 | sed 's/^/    /' || true

echo "  --- Caso B: level=5, total=NULL, remaining=3 (reconciliable) ---"
build_base "$DB"; ins "$DB" c_b 5; assert_seeded "$DB" 1; assert_row "$DB" c_b
add_progression_columns "$DB"
exec_sql "$DB" "UPDATE \"Character\" SET \"hitDiceTotal\"=NULL, \"hitDiceRemaining\"=3 WHERE \"id\"='c_b';"
apply_migration "$DB" || die "B debía aplicar sin abortar: $MIGOUT"
chk "B: no aborta" 0 "$(printf '%s' "$MIGOUT" | grep -c 'ERROR' || true)"
qreq "$DB" "SELECT \"hitDiceTotal\" FROM \"Character\" WHERE \"id\"='c_b';"; chk "B: total recalculado a 5" 5 "$QOUT"
qreq "$DB" "SELECT \"hitDiceRemaining\" FROM \"Character\" WHERE \"id\"='c_b';"; chk "B: remaining=3 conservado" 3 "$QOUT"

echo "  --- Caso C: level=5, total=2, remaining=NULL ---"
build_base "$DB"; ins "$DB" c_c 5; assert_seeded "$DB" 1; assert_row "$DB" c_c
add_progression_columns "$DB"
exec_sql "$DB" "UPDATE \"Character\" SET \"hitDiceTotal\"=2, \"hitDiceRemaining\"=NULL WHERE \"id\"='c_c';"
apply_migration "$DB" || die "C debía aplicar sin abortar: $MIGOUT"
chk "C: no aborta" 0 "$(printf '%s' "$MIGOUT" | grep -c 'ERROR' || true)"
qreq "$DB" "SELECT \"hitDiceTotal\" FROM \"Character\" WHERE \"id\"='c_c';"; chk "C: total 2 conservado" 2 "$QOUT"
qreq "$DB" "SELECT \"hitDiceRemaining\" FROM \"Character\" WHERE \"id\"='c_c';"; chk "C: remaining acotado a 2" 2 "$QOUT"

echo "  --- Caso D: remaining negativo ---"
build_base "$DB"; ins "$DB" c_d 5; assert_seeded "$DB" 1; assert_row "$DB" c_d
add_progression_columns "$DB"
exec_sql "$DB" "UPDATE \"Character\" SET \"hitDiceTotal\"=5, \"hitDiceRemaining\"=-2 WHERE \"id\"='c_d';"
apply_migration "$DB" || true
chk "D: aborta" 1 "$(printf '%s' "$MIGOUT" | grep -c 'No se puede reconciliar' || true)"
printf '%s\n' "$MIGOUT" | grep 'ERROR' | head -1 | sed 's/^/    /' || true

echo "  --- Caso E: total negativo ---"
build_base "$DB"; ins "$DB" c_e 5; assert_seeded "$DB" 1; assert_row "$DB" c_e
add_progression_columns "$DB"
exec_sql "$DB" "UPDATE \"Character\" SET \"hitDiceTotal\"=-1, \"hitDiceRemaining\"=NULL WHERE \"id\"='c_e';"
apply_migration "$DB" || true
chk "E: aborta" 1 "$(printf '%s' "$MIGOUT" | grep -c 'No se puede reconciliar' || true)"
printf '%s\n' "$MIGOUT" | grep 'ERROR' | head -1 | sed 's/^/    /' || true

echo
echo "############ 3. TIPO INCOMPATIBLE ############"
for T in BIGINT TEXT; do
  build_base "$DB"; ins "$DB" c_t 3; assert_seeded "$DB" 1; assert_row "$DB" c_t
  exec_sql "$DB" "ALTER TABLE \"Character\" ADD COLUMN \"hitDiceTotal\" $T;"
  apply_migration "$DB" || true
  echo "  --- $T ---"
  chk "$T: aborta" 1 "$(printf '%s' "$MIGOUT" | grep -c 'No se puede reconciliar' || true)"
  cols_present "$DB"; chk "$T: no crea las otras dos" 1 "$QOUT"
  qreq "$DB" "SELECT data_type FROM information_schema.columns WHERE table_name='Character' AND column_name='hitDiceTotal';"
  chk "$T: no convierte el tipo" "$(printf '%s' "$T" | tr 'A-Z' 'a-z')" "$QOUT"
  printf '%s\n' "$MIGOUT" | grep 'ERROR' | head -1 | sed 's/^/    /' || true
done

echo
echo "############ 4. DEFAULTS Y NULABILIDAD PREEXISTENTES ############"
build_base "$DB"; ins "$DB" c_1 4; ins "$DB" c_2 6
assert_seeded "$DB" 2; assert_row "$DB" c_1; assert_row "$DB" c_2
exec_sql "$DB" 'ALTER TABLE "Character"
  ADD COLUMN "hitDiceTotal" INTEGER,
  ADD COLUMN "hitDiceRemaining" INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN "exhaustionLevel" INTEGER DEFAULT 4;'
exec_sql "$DB" "UPDATE \"Character\" SET \"hitDiceTotal\"=4, \"hitDiceRemaining\"=2, \"exhaustionLevel\"=1 WHERE \"id\"='c_1';"
exec_sql "$DB" "UPDATE \"Character\" SET \"hitDiceTotal\"=NULL, \"hitDiceRemaining\"=6, \"exhaustionLevel\"=NULL WHERE \"id\"='c_2';"
apply_migration "$DB" || die "el bloque de defaults debía aplicar sin abortar: $MIGOUT"
chk "defaults: no aborta" 0 "$(printf '%s' "$MIGOUT" | grep -c 'ERROR' || true)"
qreq "$DB" "SELECT \"hitDiceTotal\"||'|'||\"hitDiceRemaining\"||'|'||\"exhaustionLevel\" FROM \"Character\" WHERE \"id\"='c_1';"
chk "c_1 valores válidos conservados (4/2/1)" "4|2|1" "$QOUT"
qreq "$DB" "SELECT \"hitDiceTotal\" FROM \"Character\" WHERE \"id\"='c_2';"; chk "c_2 total derivado del nivel (6)" 6 "$QOUT"
qreq "$DB" "SELECT \"hitDiceRemaining\" FROM \"Character\" WHERE \"id\"='c_2';"; chk "c_2 remaining=6 conservado" 6 "$QOUT"
qreq "$DB" "SELECT \"exhaustionLevel\" FROM \"Character\" WHERE \"id\"='c_2';"; chk "c_2 exhaustion nulo -> 0" 0 "$QOUT"
qreq "$DB" "SELECT column_default FROM information_schema.columns WHERE table_name='Character' AND column_name='hitDiceTotal';"
chk "default final total=1" 1 "$QOUT"
qreq "$DB" "SELECT column_default FROM information_schema.columns WHERE table_name='Character' AND column_name='hitDiceRemaining';"
chk "default final remaining=1 (corrige el 7)" 1 "$QOUT"
qreq "$DB" "SELECT column_default FROM information_schema.columns WHERE table_name='Character' AND column_name='exhaustionLevel';"
chk "default final exhaustion=0 (corrige el 4)" 0 "$QOUT"
qreq "$DB" "SELECT string_agg(is_nullable,'|' ORDER BY column_name) FROM information_schema.columns WHERE table_name='Character' AND column_name IN ('hitDiceTotal','hitDiceRemaining','exhaustionLevel');"
chk "las tres NOT NULL" "NO|NO|NO" "$QOUT"

snapshot "$DB"; BEFORE="$QOUT"
apply_migration "$DB" || die "la reaplicación debía tener éxito: $MIGOUT"
snapshot "$DB"; AFTER="$QOUT"
chk "instantánea previa con 2 filas verificables" "2|${BEFORE##*|}" "$BEFORE"
chk "idempotente (filas + md5)" "$BEFORE" "$AFTER"

echo
echo "############ 5. INVARIANTES FINALES ############"
qreq "$DB" "SELECT count(*) FROM \"Character\" WHERE \"hitDiceTotal\" IS NULL OR \"hitDiceRemaining\" IS NULL OR \"exhaustionLevel\" IS NULL OR \"hitDiceRemaining\" < 0 OR \"hitDiceRemaining\" > \"hitDiceTotal\" OR \"hitDiceTotal\" < 1;"
chk "0 filas violan las invariantes" 0 "$QOUT"

# Limpieza de la base desechable.
exec_sql postgres "DROP DATABASE IF EXISTS $DB WITH (FORCE);"

echo
echo "############ 6. GUARDA GUARD-ONLY (20260807090000) ############"

echo "-- Estados válidos: deben pasar sin tocar nada"
guard_ok    "nivel 1 / total 1"              1 1 1
guard_ok    "nivel 2 / total 1 (pendiente)"  2 1 1
guard_ok    "nivel 5 / total 4 (pendiente)"  5 4 4
guard_ok    "nivel 5 / total 5 (asentado)"   5 5 5
guard_ok    "remanente en rango (5/5/0)"     5 5 0

echo
echo "-- Estados inválidos o ambiguos: deben abortar sin tocar nada"
guard_abort "nivel 0"                        0 1 1
guard_abort "nivel 21"                      21 20 20
guard_abort "nivel 1 / total 0"              1 0 0
guard_abort "nivel 1 / total 2"              1 2 2
guard_abort "nivel 2 / total 0"              2 0 0
guard_abort "nivel 5 / total 1 (ambiguo)"    5 1 1
guard_abort "nivel 5 / total 6"              5 6 5
guard_abort "remanente negativo"             5 5 -1
guard_abort "remanente > total"              5 5 8

echo
echo "############ RESUMEN: $FAIL fallo(s) ############"
exit $FAIL
