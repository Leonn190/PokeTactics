import assert from 'node:assert/strict';
import test from 'node:test';
import { ATTACKS, calculateStats, getStageData, LEGENDARY_FAMILIES, SHOP_FAMILIES, SPECIES } from '../server/data';
import { attackCooldown, attacksPerSecond, mitigatedDamage, totalPower } from '../server/formulas';
import { GameEngine } from '../server/engine';
import { createBattle, createBattleGroup, tickBattle } from '../server/systems/combat';
import { chargedEffectiveness } from '../server/systems/effectiveness';
import type { Battle, CombatUnit, Family, Pokemon, Stats } from '../server/types';

const iv: Stats = { hp: 50, atk: 50, def: 50, spa: 50, spd: 50, speed: 50 };
const make = (family: Family, id: string, col: number, stage = 0): Pokemon => ({
  family, id, stage, level: 1, iv, xp: 0, position: { area: 'board', col, row: 1 }
});
function fight(family: Family, stage = 0, foes = 1, allies = 0): { battle: Battle; source: CombatUnit; enemies: CombatUnit[]; friends: CombatUnit[] } {
  const game = new GameEngine(901);
  game.players[0].units = [make(family, 'actor', 0, stage), ...Array.from({ length: allies }, (_, i) => make('weedle', `friend${i}`, i + 1))];
  game.players[1].units = Array.from({ length: foes }, (_, i) => make('weedle', `foe${i}`, i));
  const battle = createBattle(game.players[0], game.players[1], 'rebalance');
  battle.introElapsed = 1.5;
  const source = battle.units.find(u => u.sourceId === 'actor')!;
  const enemies = battle.units.filter(u => u.playerId === 'p1');
  const friends = battle.units.filter(u => u.playerId === 'p0' && u !== source);
  source.x = 0; source.y = 0; source.animation = null; source.range = 100;
  source.attackClock = 0;
  enemies.forEach((u, i) => { u.x = 1 + i * .2; u.y = 0; u.hp = u.maxHp = 10000; u.stats.def = 0; u.stats.spd = 0; u.attackClock = 1000; u.animation = null; });
  friends.forEach((u, i) => { u.x = -1 - i * .2; u.y = 0; u.attackClock = 1000; u.animation = null; });
  return { battle, source, enemies, friends };
}
function tick(b: Battle, seconds: number, step = .05) {
  for (let i = 0; i < Math.ceil(seconds / step); i++) tickBattle(b, step);
}

test('HP real, poder HP/5, IV/evolução e HP PvE migrado uma única vez', () => {
  const base = { hp: 250, atk: 70, def: 60, spa: 50, spd: 65, speed: 80 };
  assert.equal(totalPower(base), 375);
  for (const family of SHOP_FAMILIES) {
    const stats = calculateStats(family, 1, iv, 0);
    assert.equal(stats.hp, SPECIES[family].base.hp);
    assert.equal(stats.hp, fight(family).source.maxHp);
    const second = SPECIES[family].stageBases?.[1];
    assert.equal(calculateStats(family, 1, iv, 1).hp, second?.hp ?? stats.hp);
  }
  assert.equal(SHOP_FAMILIES.length, 18);
  assert.equal(LEGENDARY_FAMILIES.length, 11);
  assert.ok(LEGENDARY_FAMILIES.every(f => SPECIES[f].base.hp >= 400));
  assert.equal(SPECIES.snorlax.base.hp, 610);
  assert.equal(calculateStats('pikachu', 1, iv, 1).hp, 300);
});

test('curva suave de APS e mitigação DEF/SpD calculadas sem atalhos', () => {
  const expected = [[0,.3], [100,1.5], [200,2.25]];
  for (const [speed, aps] of expected) assert.ok(Math.abs(attacksPerSecond(speed) - aps) < 1e-10);
  assert.ok(Math.abs(attacksPerSecond(50) - .9701779) < .01);
  assert.ok(Math.abs(attacksPerSecond(400) - 3.01171875) < .01);
  assert.ok(attacksPerSecond(600) > attacksPerSecond(400) && attacksPerSecond(10000) <= 3.5);
  assert.ok(Math.abs(attackCooldown(100) - 2/3) < 1e-12);
  for (const def of [0,50,100,200,300]) assert.equal(mitigatedDamage(100,def), 10000/(100+def));
  assert.equal(mitigatedDamage(50,-100), 50);
});

test('cada estágio resolve dados, tipo, ataque básico e animação próprios', () => {
  assert.deepEqual(getStageData('caterpie', 2).elements, ['bug','flying']);
  assert.deepEqual(getStageData('charmander', 2).elements, ['fire','flying']);
  assert.equal(getStageData('caterpie', 0).chargedType, 'poison');
  assert.equal(getStageData('caterpie', 1).chargedAnimation, 'SpAttack');
  assert.equal(getStageData('caterpie', 2).move, 'healing-powder');
  assert.equal(getStageData('weedle', 0).chargedAnimation, 'Strike');
  assert.equal(getStageData('weedle', 1).chargedAnimation, 'Twirl');
  assert.equal(getStageData('weedle', 2).chargedAnimation, 'Jab');
  assert.equal(getStageData('koffing', 0).basic.stat, 'atk');
  assert.equal(getStageData('pikachu', 0).basic.stat, 'spa');
  assert.equal(chargedEffectiveness('bug',['grass']), 1.5);
  assert.equal(chargedEffectiveness('normal',['poison']), 1);
  assert.equal(ATTACKS.basic.offensiveRatio, .5);
});

test('básicos físicos e especiais aguardam contato e concedem 10 de energia', () => {
  for (const [family, physical] of [['weedle',true], ['caterpie',false]] as const) {
    const { battle, source, enemies } = fight(family);
    source.energy = 0;
    source.stats.atk = 100; source.stats.spa = 100;
    tickBattle(battle, .05);
    assert.equal(enemies[0].hp, 10000);
    assert.equal(source.energy, 10);
    source.attackClock = 100;
    tick(battle, .65);
    assert.equal(enemies[0].hp, 9950);
    assert.equal(source.metrics.physicalDealt, physical ? 50 : 0);
    assert.equal(source.metrics.specialDealt, physical ? 0 : 50);
  }
});

test('Caterpie aplica dano venenoso mitigado e não empilha infinitamente', () => {
  const { battle, source, enemies } = fight('caterpie');
  source.stats.spa = 100; source.energy = source.energyNeeded;
  tickBattle(battle, .05);
  source.attackClock = 100;
  tick(battle, .55);
  assert.equal(enemies[0].hp < 10000, true);
  assert.equal(enemies[0].poison?.amount, 11);
  assert.ok(enemies[0].poison!.time > 2.8);
  const before = enemies[0].hp;
  enemies[0].stats.spd = 100;
  tick(battle, 1);
  assert.ok(Math.abs((before - enemies[0].hp) - 4.125) < .4, '11 DPS bruto, 0,75× por tipo e metade após 100 SpD');
  source.attackClock = 0; source.energy = source.energyNeeded; source.stats.spa = 50;
  tickBattle(battle, .05); source.attackClock = 100; tick(battle, .5);
  assert.equal(enemies[0].poison?.amount, 11, 'reaplicação mais fraca renova, não substitui DPS forte');
  assert.ok(enemies[0].poison!.time > 2.8);
  tick(battle, 3.2);
  assert.equal(enemies[0].poison, null);
});

test('Metapod envenena e gera barreira menor; Kakuna renova sua barreira sem empilhar', () => {
  const metapod = fight('caterpie', 1);
  metapod.source.energy = metapod.source.energyNeeded;
  tickBattle(metapod.battle, .05);
  metapod.source.attackClock = 100;
  tick(metapod.battle, .6);
  assert.ok(metapod.source.barrier);
  assert.ok(metapod.enemies[0].poison);
  const kakuna = fight('weedle', 1);
  kakuna.source.stats.def = 100;
  kakuna.source.energy = kakuna.source.energyNeeded;
  tickBattle(kakuna.battle, .05);
  assert.equal(kakuna.source.animation?.name, 'Twirl');
  kakuna.source.attackClock = 100;
  tick(kakuna.battle, .25);
  assert.equal(kakuna.source.barrier?.hp, 145);
  kakuna.source.barrier!.hp = 1;
  kakuna.source.support = { moveId: 'firm-cocoon', time: .01 };
  tickBattle(kakuna.battle, .05);
  assert.equal(kakuna.source.barrier?.hp, 145);
  kakuna.enemies[0].attackClock = 0; kakuna.enemies[0].stats.atk = 800;
  tick(kakuna.battle, .3);
  assert.equal(kakuna.source.barrier, null);
  assert.ok(kakuna.source.metrics.barrierAbsorbed > 0);
  assert.ok(kakuna.source.hp < kakuna.source.maxHp);
});

test('Beedrill executa quatro Jab distintos e cancela ao matar o alvo', () => {
  const { battle, source, enemies } = fight('weedle', 2);
  source.energy = source.energyNeeded; source.stats.atk = 100;
  tickBattle(battle, .05);
  assert.equal(source.animation?.name, 'Jab');
  assert.equal(source.energy, 0);
  source.attackClock = 100;
  tick(battle, 1.1);
  assert.equal(enemies[0].hp, 10000 - 4 * 54 * .75, 'tipo Inseto é resistido pelo Venenoso do alvo');
  assert.equal(source.combo, null);
  const second = fight('weedle', 2);
  second.source.energy = second.source.energyNeeded; second.source.stats.atk = 100;
  second.enemies[0].hp = 60;
  tickBattle(second.battle, .05);
  second.source.attackClock = 100;
  tick(second.battle, .5);
  assert.equal(second.enemies[0].hp, 0);
  assert.equal(second.source.combo, null);
});

test('Butterfree cura os dois aliados com menor percentual, inclusive sem alvo próximo', () => {
  const { battle, source, friends, enemies } = fight('caterpie', 2, 1, 3);
  enemies[0].x = 7; source.range = 3.15;
  friends.forEach((u, i) => { u.maxHp = 500; u.hp = [100,250,400][i]; });
  source.energy = source.energyNeeded;
  tickBattle(battle, .05);
  assert.equal(source.animation?.name, 'FlapAround');
  source.attackClock = 100;
  tick(battle, .35);
  assert.ok(friends[0].hp > 100 && friends[1].hp > 250);
  assert.equal(friends[2].hp, 400);
  const noHeal = fight('caterpie', 2);
  noHeal.source.energy = noHeal.source.energyNeeded;
  tickBattle(noHeal.battle, .05);
  assert.equal(noHeal.source.energy, noHeal.source.energyNeeded, 'sem feridos, não desperdiça carregado');
});

test('Koffing/Weezing causam AoE físico por gás, sem DOT ou dano nos aliados', () => {
  for (const stage of [0,1]) {
    const { battle, source, enemies, friends } = fight('koffing', stage, 3, 1);
    enemies[2].x = 5;
    source.energy = source.energyNeeded; source.stats.atk = 100;
    tickBattle(battle, .05);
    assert.equal(source.animation?.name, 'Gas');
    assert.equal(enemies[0].hp, 10000);
    source.attackClock = 100;
    tick(battle, .36);
    const expected = (stage === 0 ? 120 : 142) * .75; // Weedle resiste Veneno.
    assert.equal(enemies[0].hp, 10000 - expected);
    assert.equal(enemies[1].hp, 10000 - expected);
    assert.equal(enemies[2].hp, 10000);
    assert.equal(enemies[0].poison, null);
    assert.equal(friends[0].hp, friends[0].maxHp);
    assert.equal(source.metrics.specialDealt, 0);
  }
});

test('Snorlax salta, impacta área e incapacita por 1s total (incluindo 0,35s de elevação)', () => {
  const { battle, source, enemies } = fight('snorlax', 0, 3);
  enemies[2].x = 7; source.energy = source.energyNeeded; source.range = 3;
  tickBattle(battle, .05);
  assert.equal(source.animation?.name, 'Hop');
  source.attackClock = 100;
  tick(battle, .3);
  assert.ok(source.jumpHeight > 0);
  assert.equal(enemies[0].hp, 10000);
  tick(battle, .3);
  assert.equal(source.animation?.name, 'Stomp');
  assert.ok(enemies[0].hp < 10000 && enemies[1].hp < 10000);
  assert.equal(enemies[2].hp, 10000);
  assert.ok(enemies[0].stunTime > .95 && enemies[0].knockUpTime > .3);
  enemies[0].attackClock = 0;
  tick(battle, .4);
  assert.ok(enemies[0].stunTime > .55 && enemies[0].knockUpTime === 0);
  assert.equal(enemies[0].metrics.dealt, 0);
  tick(battle, .7);
  assert.equal(enemies[0].stunTime, 0);
});

test('estados também funcionam em PvE e no campo quádruplo', () => {
  const game = new GameEngine(77);
  const bot = { ...game.players[1], id: 'bot:test', units: [make('koffing','gas',0)] };
  game.players[0].units = [make('snorlax','tank',0)];
  const pve = createBattle(game.players[0], bot, 'pve');
  assert.equal(pve.units.find(u => u.playerId === 'bot:test')?.maxHp, 340);
  const quad = createBattleGroup(game.players.slice(0,4), 'quad-effects', 'quad');
  assert.equal(quad.participants.length, 4);
  assert.equal(quad.units[0].maxHp, 610);
  quad.introElapsed = 1.5;
  tick(quad, 2);
  assert.ok(quad.units.every(u => Number.isFinite(u.hp) && Number.isFinite(u.cooldown)));
});
