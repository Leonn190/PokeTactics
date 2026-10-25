// Mechanical migration of roster and ability parameters from the supplied v11.2 specification.
// Run with `node scripts/apply-v11-spec.mjs` from the project root.
import fs from 'node:fs';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const spec = read('config/v11-spec.json');
const roster = read('config/pokemons.json');
const attacks = read('config/ataques.json');
const dex = { cubone: 104, marowak: 105, onix: 95, steelix: 208, geodude: 74,
  graveler: 75, golem: 76, chansey: 113, blissey: 242, eevee: 133,
  vaporeon: 134, jolteon: 135, flareon: 136, espeon: 196,
  umbreon: 197, leafeon: 470, glaceon: 471, sylveon: 700 };
const groups = Object.entries(spec.pokemon).filter(([,p]) => p.availability !== 'boss_only')
  .reduce((groups,entry) => { (groups[entry[1].family] ||= []).push(entry); return groups; }, {});
const eeveelutions = spec.implementation_contract.eevee_evolution.branch_ids;
for (const [family, fs] of Object.entries(groups)) {
  const forms = fs.sort((a, b) => a[1].stage - b[1].stage);
  if (family === 'eevee') continue; // The eight branches have their own family IDs, and aren't shop offers.
  const old = roster.species[family];
  const ids = forms.map(([id]) => dex[id] ?? old?.pokedexIds[forms.findIndex(v => v[0] === id)]);
  const move = family === 'cubone' ? 'bone-cubone' : family === 'onix' ? 'rise-onix'
    : family === 'geodude' ? 'rock-geodude' : family === 'chansey' ? 'egg-chansey' : old.attack;
  const data = {
    ...(old || {}), names: forms.map(([, p]) => p.name), pokedexIds: ids,
    rarity: spec.families[family].rarity, shop: spec.families[family].shop,
    glow: old?.glow || ({ cubone:'#d9af72', onix:'#b5bdcc', geodude:'#d2b38b', chansey:'#ffafc4' }[family]),
    base: { ...forms[0][1].base_stats },
    stageBases: forms.map(([, p]) => p.base_stats),
    range: ({ cubone:3, onix:1, geodude:1, chansey:1 })[family] ?? old.range,
    energy: ({ cubone:35, onix:50, geodude:55, chansey:55 })[family] ?? old.energy,
    attack: move, elements: forms[0][1].types,
    basic: old?.basic || { stat:'atk', category:'physical', animation:'Attack' },
    stages: forms.map(([id, p], i) => ({ ...(old?.stages?.[i] || {}), elements:p.types,
      ...(family === 'cubone' ? {range:id==='marowak'?3.2:3, move:`bone-${id}`, energy:35, chargedAnimation:'Shoot'} : {}),
      ...(family === 'onix' ? {range:1, move:`rise-${id}`, energy:50, chargedType:p.types[0], chargedAnimation:'Strike'} : {}),
      ...(family === 'geodude' ? {range:1, move: id==='golem'?'golem-withdraw':`rock-${id}`, energy:id==='golem'?60:55, chargedAnimation:id==='golem'?'Withdraw':'Strike'} : {}),
      ...(family === 'chansey' ? {range:1, move:`egg-${id}`, energy:id==='blissey'?60:55, chargedAnimation:'SpAttack'} : {}) }))
  };
  roster.species[family] = data;
  roster.sprites[family] = ids.map(id => `./sprites/${id}.png`);
}
for (const form of ['eevee', ...eeveelutions]) {
  const p = spec.pokemon[form];
  const ball = spec.eevee_ball_system.forms[form];
  roster.species[form] = {
    names:[p.name], pokedexIds:[dex[form]], rarity:spec.families.eevee.rarity,
    shop:form==='eevee', bossOnly:false, eeveeBranch: form!=='eevee',
    glow:({ eevee:'#d4c69f', vaporeon:'#79caff', flareon:'#ff985d', jolteon:'#f4d85d',
      umbreon:'#948ec5', sylveon:'#f5badf', leafeon:'#a6d46d', glaceon:'#9de4f5', espeon:'#dda3ef' })[form],
    base:p.base_stats, stageBases:[p.base_stats], range:ball.range_tiles,
    energy:ball.charged_attack.energy_cost, attack:`ball-${form}`, elements:p.types,
    basic:{ stat: ball.damage_category==='physical'?'atk':'spa', category:ball.damage_category, animation:'Attack', projectile:'spell' },
    stages:[{ elements:p.types, range:ball.range_tiles, energy:ball.charged_attack.energy_cost,
      move:`ball-${form}`, chargedType:ball.element, chargedAnimation:'Shoot' }]
  };
  roster.sprites[form] = [`./sprites/${dex[form]}.png`];
  attacks.moves[`ball-${form}`] = {
    name:ball.name, effect:'eevee-ball', baseDamage:ball.charged_attack.base_damage,
    attackRatio:ball.charged_attack.stat_ratio, specialRatio:0,
    splashRange:ball.charged_attack.aoe_radius_tiles,
    splashMultiplier:ball.charged_attack.secondary_target_damage_multiplier,
    conversion:ball.conversion
  };
}
for (const [form, entry] of Object.entries(spec.new_family_ability_system.forms)) {
  const move = entry.charged_attack;
  attacks.moves[`${form==='cubone'||form==='marowak'?'bone':'rise'}-${form}`] = {
    name:entry.ability_name, effect:entry.reacts_to_knockup?'bone-throw':'single-knockup',
    baseDamage:move.base_damage, attackRatio:move.atk_ratio, specialRatio:0,
    ...(entry.defense_shred ? {shredBase:entry.defense_shred.shred_base, shredRatio:entry.defense_shred.shred_spa_ratio,
      shredDuration:entry.defense_shred.duration_seconds} : {}),
    ...(entry.control ? {controlDuration:entry.control.duration_seconds} : {})
  };
}
for (const [form, entry] of Object.entries(spec.geodude_chansey_ability_system.forms)) {
  const move = entry.charged_attack;
  attacks.moves[form==='golem'?'golem-withdraw':`${form==='chansey'||form==='blissey'?'egg':'rock'}-${form}`] = {
    name:entry.ability_name, effect:form==='golem'?'withdraw-guard':form==='chansey'||form==='blissey'?'healing-egg':'rock-strike',
    baseDamage:move.base_damage || 0, specialRatio:0,
    attackRatio:move.atk_ratio || 0, healBase:move.base_heal, healRatio:move.spa_ratio,
    splashRange:move.aoe_radius_tiles, skillRange:3.2,
    guardDuration:entry.duration_seconds, guardReduction:entry.damage_reduction_fraction
  };
}
for (const [id, p] of Object.entries(spec.pokemon).filter(([,p]) => p.availability === 'boss_only')) {
  const s = roster.species[id];
  s.base = p.base_stats;
  s.stageBases = [p.base_stats];
  s.bossOnly = true;
  s.elements = p.types;
  s.stages = [{ ...(s.stages?.[0] || {}), elements:p.types }];
}
write('config/pokemons.json', roster);
write('config/ataques.json', attacks);
