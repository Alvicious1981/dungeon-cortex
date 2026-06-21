export const longswordFixture = {
  index: "longsword",
  name: "Longsword",
  equipment_category: {
    index: "weapon",
    name: "Weapon",
    url: "/api/2014/equipment-categories/weapon",
  },
  weapon_category: "Martial",
  weapon_range: "Melee",
  category_range: "Martial Melee Weapons",
  damage: {
    damage_dice: "1d8",
    damage_type: {
      index: "slashing",
      name: "Slashing",
      url: "/api/2014/damage-types/slashing",
    },
  },
  properties: [
    {
      index: "versatile",
      name: "Versatile",
      url: "/api/2014/weapon-properties/versatile",
    },
  ],
  url: "/api/2014/equipment/longsword",
} as const;
