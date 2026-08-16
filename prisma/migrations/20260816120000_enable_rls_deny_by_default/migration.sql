-- Activa Row Level Security en modo deny-by-default sobre las tablas de
-- aplicación del esquema "public". No crea ninguna policy: con RLS activo y sin
-- policy, ningún rol ajeno al owner puede leer ni escribir una sola fila.
--
-- ─── Por qué ─────────────────────────────────────────────────────────────────
-- El Data API de Supabase (PostgREST y pg_graphql) está publicado en Internet y
-- acepta la anon key en el gateway. Hoy no llega a exponer nada porque el USAGE
-- sobre el esquema "public" está revocado para anon, authenticated y
-- service_role. Pero ese REVOKE es estado vivo de base de datos: no lo reproduce
-- ninguna migración de este historial, no lo documenta ninguna guía y no lo
-- verifica ningún test. Un entorno nuevo construido desde estas migraciones
-- arranca con los defaults de Supabase —USAGE concedido y pg_default_acl sobre
-- "public" repartiendo privilegios a anon— y, con RLS apagado, quedaría abierto
-- a lectura y escritura pública de personajes, campañas, perfiles y memorias.
--
-- Esta migración convierte la negación por defecto en una propiedad versionada
-- del historial, que deja de depender de un GRANT manual irreproducible.
--
-- ─── Por qué no rompe al backend ─────────────────────────────────────────────
-- Prisma conecta con el rol "postgres", que es a la vez owner de estas tablas y
-- tiene rolbypassrls = true. RLS sin FORCE no se aplica al owner, y BYPASSRLS lo
-- salta en cualquier caso. Deliberadamente NO se toca relforcerowsecurity: eso
-- sí alcanzaría al owner y dejaría a la aplicación sin acceso a sus propios
-- datos.
--
-- ─── Por qué no hay policies ─────────────────────────────────────────────────
-- No existe multi-tenancy. lib/auth/session.ts devuelve siempre el mismo usuario
-- privado, así que cualquier policy escrita hoy sería una autoridad de acceso
-- inventada, sin sujeto real que la valide. La negación total es el estado
-- honesto mientras no exista autenticación de verdad.
--
-- ─── Alcance: por qué "_prisma_migrations" queda fuera ───────────────────────
-- El barrido la incluiría (vive en "public", es relkind 'r' y no pertenece a
-- ninguna extensión). Se excluye a propósito, por nombre, por dos razones:
--
--   1. No es modelo de aplicación, sino la contabilidad del propio motor de
--      migraciones. Su contenido —nombres, checksums y marcas de tiempo— ya es
--      público en el repositorio: no hay dato de usuario que proteger.
--
--   2. El radio de daño es asimétrico. Si algún entorno llegara a ejecutar el
--      motor de migraciones con un rol que no sea owner ni tenga BYPASSRLS, RLS
--      sin policy le impediría leer su propio historial y dejaría las
--      migraciones inservibles. Se cambia un beneficio nulo por un modo de fallo
--      real.
--
-- ─── Limitación temporal: LEE ESTO ANTES DE AÑADIR UNA TABLA ─────────────────
-- Esta migración solo puede proteger las tablas que existan en el momento de
-- ejecutarse. Una tabla creada por una migración POSTERIOR no queda cubierta por
-- este barrido y nace sin RLS.
--
-- El contrato que impide que eso pase inadvertido vive en
-- tests/architecture/rls-deny-by-default.test.ts: exige que toda tabla creada
-- después de esta migración active RLS explícitamente en la misma migración que
-- la crea. Si añades una tabla y lo olvidas, ese test se pone rojo.
--
-- ─── Por qué un bloque DO ────────────────────────────────────────────────────
-- Misma razón que 20260806090000, 20260807090000 y 20260814120000: un bloque DO
-- es una sola sentencia, así que PostgreSQL lo ejecuta de forma atómica en
-- cualquier invocación —incluido psql en autocommit— y revierte junto con su DDL
-- si algo falla, sin que un COMMIT explícito caiga sobre una transacción ya
-- abortada.
--
-- ─── Notas sobre el barrido ──────────────────────────────────────────────────
-- El esquema y la tabla se cualifican los dos con %I a partir de la MISMA fila
-- del catálogo, así que la sentencia no depende de search_path y ningún
-- identificador se escribe como literal.
--
-- relkind IN ('r','p') y NOT relispartition: hoy las 23 relaciones de "public"
-- son 'r' y ninguna es partición, así que ambas condiciones son no-ops.
-- Cubren el caso futuro de una tabla particionada, cuyo RLS debe activarse en el
-- padre y no en cada hija, que ya lo hereda.
--
-- La guarda de pg_depend excluye tablas propiedad de una extensión. También es
-- un no-op hoy (ninguna extensión posee tablas en "public"), pero pg_trgm está
-- instalada ahí y demuestra que el esquema puede alojarlas: una migración de
-- seguridad no debe alterar objetos que pertenecen a una extensión.
--
-- relrowsecurity = false hace la migración idempotente: reejecutarla no toca
-- nada.
DO $enable_rls_deny_by_default$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT n.nspname AS nspname, c.relname AS relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       AND NOT c.relispartition
       AND c.relrowsecurity = false
       AND c.relname <> '_prisma_migrations'
       AND NOT EXISTS (
             SELECT 1
               FROM pg_depend d
              WHERE d.classid = 'pg_class'::regclass
                AND d.objid = c.oid
                AND d.deptype = 'e'
           )
     ORDER BY c.relname
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',
      rec.nspname,
      rec.relname
    );
  END LOOP;
END
$enable_rls_deny_by_default$;
