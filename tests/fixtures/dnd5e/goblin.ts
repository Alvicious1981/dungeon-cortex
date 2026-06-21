export const goblinFixture = {
  index: "goblin",
  name: "Goblin",
  size: "Small",
  type: "humanoid",
  alignment: "neutral evil",
  armor_class: [{ type: "armor", value: 15 }],
  hit_points: 7,
  hit_dice: "2d6",
  speed: { walk: "30 ft." },
  strength: 8,
  dexterity: 14,
  constitution: 10,
  intelligence: 10,
  wisdom: 8,
  charisma: 8,
  proficiency_bonus: 2,
  xp: 50,
  actions: [
    {
      name: "Scimitar",
      desc: "Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 slashing damage.",
      attack_bonus: 4,
      damage: [
        {
          damage_dice: "1d6+2",
          damage_type: {
            index: "slashing",
            name: "Slashing",
            url: "/api/2014/damage-types/slashing",
          },
        },
      ],
    },
  ],
  url: "/api/2014/monsters/goblin",
} as const;
