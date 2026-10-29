import { ANIMATIONS, ATTACKS, calculateStats, getStageData, gridXY, SPECIES } from '../data';
import { attackCooldown, mitigatedDamage, stageValue, rawBasicDamage } from '../formulas';
import type { Battle, CombatEffect, CombatMetrics, CombatUnit, Element, Player, Pokemon, StageType, StatKey } from '../types';
import { chargedEffectiveness } from './effectiveness';
import { distance, closestTwo, bestEnemyCluster, bestEggCenter, woundedAllies } from '../combat/targeting';
import { effect, floatingDamage } from '../combat/effects';
import { heal } from '../combat/healing';
import { trainerSpot } from '../combat/trainer-position';
import { bonusStats, effectivePercents, effectCount, numberParam, bumpStack, bonusStat, shieldMultiplier, ITEMS } from './items';
export { trainerSpot } from '../combat/trainer-position';

const moveIdOf = (unit: CombatUnit): string => unit.bossMove || getStageData(unit.family, unit.stage).move;
const combatCooldown = (unit: CombatUnit, now: number): number =>
  attackCooldown(stat(unit,'speed')) * (unit.attackSpeedDebuffUntil > now ? 1 / .85 : 1);
const isTargetable = (unit: CombatUnit): boolean => unit.hp > 0 && !unit.dig;
const metrics = (): CombatMetrics => ({ casts: 0, controlSeconds: 0, dealt: 0, physicalDealt: 0, specialDealt: 0, taken: 0, healed: 0, blocked: 0, blockedPhysical: 0, blockedSpecial: 0, barrierAbsorbed: 0, abilityMitigated: 0 });
function stat(unit: CombatUnit, key: StatKey): number {
  const base = unit.stats[key];
  if (key === 'hp') return base;
  const increase = Math.min(base * .3, unit.buffs.filter(b => b.stat === key).reduce((sum,b) => sum + b.amount, 0));
  const decrease = (key === 'def' || key === 'spd') ? Math.min(base * .3, unit.defenseShreds.filter(b=>b.stat===key).reduce((sum,b) => sum + b.amount, 0)) : 0;
  return Math.max(0, base + increase - decrease + bonusStat(unit,key,unit.itemNow,unit.focusCount));
}

type AnimationName = NonNullable<CombatUnit['animation']>['name'];

function animate(unit: CombatUnit, name: AnimationName, duration: number, next?: string): void {
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

function makeCombatUnit(pokemon: Pokemon, owner: Player, slot: number, multi: boolean, boss = false): CombatUnit {
  if (pokemon.position.area !== 'board') throw new Error('Only deployed Pokémon may battle');
  const { col, row: localRow } = pokemon.position;
  // Quádrupla: dois tabuleiros 7x8 completos unidos lado a lado (14x8).
  // 0 inferior esquerdo, 1 superior esquerdo, 2 superior direito, 3 inferior direito.
  const upper = multi ? slot === 1 || slot === 2 : slot === 1;
  const row = upper ? 3 - localRow : localRow + 4;
  const point = gridXY(col, row);
  const { x, y } = multi ? { x: point.x + (slot < 2 ? -4.35 : 4.35), y: point.y } : point;
  const bossMew = boss && pokemon.family === 'mew';
  const equipment = (pokemon.equipment || []).map(item=>({...item,components:[...item.components]}));
  const stats = bonusStats(calculateStats(pokemon.family, pokemon.level, pokemon.iv, pokemon.stage, bossMew),equipment);
  const stage = getStageData(pokemon.family, pokemon.stage);
  const maxHp = stats.hp;
  return {
    id: `${owner.id}:${pokemon.id}`, sourceId: pokemon.id, playerId: owner.id,
    family: pokemon.family, stage: pokemon.stage, level: pokemon.level, iv: { ...pokemon.iv },
    col, row, x, y, hp: maxHp, maxHp, energy: 0,
    energyNeeded: bossMew ? SPECIES.mew.bossEnergy! : stage.energy, range: (bossMew ? SPECIES.mew.bossRange! : stage.range) + equipment.filter(i=>i.recipe && i.recipe==='red+red').length * numberParam('longbow','range'),
    equipment, itemStacks:{},itemTimers:{regeneration:ITEMS.combatIntroSeconds+numberParam('regeneration','interval'),scaling_spa:ITEMS.combatIntroSeconds+numberParam('scaling_spa','interval'),burn_aura:ITEMS.combatIntroSeconds+numberParam('burn_aura','interval')},itemNow:0,hitSerial:0,focusCount:0,
    ...(bossMew ? { bossMove: SPECIES.mew.bossMove } : {}),
    stats, cooldown: attackCooldown(stats.speed),
    attackClock: 0.5 + (col % 4) * 0.13,
    // Entra já voltado ao lado adversário, sem tocar a animação Rotate de 360°.
    // O Idle permanece animado inclusive durante a entrada das Pokébolas.
    moving: false, facingX: 0, facingY: upper ? 1 : -1,
    animation: null,
    spinTime: 0, spinDuration: 0, spinReduction: 0, waterFxClock: 0, pendingPollen: null,
    flash: 0, effects: [], damageOverTime: null, poison: null, barrier: null,
    barriers: [], buffs: [], defenseShreds: [], guardUntil: 0, combo: null,
    dig: null, storm: null, psychicImbuement: null, attackSpeedDebuffUntil: 0,
    gasTime: 0, support: null, leap: null, charge: null, jumpHeight: 0, stunTime: 0, knockUpTime: 0, knockUpDuration: 0, stunUntil: 0, knockUpUntil: 0,
    slow: 0, metrics: metrics()
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
    for (const type of getStageData(u.family, u.stage).elements) count[type] = (count[type] || 0) + 1;
  }
  return count;
}

export function createBattleGroup(players: Player[], id: string, kind: StageType = 'battle'): Battle {
  if (players.length < 2) throw new Error('Batalha precisa de dois ou mais participantes');
  const multi = players.length > 2;
  return {
    id, kind, goldRound: kind === 'gold', seed:[...id].reduce((n,c)=>Math.imul(n ^ c.charCodeAt(0),16777619) >>> 0,2166136261),
    playerA: players[0].id, playerB: players[1].id,
    participants: players.map(p => p.id), rankings: [], knockoutAt: {}, goldDrops: [],
    units: players.flatMap((p, slot) => p.units.filter(u => u.position.area === 'board').map(u => makeCombatUnit(u, p, slot, multi, kind === 'boss' && p.id.startsWith('bot:')))),
    effects: [], knockupEvents: [], elapsed: 0, introElapsed: 0, outcomeElapsed: 0, resolved: false, winner: null, loser: null,
    benches: Object.fromEntries(players.map(p => [p.id, p.units.filter(u => u.position.area === 'bench').map(u => ({ ...u, position: { ...u.position }, iv: { ...u.iv } }))])),
    traitsByPlayer: Object.fromEntries(players.map(p => [p.id, countTraits(p)]))
  };
}

export function createBattle(playerA: Player, playerB: Player, id: string): Battle {
  return createBattleGroup([playerA, playerB], id);
}

// A animação do projétil e a aplicação do dano compartilham o mesmo relógio.
// O impacto ocorre no mesmo ponto (fração da duração) em que o canvas desenha a chegada.
function projectile(battle: Battle, caster: CombatUnit, target: CombatUnit,
  kind: CombatEffect['kind'], raw: number, magical: boolean, charged: boolean,
  arrival: number, onHit?: 'drain' | 'burn' | 'slow' | 'poison', origin: CombatUnit = caster,
  moveId?: string, attackType?: Element, special?: NonNullable<CombatEffect['pendingHit']>['special']): void {
  effect(battle, origin, target, kind, 0);
  battle.effects[battle.effects.length - 1].pendingHit = {
    sourceId: caster.id, targetId: target.id, raw, magical, charged, arrival, onHit, moveId, attackType, special
  };
}

// Segment sweep: a hit cannot be skipped by accelerated combat or a large dt.
function segmentDistanceSq(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  const vx = bx - ax, vy = by - ay, lengthSq = vx * vx + vy * vy;
  const t = lengthSq ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / lengthSq)) : 0;
  return (px - ax - t * vx) ** 2 + (py - ay - t * vy) ** 2;
}

function arenaBoundary(battle: Battle): { minX: number; maxX: number; minY: number; maxY: number } {
  const quad = battle.participants.length > 2;
  return { minX: quad ? -8.25 : -3.95, maxX: quad ? 8.25 : 3.95, minY: -3.62, maxY: 3.62 };
}

/** Maximal unobstructed resting location; enemies may be crossed but never occupied at the end. */
function chargeEndpoint(battle: Battle, source: CombatUnit, dx: number, dy: number): number {
  const bounds = arenaBoundary(battle);
  const limit = Math.min(3,
    dx > 0 ? (bounds.maxX - source.x) / dx : dx < 0 ? (bounds.minX - source.x) / dx : 3,
    dy > 0 ? (bounds.maxY - source.y) / dy : dy < 0 ? (bounds.minY - source.y) / dy : 3);
  for (let step = Math.floor(Math.max(0, limit) * 20); step >= 6; step--) {
    const travel = step / 20;
    const x = source.x + dx * travel, y = source.y + dy * travel;
    if (!battle.units.some(u => u !== source && u.hp > 0 && Math.hypot(u.x - x, u.y - y) < .58)) return travel;
  }
  return 0;
}

function bestCharge(battle: Battle, source: CombatUnit, primary: CombatUnit | null) {
  const enemies = battle.units.filter(u => u.hp > 0 && u.playerId !== source.playerId);
  if (!enemies.length) return null;
  const vectors = [
    ...Array.from({ length: 8 }, (_, i) => ({ x: Math.cos(i * Math.PI / 4), y: Math.sin(i * Math.PI / 4) })),
    ...enemies.map(enemy => { const d = distance(source, enemy) || 1;
      return { x: (enemy.x - source.x) / d, y: (enemy.y - source.y) / d }; })
  ];
  return vectors.map(dir => {
    const travel = chargeEndpoint(battle, source, dir.x, dir.y);
    const length = Math.min(2.15, travel);
    const hit = enemies.filter(enemy => length > 0 &&
      segmentDistanceSq(source.x, source.y, source.x + dir.x * length, source.y + dir.y * length, enemy.x, enemy.y) <= .52 ** 2);
    return { ...dir, travel, hit, primaryHit: primary ? hit.includes(primary) : false };
  }).filter(path => path.travel > 0).sort((a, b) =>
    b.hit.length - a.hit.length || Number(b.primaryHit) - Number(a.primaryHit) || b.travel - a.travel)[0] || null;
}

function piercingFire(battle: Battle, source: CombatUnit, target: CombatUnit, raw: number, moveId: string, type: Element): void {
  const d = Math.max(.001, distance(source, target));
  const dx = (target.x - source.x) / d, dy = (target.y - source.y) / d;
  const startX = source.x + dx * .34, startY = source.y + dy * .34;
  const bounds = arenaBoundary(battle);
  const travel = Math.min(
    dx > 0 ? (bounds.maxX - startX) / dx : dx < 0 ? (bounds.minX - startX) / dx : Infinity,
    dy > 0 ? (bounds.maxY - startY) / dy : dy < 0 ? (bounds.minY - startY) / dy : Infinity);
  // At the same rate as the displayed projectile. Keep a fixed ray after launch.
  const fx: CombatEffect = {
    id: `${battle.id}:pierce:${battle.elapsed}:${battle.effects.length}`,
    kind: 'piercing-flame', family: source.family, value: 0, time: 0,
    duration: Math.max(.05, travel / 8.5), x: startX, y: startY,
    targetX: startX + dx * travel, targetY: startY + dy * travel,
    piercing: { sourceId: source.id, raw, attackType: type, hitIds: [] }
  };
  battle.effects.push(fx);
}

function applyKnockup(battle: Battle, source: CombatUnit, target: CombatUnit, seconds: number, airborneSeconds=seconds): void {
  if (target.hp <= 0 || target.dig || target.controlImmune || target.knockUpUntil > battle.elapsed
    || (effectCount(target,'opening_immunity') && battle.elapsed<ITEMS.combatIntroSeconds+numberParam('opening_immunity','duration'))) return;
  const until = battle.elapsed + seconds;
  source.metrics.controlSeconds += Math.max(0, until-Math.max(battle.elapsed,target.stunUntil));
  target.stunUntil = Math.max(target.stunUntil, until);
  target.knockUpUntil = battle.elapsed + airborneSeconds;
  target.stunTime = target.stunUntil-battle.elapsed;
  target.knockUpTime = airborneSeconds;
  target.knockUpDuration = airborneSeconds;
  const event = { battle_id:battle.id, source_unit_id:source.id, target_unit_id:target.id,
    knockup_instance_id:`${battle.id}:air:${battle.knockupEvents.length}`, start_time:battle.elapsed };
  battle.knockupEvents.push(event);
  // The reaction belongs to this battle alone. One bone from each surviving allied caster.
  for (const ally of battle.units) {
    if (ally.hp <= 0 || ally.playerId !== source.playerId || ally.family !== 'cubone') continue;
    const stage = getStageData(ally.family, ally.stage), move = ATTACKS.moves[stage.move];
    projectile(battle, ally, target, 'bone', move.baseDamage + stat(ally,'atk') * (move.attackRatio || 0),
      false, true, .78, undefined, ally, stage.move, stage.chargedType, 'bone-throw');
  }
}

function applyShred(battle: Battle, caster: CombatUnit, target: CombatUnit): void {
  const move = ATTACKS.moves[getStageData(caster.family,caster.stage).move];
  const proposed = Math.floor((move.shredBase || 0) + stat(caster,'spa') * (move.shredRatio || 0));
  const cap = Math.floor(target.stats.def * .3);
  const amount = Math.min(proposed,cap,stat(target,'def'));
  const prior = target.defenseShreds.find(b => b.sourceId === caster.id);
  if (prior) { prior.amount = Math.max(prior.amount, amount); prior.until = battle.elapsed + (move.shredDuration || 5); }
  else target.defenseShreds.push({ sourceId:caster.id, stat:'def', amount, until:battle.elapsed + (move.shredDuration || 5) });
}

function applyBallConversion(battle: Battle, caster: CombatUnit, amount: number): void {
  const move = ATTACKS.moves[getStageData(caster.family,caster.stage).move];
  const conversion = move.conversion;
  if (!conversion || conversion.kind === 'none' || amount <= 0) return;
  const allies = closestTwo(battle,caster);
  for (const ally of allies) {
    if (conversion.kind === 'stat_buff' && conversion.stat) {
      const points = Math.min(50, Math.floor(amount * (conversion.points_per_damage_per_ally || 0)));
      const previousCooldown = ally.cooldown;
      const old = ally.buffs.find(b => b.sourceId === caster.id && b.stat === conversion.stat);
      if (old) { old.amount = Math.max(points,old.amount); old.until = battle.elapsed + (conversion.duration_seconds || 6); }
      else ally.buffs.push({ sourceId:caster.id, stat:conversion.stat, amount:points, until:battle.elapsed + (conversion.duration_seconds || 6) });
      if (conversion.stat === 'speed') {
        ally.cooldown = attackCooldown(stat(ally,'speed'));
        ally.attackClock *= ally.cooldown/previousCooldown;
      }
    } else if (conversion.kind === 'heal') {
      heal(battle, ally, amount * (conversion.healing_pool_per_damage || 0) / allies.length, caster);
    } else if (conversion.kind === 'barrier') {
      const desired = amount * (conversion.shield_pool_per_damage || 0) / allies.length;
      const old = ally.barriers.find(b => b.sourceId === caster.id);
      const activeOther = ally.barriers.filter(b => b.sourceId !== caster.id).reduce((sum,b) => sum+b.hp,0);
      const cap = Math.min(ally.maxHp*.35, ally.maxHp * (conversion.max_barrier_fraction_of_target_max_hp || .35));
      const hp = Math.max(0, Math.min(Math.max(old?.hp || 0,desired)*shieldMultiplier(ally), cap, ally.maxHp*.35-activeOther));
      if (old) { old.hp = hp; old.until = battle.elapsed + (conversion.duration_seconds || 5); }
      else ally.barriers.push({ sourceId:caster.id, hp, until:battle.elapsed+(conversion.duration_seconds || 5), kind:'eevee' });
      if (hp) effect(battle,caster,ally,'shield',hp);
    }
  }
}

function landProjectiles(battle: Battle, dt: number): void {
  for (const fx of battle.effects) {
    if (fx.pendingHit) {
      const movingTarget = battle.units.find(u => u.id === fx.pendingHit!.targetId && u.hp > 0);
      if (movingTarget) { fx.targetX = movingTarget.x; fx.targetY = movingTarget.y; }
    }
    const oldTime = fx.time;
    fx.time += dt;
    if (fx.piercing) {
      const hit = fx.piercing;
      const caster = battle.units.find(u => u.id === hit.sourceId);
      if (!caster) continue;
      const a = Math.min(1, oldTime / fx.duration), b = Math.min(1, fx.time / fx.duration);
      if (a >= 1) continue;
      const ax = fx.x + (fx.targetX - fx.x) * a, ay = fx.y + (fx.targetY - fx.y) * a;
      const bx = fx.x + (fx.targetX - fx.x) * b, by = fx.y + (fx.targetY - fx.y) * b;
      for (const target of battle.units) {
        if (target.playerId === caster.playerId || !isTargetable(target) || hit.hitIds.includes(target.id)) continue;
        if (segmentDistanceSq(ax, ay, bx, by, target.x, target.y) > .43 ** 2) continue;
        hit.hitIds.push(target.id);
        deal(battle, caster, target, hit.raw, true, true, hit.attackType);
      }
      continue;
    }
    const hit = fx.pendingHit;
    if (!hit || fx.time < fx.duration * hit.arrival) continue;
    fx.pendingHit = undefined; // impacto único, inclusive em simulações aceleradas
    const caster = battle.units.find(u => u.id === hit.sourceId);
    const target = battle.units.find(u => u.id === hit.targetId);
    if (!caster || !target) continue;
    const move = ATTACKS.moves[hit.moveId || moveIdOf(caster)];
    if (hit.special === 'mew-blessing') {
      // A projectile aimed at a defeated/buried ally dissipates safely instead of healing a different unit off-screen.
      const ally = isTargetable(target) ? target : null;
      if (ally) {
        heal(battle,ally,(move.healBase || 0)+stat(caster,'spa')*(move.healRatio || 0),caster);
        const value = ((move.shieldBase || 0)+stat(caster,'spa')*(move.shieldSpaRatio || 0))*shieldMultiplier(ally);
        const old = ally.barriers.find(b => b.kind === 'mew' && b.sourceId === caster.id);
        if (old) { old.hp = value; old.until = battle.elapsed + (move.shieldDuration || 3); }
        else ally.barriers.push({kind:'mew',sourceId:caster.id,hp:value,until:battle.elapsed+(move.shieldDuration || 3)});
        effect(battle,caster,ally,'shield',value);
        ally.psychicImbuement = {sourceId:caster.id,extraDamage:(move.bonusBase || 0)+stat(caster,'spa')*(move.bonusSpaRatio || 0),until:battle.elapsed+(move.buffDuration || 3)};
        effect(battle,caster,ally,'psychic-spark',0);
      }
      continue;
    }
    if (hit.special === 'dragon-cyclone') {
      const center = {x:fx.targetX,y:fx.targetY};
      const radius = move.splashRange || 1;
      const enemies = battle.units.filter(u => isTargetable(u) && u.playerId !== caster.playerId && distance(u,center) <= radius);
      for (const enemy of enemies) {
        deal(battle,caster,enemy,hit.raw*(enemy.id===target.id?1:move.splashMultiplier || .5),true,true,'dragon');
        applyAttackSlow(battle,enemy,move.slowDuration || 2);
      }
      effect(battle,caster,center,'dragon-tornado',radius);
      continue;
    }
    if (hit.special === 'eevee-ball') {
      const center = { x:fx.targetX, y:fx.targetY };
      const radius = move.splashRange || 1.65;
      let actual = 0;
      for (const enemy of battle.units.filter(u => u.hp > 0 && u.playerId !== caster.playerId && distance(u,center) <= radius)) {
        actual += deal(battle, caster, enemy, hit.raw * (enemy.id === hit.targetId ? 1 : move.splashMultiplier || .85),
          hit.magical, true, hit.attackType);
      }
      effect(battle,caster,center,'impact',radius);
      applyBallConversion(battle,caster,actual);
      continue;
    }
    if (hit.special === 'healing-egg') {
      const center = { x:fx.targetX, y:fx.targetY };
      for (const ally of battle.units.filter(u => u.hp > 0 && u.playerId === caster.playerId && distance(u,center) <= (move.splashRange || 1.65))) {
        heal(battle, ally,(move.healBase || 0) + stat(caster,'spa')*(move.healRatio || 0),caster);
      }
      effect(battle,caster,center,'impact',move.splashRange || 1.65);
      continue;
    }
    if (!isTargetable(target)) continue;
    deal(battle, caster, target, hit.raw, hit.magical, hit.charged, hit.attackType);
    if (hit.special === 'dragon-breath') applyAttackSlow(battle,target,move.slowDuration || 2);
    // Additional psychic component is strictly tied to landing a regular basic.
    if (!hit.charged && target.hp > 0 && caster.psychicImbuement && caster.psychicImbuement.until > battle.elapsed) {
      const buff = caster.psychicImbuement;
      const mew = battle.units.find(u => u.id === buff.sourceId);
      if (mew) { deal(battle,mew,target,buff.extraDamage,true,false,'psychic'); effect(battle,mew,target,'psychic-spark',0); }
    }
    if (hit.special === 'bone-throw') { if (target.hp > 0) applyShred(battle,caster,target); continue; }
    if (hit.special === 'single-knockup') { applyKnockup(battle,caster,target,move.controlDuration || .75); continue; }
    if (hit.special === 'rock-strike') continue;
    if (hit.onHit === 'drain') {
      heal(battle, caster, (move.healBase || 0) + caster.stats.spa * (move.healRatio || 0));
    } else if (hit.onHit === 'burn' && target.hp > 0) {
      target.damageOverTime = { amount: (move.dotBase || 0) + caster.stats.spa * (move.dotRatio || 0), time: move.dotDuration || 3, sourceId: caster.id };
    } else if (hit.onHit === 'slow' && target.hp > 0) {
      target.slow = move.slowDuration || 2;
      target.attackClock *= 1.3;
    } else if (hit.onHit === 'poison' && target.hp > 0) {
      const amount = (move.dotBase || 0) + caster.stats.spa * (move.dotRatio || 0);
      if (!target.poison || amount >= target.poison.amount) {
        target.poison = { amount, time: move.dotDuration || 3, sourceId: caster.id, accumulator: 0 };
      } else target.poison.time = move.dotDuration || 3;
      effect(battle, caster, target, 'poison', 0);
    }
    if (hit.chain?.remaining) {
      const next = battle.units.filter(u => u.playerId !== caster.playerId && u.hp > 0 &&
        !hit.chain!.visited.includes(u.id) && distance(u, target) <= hit.chain!.range)
        .sort((a, b) => distance(a, target) - distance(b, target))[0];
      if (next) {
        projectile(battle, caster, next, 'lightning', caster.stats.spa * hit.chain.ratio,
          true, true, 1 / 3, undefined, target, hit.moveId, hit.attackType);
        battle.effects[battle.effects.length - 1].pendingHit!.chain = {
          ...hit.chain, remaining: hit.chain.remaining - 1, visited: [...hit.chain.visited, next.id]
        };
      }
    }
  }
}

function knockout(battle: Battle, killer: CombatUnit, target: CombatUnit, damage: number): void {
  effect(battle, killer, target, 'ko', damage);
  if (!battle.units.some(u => u.playerId === target.playerId && u.hp > 0)) battle.knockoutAt[target.playerId] = battle.elapsed;
  if (battle.goldRound && killer.playerId !== target.playerId) {
    battle.goldDrops.push({ id: `${battle.id}:coin:${battle.goldDrops.length}`, x: target.x, y: target.y, ownerId: killer.playerId, claimed: false });
  }
}

/** Damage is resolved only on the simulation thread. DOT/reflect/extra hits cannot proc themselves. */
function deal(battle: Battle, source: CombatUnit, target: CombatUnit, raw: number, magical: boolean, charged = false, attackType?: Element,
  mode: 'normal' | 'dot' | 'reflect' | 'extra' = 'normal'): number {
  if (target.hp <= 0 || target.dig) return 0;
  const defense = magical ? stat(target,'spd') : stat(target,'def');
  const element = attackType || getStageData(source.family, source.stage).chargedType;
  const typeFactor = charged ? chargedEffectiveness(element, getStageData(target.family, target.stage).elements) : 1;
  const attacker=effectivePercents(source,battle.elapsed);
  const defender=effectivePercents(target,battle.elapsed);
  // Hit serial participates in a deterministic seeded 32-bit roll. No Math.random in combat.
  source.hitSerial++;
  let bits = (battle.seed ^ Math.imul(source.hitSerial, 0x9e3779b9)) >>> 0;
  bits ^= bits >>> 16; bits = Math.imul(bits, 0x7feb352d); bits ^= bits >>> 15;
  bits = Math.imul(bits, 0x846ca68b); bits ^= bits >>> 16;
  const critical = mode==='normal' && (!charged || effectCount(source,'spell_critical')>0)
    && (bits >>> 0)/4294967296 < attacker.critChance;
  let critFactor=critical ? attacker.critDamage : 1;
  if (critical && effectCount(target,'bramble')) critFactor=1+(critFactor-1)*(1-numberParam('bramble','criticalExtraReduction'));
  const execution= !charged && effectCount(source,'executioner') && target.hp/Math.max(1,target.maxHp)<numberParam('executioner','threshold')
    ? 1+numberParam('executioner','amplification') : 1;
  const unguarded = Math.max(0, raw) * typeFactor * (1 - target.spinReduction) *
    (1+attacker.amplification) * execution * critFactor;
  const afterAbility = unguarded * (target.guardUntil > battle.elapsed ? .4 : 1);
  if (unguarded > afterAbility) { const blocked = mitigatedDamage(unguarded-afterAbility, defense);
    target.metrics.abilityMitigated += blocked; target.metrics.blocked += blocked;
    if (magical) target.metrics.blockedSpecial += blocked; else target.metrics.blockedPhysical += blocked; }
  const afterDefense = mitigatedDamage(afterAbility, defense);
  const blockedByStat = Math.max(0, afterAbility - afterDefense);
  target.metrics.blocked += blockedByStat;
  if (magical) target.metrics.blockedSpecial += blockedByStat;
  else target.metrics.blockedPhysical += blockedByStat;
  let damage = afterDefense * (1-defender.durability);
  if (magical && effectCount(target,'magic_guard')) damage*=1-numberParam('magic_guard','specialReduction');
  // Shield bonus applies to shield HP ONLY. Spillover into ordinary life
  // conserves the unamplified portion of the attack rather than multiplying it.
  const shieldFactor = charged && mode === 'normal' && effectCount(source,'magic_sunder')
    ? 1 + numberParam('magic_sunder','shieldBonus') : 1;
  let absorbedTotal = 0;
  const absorbShield = (shieldHp: number): number => {
    const absorbed = Math.min(shieldHp, damage * shieldFactor);
    damage = Math.max(0, damage - absorbed / shieldFactor);
    absorbedTotal += absorbed;
    target.metrics.barrierAbsorbed += absorbed;
    return absorbed;
  };
  if (target.barrier && target.barrier.time > 0) {
    target.barrier.hp -= absorbShield(target.barrier.hp);
    if (target.barrier.hp <= 0) target.barrier = null;
  }
  for (const barrier of target.barriers) {
    barrier.hp -= absorbShield(barrier.hp);
    if (damage <= 0) break;
  }
  target.barriers = target.barriers.filter(b => b.hp > 0);
  damage = Math.min(target.hp, damage);
  source.metrics.dealt += damage;
  if (magical) source.metrics.specialDealt += damage;
  else source.metrics.physicalDealt += damage;
  target.metrics.taken += damage;
  target.hp -= damage;
  if (damage > 0) floatingDamage(battle, target, damage, magical ? 'special' : 'physical');
  target.flash = 0.19;
  if (damage > target.maxHp * .2 && target.hp > 0 && !target.leap && !target.combo) animate(target, 'Hurt', .28, target.spinTime > 0 ? 'Withdraw' : undefined);
  if (target.hp <= 0) knockout(battle, source, target, damage);
  const actual=damage+absorbedTotal;
  if (mode==='normal' && actual>0) {
    if (attacker.vampirism>0 && source.hp>0) heal(battle,source,actual*attacker.vampirism,source);
    if (charged && effectCount(source,'ally_healing')) {
      const ally=battle.units.filter(u=>u.hp>0 && u.playerId===source.playerId)
        .sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp || a.id.localeCompare(b.id))[0];
      if (ally) heal(battle,ally,actual*numberParam('ally_healing','healingShare'),source);
    }
    if (charged && effectCount(source,'magic_sunder') && target.hp>0) {
      const duration=numberParam('magic_sunder','duration');
      const key=`item:sunder:${source.id}`;
      const amount=target.stats.spd*numberParam('magic_sunder','shred');
      const previous=target.defenseShreds.find(e=>e.sourceId===key && e.stat==='spd');
      if (previous) { previous.amount=Math.max(previous.amount,amount); previous.until=battle.elapsed+duration; }
      else target.defenseShreds.push({sourceId:key,stat:'spd',amount,until:battle.elapsed+duration});
    }
    if (!charged && effectCount(source,'armor_break') && target.hp>0) {
      const key=`item:armor:${source.id}`;
      const amount=target.stats.def*numberParam('armor_break','shred');
      const prev=target.defenseShreds.find(e=>e.sourceId===key && e.stat==='def');
      if (prev) { prev.amount=Math.max(prev.amount,amount); prev.until=battle.elapsed+numberParam('armor_break','duration'); }
      else target.defenseShreds.push({sourceId:key,stat:'def',amount,until:battle.elapsed+numberParam('armor_break','duration')});
    }
  }
  if (actual>0 && mode!=='reflect' && mode!=='dot') {
    if (effectCount(target,'titan') && battle.elapsed>=(target.itemTimers.titanHit||0)) {
      bumpStack(target,'titan'); target.itemTimers.titanHit=battle.elapsed+.1;
    }
    if (effectCount(target,'adaptive_shield') && !target.itemTimers.shieldUsed && target.hp>0 && target.hp/target.maxHp<numberParam('adaptive_shield','threshold')) {
      const amount=target.maxHp*numberParam('adaptive_shield','barrierFraction')*shieldMultiplier(target);
      target.barriers.push({kind:'item',sourceId:target.id,hp:amount,until:battle.elapsed+numberParam('adaptive_shield','duration')});
      target.itemTimers.shieldUsed=1; effect(battle,target,target,'shield',amount);
    }
    if (magical && charged && effectCount(target,'magic_guard') && battle.elapsed>=(target.itemTimers.magicHeal||0)) {
      target.itemTimers.magicHeal=battle.elapsed+numberParam('magic_guard','cooldown');
      heal(battle,target,target.maxHp*numberParam('magic_guard','healPercent'));
    }
    if (!charged && effectCount(target,'bramble') && source.hp>0 && target!==source) {
      deal(battle,target,source,actual*numberParam('bramble','reflect'),false,false,undefined,'reflect');
    }
  }
  return actual;
}

function grantBarrier(battle: Battle, source: CombatUnit, moveId: string): void {
  const move = ATTACKS.moves[moveId];
  const hp = ((move.shieldBase || 0) + (move.shieldDefenseRatio || 0) * source.stats.def) * shieldMultiplier(source);
  source.barrier = { hp, maxHp: hp, time: move.shieldDuration || 4 }; // Renova; nunca empilha.
  effect(battle, source, source, 'shield', hp);
}

function supportTick(battle: Battle, source: CombatUnit, dt: number): void {
  if (!source.support) return;
  source.support.time -= dt;
  if (source.support.time > 0) return;
  const moveId = source.support.moveId;
  source.support = null;
  const move = ATTACKS.moves[moveId];
  if (move.effect === 'shield' || move.shieldBase) grantBarrier(battle, source, moveId);
  else if (move.effect === 'heal-powder') {
    for (const ally of woundedAllies(battle, source, move.healRange || 3.5, move.healTargets || 2)) {
      heal(battle, ally, (move.healBase || 0) + source.stats.spa * (move.healRatio || 0), source);
    }
  }
}

function spell(battle: Battle, source: CombatUnit, target: CombatUnit | null): void {
  const stage = getStageData(source.family, source.stage);
  const moveId = moveIdOf(source), move = ATTACKS.moves[moveId];
  source.metrics.casts++;
  if (effectCount(source,'cast_haste')) source.itemTimers.cast_haste=battle.elapsed+numberParam('cast_haste','duration');
  if (effectCount(source,'cast_wave')) {
    source.itemStacks.cast_wave=(source.itemStacks.cast_wave||0)+1;
    if (source.itemStacks.cast_wave % numberParam('cast_wave','casts',2)===0 && target) {
      for (const enemy of battle.units.filter(u=>u.playerId!==source.playerId && u.hp>0 && distance(u,target)<=numberParam('cast_wave','radius')))
        deal(battle,source,enemy,stat(source,'spa')*numberParam('cast_wave','spaRatio'),true,true,undefined,'extra');
      effect(battle,source,target,'impact',numberParam('cast_wave','radius'));
    }
  }
  const a = stat(source,'atk'), s = stat(source,'spa');
  const shot = (victim: CombatUnit, kind: CombatEffect['kind'], raw: number, magical: boolean,
    arrival: number, onHit?: 'drain' | 'burn' | 'slow' | 'poison') =>
    projectile(battle, source, victim, kind, raw, magical, true, arrival, onHit, source, moveId, stage.chargedType);

  if (move.effect === 'self-explosion') {
    animate(source,'Attack',.45);
    effect(battle,source,source,'explosion',move.splashRange||1.45);
    for (const enemy of battle.units.filter(u=>u.playerId!==source.playerId && isTargetable(u) && distance(u,source)<=(move.splashRange||1.45))) {
      deal(battle,source,enemy,move.baseDamage+stat(source,'spa')*move.specialRatio,true,true,stage.chargedType);
    }
    const hpCost=source.maxHp*(move.selfHpCost || 0);
    source.hp=Math.max(0,source.hp-hpCost); // true HP cost: ignores shields/durability/lifesteal
    if (source.hp<=0) { source.hp=0; effect(battle,source,source,'ko',0); }
    return;
  }
  if (move.effect === 'mew-blessing') {
    const ally = battle.units.filter(u => u.playerId === source.playerId && isTargetable(u) && u !== source)
      .sort((a,b) => a.hp/a.maxHp - b.hp/b.maxHp || a.id.localeCompare(b.id))[0]
      || (isTargetable(source) ? source : null);
    if (ally) {
      animate(source,'Charge',.55);
      projectile(battle,source,ally,'psychic-blessing',0,true,true,.83,undefined,source,moveId,'psychic','mew-blessing');
    }
    return;
  }
  if (move.effect === 'burrow') {
    startDig(battle,source);
    return;
  }
  if (move.effect === 'dragon-storm') {
    const enemies = battle.units.filter(u => u.playerId !== source.playerId && isTargetable(u));
    const centers = [source,...enemies.filter(u => distance(source,u) <= 1)].map(u => ({ x:u.x,y:u.y }));
    const radius = move.splashRange || 1.5;
    const primary = target?.id;
    const best = centers.map(c => ({ ...c, members: enemies.filter(e => distance(e,c) <= radius) }))
      .sort((a,b) => b.members.length-a.members.length || Number(b.members.some(e=>e.id===primary))-Number(a.members.some(e=>e.id===primary))
        || distance(source,a)-distance(source,b))[0];
    if (best && best.members.length) {
      source.storm = {x:best.x,y:best.y,nextWave:0,waves:3,targetIds:[],elapsed:0};
      animate(source,'Hop',1.35,'Idle');
    }
    return;
  }
  if (move.effect === 'dragon-breath' && target) {
    animate(source,'Shoot',.42);
    projectile(battle,source,target,'dragon-orb',move.baseDamage+s*move.specialRatio,true,true,.83,
      undefined,source,moveId,'dragon','dragon-breath');
    return;
  }
  if (move.effect === 'dragon-cyclone' && target) {
    animate(source,'Shoot',.48);
    projectile(battle,source,target,'dragon-orb',move.baseDamage+s*move.specialRatio,true,true,.83,
      undefined,source,moveId,'dragon','dragon-cyclone');
    return;
  }
  if (move.effect === 'rock-charge') {
    const path = bestCharge(battle, source, target);
    if (path) {
      source.facingX = path.x; source.facingY = path.y;
      source.charge = {
        fromX: source.x, fromY: source.y,
        toX: source.x + path.x * path.travel, toY: source.y + path.y * path.travel,
        directionX: path.x, directionY: path.y, time: 0,
        duration: Math.max(.15, path.travel / 6.4), hitIds: [], moveId
      };
      animate(source, stage.chargedAnimation, source.charge.duration);
    } else if (target) {
      // Surrounded at an edge: still deliver a physical blow rather than freezing the unit.
      animate(source, 'Attack', .4);
      projectile(battle,source,target,'physical',move.baseDamage+a*(move.attackRatio||0),false,true,.32,
        undefined,source,moveId,stage.chargedType,'single-knockup');
    }
    return;
  }
  if (move.effect === 'piercing-fire' && target) {
    source.facingX = target.x-source.x; source.facingY = target.y-source.y;
    animate(source, stage.chargedAnimation, .42);
    piercingFire(battle,source,target,move.baseDamage+s*move.specialRatio,moveId,stage.chargedType);
    return;
  }

  if (move.effect === 'eevee-ball') {
    const center = bestEnemyCluster(battle,source,move.splashRange || 1.65);
    if (center) {
      animate(source,'Shoot',.42);
      projectile(battle,source,center,'ball',move.baseDamage + (stage.basic.stat === 'atk' ? a : s)*(move.attackRatio || 0),
        stage.basic.category === 'special',true,.83,undefined,source,moveId,stage.chargedType,'eevee-ball');
    }
    return;
  }
  if (move.effect === 'bone-throw' && target) {
    animate(source,'Shoot',.4);
    projectile(battle,source,target,'bone',move.baseDamage + a*(move.attackRatio || 0),false,true,.78,
      undefined,source,moveId,stage.chargedType,'bone-throw');
    return;
  }
  if (move.effect === 'single-knockup' && target) {
    animate(source,'Strike',.45);
    projectile(battle,source,target,'physical',move.baseDamage + a*(move.attackRatio || 0),false,true,.32,
      undefined,source,moveId,stage.chargedType,'single-knockup');
    return;
  }
  if (move.effect === 'rock-strike' && target) {
    animate(source,'Strike',.44);
    projectile(battle,source,target,'physical',move.baseDamage + a*(move.attackRatio || 0),false,true,.32,
      undefined,source,moveId,stage.chargedType,'rock-strike');
    return;
  }
  if (move.effect === 'withdraw-guard') {
    source.guardUntil = battle.elapsed+(move.guardDuration || 4.5);
    animate(source,'Withdraw',.62);
    effect(battle,source,source,'shield',0);
    return;
  }
  if (move.effect === 'healing-egg') {
    const center = bestEggCenter(battle,source,move.splashRange || 1.65,move.skillRange || 3.2);
    if (center) {
      animate(source,'SpAttack',.42);
      projectile(battle,source,center,'egg',0,false,true,.83,undefined,source,moveId,stage.chargedType,'healing-egg');
    }
    return;
  }

  if (move.effect === 'heal-powder' || move.effect === 'shield') {
    animate(source, stage.chargedAnimation === 'Attack' ? 'FlapAround' : stage.chargedAnimation, .45);
    source.support = { time: move.effect === 'shield' ? .22 : .32, moveId };
    return;
  }
  if (move.effect === 'pollen') {
    animate(source, 'Charge', .31, 'Shoot');
    const enemies = battle.units.filter(u => u.playerId !== source.playerId && u.hp > 0 && distance(u, source) <= source.range + 1.2);
    const radius = move.splashRange || 1.45;
    const center = [...enemies].sort((u, v) => {
      const members = (candidate: CombatUnit) => enemies.filter(e => distance(e, candidate) <= radius);
      const count = members(v).length - members(u).length;
      if (count) return count;
      const hp = members(v).reduce((n, e) => n + e.hp, 0) - members(u).reduce((n, e) => n + e.hp, 0);
      return hp || distance(source, u) - distance(source, v);
    })[0] || target;
    if (center) source.pendingPollen = { targetId: center.id, x: center.x, y: center.y, remaining: .61, launched: false };
    return;
  }
  if (move.effect === 'spin') {
    source.spinTime = move.seconds || 2;
    source.spinDuration = source.spinTime;
    source.spinReduction = stageValue(move.shieldByStage, source.stage);
    source.waterFxClock = 0;
    animate(source, 'Withdraw', source.spinTime);
    effect(battle, source, source, 'water', 0);
    return;
  }
  if (move.effect === 'gas') {
    animate(source, stage.chargedAnimation, .48);
    source.gasTime = .32;
    effect(battle, source, source, 'gas', stageValue(move.radiusByStage, source.stage, 1.85));
    return;
  }
  if (move.effect === 'stomp') {
    const maxRange = move.jumpRange || 3;
    const candidates = battle.units.filter(u => u.hp > 0 && u.playerId !== source.playerId && distance(u, source) <= maxRange);
    const radius = move.splashRange || 1.75;
    const center = [...candidates].sort((u, v) =>
      candidates.filter(e => distance(e, v) <= radius).length - candidates.filter(e => distance(e, u) <= radius).length
      || distance(source, u) - distance(source, v))[0];
    if (!center) return;
    const quad = battle.participants.length > 2;
    const x = Math.max(quad ? -8.45 : -4.05, Math.min(quad ? 8.45 : 4.05, center.x));
    const y = Math.max(-3.7, Math.min(3.7, center.y));
    source.leap = { fromX: source.x, fromY: source.y, toX: x, toY: y, time: 0, duration: .55 };
    animate(source, 'Hop', .55, 'Stomp');
    return;
  }
  if (!target) return;
  if (move.effect === 'multi') {
    source.combo = { targetId: target.id, hits: move.hits || 4, time: .16, interval: (move.seconds || .9) / (move.hits || 4) };
    animate(source, 'Jab', .23);
    return;
  }
  if (move.effect === 'poison-shot') {
    animate(source, stage.chargedAnimation === 'Attack' ? 'Shoot' : stage.chargedAnimation, .44);
    shot(target, 'poison', move.baseDamage + s * move.specialRatio, true, .75, 'poison');
    if (move.shieldBase) source.support = { time: .24, moveId };
    return;
  }
  if (move.effect === 'sting') {
    animate(source, stage.chargedAnimation, .42);
    shot(target, 'physical', move.baseDamage + a * (move.attackRatio || 0), false, .36);
    return;
  }
  if (move.effect === 'flame-strike') {
    animate(source, 'Strike', .46);
    shot(target, 'flame', a * stageValue(move.damageRatioByStage, source.stage, 1.55), false, 1 / 2.7);
    return;
  }
  if (move.effect === 'shock') {
    animate(source, 'Shoot', .42);
    shot(target, 'lightning', s * stageValue(move.damageRatioByStage, source.stage, 1.05), true, 1 / 3);
    battle.effects[battle.effects.length - 1].pendingHit!.chain = {
      remaining: stageValue(move.secondaryTargetsByStage, source.stage, 1), visited: [target.id],
      ratio: stageValue(move.secondaryRatioByStage, source.stage, .5), range: move.chainRange || 2
    };
    return;
  }
  animate(source, stage.chargedAnimation, .38);
  shot(target, 'spell', move.baseDamage + a * (move.attackRatio || 0) + s * move.specialRatio,
    true, 1, move.effect === 'drain' || move.effect === 'burn' || move.effect === 'slow' ? move.effect : undefined);
  if (move.effect === 'chain') {
    const chained = battle.units.filter(u => u.playerId !== source.playerId && u.id !== target.id && u.hp > 0 && distance(u, target) < (move.chainRange || 2.6))
      .sort((u, v) => distance(u, target) - distance(v, target))[0];
    if (chained) shot(chained, 'spell', (move.chainBase || 0) + s * (move.chainRatio || 0), true, 1);
  }
}

function pollenTick(battle: Battle, source: CombatUnit, dt: number): void {
  const pending = source.pendingPollen;
  if (!pending) return;
  const move = ATTACKS.moves[getStageData(source.family, source.stage).move];
  pending.remaining -= dt;
  const liveTarget = battle.units.find(u => u.id === pending.targetId && u.hp > 0);
  const center = pending.launched ? { x: pending.x, y: pending.y } : liveTarget || { x: pending.x, y: pending.y };
  if (!pending.launched && pending.remaining <= .3) {
    pending.x = center.x; pending.y = center.y;
    effect(battle, source, center, 'pollen', move.splashRange || 1.65);
    pending.launched = true;
  }
  if (pending.remaining > 0) return;
  for (const enemy of battle.units.filter(u => u.playerId !== source.playerId && u.hp > 0 && distance(u, center) <= (move.splashRange || 1.65))) {
    deal(battle, source, enemy, stageValue(move.damageByStage, source.stage) + stat(source,'spa') * move.specialRatio, true, true);
  }
  for (const ally of woundedAllies(battle, source, move.healRange || 3.3, move.healTargets || 2)) {
    heal(battle, ally, stageValue(move.healByStage, source.stage) + source.stats.spa * (move.healRatio || 0), source);
  }
  source.pendingPollen = null;
}

function spinTick(battle: Battle, source: CombatUnit, dt: number): void {
  const move = ATTACKS.moves[getStageData(source.family, source.stage).move];
  const duration = Math.min(dt, source.spinTime);
  const dps = stageValue(move.damageByStage, source.stage) + stat(source,'spa') * move.specialRatio;
  for (const enemy of battle.units) {
    if (enemy.playerId === source.playerId || enemy.hp <= 0 || distance(source, enemy) > (move.splashRange || 1.7)) continue;
    deal(battle, source, enemy, dps * duration, true, true);
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

function comboTick(battle: Battle, source: CombatUnit, dt: number): void {
  const combo = source.combo;
  if (!combo) return;
  combo.time -= dt;
  const move = ATTACKS.moves[getStageData(source.family, source.stage).move];
  while (source.combo && combo.time <= 0 && combo.hits > 0) {
    const target = battle.units.find(u => u.id === combo.targetId && u.hp > 0);
    if (!target || distance(source, target) > source.range + .5) { source.combo = null; break; }
    deal(battle, source, target, move.baseDamage + stat(source,'atk') * (move.attackRatio || 0), false, true);
    effect(battle, source, target, 'physical', 0);
    combo.hits--;
    combo.time += combo.interval;
    if (target.hp <= 0) source.combo = null;
    else if (combo.hits > 0) animate(source, 'Jab', combo.interval);
    else source.combo = null;
  }
}

function gasTick(battle: Battle, source: CombatUnit, dt: number): void {
  source.gasTime -= dt;
  if (source.gasTime > 0) return;
  source.gasTime = 0;
  const move = ATTACKS.moves[getStageData(source.family, source.stage).move];
  const radius = stageValue(move.radiusByStage, source.stage, 1.85);
  const raw = stageValue(move.damageByStage, source.stage) + stat(source,'atk') * stageValue(move.attackRatioByStage, source.stage, .9);
  for (const target of battle.units) {
    if (target.hp > 0 && target.playerId !== source.playerId && distance(source, target) <= radius) {
      deal(battle, source, target, raw, false, true);
    }
  }
}

function leapTick(battle: Battle, source: CombatUnit, dt: number): void {
  const leap = source.leap;
  if (!leap) return;
  leap.time = Math.min(leap.duration, leap.time + dt);
  const t = leap.time / leap.duration;
  source.x = leap.fromX + (leap.toX - leap.fromX) * t;
  source.y = leap.fromY + (leap.toY - leap.fromY) * t;
  source.jumpHeight = Math.sin(t * Math.PI) * .95;
  if (t < 1) return;
  source.leap = null;
  source.jumpHeight = 0;
  const move = ATTACKS.moves[getStageData(source.family, source.stage).move];
  effect(battle, source, source, 'stomp', move.splashRange || 1.75);
  for (const target of battle.units) {
    if (target.playerId === source.playerId || target.hp <= 0 || distance(source, target) > (move.splashRange || 1.75)) continue;
    deal(battle, source, target, move.baseDamage + stat(source,'atk') * (move.attackRatio || 0), false, true);
    applyKnockup(battle,source,target,move.stunDuration || 1,.35);
  }
}

/** Real, time-based movement. Hits are checked along each swept segment, not at the end of the charge. */
function chargeTick(battle: Battle, source: CombatUnit, dt: number): void {
  const charge = source.charge;
  if (!charge) return;
  const oldX = source.x, oldY = source.y;
  charge.time = Math.min(charge.duration, charge.time + dt);
  const ratio = charge.time / charge.duration;
  source.x = charge.fromX + (charge.toX - charge.fromX) * ratio;
  source.y = charge.fromY + (charge.toY - charge.fromY) * ratio;
  source.moving = true;
  source.facingX = charge.directionX; source.facingY = charge.directionY;
  const maxImpact = 2.15;
  const formerTravel = Math.hypot(oldX - charge.fromX, oldY - charge.fromY);
  const currentTravel = Math.hypot(source.x - charge.fromX, source.y - charge.fromY);
  if (formerTravel < maxImpact) {
    const segmentEnd = Math.min(maxImpact, currentTravel);
    const hitX = charge.fromX + charge.directionX * segmentEnd;
    const hitY = charge.fromY + charge.directionY * segmentEnd;
    const move = ATTACKS.moves[charge.moveId];
    for (const target of battle.units) {
      if (target.playerId === source.playerId || target.hp <= 0 || charge.hitIds.includes(target.id)) continue;
      if (segmentDistanceSq(oldX, oldY, hitX, hitY, target.x, target.y) > .52 ** 2) continue;
      charge.hitIds.push(target.id);
      deal(battle,source,target,move.baseDamage+stat(source,'atk')*(move.attackRatio||0),false,true,'rock');
      if (target.hp > 0) applyKnockup(battle,source,target,move.controlDuration||.4);
      effect(battle,source,target,'impact',.4);
    }
  }
  if (charge.time < charge.duration) return;
  source.charge = null;
  source.moving = false;
  // Preserve ground contact, then show the physical finishing animation.
  animate(source, 'Strike', .25);
}

function applyAttackSlow(battle: Battle, target: CombatUnit, duration: number): void {
  if (target.hp <= 0) return;
  target.attackSpeedDebuffUntil = Math.max(target.attackSpeedDebuffUntil,battle.elapsed+duration);
  const old = target.cooldown;
  target.cooldown = combatCooldown(target,battle.elapsed);
  if (old > 0) target.attackClock *= target.cooldown/old;
}

/** Choose a free resting point, without assuming the board uses integer tile coordinates. */
function digDestination(battle: Battle, source: CombatUnit, target: CombatUnit): {x:number;y:number} | null {
  const boundary = arenaBoundary(battle);
  const options: Array<{x:number;y:number;d:number}> = [];
  for (const radius of [.72,1.04,1.38,1.7,2.08,2.4]) {
    for (let i=0;i<16;i++) {
      const angle = Math.PI*2*i/16;
      const x=target.x+Math.cos(angle)*radius, y=target.y+Math.sin(angle)*radius;
      if (x < boundary.minX || x > boundary.maxX || y < boundary.minY || y > boundary.maxY) continue;
      if (battle.units.some(u=>u !== source && u.hp>0 && Math.hypot(u.x-x,u.y-y)<.62)) continue;
      options.push({x,y,d:radius+Math.hypot(source.x-x,source.y-y)*.005});
    }
    if (options.length) break;
  }
  // If all adjacent spots are occupied, scan the rest of the arena for the nearest safe landing.
  if (!options.length) {
    for (let x=boundary.minX+.3;x<=boundary.maxX-.3;x+=.45) for (let y=boundary.minY+.3;y<=boundary.maxY-.3;y+=.45) {
      if (battle.units.some(u=>u!==source && u.hp>0 && Math.hypot(u.x-x,u.y-y)<.62)) continue;
      options.push({x,y,d:Math.hypot(target.x-x,target.y-y)});
    }
  }
  return options.sort((a,b)=>a.d-b.d||a.x-b.x||a.y-b.y)[0] || null;
}
function startDig(battle: Battle, source: CombatUnit): void {
  const victim = battle.units.filter(u=>u.playerId!==source.playerId && isTargetable(u))
    .sort((a,b)=>distance(source,b)-distance(source,a)||a.id.localeCompare(b.id))[0];
  if (!victim) return;
  const point=digDestination(battle,source,victim);
  if (!point) return;
  source.dig={phase:'sink',time:0,duration:.23,fromX:source.x,fromY:source.y,toX:point.x,toY:point.y,targetId:victim.id,trailClock:0};
  animate(source,'Attack',.23);
}
function digTick(battle: Battle, source: CombatUnit, dt: number): void {
  const dig=source.dig;
  if (!dig) return;
  dig.time = Math.min(dig.duration,dig.time+dt);
  if (dig.phase === 'sink' && dig.time>=dig.duration) {
    dig.phase='travel';dig.time=0;dig.duration=Math.max(.32,Math.hypot(dig.fromX-dig.toX,dig.fromY-dig.toY)/5);
    source.animation=null;
  } else if (dig.phase === 'travel') {
    const t=dig.time/dig.duration;
    source.x=dig.fromX+(dig.toX-dig.fromX)*t;
    source.y=dig.fromY+(dig.toY-dig.fromY)*t;
    dig.trailClock+=dt;
    if (dig.trailClock >= .11) {
      dig.trailClock %= .11;
      effect(battle,source,source,'earth-trail',source.stage ? .58 : .38);
    }
    if (dig.time>=dig.duration) {
      // Units may move into the chosen landing spot while the Pokémon is underground.
      // Recheck occupancy against the authoritative unit positions before surfacing.
      const occupied = battle.units.some(u => u !== source && u.hp > 0 &&
        Math.hypot(u.x-source.x,u.y-source.y) < .62);
      if (occupied) {
        const desired = battle.units.find(u => u.id === dig.targetId && isTargetable(u)) ||
          battle.units.filter(u => u.playerId !== source.playerId && isTargetable(u))
            .sort((a,b) => distance(source,a)-distance(source,b) || a.id.localeCompare(b.id))[0];
        const free = desired && digDestination(battle, source, desired);
        // The subterranean position, not the sprite, is moved to the safe resting location.
        if (free) { source.x=free.x; source.y=free.y; }
        else { source.x=dig.fromX; source.y=dig.fromY; }
      }
      dig.phase='rise';dig.time=0;dig.duration=.27;
      effect(battle,source,source,'earth-burst',source.stage ? .85 : .55);
    }
  } else if (dig.phase === 'rise' && dig.time>=dig.duration) {
    // Last-moment collision protection: a target can move during the rise itself.
    if (battle.units.some(u => u !== source && u.hp > 0 && Math.hypot(u.x-source.x,u.y-source.y)<.62)) {
      const intended = battle.units.find(u => u.id===dig.targetId && isTargetable(u)) ||
        battle.units.filter(u => u.playerId !== source.playerId && isTargetable(u))
          .sort((a,b)=>distance(source,a)-distance(source,b)||a.id.localeCompare(b.id))[0];
      const free = intended && digDestination(battle,source,intended);
      if (free) { source.x=free.x; source.y=free.y; }
      else { source.x=dig.fromX; source.y=dig.fromY; }
    }
    source.dig=null;source.moving=false;
    const victim=battle.units.find(u=>u.id===dig.targetId && isTargetable(u))
      || battle.units.filter(u=>u.playerId!==source.playerId && isTargetable(u)).sort((a,b)=>distance(source,a)-distance(source,b)||a.id.localeCompare(b.id))[0];
    const move=ATTACKS.moves[moveIdOf(source)];
    if (victim && distance(source,victim)<=2.5) deal(battle,source,victim,move.baseDamage+stat(source,'spa')*move.specialRatio,true,true,'ground');
    animate(source,'Attack',.2);
  }
}
function stormTick(battle: Battle,source: CombatUnit,dt: number): void {
  const storm=source.storm;
  if (!storm) return;
  storm.elapsed+=dt;
  source.jumpHeight = .65 * Math.sin(Math.PI * Math.min(1, storm.elapsed/1.15));
  if (storm.waves<=0) {
    if (storm.elapsed>=1.15) { source.jumpHeight=0;source.storm=null;animate(source,'Idle',.2); }
    return;
  }
  storm.nextWave-=dt;
  const move=ATTACKS.moves[moveIdOf(source)];
  if (storm.nextWave>0) return;
  const wave=4-storm.waves;
  const center={x:storm.x,y:storm.y};
  effect(battle,source,center,wave===1?'dragon-tornado':'dragon-wave',move.splashRange||1.5);
  for (const victim of battle.units) {
    if (victim.playerId===source.playerId || !isTargetable(victim) || distance(victim,center)>(move.splashRange||1.5)) continue;
    deal(battle,source,victim,move.baseDamage+stat(source,'spa')*move.specialRatio,true,true,'dragon');
    if (wave===1 && victim.hp>0 && !storm.targetIds.includes(victim.id)) {
      storm.targetIds.push(victim.id);
      applyKnockup(battle,source,victim,move.controlDuration||.5);
    }
  }
  storm.waves--;
  if (storm.waves>0) storm.nextWave+=move.seconds||.35;
}

function resolve(battle: Battle): void {
  if ((battle.effects.some(fx => fx.pendingHit || (fx.piercing && fx.time < fx.duration)) ||
    battle.units.some(u => u.charge || u.dig || u.storm)) && battle.elapsed < 120) return;
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
  for (const unit of battle.units) {
    if (unit.hp <= 0) continue;
    unit.moving = false;
    unit.spinTime = 0;
    unit.pendingPollen = null;
    unit.buffs = []; unit.defenseShreds = []; unit.barriers = []; unit.guardUntil = 0;
    unit.combo = null;
    unit.leap = null;
    unit.charge = null;
    unit.dig = null; unit.storm = null; unit.psychicImbuement = null;
    unit.support = null;
    unit.gasTime = 0;
    unit.jumpHeight = 0;
    unit.animation = null;
    // Preserva a direção final para o cliente fazer apenas o menor giro até
    // a câmera no encerramento. Somente os vencedores realizam essa virada.
  }
}

function tickOutcome(battle: Battle, dt: number): void {
  const before = battle.outcomeElapsed;
  battle.outcomeElapsed += dt;
  for (let i = battle.effects.length - 1; i >= 0; i--) {
    battle.effects[i].time += dt;
    if (battle.effects[i].time >= battle.effects[i].duration) battle.effects.splice(i, 1);
  }
  for (const u of battle.units) if (u.hp > 0) advanceAnimation(u, dt);
  // Apenas sobreviventes do vencedor atacam os treinadores derrotados.
  if (before < .35 && battle.outcomeElapsed >= .35) {
    const targets = battle.participants.filter(id => id !== battle.winner);
    for (const unit of battle.units.filter(u => u.hp > 0 && u.playerId === battle.winner)) {
      animate(unit, 'Shoot', .45);
      const id = targets[unit.col % targets.length];
      if (!id) continue;
      const target = trainerSpot(battle.participants.indexOf(id), battle.participants.length > 2);
      battle.effects.push({ id: `${battle.id}:trainer:${unit.id}`, x: unit.x, y: unit.y,
        targetX: target.x, targetY: target.y, family: unit.family,
        kind: 'trainer-hit', time: 0, duration: 1.03, value: 0 });
    }
  }
}

export function tickBattle(battle: Battle, dt: number): void {
  if (battle.resolved) { tickOutcome(battle, dt); return; }
  battle.elapsed += dt;
  battle.introElapsed += dt;
  // O treinador lança as Pokébolas antes de começar a luta.
  if (battle.introElapsed < ITEMS.combatIntroSeconds) return;
  // Periodic item effects belong to simulation time and are deterministic.
  for (const unit of battle.units) {
    unit.itemNow=battle.elapsed;
    unit.controlImmune=effectCount(unit,'opening_immunity')>0 && battle.elapsed<ITEMS.combatIntroSeconds+numberParam('opening_immunity','duration');
    if (unit.hp<=0) continue;
    const enemies=battle.units.filter(e=>e.playerId!==unit.playerId && e.hp>0);
    unit.focusCount=effectCount(unit,'focused_defense') ? Math.min(numberParam('focused_defense','maxTargets'),enemies.filter(enemy=>{
      const valid=battle.units.filter(foe=>foe.playerId!==enemy.playerId && foe.hp>0);
      valid.sort((a,b)=>distance(a,enemy)-distance(b,enemy)||a.id.localeCompare(b.id));
      return valid[0]?.id===unit.id;
    }).length) : 0;
    if (effectCount(unit,'regeneration') && battle.elapsed>= (unit.itemTimers.regeneration||0)) {
      unit.itemTimers.regeneration=battle.elapsed+numberParam('regeneration','interval');
      heal(battle,unit,unit.maxHp*numberParam('regeneration','healPercent'));
    }
    if (effectCount(unit,'scaling_spa') && battle.elapsed>=(unit.itemTimers.scaling_spa||0)) {
      unit.itemTimers.scaling_spa=battle.elapsed+numberParam('scaling_spa','interval');
      bumpStack(unit,'scaling_spa');
    }
    if (effectCount(unit,'burn_aura') && battle.elapsed>=(unit.itemTimers.burn_aura||0)) {
      unit.itemTimers.burn_aura=battle.elapsed+numberParam('burn_aura','interval');
      const target=enemies.filter(e=>distance(e,unit)<=numberParam('burn_aura','radius'))
        .sort((a,b)=>distance(a,unit)-distance(b,unit)||a.id.localeCompare(b.id))[0];
      if (target) {
        target.itemTimers.burning=battle.elapsed+numberParam('burn_aura','duration');
        // One burn source per victim, stronger refresh replaces weaker rather than stacking.
        if (!target.itemBurn || target.itemBurn.until<=battle.elapsed || target.itemBurn.dps<target.maxHp*numberParam('burn_aura','burnPercent')/numberParam('burn_aura','duration'))
          target.itemBurn={sourceId:unit.id,dps:target.maxHp*numberParam('burn_aura','burnPercent')/numberParam('burn_aura','duration'),until:target.itemTimers.burning};
        else target.itemBurn.until=target.itemTimers.burning;
        effect(battle,unit,target,'flame',0);
      }
    }
    if (unit.itemBurn && unit.itemBurn.until>battle.elapsed && unit.hp>0) {
      const burner=battle.units.find(e=>e.id===unit.itemBurn!.sourceId);
      if (burner) deal(battle,burner,unit,unit.itemBurn.dps*dt,true,true,undefined,'dot');
    }
    if (unit.itemBurn && unit.itemBurn.until<=battle.elapsed) unit.itemBurn=null;
  }
  // Expiração anterior ao impacto: nenhum buff ou escudo continua ativo um frame extra.
  for (const unit of battle.units) {
    const previousCooldown = unit.cooldown;
    unit.buffs = unit.buffs.filter(b => unit.hp > 0 && b.until > battle.elapsed);
    unit.defenseShreds = unit.defenseShreds.filter(b => unit.hp > 0 && b.until > battle.elapsed);
    unit.barriers = unit.barriers.filter(b => unit.hp > 0 && b.until > battle.elapsed && b.hp > 0);
    unit.cooldown = combatCooldown(unit,battle.elapsed);
    if (previousCooldown > 0 && unit.cooldown !== previousCooldown) unit.attackClock *= unit.cooldown/previousCooldown;
  }
  landProjectiles(battle, dt);
  for (let i = battle.effects.length - 1; i >= 0; i--) {
    if (battle.effects[i].time >= battle.effects[i].duration) battle.effects.splice(i, 1);
  }
  for (const unit of battle.units) {
    if (unit.hp <= 0) {
      unit.dig = null; unit.storm = null; unit.psychicImbuement = null;
      unit.buffs = []; unit.defenseShreds = []; unit.barriers = []; unit.guardUntil = 0;
      continue;
    }
    unit.moving = false;
    advanceAnimation(unit, dt);
    unit.flash = Math.max(0, unit.flash - dt);
    unit.slow = Math.max(0, unit.slow - dt);
    unit.buffs = unit.buffs.filter(b => b.until > battle.elapsed);
    unit.defenseShreds = unit.defenseShreds.filter(b => b.until > battle.elapsed);
    unit.barriers = unit.barriers.filter(b => b.until > battle.elapsed && b.hp > 0);
    if (unit.psychicImbuement && unit.psychicImbuement.until <= battle.elapsed) unit.psychicImbuement = null;
    if (unit.barrier) {
      unit.barrier.time -= dt;
      if (unit.barrier.time <= 0) unit.barrier = null;
    }
    if (unit.damageOverTime) {
      const dot = unit.damageOverTime;
      const source = battle.units.find(other => other.id === dot.sourceId);
      if (source) deal(battle, source, unit, dot.amount * Math.min(dt, dot.time), true, true,undefined,'dot');
      dot.time -= dt;
      if (dot.time <= 0) unit.damageOverTime = null;
    }
    if (unit.poison && unit.hp > 0) {
      const dot = unit.poison;
      const source = battle.units.find(other => other.id === dot.sourceId);
      if (source) deal(battle, source, unit, dot.amount * Math.min(dt, dot.time), true, true, 'poison','dot');
      dot.time -= dt;
      if (dot.time <= 0) unit.poison = null;
    }
    if (unit.hp <= 0) continue;
    unit.stunTime = Math.max(0, unit.stunUntil - battle.elapsed);
    unit.knockUpTime = Math.max(0, unit.knockUpUntil - battle.elapsed);
    if (unit.dig) { digTick(battle,unit,dt); continue; }
    if (unit.storm) { stormTick(battle,unit,dt); continue; }
    if (unit.charge) { chargeTick(battle,unit,dt); continue; }
    if (unit.stunTime > 0 && !(effectCount(unit,'opening_immunity') && battle.elapsed<ITEMS.combatIntroSeconds+numberParam('opening_immunity','duration'))) {
      continue;
    }
    if (unit.support) { supportTick(battle, unit, dt); continue; }
    if (unit.combo) { comboTick(battle, unit, dt); continue; }
    if (unit.gasTime > 0) { gasTick(battle, unit, dt); continue; }
    if (unit.leap) { leapTick(battle, unit, dt); continue; }
    if (unit.pendingPollen) { pollenTick(battle, unit, dt); continue; }
    if (unit.spinTime > 0) { spinTick(battle, unit, dt); continue; }
    unit.attackClock -= dt;
    unit.cooldown = combatCooldown(unit,battle.elapsed);
    const stage = getStageData(unit.family, unit.stage);
    const move = ATTACKS.moves[moveIdOf(unit)];
    if (unit.attackClock <= 0 && unit.energy >= unit.energyNeeded &&
      (move.effect === 'healing-egg' || move.effect === 'withdraw-guard' || move.effect === 'mew-blessing' || move.effect === 'burrow')) {
      const center = move.effect === 'healing-egg'
        ? bestEggCenter(battle,unit,move.splashRange || 1.65,move.skillRange || 3.2) : unit;
      if (center) {
        unit.energy = 0;
        spell(battle,unit,center);
        unit.attackClock = unit.cooldown*(unit.slow ? 1.3 : 1);
        continue;
      }
    }
    if (unit.attackClock <= 0 && unit.energy >= unit.energyNeeded && move.effect === 'heal-powder' &&
      woundedAllies(battle, unit, move.healRange || 3.5, move.healTargets || 2).length > 0) {
      unit.energy = 0;
      spell(battle, unit, null);
      unit.attackClock = unit.cooldown * (unit.slow ? 1.3 : 1);
      continue;
    }
    let target: CombatUnit | null = null;
    let distanceSq = Infinity;
    for (const enemy of battle.units) {
      if (enemy.playerId === unit.playerId || !isTargetable(enemy)) continue;
      const squared = (enemy.x - unit.x) ** 2 + (enemy.y - unit.y) ** 2;
      if (squared < distanceSq) { target = enemy; distanceSq = squared; }
    }
    if (!target) continue;
    const d = Math.sqrt(distanceSq);
    unit.facingX = target.x - unit.x;
    unit.facingY = target.y - unit.y;
    if (unit.attackClock <= 0 && unit.energy >= unit.energyNeeded && move.effect === 'stomp' && d <= (move.jumpRange || 3)) {
      unit.energy = 0;
      spell(battle, unit, target);
      unit.attackClock = unit.cooldown * (unit.slow ? 1.3 : 1);
      continue;
    }
    if (d > unit.range + 0.08) {
      const travel = Math.min(d - unit.range, dt * (0.68 + unit.stats.speed / 180) * (unit.slow ? 0.65 : 1));
      unit.x += (target.x - unit.x) / d * travel;
      unit.y += (target.y - unit.y) / d * travel;
      unit.moving = travel > .001;
      continue;
    }
    if (unit.attackClock > 0) continue;
    if (unit.energy >= unit.energyNeeded
      && (move.effect !== 'heal-powder' || woundedAllies(battle, unit, move.healRange || 3.5, move.healTargets || 2).length)
      && (move.effect !== 'healing-egg' || bestEggCenter(battle,unit,move.splashRange || 1.65,move.skillRange || 3.2))) {
      unit.energy = 0;
      spell(battle, unit, target);
    } else {
      animate(unit, stage.basic.animation, Math.min(.4, unit.cooldown * .82));
      const basic = ATTACKS.basic;
      const raw = rawBasicDamage(stat(unit,unit.bossMove ? 'atk' : stage.basic.stat), basic.offensiveRatio);
      const ranged = !!stage.basic.projectile;
      const projectileKind = ranged ? 'basic-projectile' : 'physical';
      projectile(battle, unit, target, projectileKind, raw, !unit.bossMove && stage.basic.category === 'special', false,
        ranged ? ANIMATIONS.projectilesByType[stage.elements[0]].arrival : .35);
      if (ranged) battle.effects[battle.effects.length - 1].basicType = stage.elements[0];
      unit.energy = Math.min(unit.energyNeeded, unit.energy + basic.energyGain + (effectCount(unit,'bonus_energy') ? numberParam('bonus_energy','energy') : 0));
      bumpStack(unit,'guinsoo'); bumpStack(unit,'titan');
    }
    unit.cooldown=combatCooldown(unit,battle.elapsed);
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
