import { calculateStats, gridXY, SPECIES } from '../data';
import type { Battle, CombatEffect, CombatMetrics, CombatUnit, Element, Player, Pokemon } from '../types';

const metrics = (): CombatMetrics => ({ dealt: 0, physicalDealt: 0, specialDealt: 0, taken: 0, healed: 0, blocked: 0 });
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

function makeCombatUnit(pokemon: Pokemon, owner: Player, enemySide: boolean): CombatUnit {
  const position = pokemon.position;
  if (position.area !== 'board') throw new Error('Only deployed Pokémon may battle');
  const row = enemySide ? 3 - position.row : 4 + position.row;
  const { x, y } = gridXY(position.col, row);
  const stats = calculateStats(pokemon.family, pokemon.level, pokemon.iv, pokemon.stage);
  const species = SPECIES[pokemon.family];
  const maxHp = Math.round(stats.hp * 5.2 + 60);
  return {
    id: `${owner.id}:${pokemon.id}`, sourceId: pokemon.id, playerId: owner.id,
    family: pokemon.family, stage: pokemon.stage, level: pokemon.level,
    col: position.col, row, x, y, hp: maxHp, maxHp, energy: 0,
    energyNeeded: species.energy, range: species.range,
    stats, cooldown: Math.max(0.48, 1.94 - stats.speed / 175),
    attackClock: 0.5 + (position.col % 4) * 0.13,
    flash: 0, effects: [], damageOverTime: null, slow: 0, metrics: metrics()
  };
}

export function createBattle(playerA: Player, playerB: Player, id: string): Battle {
  const deployed = (p: Player, enemySide: boolean) => p.units
    .filter(u => u.position.area === 'board')
    .map(u => makeCombatUnit(u, p, enemySide));
  return {
    id, playerA: playerA.id, playerB: playerB.id,
    units: [...deployed(playerA, false), ...deployed(playerB, true)],
    effects: [], elapsed: 0, resolved: false, winner: null, loser: null,
    traitsByPlayer: { [playerA.id]: countTraits(playerA), [playerB.id]: countTraits(playerB) }
  };
}

function countTraits(player: Player): Partial<Record<Element, number>> {
  const unique = new Set<string>();
  const count: Partial<Record<Element, number>> = {};
  for (const u of player.units) {
    if (u.position.area !== 'board') continue;
    const key = `${u.family}:${u.stage}`;
    if (unique.has(key)) continue;
    unique.add(key);
    for (const type of SPECIES[u.family].elements) count[type] = (count[type] || 0) + 1;
  }
  return count;
}

function effect(battle: Battle, source: CombatUnit, target: CombatUnit, kind: CombatEffect['kind'], value: number): void {
  battle.effects.push({
    id: `${battle.id}:${battle.elapsed}:${battle.effects.length}`,
    x: source.x, y: source.y, targetX: target.x, targetY: target.y,
    family: source.family, kind, value: Math.round(value), time: 0, duration: kind === 'ko' ? 0.9 : 0.6
  });
}

function deal(battle: Battle, source: CombatUnit, target: CombatUnit, raw: number, magical: boolean, traitBoost = 0): number {
  if (target.hp <= 0) return 0;
  const shield = magical ? target.stats.spd : target.stats.def;
  const mitigation = 100 / (100 + shield * 0.8);
  const defenderTraits = battle.traitsByPlayer[target.playerId];
  const waterReduction = defenderTraits.water ? Math.min(0.32, defenderTraits.water * 0.1) : 0;
  const damage = Math.max(1, raw * mitigation * (1 - waterReduction) * (1 + traitBoost));
  source.metrics.dealt += damage;
  if (magical) source.metrics.specialDealt += damage;
  else source.metrics.physicalDealt += damage;
  target.metrics.taken += damage;
  target.metrics.blocked += Math.max(0, raw * (1 + traitBoost) - damage);
  target.hp = Math.max(0, target.hp - damage);
  target.flash = 0.19;
  if (target.hp <= 0) effect(battle, source, target, 'ko', damage);
  return damage;
}

function heal(unit: CombatUnit, amount: number): number {
  const gain = Math.min(unit.maxHp - unit.hp, Math.max(0, amount));
  unit.hp += gain;
  unit.metrics.healed += gain;
  return gain;
}

function spell(battle: Battle, source: CombatUnit, target: CombatUnit, traitBoost: number): void {
  const a = source.stats.atk;
  const s = source.stats.spa;
  const magic = (raw: number) => deal(battle, source, target, raw, true, traitBoost);
  if (source.family === 'bulbasaur') {
    magic(15 + a * 0.38 + s * 0.65);
    const gain = heal(source, 18 + s * 0.45);
    effect(battle, source, source, 'heal', gain);
  } else if (source.family === 'charmander') {
    magic(22 + s * 1.12);
    target.damageOverTime = { amount: 4 + s * 0.11, time: 3.1, sourceId: source.id };
  } else if (source.family === 'squirtle') {
    magic(15 + a * 0.28 + s * 0.9);
    target.slow = 2.8;
  } else {
    magic(20 + s * 1.25);
    let chained: CombatUnit | null = null;
    let nearest = Infinity;
    for (const u of battle.units) {
      if (u.playerId === source.playerId || u.id === target.id || u.hp <= 0) continue;
      const d = (u.x - target.x) ** 2 + (u.y - target.y) ** 2;
      if (d < nearest) { chained = u; nearest = d; }
    }
    if (chained && distance(chained, target) < 2.6) {
      deal(battle, source, chained, 12 + s * 0.65, true, traitBoost);
      effect(battle, source, chained, 'spell', 0);
    }
  }
  effect(battle, source, target, 'spell', 0);
}

function resolve(battle: Battle): void {
  const a = battle.units.filter(u => u.playerId === battle.playerA && u.hp > 0);
  const b = battle.units.filter(u => u.playerId === battle.playerB && u.hp > 0);
  if (a.length && b.length && battle.elapsed < 120) return;
  const aHealth = a.reduce((sum, u) => sum + u.hp / u.maxHp, 0);
  const bHealth = b.reduce((sum, u) => sum + u.hp / u.maxHp, 0);
  battle.resolved = true;
  battle.winner = aHealth >= bHealth ? battle.playerA : battle.playerB;
  battle.loser = battle.winner === battle.playerA ? battle.playerB : battle.playerA;
}

export function tickBattle(battle: Battle, dt: number): void {
  if (battle.resolved) return;
  battle.elapsed += dt;
  for (let i = battle.effects.length - 1; i >= 0; i--) {
    battle.effects[i].time += dt;
    if (battle.effects[i].time >= battle.effects[i].duration) battle.effects.splice(i, 1);
  }

  for (const unit of battle.units) {
    if (unit.hp <= 0) continue;
    unit.flash = Math.max(0, unit.flash - dt);
    unit.slow = Math.max(0, unit.slow - dt);
    if (unit.damageOverTime) {
      const applied = Math.min(unit.hp, unit.damageOverTime.amount * dt);
      unit.hp -= applied;
      unit.metrics.taken += applied;
      const source = battle.units.find(other => other.id === unit.damageOverTime?.sourceId);
      if (source) { source.metrics.dealt += applied; source.metrics.specialDealt += applied; }
      unit.damageOverTime.time -= dt;
      if (unit.damageOverTime.time <= 0) unit.damageOverTime = null;
    }
    if (unit.hp <= 0) continue;

    const alliedTraits = battle.traitsByPlayer[unit.playerId];
    if (alliedTraits.grass) heal(unit, unit.maxHp * 0.006 * Math.min(3, alliedTraits.grass) * dt);
    unit.attackClock -= dt;
    let target: CombatUnit | null = null;
    let distanceSq = Infinity;
    for (const enemy of battle.units) {
      if (enemy.playerId === unit.playerId || enemy.hp <= 0) continue;
      const squared = (enemy.x - unit.x) ** 2 + (enemy.y - unit.y) ** 2;
      if (squared < distanceSq) { target = enemy; distanceSq = squared; }
    }
    if (!target) continue;
    const d = Math.sqrt(distanceSq);
    if (d > unit.range + 0.08) {
      const travel = Math.min(d - unit.range, dt * (0.68 + unit.stats.speed / 180) * (unit.slow ? 0.65 : 1));
      unit.x += (target.x - unit.x) / d * travel;
      unit.y += (target.y - unit.y) / d * travel;
      continue;
    }
    if (unit.attackClock > 0) continue;
    const fireBoost = alliedTraits.fire ? 0.1 * Math.min(3, alliedTraits.fire) : 0;
    if (unit.energy >= unit.energyNeeded) {
      unit.energy = 0;
      spell(battle, unit, target, fireBoost);
    } else {
      const raw = 8 + unit.stats.atk * 0.48;
      deal(battle, unit, target, raw, false, fireBoost);
      effect(battle, unit, target, 'physical', raw);
      if (alliedTraits.poison) target.damageOverTime = { amount: 3 * Math.min(3, alliedTraits.poison), time: 3, sourceId: unit.id };
      unit.energy = Math.min(unit.energyNeeded, unit.energy + 10);
    }
    unit.attackClock = unit.cooldown * (alliedTraits.electric ? 0.86 : 1) * (unit.slow ? 1.3 : 1);
  }
  resolve(battle);
}

export function forceResolveBattle(battle: Battle): void {
  if (!battle.resolved) {
    battle.elapsed = 120;
    resolve(battle);
  }
}

export function battleMetrics(battle: Battle): Record<string, Record<string, CombatMetrics>> {
  const result: Record<string, Record<string, CombatMetrics>> = {};
  for (const u of battle.units) {
    result[u.playerId] ||= {};
    result[u.playerId][u.sourceId] = { ...u.metrics };
  }
  return result;
}

export function survivors(battle: Battle, playerId: string): number {
  return battle.units.filter(u => u.playerId === playerId && u.hp > 0).length;
}
