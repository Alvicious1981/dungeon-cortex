-- Snapshot de eventos para reproducir un duplicado (DC-AUD-004).
--
-- Un duplicado responde hoy con `duplicate` + `done`, así que el turno
-- reproducido llega mudo: el cliente no ve daño ni avance de turno y solo
-- reconcilia por su refresco habitual. Esta columna guarda los `GameEvent`
-- deterministas que emitió la primera ejecución para poder reemitirlos.
--
-- Columna propia y no reutilización de `responseBody`: aquello es el cuerpo
-- HTTP a reproducir para los cierres no-streaming (`/roll`, rechazos), y
-- mezclar ambos significados en una columna la volvería polimórfica según el
-- valor de `responseStatus`.
--
-- Nullable y sin backfill a propósito: los recibos anteriores a esta migración
-- siguen reproduciéndose en silencio, que es el comportamiento actual. El
-- enriquecimiento es best-effort y nunca condiciona la transición mecánica.
--
-- No se toca RLS: la tabla ya la tiene activada desde la migración que la creó
-- (20260904120000), y RLS es por tabla, no por columna.

ALTER TABLE "ActionRequestReceipt"
  ADD COLUMN "replayEvents" JSONB;
