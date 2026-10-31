/** Static, read-only configuration validation; not a test suite. Run: npm run validate:config */
import { readFileSync } from 'node:fs';

const read = name => JSON.parse(readFileSync(new URL('../config/' + name, import.meta.url), 'utf8'));
const pokemons = read('pokemons.json');
const ataques = read('ataques.json');
const alcances = read('alcances.json');
const regras = read('regras_gerais.json');
const augments = read('augments.json');
const itens = read('itens.json');
const fases = read('fases.json');
const errors = [];
const check = (ok, message) => { if (!ok) errors.push(message); };
const finite = value => typeof value === 'number' && Number.isFinite(value);
const positive = value => finite(value) && value >= 0;
const stats = ['hp', 'atk', 'def', 'spa', 'spd', 'speed'];

const rangeLevels = new Set();
for (const range of alcances.levels) {
  const level = Number(range.name);
  check(typeof range.name === 'string' && /^[1-9][0-9]*$/.test(range.name) && Number.isSafeInteger(level), 'Nível de alcance inválido: ' + range.name);
  check(!rangeLevels.has(level), 'Nível de alcance duplicado: ' + range.name);
  check(finite(range.value) && range.value === level - 0.5, 'Distância efetiva inválida para alcance ' + range.name);
  rangeLevels.add(level);
}
const validRangeLevel = level => Number.isInteger(level) && rangeLevels.has(level);
const assertStats = (value, label) => {
  for (const key of stats) check(positive(value?.[key]), label + ': atributo ' + key + ' inválido');
};
const moves = ataques.moves;
check(finite(ataques.basic?.offensiveRatio), 'ataques.json: offensiveRatio inválido');
check(positive(ataques.basic?.energyGain), 'ataques.json: energyGain inválido');
for (const [name, move] of Object.entries(moves)) {
  check(typeof move.name === 'string' && move.name.length > 0, 'Ataque sem nome: ' + name);
  check(typeof move.effect === 'string' && move.effect.length > 0, 'Ataque sem efeito: ' + name);
  check(finite(move.baseDamage), 'Dano base inválido: ' + name);
  check(finite(move.specialRatio), 'Relação de SpA inválida: ' + name);
}
for (const [family, species] of Object.entries(pokemons.species)) {
  const label = 'Pokémon ' + family;
  check(Array.isArray(species.names) && species.names.length > 0, label + ': names ausente');
  check(species.pokedexIds?.length === species.names?.length, label + ': nomes e Pokédex desalinhados');
  check(Number.isInteger(species.rarity) && species.rarity >= 1 && species.rarity <= 5, label + ': raridade inválida');
  check(positive(species.energy), label + ': energia inválida');
  check(validRangeLevel(species.rangeLevel), label + ': nível de alcance inválido');
  check(Boolean(moves[species.attack]), label + ': habilidade inexistente ' + species.attack);
  if (species.bossMove) check(Boolean(moves[species.bossMove]), label + ': bossMove inexistente ' + species.bossMove);
  assertStats(species.base, label + '.base');
  if (species.bossBase) assertStats(species.bossBase, label + '.bossBase');
  if (species.stageBases) {
    check(species.stageBases.length === species.names.length, label + ': bases evolutivas desalinhadas');
    species.stageBases.forEach((value, i) => assertStats(value, label + '.stageBases[' + i + ']'));
  }
  if (species.stages) {
    check(species.stages.length <= species.names.length, label + ': etapas acima do total de formas');
    species.stages.forEach((stage, i) => {
      if (stage.move) check(Boolean(moves[stage.move]), label + ': move desconhecido na etapa ' + i);
      if (stage.rangeLevel !== undefined) check(validRangeLevel(stage.rangeLevel), label + ': nível de alcance inválido na etapa ' + i);
      if (stage.energy !== undefined) check(positive(stage.energy), label + ': energia inválida na etapa ' + i);
    });
  }
  if (species.physicalSizes) {
    check(species.physicalSizes.length === species.names.length, label + ': tamanhos não cobrem todas as formas');
    species.physicalSizes.forEach((n,i) => check(finite(n) && n >= .5 && n <= 1.8, label + ': tamanho inválido na forma ' + i));
  }
  if (species.evolutionCopies) species.evolutionCopies.forEach((n,i) => check(Number.isInteger(n) && n >= 2 && n <= 15, label + ': cópias inválidas na etapa ' + i));
}
const odds = regras.shopOddsByLevel;
check(Array.isArray(odds) && odds.length > 0, 'Tabela de probabilidades da loja ausente');
for (const [level, row] of (odds || []).entries()) {
  check(Array.isArray(row) && row.length === 5, 'Loja: nível ' + (level + 1) + ' precisa de cinco raridades');
  if (!Array.isArray(row)) continue;
  check(row.every(n => finite(n) && n >= 0 && n <= 100), 'Loja: valores inválidos no nível ' + (level + 1));
  check(Math.abs(row.reduce((sum,n) => sum + n,0) - 100) < .001, 'Loja: probabilidades não somam 100 no nível ' + (level + 1));
}
const augmentIds = new Set();
for (const augment of augments.augments) {
  check(typeof augment.id === 'string' && !augmentIds.has(augment.id), 'Augment duplicado ou sem ID: ' + augment.id);
  augmentIds.add(augment.id);
  check(['bronze','silver','gold','prismatic'].includes(augment.rarity), 'Augment com raridade inválida: ' + augment.id);
}
for (const recipe of Object.keys(itens.recipes)) {
  for (const component of recipe.split('+')) check(Boolean(itens.components[component]), 'Item ' + recipe + ': componente inexistente ' + component);
}
check(fases.stages?.length === fases.stagesPerChapter, 'fases.json: tamanho do capítulo inconsistente');

if (errors.length) {
  console.error('Configuração inválida (' + errors.length + ' problema(s)):\n- ' + errors.join('\n- '));
  process.exitCode = 1;
} else {
  console.log('Configuração válida: ' + Object.keys(pokemons.species).length + ' famílias, ' + Object.keys(moves).length + ' habilidades e ' + augments.augments.length + ' augments.');
}
