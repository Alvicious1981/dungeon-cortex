-- Add equippedSlot to InventoryItem.
-- Nullable TEXT: null = item is in bag, a value = slot name ('MAIN_HAND', 'OFF_HAND', 'ARMOR', 'ACCESSORY', …).
ALTER TABLE "InventoryItem" ADD COLUMN "equippedSlot" TEXT;
