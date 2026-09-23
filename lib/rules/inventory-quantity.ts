/**
 * Whether a reduced inventory row is available for an equipped mechanical
 * effect. Production rows always carry a quantity, but pure-rule callers that
 * predate that field intentionally remain compatible when it is absent.
 */
export function hasUsableQuantity(row: { quantity?: number }): boolean {
  if (row.quantity === undefined) return true;

  return Number.isInteger(row.quantity) && row.quantity > 0;
}
