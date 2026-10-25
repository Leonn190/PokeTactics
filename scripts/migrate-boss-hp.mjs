/** Migração idempotente de HP legado dos chefes PvE para a escala real de HP ×5. */
import { readFileSync, writeFileSync } from 'node:fs';
const path = new URL('../config/pokemons.json', import.meta.url);
const config = JSON.parse(readFileSync(path, 'utf8'));
let changed = 0;
const legacyHp = { articuno: 90, zapdos: 90, moltres: 90, mewtwo: 106, mew: 100,
  raikou: 90, entei: 115, suicune: 100, lugia: 106, 'ho-oh': 106, celebi: 100 };
for (const [name, hp] of Object.entries(legacyHp)) {
  const species = config.species[name];
  if (species && !species.shop && species.base.hp === hp) {
    species.base.hp *= 5;
    changed++;
  }
}
if (changed) writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
console.log(`Chefes com HP migrado: ${changed}`);
