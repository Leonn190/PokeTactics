import { ATTACKS, RULES, calculateStats, gridXY, SPECIES } from '../data';
import type { Battle, CombatEffect, CombatMetrics, CombatUnit, Element, Player, Pokemon, StageType } from '../types';

const metrics = (): CombatMetrics => ({ dealt: 0, physicalDealt: 0, specialDealt: 0, taken: 0, healed: 0, blocked: 0 });
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

function makeCombatUnit(pokemon: Pokemon, owner: Player, slot: number, multi: boolean): CombatUnit {
  if (pokemon.position.area !== 'board') throw new Error('Only deployed Pokémon may battle');
  const { col, row: localRow } = pokemon.position;
  const row = multi ? localRow + 4 : slot === 0 ? localRow + 4 : 3 - localRow;
  const point = gridXY(col, row);
  // Quatro tabuleiros 7×4 contíguos, sem tabuleiro central sobreposto.
  // Cada jogador ocupa um quadrante e sua linha 0 fica próxima do centro.
  const quadrants = [{ x: -2.2, sign: -1 }, { x: 2.2, sign: -1 }, { x: -2.2, sign: 1 }, { x: 2.2, sign: 1 }];
  const quadrant = quadrants[slot % quadrants.length];
  const { x, y } = multi
    ? { x: quadrant.x + (col - 3) * .6 + (localRow % 2 ? .13 : -.13), y: quadrant.sign * (.42 + localRow * .81) }
    : point;
  const stats = calculateStats(pokemon.family, pokemon.level, pokemon.iv, pokemon.stage);
  const species = SPECIES[pokemon.family];
  const maxHp = Math.round(stats.hp * RULES.combatHealthMultiplier + RULES.combatHealthFlat);
  return {
    id: `${owner.id}:${pokemon.id}`, sourceId: pokemon.id, playerId: owner.id,
    family: pokemon.family, stage: pokemon.stage, level: pokemon.level,
    col, row, x, y, hp: maxHp, maxHp, energy: 0,
    energyNeeded: species.energy, range: species.range,
    stats, cooldown: Math.max(RULES.minAttackCooldown, RULES.attackCooldownBase - stats.speed / RULES.attackCooldownSpeedDivisor),
    attackClock: 0.5 + (col % 4) * 0.13,
    flash: 0, effects: [], damageOverTime: null, slow: 0, metrics: metrics()
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

export function createBattleGroup(players: Player[], id: string, kind: StageType = 'battle'): Battle {
  if (players.length < 2) throw new Error('Batalha precisa de dois ou mais participantes');
  const multi = players.length > 2;
  return {
    id, kind, goldRound: kind === 'gold',
    playerA: players[0].id, playerB: players[1].id,
    participants: players.map(p => p.id), rankings: [], knockoutAt: {}, goldDrops: [],
    units: players.flatMap((p, slot) => p.units.filter(u => u.position.area === 'board').map(u => makeCombatUnit(u, p, slot, multi))),
    effects: [], elapsed: 0, resolved: false, winner: null, loser: null,
    benches: Object.fromEntries(players.map(p => [p.id, p.units.filter(u => u.position.area === 'bench').map(u => ({ ...u, position: { ...u.position }, iv: { ...u.iv } }))])),
    traitsByPlayer: Object.fromEntries(players.map(p => [p.id, countTraits(p)]))
  };
}

export function createBattle(playerA: Player, playerB: Player, id: string): Battle {
  return createBattleGroup([playerA, playerB], id);
}

function effect(battle: Battle, source: CombatUnit, target: CombatUnit, kind: CombatEffect['kind'], value: number): void {
  battle.effects.push({
    id: `${battle.id}:${battle.elapsed}:${battle.effects.length}`,
    x: source.x, y: source.y, targetX: target.x, targetY: target.y,
    family: source.family, kind, value: Math.round(value), time: 0, duration: kind === 'ko' ? 0.9 : 0.6
  });
}

function floatingDamage(battle: Battle, target: CombatUnit, amount: number, damageType: 'physical' | 'special' | 'true'): void {
  // Pequenos ticks de veneno se somam em uma só etiqueta por alvo.
  const recent = [...battle.effects].reverse().find(fx => fx.kind === 'damage' && fx.targetId === target.id && fx.damageType === damageType && fx.time < .12);
  if (recent) { recent.value += amount; return; }
  battle.effects.push({ id: `${battle.id}:hit:${battle.elapsed}:${battle.effects.length}`, targetId: target.id,
    x: target.x, y: target.y, targetX: target.x, targetY: target.y,
    kind: 'damage', damageType, family: target.family, value: amount, time: 0, duration: .85 });
}

function knockout(battle: Battle, killer: CombatUnit, target: CombatUnit, damage: number): void {
  effect(battle, killer, target, 'ko', damage);
  if (!battle.units.some(u => u.playerId === target.playerId && u.hp > 0)) battle.knockoutAt[target.playerId] = battle.elapsed;
  if (battle.goldRound && killer.playerId !== target.playerId) {
    battle.goldDrops.push({ id: `${battle.id}:coin:${battle.goldDrops.length}`, x: target.x, y: target.y, ownerId: killer.playerId, claimed: false });
  }
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
  floatingDamage(battle, target, damage, magical ? 'special' : 'physical');
  target.flash = 0.19;
  if (target.hp <= 0) knockout(battle, source, target, damage);
  return damage;
}

function heal(unit: CombatUnit, amount: number): number {
  const gain = Math.min(unit.maxHp - unit.hp, Math.max(0, amount));
  unit.hp += gain;
  unit.metrics.healed += gain;
  return gain;
}

function spell(battle: Battle, source: CombatUnit, target: CombatUnit, traitBoost: number): void {
  const move = ATTACKS.moves[SPECIES[source.family].attack];
  const a = source.stats.atk, s = source.stats.spa;
  deal(battle, source, target, move.baseDamage + a * (move.attackRatio || 0) + s * move.specialRatio, true, traitBoost);
  if (move.effect === 'drain') {
    const gain = heal(source, (move.healBase || 0) + s * (move.healRatio || 0));
    effect(battle, source, source, 'heal', gain);
  } else if (move.effect === 'burn' && target.hp > 0) {
    target.damageOverTime = { amount: (move.dotBase || 0) + s * (move.dotRatio || 0), time: move.dotDuration || 3, sourceId: source.id };
  } else if (move.effect === 'slow' && target.hp > 0) {
    target.slow = move.slowDuration || 2;
  } else if (move.effect === 'chain') {
    let chained: CombatUnit | null = null;
    let nearest = Infinity;
    for (const u of battle.units) {
      if (u.playerId === source.playerId || u.id === target.id || u.hp <= 0) continue;
      const d = (u.x - target.x) ** 2 + (u.y - target.y) ** 2;
      if (d < nearest) { chained = u; nearest = d; }
    }
    if (chained && distance(chained, target) < (move.chainRange || 2.6)) {
      deal(battle, source, chained, (move.chainBase || 0) + s * (move.chainRatio || 0), true, traitBoost);
      effect(battle, source, chained, 'spell', 0);
    }
  }
  effect(battle, source, target, 'spell', 0);
}

function resolve(battle: Battle): void {
  const living = battle.participants.filter(id => battle.units.some(u => u.playerId === id && u.hp > 0));
  if (living.length > 1 && battle.elapsed < 120) return;
  const score = (id: string) => battle.units.filter(u => u.playerId === id).reduce((sum, u) => sum + Math.max(0, u.hp) / u.maxHp, 0);
  // A later knockout beats an earlier one; survivors are sorted by remaining health when timed out.
  battle.rankings = [...battle.participants].sort((a, b) => {
    const aAlive = living.includes(a), bAlive = living.includes(b);
    if (aAlive !== bAlive) return aAlive ? -1 : 1;
    if (!aAlive && !bAlive) return (battle.knockoutAt[b] ?? -1) - (battle.knockoutAt[a] ?? -1);
    return score(b) - score(a) || battle.participants.indexOf(a) - battle.participants.indexOf(b);
  });
  battle.resolved = true;
  battle.winner = battle.rankings[0] || null;
  battle.loser = battle.rankings[battle.rankings.length - 1] || null;
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
      floatingDamage(battle, unit, applied, 'special');
      const source = battle.units.find(other => other.id === unit.damageOverTime?.sourceId);
      if (source) {
        source.metrics.dealt += applied; source.metrics.specialDealt += applied;
        if (unit.hp <= 0) knockout(battle, source, unit, applied);
      }
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
      const basic = ATTACKS.basic;
      const raw = basic.damageBase + unit.stats.atk * basic.physicalAttackRatio;
      deal(battle, unit, target, raw, false, fireBoost);
      effect(battle, unit, target, 'physical', raw);
      if (alliedTraits.poison && target.hp > 0) target.damageOverTime = { amount: 3 * Math.min(3, alliedTraits.poison), time: 3, sourceId: unit.id };
      unit.energy = Math.min(unit.energyNeeded, unit.energy + basic.energyGain);
    }
    unit.attackClock = unit.cooldown * (alliedTraits.electric ? 0.86 : 1) * (unit.slow ? 1.3 : 1);
  }
  resolve(battle);
}

export function forceResolveBattle(battle: Battle): void {
  if (!battle.resolved) { battle.elapsed = 120; resolve(battle); }
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
