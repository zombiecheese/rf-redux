// The sprites (cels) the client's code asks for by number, as opposed to those the models and explosions in the
// asset files name. tools/asset-inventory.mjs adds these to what the data uses; tools/placeholder-assets.mjs checks
// that it draws every one. Keep it in step with the constants in the files named here.
export const CODE_CELS = [
  { first: 0, count: 128, use: 'Terrain tiles, by terrain code', file: 'view.ts' },
  { first: 630, count: 25, use: 'Submarine frames', file: 'view.ts' },
  { first: 655, count: 100, use: 'Soldiers: 5 directions x (10 frames for Brown, 10 for Green)', file: 'view.ts' },
  { first: 755, count: 1, use: 'Soldier shadow', file: 'view.ts' },
  { first: 756, count: 50, use: 'Swimming soldier: 25 frames a side', file: 'view.ts' },
  { first: 806, count: 6, use: 'Soldier splat', file: 'view.ts' },
  { first: 822, count: 4, use: 'Bunker lift hatch doors (two, Brown then Green)', file: 'view.ts' },
  { first: 826, count: 3, use: 'Bunker lift shaft walls', file: 'view.ts' },
  { first: 829, count: 2, use: 'Bunker lift platform (Brown, Green)', file: 'view.ts' },
  { first: 831, count: 1, use: 'Bunker lift hazard lip', file: 'view.ts' },
  { first: 858, count: 1, use: 'Open gate leaf', file: 'view.ts' },
  ...[0x38d, 0x3a3, 0x393, 0x39f, 0x397, 0x39b].map((first) => ({ first, count: 1, use: 'Building wall variety (swapped in on models that use these walls)', file: 'variety.ts', optional: true })),
  ...[0x3aa, 0x3c0, 0x3b0, 0x3bc, 0x3b4, 0x3b8].map((first) => ({ first, count: 1, use: 'Factory wall variety (swapped in on models that use these walls)', file: 'variety.ts', optional: true })),
  { first: 1503, count: 1, use: 'Shot (when the pack has no shot models)', file: 'view.ts', optional: true },
  { first: 1952, count: 1, use: 'Missile (when the pack has no shot models)', file: 'view.ts', optional: true },
  { first: 1940, count: 1, use: 'Cockpit: bunker console frame', file: 'hud.ts' },
  { first: 1942, count: 1, use: 'Cockpit: bunker console pad', file: 'hud.ts' },
  { first: 1943, count: 4, use: 'Cockpit consoles: tank, jeep, ASV, helicopter', file: 'hud.ts' },
  { first: 1963, count: 1, use: 'Radar grid', file: 'hud.ts' },
  { first: 1968, count: 1, use: 'Grenade pip', file: 'hud.ts' },
  { first: 1977, count: 4, use: 'Helicopter weapon lights, lit and dark', file: 'hud.ts' },
  { first: 2146, count: 10, use: 'Red digits 0-9', file: 'hud.ts' },
  { first: 2156, count: 2, use: 'Weapon icons: jeep, ASV', file: 'hud.ts' },
  { first: 2159, count: 2, use: 'Weapon icons: helicopter, tank', file: 'hud.ts' },
  { first: 2161, count: 4, use: 'Vehicle icons: jeep, helicopter, tank, ASV', file: 'hud.ts' },
  { first: 2075, count: 5, use: 'Bunker screen: shaft, lift top, spotlight, doorway, lift column', file: 'bunker.ts' },
  { first: 2080, count: 4, use: 'Bunker screen: dirt tiles', file: 'bunker.ts' },
  { first: 2084, count: 2, use: 'Bunker screen: lift door, horizon', file: 'bunker.ts' },
  { first: 2087, count: 2, use: 'Bunker screen: clouds', file: 'bunker.ts' },
  { first: 2091, count: 3, use: 'Bunker screen: running lights', file: 'bunker.ts' },
  { first: 2094, count: 8, use: 'Bunker screen: parked tank, jeep, ASV, helicopter (Brown, Green each)', file: 'bunker.ts' },
  ...[2104, 2109, 2114, 2120].map((first, k) => ({ first, count: 1, use: `Death screen: ${['tank', 'jeep', 'ASV', 'helicopter'][k]} life icon`, file: 'skull.ts' })),
  { first: 2125, count: 1, use: 'Death screen: cross over a lost life', file: 'skull.ts' },
  { first: 2126, count: 14, use: 'Laughing skull: 7 faces in Brown\'s helmet, 7 in Green\'s', file: 'skull.ts' },
];

/** The pictures the client loads from screens/. */
export const SCREENS = [
  { name: '1pbscrl', use: 'Cockpit panel, one player', required: true },
  { name: '2pbscrl', use: 'Cockpit panel, split screen', required: true },
  { name: '2pmscr', use: 'Split screen divider', required: true },
];
