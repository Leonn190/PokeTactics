import { ATTACKS, RULES, calculateStats, gridXY, SPECIES } from '../data';
import type { Battle, CombatEffect, CombatMetrics, CombatUnit, Element, Player, Pokemon, StageType } from '../types';

const metrics = (): CombatMetrics => ({ dealt: 0, physicalDealt: 0, specialDealt: 0, taken: 0, healed: 0, blocked: 0 });
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
type AnimationName = NonNullable<CombatUnit['animation']>['name'];
const stageValue = (values: number[] | undefined, stage: number, fallback = 0) => values?.[Math.min(stage, values.length - 1)] ?? fallback;

function animate(unit: CombatUnit, name: AnimationName, duration: number, next?: 'Shoot' | 'Withdraw'): void {
  unit.animation = { name, duration, elapsed: 0, ...(next ? { next } : {}) };
}

function advanceAnimation(unit: CombatUnit, dt: number): void {
  if (!unit.animation) return;
  unit.animation.elapsed += dt;
  if (unit.animation.elapsed < unit.animation.duration) return;
  const next = unit.animation.next;
  if (next) animate(unit, next, next === 'Withdraw' ? unit.spinTime : .48);
  else unit.animation = null;
}

function makeCombatUnit(pokemon: Pokemon, owner: Player, slot: number, multi: boolean): CombatUnit {
  if (pokemon.position.area !== 'board') throw new Error('Only deployed Pokémon may battle');
  const { col, row: localRow } = pokemon.position;
  // Quádrupla: dois tabuleiros 7x8 completos unidos lado a lado (14x8).
  // 0 inferior esquerdo, 1 superior esquerdo, 2 superior direito, 3 inferior direito.
  const upper = multi ? slot === 1 || slot === 2 : slot === 1;
  const row = upper ? 3 - localRow : localRow + 4;
  const point = gridXY(col, row);
  const { x, y } = multi ? { x: point.x + (slot < 2 ? -4.35 : 4.35), y: point.y } : point;
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
    moving: false, facingX: 0, facingY: 1,
    animation: { name: 'Rotate', elapsed: 0, duration: .38 },
    spinTime: 0, spinDuration: 0, spinReduction: 0, waterFxClock: 0, pendingPollen: null,
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

function effect(battle: Battle, source: CombatUnit, target: { x: number; y: number }, kind: CombatEffect['kind'], value: number): void {
  battle.effects.push({
    id: `${battle.id}:${battle.elapsed}:${battle.effects.length}`,
    x: source.x, y: source.y, targetX: target.x, targetY: target.y,
    family: source.family, kind, value: kind === 'pollen' || kind === 'water' ? value : Math.round(value), time: 0,
    duration: kind === 'ko' ? .9 : kind === 'pollen' || kind === 'lightning' ? .52 : kind === 'water' ? .3 : .6
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

function deal(battle: Battle, source: CombatUnit, target: CombatUnit, raw: number, magical: boolean): number {
  if (target.hp <= 0) return 0;
  const shield = magical ? target.stats.spd : target.stats.def;
  const mitigation = 100 / (100 + shield * 0.8);
  // Sinergias elementais são SOMENTE contagem visual: nenhum bônus de combate.
  const damage = Math.max(.001, raw * mitigation * (1 - target.spinReduction));
  source.metrics.dealt += damage;
  if (magical) source.metrics.specialDealt += damage;
  else source.metrics.physicalDealt += damage;
  target.metrics.taken += damage;
  target.metrics.blocked += Math.max(0, raw - damage);
  target.hp = Math.max(0, target.hp - damage);
  floatingDamage(battle, target, damage, magical ? 'special' : 'physical');
  target.flash = 0.19;
  if (damage > target.maxHp * .2 && target.hp > 0) animate(target, 'Hurt', .28, target.spinTime > 0 ? 'Withdraw' : undefined);
  if (target.hp <= 0) knockout(battle, source, target, damage);
  return damage;
}

function heal(unit: CombatUnit, amount: number): number {
  const gain = Math.min(unit.maxHp - unit.hp, Math.max(0, amount));
  unit.hp += gain;
  unit.metrics.healed += gain;
  return gain;
}

function spell(battle: Battle, source: CombatUnit, target: CombatUnit): void {
  const move = ATTACKS.moves[SPECIES[source.family].attack];
  const a = source.stats.atk, s = source.stats.spa;
  if (move.effect === 'pollen') {
    animate(source, 'Charge', .31, 'Shoot');
    const enemies = battle.units.filter(u => u.playerId !== source.playerId && u.hp > 0);
    const radius = move.splashRange || 1.65;
    // Escolhe o agrupamento mais populoso; empate: maior vida somada, depois proximidade.
    const center = [...enemies].sort((u, v) => {
      const members = (candidate: CombatUnit) => enemies.filter(e => distance(e, candidate) <= radius);
      const count = members(v).length - members(u).length;
      if (count) return count;
      const hp = members(v).reduce((n, e) => n + e.hp, 0) - members(u).reduce((n, e) => n + e.hp, 0);
      return hp || distance(source, u) - distance(source, v);
    })[0];
    if (center) {
      // A animação Charge acontece primeiro. Shoot lança o projétil e o dano
      // só é aplicado quando ele atinge o grupo, evitando popups prematuros.
      source.pendingPollen = { targetId: center.id, x: center.x, y: center.y, remaining: .61, launched: false };
    }
    return;
  }
  if (move.effect === 'spin') {
    source.spinTime = (move.seconds || 2) + Math.floor(s / (move.durationSpaStep || 80)) * (move.secondsPerSpA || .25);
    source.spinDuration = source.spinTime;
    source.spinReduction = stageValue(move.shieldByStage, source.stage);
    source.waterFxClock = 0;
    animate(source, 'Withdraw', source.spinTime);
    effect(battle, source, source, 'water', 0);
    return;
  }
  if (move.effect === 'flame-strike') {
    animate(source, 'Strike', .46);
    deal(battle, source, target, a * stageValue(move.damageRatioByStage, source.stage, 1.5), false);
    effect(battle, source, target, 'flame', 0);
    return;
  }
  if (move.effect === 'shock') {
    animate(source, 'Attack', .42);
    deal(battle, source, target, s * stageValue(move.damageRatioByStage, source.stage, 1.2), true);
    effect(battle, source, target, 'lightning', 0);
    const count = stageValue(move.secondaryTargetsByStage, source.stage, 1);
    const other = battle.units.filter(u => u.playerId !== source.playerId && u.id !== target.id && u.hp > 0 && distance(u, target) <= (move.chainRange || 2))
      .sort((u, v) => distance(u, target) - distance(v, target));
    for (const chained of other.slice(0, count)) {
      deal(battle, source, chained, s * stageValue(move.secondaryRatioByStage, source.stage, .6), true);
      effect(battle, target, chained, 'lightning', 0);
    }
    return;
  }
  animate(source, 'Attack', .38);
  deal(battle, source, target, move.baseDamage + a * (move.attackRatio || 0) + s * move.specialRatio, true);
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
      deal(battle, source, chained, (move.chainBase || 0) + s * (move.chainRatio || 0), true);
      effect(battle, source, chained, 'spell', 0);
    }
  }
  effect(battle, source, target, 'spell', 0);
}

function pollenTick(battle: Battle, source: CombatUnit, dt: number): void {
  const pending = source.pendingPollen;
  if (!pending) return;
  const move = ATTACKS.moves[SPECIES[source.family].attack];
  pending.remaining -= dt;
  const center = battle.units.find(u => u.id === pending.targetId) || { x: pending.x, y: pending.y };
  if (!pending.launched && pending.remaining <= .3) {
    effect(battle, source, center, 'pollen', move.splashRange || 1.65);
    pending.launched = true;
  }
  if (pending.remaining > 0) return;
  for (const enemy of battle.units.filter(u => u.playerId !== source.playerId && u.hp > 0 && distance(u, center) <= (move.splashRange || 1.65))) {
    deal(battle, source, enemy, stageValue(move.damageByStage, source.stage) + source.stats.spa * move.specialRatio, true);
  }
  for (const ally of battle.units.filter(u => u.playerId === source.playerId && u.hp > 0)) {
    const gained = heal(ally, stageValue(move.healByStage, source.stage) + source.stats.spa * (move.healRatio || 0));
    if (gained > 0) effect(battle, source, ally, 'heal', gained);
  }
  source.pendingPollen = null;
}

function spinTick(battle: Battle, source: CombatUnit, dt: number): void {
  const move = ATTACKS.moves[SPECIES[source.family].attack];
  const duration = Math.min(dt, source.spinTime);
  const dps = stageValue(move.damageByStage, source.stage) + source.stats.spa * move.specialRatio;
  for (const enemy of battle.units) {
    if (enemy.playerId === source.playerId || enemy.hp <= 0 || distance(source, enemy) > (move.splashRange || 1.7)) continue;
    deal(battle, source, enemy, dps * duration, true);
  }
  source.waterFxClock -= duration;
  if (source.waterFxClock <= 0) {
    effect(battle, source, source, 'water', move.splashRange || 1.7);
    source.waterFxClock = .23;
  }
  source.spinTime = Math.max(0, source.spinTime - duration);
  if (source.spinTime < 0.000001) source.spinTime = 0;
  if (source.spinTime <= 0) {
    source.spinReduction = 0;
    if (source.animation?.name === 'Withdraw') source.animation = null;
  }
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
    unit.moving = false;
    advanceAnimation(unit, dt);
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
    if (unit.pendingPollen) { pollenTick(battle, unit, dt); continue; }
    if (unit.spinTime > 0) { spinTick(battle, unit, dt); continue; }
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
    unit.facingX = target.x - unit.x;
    unit.facingY = target.y - unit.y;
    // Os combatentes entram olhando para a tela e completam a rotação antes de agir.
    if (unit.animation?.name === 'Rotate') continue;
    if (d > unit.range + 0.08) {
      const travel = Math.min(d - unit.range, dt * (0.68 + unit.stats.speed / 180) * (unit.slow ? 0.65 : 1));
      unit.x += (target.x - unit.x) / d * travel;
      unit.y += (target.y - unit.y) / d * travel;
      unit.moving = travel > .001;
      continue;
    }
    if (unit.attackClock > 0) continue;
    if (unit.energy >= unit.energyNeeded) {
      unit.energy = 0;
      spell(battle, unit, target);
    } else {
      animate(unit, unit.family === 'bulbasaur' ? 'Shoot' : 'Attack', .40);
      const basic = ATTACKS.basic;
      const raw = basic.damageBase + unit.stats.atk * basic.physicalAttackRatio;
      deal(battle, unit, target, raw, false);
      effect(battle, unit, target, unit.family === 'bulbasaur' ? 'seed' : 'physical', raw);
      unit.energy = Math.min(unit.energyNeeded, unit.energy + basic.energyGain);
    }
    unit.attackClock = unit.cooldown * (unit.slow ? 1.3 : 1);
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
