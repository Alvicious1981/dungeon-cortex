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
# Uso (conexión por variables libpq estándar):
#   export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGPASSWORD=<CLAVE>
#   bash scripts/check-progression-migration-safety.sh
#
# Con PostgreSQL en Docker:
#   SAFETY_PSQL="docker exec -i <CONTENEDOR> psql -U postgres" #     bash scripts/check-progression-migration-safety.sh
#
# Crea y destruye una única base llamada $SAFETY_DB (por defecto
# progression_safety_check). Debe poder crear bases.
#
set -uo pipefail

SAFETY_PSQL="${SAFETY_PSQL:-psql}"
SAFETY_DB="${SAFETY_DB:-progression_safety_check}"
MIG="prisma/migrations/20260806090000_reconcile_character_progression_columns/migration.sql"

if [ ! -f "$MIG" ]; then
  echo "No se encuentra $MIG. Ejecuta el script desde la raíz del repositorio." >&2
  exit 1
fi

FAIL=0


chk() { if [ "$2" = "$3" ]; then echo "    PASA  $1 — $3"; else echo "    FALLA $1 — esperado='$2' obtenido='$3'"; FAIL=$((FAIL+1)); fi; }
q()   { $SAFETY_PSQL -d "$1" -tAc "$2" 2>/dev/null | tr -d ' \r'; }
qq()  { $SAFETY_PSQL -d "$1" -q -c "$2" 2>&1; }

# Reconstruye una base con SOLO las 16 migraciones previas.
build_base() {
  local db="$1"
  $SAFETY_PSQL -d postgres -c "DROP DATABASE IF EXISTS $db WITH (FORCE);" >/dev/null 2>&1
  $SAFETY_PSQL -d postgres -c "CREATE DATABASE $db;" >/dev/null 2>&1
  for d in $(ls prisma/migrations | grep '^2' | grep -v 20260806090000 | sort); do
    $SAFETY_PSQL -d "$db" -v ON_ERROR_STOP=1 -q \
      < "prisma/migrations/$d/migration.sql" >/dev/null 2>&1 || echo "    (aviso: falló $d)"
  done
  docker exec dc-drift-pg psql -U postgres -d "$db" -q -c \
    "INSERT INTO \"User\"(\"id\",\"email\",\"name\",\"createdAt\") VALUES ('u1','u@d.local','it_audit','2026-01-01');" >/dev/null 2>&1
}

# Inserta un Character. $2=id $3=level  (columnas de progresión aparte)
ins() {
  $SAFETY_PSQL -d "$1" -q -c \
    "INSERT INTO \"Character\"(\"id\",\"userId\",\"name\",\"race\",\"class\",\"level\",\"xp\",\"hp\",\"maxHp\",\"stats\",\"createdAt\") \
     VALUES ('$2','u1','it_audit_$2','human','fighter',$3,0,10,10,'{}','2026-01-01');" >/dev/null 2>&1
}

# Aplica la migración vía psql (autocommit por sentencia, el caso adverso).
apply_psql() {
  $SAFETY_PSQL -d "$1" -v ON_ERROR_STOP=1 -q < "$MIG" 2>&1
}

cols_present() {
  q "$1" "SELECT count(*) FROM information_schema.columns WHERE table_name='Character' AND column_name IN ('hitDiceTotal','hitDiceRemaining','exhaustionLevel');"
}

echo "############ 1. ATOMICIDAD ############"
build_base "$SAFETY_DB"
ins "$SAFETY_DB" c_bad 0     # level=0 -> el bloque de validación debe abortar
echo "  columnas antes: $(cols_present "$SAFETY_DB") (esperado 0)"
OUT=$(apply_psql "$SAFETY_DB")
echo "  ¿abortó?: $(echo "$OUT" | grep -c 'ERROR') error(es)"
echo "$OUT" | grep 'ERROR' | head -1 | sed 's/^/    /'
chk "columnas tras el aborto (0 = rollback total)" 0 "$(cols_present "$SAFETY_DB")"
chk "la fila sigue intacta (level=0)" 0 "$(q "$SAFETY_DB" "SELECT \"level\" FROM \"Character\" WHERE \"id\"='c_bad';")"
echo "  -- reintento tras corregir SOLO el dato --"
qq "$SAFETY_DB" "UPDATE \"Character\" SET \"level\"=1 WHERE \"id\"='c_bad';" >/dev/null
OUT2=$(apply_psql "$SAFETY_DB")
chk "segunda aplicación sin errores" 0 "$(echo "$OUT2" | grep -c 'ERROR')"
chk "columnas creadas tras el reintento" 3 "$(cols_present "$SAFETY_DB")"

echo
echo "############ 2. CASOS CRUZADOS CON NULL ############"

echo "  --- Caso A: level=3, total=NULL, remaining=99 (no reconciliable) ---"
build_base "$SAFETY_DB"
ins "$SAFETY_DB" c_a 3
qq "$SAFETY_DB" 'ALTER TABLE "Character" ADD COLUMN "hitDiceTotal" INTEGER, ADD COLUMN "hitDiceRemaining" INTEGER, ADD COLUMN "exhaustionLevel" INTEGER;' >/dev/null
qq "$SAFETY_DB" "UPDATE \"Character\" SET \"hitDiceTotal\"=NULL, \"hitDiceRemaining\"=99 WHERE \"id\"='c_a';" >/dev/null
OA=$(apply_psql "$SAFETY_DB")
chk "A: aborta" 1 "$([ "$(echo "$OA" | grep -c 'ERROR')" -ge 1 ] && echo 1 || echo 0)"
chk "A: NO deja total=3 con remaining=99" "" "$(q "$SAFETY_DB" "SELECT 'MAL' FROM \"Character\" WHERE \"id\"='c_a' AND \"hitDiceTotal\"=3 AND \"hitDiceRemaining\"=99;")"
echo "$OA" | grep 'ERROR' | head -1 | sed 's/^/    /'

echo "  --- Caso B: level=5, total=NULL, remaining=3 (reconciliable) ---"
build_base "$SAFETY_DB"
ins "$SAFETY_DB" c_b 5
qq "$SAFETY_DB" 'ALTER TABLE "Character" ADD COLUMN "hitDiceTotal" INTEGER, ADD COLUMN "hitDiceRemaining" INTEGER, ADD COLUMN "exhaustionLevel" INTEGER;' >/dev/null
qq "$SAFETY_DB" "UPDATE \"Character\" SET \"hitDiceTotal\"=NULL, \"hitDiceRemaining\"=3 WHERE \"id\"='c_b';" >/dev/null
OB=$(apply_psql "$SAFETY_DB")
chk "B: no aborta" 0 "$(echo "$OB" | grep -c 'ERROR')"
chk "B: total recalculado a 5" 5 "$(q "$SAFETY_DB" "SELECT \"hitDiceTotal\" FROM \"Character\" WHERE \"id\"='c_b';")"
chk "B: remaining=3 conservado" 3 "$(q "$SAFETY_DB" "SELECT \"hitDiceRemaining\" FROM \"Character\" WHERE \"id\"='c_b';")"

echo "  --- Caso C: level=5, total=2, remaining=NULL ---"
build_base "$SAFETY_DB"
ins "$SAFETY_DB" c_c 5
qq "$SAFETY_DB" 'ALTER TABLE "Character" ADD COLUMN "hitDiceTotal" INTEGER, ADD COLUMN "hitDiceRemaining" INTEGER, ADD COLUMN "exhaustionLevel" INTEGER;' >/dev/null
qq "$SAFETY_DB" "UPDATE \"Character\" SET \"hitDiceTotal\"=2, \"hitDiceRemaining\"=NULL WHERE \"id\"='c_c';" >/dev/null
OC=$(apply_psql "$SAFETY_DB")
chk "C: no aborta" 0 "$(echo "$OC" | grep -c 'ERROR')"
chk "C: total 2 conservado" 2 "$(q "$SAFETY_DB" "SELECT \"hitDiceTotal\" FROM \"Character\" WHERE \"id\"='c_c';")"
chk "C: remaining acotado a 2" 2 "$(q "$SAFETY_DB" "SELECT \"hitDiceRemaining\" FROM \"Character\" WHERE \"id\"='c_c';")"

echo "  --- Caso D: remaining negativo ---"
build_base "$SAFETY_DB"
ins "$SAFETY_DB" c_d 5
qq "$SAFETY_DB" 'ALTER TABLE "Character" ADD COLUMN "hitDiceTotal" INTEGER, ADD COLUMN "hitDiceRemaining" INTEGER, ADD COLUMN "exhaustionLevel" INTEGER;' >/dev/null
qq "$SAFETY_DB" "UPDATE \"Character\" SET \"hitDiceTotal\"=5, \"hitDiceRemaining\"=-2 WHERE \"id\"='c_d';" >/dev/null
OD=$(apply_psql "$SAFETY_DB")
chk "D: aborta" 1 "$([ "$(echo "$OD" | grep -c 'ERROR')" -ge 1 ] && echo 1 || echo 0)"
echo "$OD" | grep 'ERROR' | head -1 | sed 's/^/    /'

echo "  --- Caso E: total negativo ---"
build_base "$SAFETY_DB"
ins "$SAFETY_DB" c_e 5
qq "$SAFETY_DB" 'ALTER TABLE "Character" ADD COLUMN "hitDiceTotal" INTEGER, ADD COLUMN "hitDiceRemaining" INTEGER, ADD COLUMN "exhaustionLevel" INTEGER;' >/dev/null
qq "$SAFETY_DB" "UPDATE \"Character\" SET \"hitDiceTotal\"=-1, \"hitDiceRemaining\"=NULL WHERE \"id\"='c_e';" >/dev/null
OE=$(apply_psql "$SAFETY_DB")
chk "E: aborta" 1 "$([ "$(echo "$OE" | grep -c 'ERROR')" -ge 1 ] && echo 1 || echo 0)"
echo "$OE" | grep 'ERROR' | head -1 | sed 's/^/    /'

echo
echo "############ 3. TIPO INCOMPATIBLE ############"
for T in BIGINT TEXT; do
  db="$SAFETY_DB"
  build_base "$db"
  ins "$db" c_t 3
  qq "$db" "ALTER TABLE \"Character\" ADD COLUMN \"hitDiceTotal\" $T;" >/dev/null
  OT=$(apply_psql "$db")
  echo "  --- $T ---"
  chk "$T: aborta" 1 "$([ "$(echo "$OT" | grep -c 'ERROR')" -ge 1 ] && echo 1 || echo 0)"
  chk "$T: no crea las otras dos" 1 "$(q "$db" "SELECT count(*) FROM information_schema.columns WHERE table_name='Character' AND column_name IN ('hitDiceTotal','hitDiceRemaining','exhaustionLevel');")"
  chk "$T: no convierte el tipo" "$(echo "$T" | tr 'A-Z' 'a-z')" "$(q "$db" "SELECT CASE data_type WHEN 'bigint' THEN 'bigint' WHEN 'text' THEN 'text' ELSE data_type END FROM information_schema.columns WHERE table_name='Character' AND column_name='hitDiceTotal';")"
  echo "$OT" | grep 'ERROR' | head -1 | sed 's/^/    /'
done

echo
echo "############ 4. DEFAULTS Y NULABILIDAD PREEXISTENTES ############"
build_base "$SAFETY_DB"
ins "$SAFETY_DB" c_1 4
ins "$SAFETY_DB" c_2 6
qq "$SAFETY_DB" 'ALTER TABLE "Character"
  ADD COLUMN "hitDiceTotal" INTEGER,
  ADD COLUMN "hitDiceRemaining" INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN "exhaustionLevel" INTEGER DEFAULT 4;' >/dev/null
qq "$SAFETY_DB" "UPDATE \"Character\" SET \"hitDiceTotal\"=4, \"hitDiceRemaining\"=2, \"exhaustionLevel\"=1 WHERE \"id\"='c_1';" >/dev/null
qq "$SAFETY_DB" "UPDATE \"Character\" SET \"hitDiceTotal\"=NULL, \"hitDiceRemaining\"=6, \"exhaustionLevel\"=NULL WHERE \"id\"='c_2';" >/dev/null
ODEF=$(apply_psql "$SAFETY_DB")
chk "defaults: no aborta" 0 "$(echo "$ODEF" | grep -c 'ERROR')"
chk "c_1 valores válidos conservados (4/2/1)" "4|2|1" "$(q "$SAFETY_DB" "SELECT \"hitDiceTotal\"||'|'||\"hitDiceRemaining\"||'|'||\"exhaustionLevel\" FROM \"Character\" WHERE \"id\"='c_1';")"
chk "c_2 total derivado del nivel (6)" 6 "$(q "$SAFETY_DB" "SELECT \"hitDiceTotal\" FROM \"Character\" WHERE \"id\"='c_2';")"
chk "c_2 remaining=6 conservado" 6 "$(q "$SAFETY_DB" "SELECT \"hitDiceRemaining\" FROM \"Character\" WHERE \"id\"='c_2';")"
chk "c_2 exhaustion nulo -> 0" 0 "$(q "$SAFETY_DB" "SELECT \"exhaustionLevel\" FROM \"Character\" WHERE \"id\"='c_2';")"
chk "default final total=1" 1 "$(q "$SAFETY_DB" "SELECT column_default FROM information_schema.columns WHERE table_name='Character' AND column_name='hitDiceTotal';")"
chk "default final remaining=1 (corrige el 7)" 1 "$(q "$SAFETY_DB" "SELECT column_default FROM information_schema.columns WHERE table_name='Character' AND column_name='hitDiceRemaining';")"
chk "default final exhaustion=0 (corrige el 4)" 0 "$(q "$SAFETY_DB" "SELECT column_default FROM information_schema.columns WHERE table_name='Character' AND column_name='exhaustionLevel';")"
chk "las tres NOT NULL" "NO|NO|NO" "$(q "$SAFETY_DB" "SELECT string_agg(is_nullable,'|' ORDER BY column_name) FROM information_schema.columns WHERE table_name='Character' AND column_name IN ('hitDiceTotal','hitDiceRemaining','exhaustionLevel');")"
BEFORE=$(q "$SAFETY_DB" "SELECT md5(string_agg(\"id\"||\"hitDiceTotal\"::text||\"hitDiceRemaining\"::text||\"exhaustionLevel\"::text,',' ORDER BY \"id\")) FROM \"Character\";")
apply_psql "$SAFETY_DB" >/dev/null 2>&1
AFTER=$(q "$SAFETY_DB" "SELECT md5(string_agg(\"id\"||\"hitDiceTotal\"::text||\"hitDiceRemaining\"::text||\"exhaustionLevel\"::text,',' ORDER BY \"id\")) FROM \"Character\";")
chk "idempotente (checksum)" "$BEFORE" "$AFTER"

echo
echo "############ 5. INVARIANTES FINALES ############"
for db in "$SAFETY_DB"; do
  BAD=$(q "$db" "SELECT count(*) FROM \"Character\" WHERE \"hitDiceTotal\" IS NULL OR \"hitDiceRemaining\" IS NULL OR \"exhaustionLevel\" IS NULL OR \"hitDiceRemaining\" < 0 OR \"hitDiceRemaining\" > \"hitDiceTotal\" OR \"hitDiceTotal\" < 1;")
  chk "$db: 0 filas violan las invariantes" 0 "$BAD"
done

echo

# Limpieza final de la base desechable.
$SAFETY_PSQL -d postgres -c "DROP DATABASE IF EXISTS $SAFETY_DB WITH (FORCE);" >/dev/null 2>&1

echo "############ RESUMEN: $FAIL fallo(s) ############"
exit $FAIL
