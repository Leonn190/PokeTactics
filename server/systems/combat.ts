import { firstObstacle, expireObstacles, summonPreparedPillars, summonWalls, routeAround } from '../combat/obstacles';
import { active, apply as applyStatus, incapacitated, blocksEnergy, expire as expireStatus, wakeFromBasic, STATUS_RULES } from '../combat/statuses';
import { beginCombatAugments, onAugmentBasic, onAugmentCast, onAugmentDamage, onAugmentDeath, tickCombatAugments } from './augments';
import { ANIMATIONS, ATTACKS, calculateStats, getStageData, collisionRadius, gridXY, SPECIES } from '../data';
import { attackCooldown, mitigatedDamage, stageValue, rawBasicDamage } from '../formulas';
import type { Battle, CombatEffect, CombatMetrics, CombatUnit, Element, Player, Pokemon, StageType, StatKey } from '../types';
import { chargedEffectiveness } from './effectiveness';
import { distance, closestTwo, bestEnemyCluster, bestEggCenter, woundedAllies, countClosestThreats } from '../combat/targeting';
import { effect, floatingDamage } from '../combat/effects';
import { heal } from '../combat/healing';
import { trainerSpot } from '../combat/trainer-position';
import { bonusStats, effectivePercents, effectCount, numberParam, bumpStack, bonusStat, shieldMultiplier, ITEMS } from './items';
import { countTraits } from './synergies/counting';
import { initializeSynergies, updateSacredTiles, synergyTier } from './synergies/stats';
import { onSynergyHit, onSynergyDeath, sourceShieldMultiplier } from './synergies/combat-events';
import { tickSynergies } from './synergies/periodic';
import { clearStep, resolveBodies } from './physical-collision';
import { pushTarget } from './synergies/positioning';
import { tickFlameOrbits } from '../combat/flame-orbits';
import { basicInRange, basicApproachDistance } from '../combat/basic-range';
import { meteorCenters, withinCone } from '../combat/field-skills';
export { trainerSpot } from '../combat/trainer-position';

const moveIdOf = (unit: CombatUnit): string => unit.bossMove || getStageData(unit.family, unit.stage).move;
const combatCooldown = (unit: CombatUnit, now: number): number =>
  attackCooldown(stat(unit,'speed')) * (unit.attackSpeedDebuffUntil > now ? 1 / .85 : 1);
const isTargetable = (unit: CombatUnit): boolean => unit.hp > 0 && !(unit.family==='diglett' && unit.moving) && !unit.dig && !unit.ghost && !unit.synergy?.flight && !(unit.synergy?.intangibleUntil && unit.synergy.intangibleUntil > unit.itemNow);
const metrics = (): CombatMetrics => ({ casts: 0, controlSeconds: 0, dealt: 0, physicalDealt: 0, specialDealt: 0, taken: 0, healed: 0, blocked: 0, blockedPhysical: 0, blockedSpecial: 0, barrierAbsorbed: 0, abilityMitigated: 0 });
function stat(unit: CombatUnit, key: StatKey): number {
  const base = unit.stats[key];
  if (key === 'hp') return base;
  // Scan status arrays without allocating filter buffers on repeated stat reads.
  // Additions preserve original iteration order and therefore numeric rounding.
  let buffAmount = 0;
  for (const buff of unit.buffs) if (buff.stat === key) buffAmount += buff.amount;
  const increase = Math.min(base * .3, buffAmount);
  let decrease = 0;
  if (key === 'def' || key === 'spd') {
    let shredAmount = 0;
    for (const shred of unit.defenseShreds) if (shred.stat === key) shredAmount += shred.amount;
    decrease = Math.min(base * .3, shredAmount);
  }
  const synergySpeed=key==='speed'?base*(unit.synergy?.speedBonus||0):0;
  const frostSpeed=key==='speed' && unit.synergy?.chilled && unit.synergy.chilled.until>unit.itemNow?base*unit.synergy.chilled.speed:0;
  return Math.max(0, base + increase - decrease + bonusStat(unit,key,unit.itemNow,unit.focusCount) + synergySpeed - frostSpeed + (unit.synergy?.inherit[key]||0)) * (key==='speed' ? 1-(unit.windSlow||0) : 1) * (unit.orbitFlames?.length && (key==='speed'||key==='def'||key==='spd') ? 1+(ATTACKS.moves[getStageData(unit.family,unit.stage).move]?.[key==='speed'?'speedBonusPercent':key==='def'?'defBonusPercent':'spdBonusPercent']||0) : 1);
}

type AnimationName = NonNullable<CombatUnit['animation']>['name'];

function animate(unit: CombatUnit, name: AnimationName, duration: number, next?: string, role: 'basic'|'charged' = 'charged'): void {
  unit.animation = { name, duration, elapsed: 0, role, ...(next ? { next } : {}) };
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
    stats, mimePillars:pokemon.mimePillars?.map(p=>({...p})), cooldown: attackCooldown(stats.speed),
    attackClock: 0.5 + (col % 4) * 0.13,
    // Entra já voltado ao lado adversário, sem tocar a animação Rotate de 360°.
    // O Idle permanece animado inclusive durante a entrada das Pokébolas.
    moving: false, facingX: 0, facingY: upper ? 1 : -1,
    animation: null,
    spinTime: 0, spinDuration: 0, spinReduction: 0, waterFxClock: 0, pendingPollen: null,
    flash: 0, effects: [], damageOverTime: null, poison: null, barrier: null,
    barriers: [], buffs: [], defenseShreds: [], guardUntil: 0, combo: null,
    dig: null, ghost: null, ghostCasts: 0, orbitFlames: [], statuses:{}, lullaby:null, starWard:null, fear: null, storm: null, psychicImbuement: null, refractionUntil: 0, hitmonGuaranteed:false, hitmonAction:null, attackSpeedDebuffUntil: 0,
    gasTime: 0, gasCharge: null, sleep:null, surf:null, ditto: pokemon.family==='ditto' ? {used:false,active:false,original:{family:pokemon.family,stage:pokemon.stage,stats:{...stats},iv:{...pokemon.iv},level:pokemon.level,range:stage.range + equipment.filter(i=>i.recipe==='red+red').length*numberParam('longbow','range'),energyNeeded:stage.energy,hp:maxHp,maxHp}} : null, support: null, leap: null, charge: null, jumpHeight: 0, stunTime: 0, knockUpTime: 0, knockUpDuration: 0, stunUntil: 0, knockUpUntil: 0,
    slow: 0, metrics: metrics()
  };
}


export function createBattleGroup(players: Player[], id: string, kind: StageType = 'battle'): Battle {
  if (players.length < 2) throw new Error('Batalha precisa de dois ou mais participantes');
  const multi = players.length > 2;
  const battle:Battle = {
    id, kind, goldRound: kind === 'gold', seed:[...id].reduce((n,c)=>Math.imul(n ^ c.charCodeAt(0),16777619) >>> 0,2166136261),
    playerA: players[0].id, playerB: players[1].id,
    participants: players.map(p => p.id), rankings: [], knockoutAt: {}, goldDrops: [],
    units: players.flatMap((p, slot) => p.units.filter(u => u.position.area === 'board').map(u => makeCombatUnit(u, p, slot, multi, kind === 'boss' && p.id.startsWith('bot:')))),
    effects: [], obstacles:[], obstacleVersion:0, pillarsSpawned:false, knockupEvents: [], elapsed: 0, introElapsed: 0, outcomeElapsed: 0, resolved: false, winner: null, loser: null,
    benches: Object.fromEntries(players.map(p => [p.id, p.units.filter(u => u.position.area === 'bench').map(u => ({ ...u, position: { ...u.position }, iv: { ...u.iv } }))])),
    traitsByPlayer: Object.fromEntries(players.map(p => [p.id, countTraits(p)])),
    augmentsByPlayer: Object.fromEntries(players.map(p=>[p.id,[...(p.augments||[])]])),
    augmentTimers: {}
  };
  initializeSynergies(battle);
  beginCombatAugments(battle);
  return battle;
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
  const fx=battle.effects[battle.effects.length-1];
  const obstructed=firstObstacle(battle,caster.playerId,origin.x,origin.y,target.x,target.y);
  if(obstructed){fx.targetX=origin.x+(target.x-origin.x)*obstructed.t;fx.targetY=origin.y+(target.y-origin.y)*obstructed.t;fx.obstacleImpact=true;}
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
  if (!conversion || conversion.kind === 'none') return;
  const allies = closestTwo(battle,caster);
  for (const ally of allies) {
    if (conversion.kind === 'stat_buff' && conversion.stat) {
      const points = Math.min(50, Math.floor(amount * (conversion.points_per_damage_per_ally || 0) + stat(caster,'spa')*(conversion.spaRatio || 0)));
      const previousCooldown = ally.cooldown;
      const old = ally.buffs.find(b => b.sourceId === caster.id && b.stat === conversion.stat);
      if (old) { old.amount = Math.max(points,old.amount); old.until = battle.elapsed + (conversion.duration_seconds || 6); }
      else ally.buffs.push({ sourceId:caster.id, stat:conversion.stat, amount:points, until:battle.elapsed + (conversion.duration_seconds || 6) });
      if (conversion.stat === 'speed') {
        ally.cooldown = attackCooldown(stat(ally,'speed'));
        ally.attackClock *= ally.cooldown/previousCooldown;
      }
    } else if (conversion.kind === 'heal') {
      heal(battle, ally, (amount * (conversion.healing_pool_per_damage || 0) + stat(caster,'spa')*(conversion.spaRatio || 0)) / allies.length, caster);
    } else if (conversion.kind === 'barrier') {
      const desired = (amount * (conversion.shield_pool_per_damage || 0) + stat(caster,'spa')*(conversion.spaRatio || 0)) / allies.length;
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

/** World-space deterministic meteor and fragment impacts. Exactly one contact per fragment. */
function tickFieldEffect(battle:Battle,fx:CombatEffect,oldTime:number,dt:number):boolean {
  const source=fx.sourceId&&battle.units.find(u=>u.id===fx.sourceId);
  if(fx.meteor){
    const m=fx.meteor;
    if(!m.done && oldTime<m.hitAt && fx.time>=m.hitAt){
      m.done=true;
      if(source){
        for(const enemy of battle.units)if(enemy.playerId!==source.playerId&&isTargetable(enemy)&&distance(enemy,{x:fx.targetX,y:fx.targetY})<=m.radius)
          deal(battle,source,enemy,m.raw,true,true,'rock');
        battle.effects.push({id:fx.id+':impact',kind:'meteor-impact',family:source.family,sourceId:source.id,
          x:fx.targetX,y:fx.targetY,targetX:fx.targetX,targetY:fx.targetY,time:0,duration:.42,value:m.radius});
        const bounds=arenaBoundary(battle);
        const axes=[[1,0],[-1,0],[0,1],[0,-1]] as const;
        axes.forEach(([dx,dy],index)=>{
          const endX=dx>0?bounds.maxX:dx<0?bounds.minX:fx.targetX;
          const endY=dy>0?bounds.maxY:dy<0?bounds.minY:fx.targetY;
          const span=Math.hypot(endX-fx.targetX,endY-fx.targetY);
          if(span>.01)battle.effects.push({id:fx.id+':fragment:'+index,kind:'meteor-fragment',family:source.family,
            sourceId:source.id,x:fx.targetX,y:fx.targetY,targetX:endX,targetY:endY,time:0,
            duration:span/Math.max(.1,m.speed),value:0,fragment:{raw:m.raw*m.fragmentRatio,speed:m.speed}});
        });
      }
    }
    return true;
  }
  if(fx.fragment){
    if(!source)return true;
    const t0=Math.min(1,oldTime/fx.duration),t1=Math.min(1,fx.time/fx.duration);
    const ax=fx.x+(fx.targetX-fx.x)*t0,ay=fx.y+(fx.targetY-fx.y)*t0;
    const bx=fx.x+(fx.targetX-fx.x)*t1,by=fx.y+(fx.targetY-fx.y)*t1;
    const block=firstObstacle(battle,source.playerId,ax,ay,bx,by);
    const endX=block?ax+(bx-ax)*block.t:bx,endY=block?ay+(by-ay)*block.t:by;
    let first:CombatUnit|null=null,min=Infinity;
    for(const enemy of battle.units){
      if(enemy.playerId===source.playerId||!isTargetable(enemy))continue;
      if(segmentDistanceSq(ax,ay,endX,endY,enemy.x,enemy.y)>(collisionRadius(enemy.family,enemy.stage)+.12)**2)continue;
      const d=Math.hypot(enemy.x-ax,enemy.y-ay);
      if(d<min){min=d;first=enemy;}
    }
    if(first){
      deal(battle,source,first,fx.fragment.raw,true,true,'rock');
      effect(battle,source,first,'meteor-impact',.16);
      fx.time=fx.duration; // one target, then the fragment disappears
    } else if(block)fx.time=fx.duration;
    return true;
  }
  if(fx.cone){
    const c=fx.cone;
    if(!c.done&&fx.time>=c.hitAt){
      c.done=true;
      if(source){
        const aim={x:fx.targetX,y:fx.targetY};
        for(const enemy of battle.units){
          if(enemy.playerId===source.playerId||!isTargetable(enemy)||!withinCone(source,aim,enemy,c.range,c.angle))continue;
          const dealt=deal(battle,source,enemy,c.raw,true,true,'bug');
          if(c.executeThreshold>0&&dealt>0&&enemy.hp>0&&enemy.hp/enemy.maxHp<c.executeThreshold){
            const remaining=enemy.hp;enemy.hp=0;
            source.metrics.dealt+=remaining;source.metrics.specialDealt+=remaining;enemy.metrics.taken+=remaining;
            floatingDamage(battle,enemy,remaining,'special');
            if(!onSynergyDeath(battle,source,enemy,{deal,heal,effect,stat}))knockout(battle,source,enemy,remaining);
          }
        }
      }
    }
    return true;
  }
  return false;
}

/** Impact is tied to fixed simulation time, even at high/low client FPS. */
function tickScizor(battle:Battle,source:CombatUnit,dt:number):void {
  const action=source.scizorAction;
  if(!action)return;
  const target=battle.units.find(u=>u.id===action.targetId&&isTargetable(u));
  if(!target){source.scizorAction=undefined;source.moving=false;return;}
  action.elapsed+=dt;
  if(action.elapsed<action.dashTime){
    const t=Math.min(1,action.elapsed/action.dashTime);
    const x=action.fromX+(action.toX-action.fromX)*t,y=action.fromY+(action.toY-action.fromY)*t;
    const bounds=arenaBoundary(battle);
    if(x>=bounds.minX&&x<=bounds.maxX&&y>=bounds.minY&&y<=bounds.maxY&&clearStep(battle,source,x,y)){
      source.x=x;source.y=y;source.moving=true;
    } else {action.elapsed=action.dashTime;source.moving=false;}
    if(action.elapsed<action.dashTime)return;
  }
  source.moving=false;
  const move=ATTACKS.moves['scizor-double'];
  while(action.hitsDone<2&&action.elapsed>=action.dashTime+action.nextHit){
    if(!isTargetable(target)||distance(source,target)>1.7)break;
    deal(battle,source,target,move.baseDamage+stat(source,'spa')*move.specialRatio,true,true,'steel');
    effect(battle,source,target,'scizor-impact',action.hitsDone+1);
    animate(source,'Attack',move.hitInterval??.22);
    action.hitsDone++;action.nextHit+=(move.hitInterval??.22);
  }
  if(action.hitsDone>=2||!isTargetable(target)||distance(source,target)>1.7)source.scizorAction=undefined;
}

function landProjectiles(battle: Battle, dt: number): void {
  // Multiple tornadoes may overlap; a single 50% slow is applied (never multiplied).
  for(const unit of battle.units)unit.windSlow=0;
  for (const fx of battle.effects) {
    if (fx.pendingHit) {
      const movingTarget = battle.units.find(u => u.id === fx.pendingHit!.targetId && u.hp > 0);
      if (movingTarget && !fx.obstacleImpact && fx.kind!=='falling-star') { fx.targetX = movingTarget.x; fx.targetY = movingTarget.y; }
    }
    const oldTime = fx.time;
    fx.time += dt;
    if(tickFieldEffect(battle,fx,oldTime,dt))continue;
    if (fx.wind) {
      const wind=fx.wind;
      const caster=battle.units.find(u=>u.id===wind.sourceId);
      if(!caster||fx.time>=fx.duration){fx.time=fx.duration;continue;}
      // Fixed substeps prevent tunneling at accelerated combat speed. One hit ID per cast.
      let remaining=dt;
      while(remaining>0 && wind.traveled<wind.maxDistance){
        const step=Math.min(.035,remaining);remaining-=step;
        const touching=battle.units.some(unit=>unit.hp>0&&unit.playerId!==caster.playerId
          &&Math.hypot(unit.x-fx.x,unit.y-fx.y)<=wind.radius);
        const ratio=touching ? wind.speedFactor : 1;
        const traveled=Math.min(wind.maxDistance-wind.traveled,wind.speed*ratio*step);
        const px=fx.x,py=fx.y;
        fx.x+=wind.dx*traveled;fx.y+=wind.dy*traveled;wind.traveled+=traveled;
        const stopped=firstObstacle(battle,caster.playerId,px,py,fx.x,fx.y,wind.radius*.6);
        if(stopped){fx.x=px+(fx.x-px)*stopped.t;fx.y=py+(fx.y-py)*stopped.t;fx.time=fx.duration;
          effect(battle,caster,{x:fx.x,y:fx.y},'wall-impact',0);break;}
        for(const unit of battle.units){
          if(unit.hp<=0||unit.playerId===caster.playerId)continue;
          if(segmentDistanceSq(px,py,fx.x,fx.y,unit.x,unit.y)>wind.radius**2)continue;
          if(!wind.hitIds.includes(unit.id)){
            wind.hitIds.push(unit.id);deal(battle,caster,unit,wind.raw,true,true,wind.attackType);
          }
          // The slowing effect is tied to the tornado's actual contact area.
          if(unit.hp>0 && Math.hypot(unit.x-fx.x,unit.y-fx.y)<=wind.radius)unit.windSlow=Math.max(unit.windSlow||0,wind.slowFactor);
        }
      }
      if(wind.traveled>=wind.maxDistance)fx.time=fx.duration;
      continue;
    }
    if (fx.piercing) {
      const hit = fx.piercing;
      const caster = battle.units.find(u => u.id === hit.sourceId);
      if (!caster) continue;
      const a = Math.min(1, oldTime / fx.duration), b = Math.min(1, fx.time / fx.duration);
      if (a >= 1) continue;
      const ax = fx.x + (fx.targetX - fx.x) * a, ay = fx.y + (fx.targetY - fx.y) * a;
      let bx = fx.x + (fx.targetX - fx.x) * b, by = fx.y + (fx.targetY - fx.y) * b;
      const stopped=firstObstacle(battle,caster.playerId,ax,ay,bx,by);
      if(stopped){bx=ax+(bx-ax)*stopped.t;by=ay+(by-ay)*stopped.t;
        fx.time=fx.duration;effect(battle,caster,{x:bx,y:by},'wall-impact',0);}
      for (const target of battle.units) {
        if (target.playerId === caster.playerId || !isTargetable(target) || hit.hitIds.includes(target.id)) continue;
        if (segmentDistanceSq(ax, ay, bx, by, target.x, target.y) > .43 ** 2) continue;
        if(firstObstacle(battle,caster.playerId,ax,ay,target.x,target.y))continue;
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
    if(fx.obstacleImpact){effect(battle,caster,{x:fx.targetX,y:fx.targetY},'wall-impact',0);continue;}
    const move = ATTACKS.moves[hit.moveId || moveIdOf(caster)];

    if (hit.special === 'mew-blessing') {
      // A projectile aimed at a defeated/buried ally dissipates safely instead of healing a different unit off-screen.
      const ally = isTargetable(target) ? target : null;
      if (ally) {
        heal(battle,ally,(move.healBase || 0)+stat(caster,'spa')*(move.healRatio || 0),caster);
        const value = ((move.shieldBase || 0)+stat(caster,'spa')*(move.shieldSpaRatio || 0))*shieldMultiplier(ally)*sourceShieldMultiplier(caster);
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
        const multiplier=enemy.id === hit.targetId ? 1 : move.splashMultiplier || .85;
        actual += deal(battle,caster,enemy,hit.raw*multiplier,false,true,hit.attackType);
        if (caster.family === 'eevee' && move.specialRatio>0 && enemy.hp>0)
          actual += deal(battle,caster,enemy,stat(caster,'spa')*move.specialRatio*multiplier,true,true,hit.attackType);
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
    if (fx.kind!=='falling-star'){
      const obstacle=firstObstacle(battle,caster.playerId,caster.x,caster.y,target.x,target.y);
      if(obstacle){effect(battle,caster,{x:caster.x+(target.x-caster.x)*obstacle.t,y:caster.y+(target.y-caster.y)*obstacle.t},'wall-impact',0);continue;}
    }
    if (fx.kind==='falling-star' && (!caster.starWard || !caster.barriers.some(b=>b.kind==='star-ward'&&b.instanceId===caster.starWard!.instanceId&&b.hp>0))) continue;
    deal(battle, caster, target, hit.raw, hit.magical, hit.charged, hit.attackType);
    if (hit.special === 'jynx-kiss' && isTargetable(target)){
      const freeze=Math.min(move.freezeMax??2.6,(move.freezeBase??1.2)+stat(caster,'spa')*(move.freezeSpaRatio??0));
      applyStatus(battle,target,'frozen',caster,freeze,fx.id);
      const near=battle.units.filter(u=>u.playerId!==caster.playerId&&u.id!==target.id&&isTargetable(u)&&distance(u,target)<=(move.adjacentRadius??1))
        .sort((a,b)=>distance(a,target)-distance(b,target)||a.id.localeCompare(b.id))[0];
      if(near)applyStatus(battle,near,'frozen',caster,freeze*(move.adjacentFreezeRatio??.45),fx.id+':adjacent');
    }
    if(fx.kind!=='falling-star' && !hit.charged && caster.family==='mr-mime' && target.hp>0){
      const allWalls=battle.obstacles.filter(o=>o.kind==='wall'&&o.sourceId===caster.id&&o.until>battle.elapsed);
      const special=firstObstacle({...battle,obstacles:allWalls},'opponent',caster.x,caster.y,target.x,target.y);
      if(special){const wall=ATTACKS.moves['mime-wall'];deal(battle,caster,target,stat(caster,'spa')*(wall.wallBonusRatio??.48),true,false,'psychic');effect(battle,caster,target,'psychic-spark',0);}
    }
    if (hit.special === 'dragon-breath') applyAttackSlow(battle,target,move.slowDuration || 2);
    // Additional psychic component is strictly tied to landing a regular basic.
    if (!hit.charged && target.hp > 0 && caster.psychicImbuement && caster.psychicImbuement.until > battle.elapsed) {
      const buff = caster.psychicImbuement;
      const mew = battle.units.find(u => u.id === buff.sourceId);
      if (mew) { deal(battle,mew,target,buff.extraDamage,true,false,'psychic'); effect(battle,mew,target,'psychic-spark',0); }
    }
    if (hit.special === 'bone-throw' || hit.special==='bite-shred') { if (target.hp > 0) applyShred(battle,caster,target); continue; }
    if (hit.special === 'single-knockup') { applyKnockup(battle,caster,target,Math.min(move.controlMax??3,(move.controlDuration || .75)+stat(caster,'spa')*(move.controlSpaRatio||0))); continue; }
    if (hit.special === 'rock-strike') {
      const extra=Math.min(move.durabilityMax ?? .35,stat(caster,'spa')*(move.durabilitySpaRatio||0));
      if (extra>0 && caster.synergy) caster.synergy.percents.durability=(caster.synergy.percents.durability||0)+extra;
      continue;
    }
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
        target.itemTimers.poison_tick=0;
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
  // Only a definitive KO can transfer the prism's inheritance.
  onAugmentDeath(battle,target);
  effect(battle, killer, target, 'ko', damage);
  if (!battle.units.some(u => u.playerId === target.playerId && u.hp > 0)) battle.knockoutAt[target.playerId] = battle.elapsed;
  if (battle.goldRound && killer.playerId !== target.playerId) {
    battle.goldDrops.push({ id: `${battle.id}:coin:${battle.goldDrops.length}`, x: target.x, y: target.y, ownerId: killer.playerId, claimed: false });
  }
}

/** Damage is resolved only on the simulation thread. DOT/reflect/extra hits cannot proc themselves. */
function deal(battle: Battle, source: CombatUnit, target: CombatUnit, raw: number, magical: boolean, charged = false, attackType?: Element,
  mode: 'normal' | 'dot' | 'reflect' | 'extra' = 'normal'): number {
  if (!isTargetable(target)) return 0;
  const beedrill=source.family==='weedle'&&source.stage===2;
  const stinger=ATTACKS.moves['multi-jab'];
  const pierce=beedrill?Math.max(0,Math.min(stinger.pierceMax??.7,(stinger.pierceBase??0)+stat(source,'spa')*(stinger.pierceSpaRatio??0))):0;
  const defense = magical ? stat(target,'spd') : stat(target,'def')*(1-pierce);
  const element = attackType || getStageData(source.family, source.stage).chargedType;
  const typeFactor = charged ? chargedEffectiveness(element, getStageData(target.family, target.stage).elements) : 1;
  const attacker=effectivePercents(source,battle.elapsed);
  const defender=effectivePercents(target,battle.elapsed);
  // Hit serial participates in a deterministic seeded 32-bit roll. No Math.random in combat.
  source.hitSerial++;
  let bits = (battle.seed ^ Math.imul(source.hitSerial, 0x9e3779b9)) >>> 0;
  bits ^= bits >>> 16; bits = Math.imul(bits, 0x7feb352d); bits ^= bits >>> 15;
  bits = Math.imul(bits, 0x846ca68b); bits ^= bits >>> 16;
  const critical = mode==='normal' && (!charged || effectCount(source,'spell_critical')>0 || !!source.synergy?.flags.augmentSpellCritical || !!synergyTier(battle,source,'dark'))
    && (bits >>> 0)/4294967296 < attacker.critChance;
  let critFactor=critical ? attacker.critDamage : 1;
  if (critical && effectCount(target,'bramble')) critFactor=1+(critFactor-1)*(1-numberParam('bramble','criticalExtraReduction'));
  const execution= !charged && effectCount(source,'executioner') && target.hp/Math.max(1,target.maxHp)<numberParam('executioner','threshold')
    ? 1+numberParam('executioner','amplification') : 1;
  const unguarded = Math.max(0, raw) * typeFactor * (1 - target.spinReduction) *
    (1+attacker.amplification) * execution * critFactor;
  const afterAbility = unguarded * (target.guardUntil > battle.elapsed ? 1-(target.guardReductionEffective??.6) : 1);
  if (unguarded > afterAbility) { const blocked = mitigatedDamage(unguarded-afterAbility, defense);
    target.metrics.abilityMitigated += blocked; target.metrics.blocked += blocked;
    if (magical) target.metrics.blockedSpecial += blocked; else target.metrics.blockedPhysical += blocked; }
  const afterDefense = mitigatedDamage(afterAbility, defense);
  const blockedByStat = Math.max(0, afterAbility - afterDefense);
  target.metrics.blocked += blockedByStat;
  if (magical) target.metrics.blockedSpecial += blockedByStat;
  else target.metrics.blockedPhysical += blockedByStat;
  let damage = afterDefense * (1-Math.min(0.75, defender.durability+(active(target,'frozen',battle.elapsed)?STATUS_RULES.frozen.durabilityBonus:0)));
  if (magical && effectCount(target,'magic_guard')) damage*=1-numberParam('magic_guard','specialReduction');
  // Shield bonus applies to shield HP ONLY. Spillover into ordinary life
  // conserves the unamplified portion of the attack rather than multiplying it.
  const shieldFactor = (charged && mode === 'normal' && effectCount(source,'magic_sunder')
    ? 1 + numberParam('magic_sunder','shieldBonus') : 1) * (source.family==='scizor' && source.scizorAction && charged ? ATTACKS.moves['scizor-double'].shieldDamageMultiplier??2 : 1);
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
  const hpBefore=target.hp;
  target.hp -= damage;
  // An actual enemy strike (including a blocked one) triggers Ditto's only transformation.
  if (mode === 'normal' && source.playerId !== target.playerId && source.id !== target.id && target.hp > 0) {
    if (target.ditto && !target.ditto.used) transformDitto(battle,target,source);
    }
  if (target.ditto?.active && target.hp > 0 && target.hp / target.maxHp < (ATTACKS.moves['ditto-transform'].revertHealthRatio ?? .3)) revertDitto(battle,target);
  // Exactly one energy point per *effective damage event*, not per damage amount.
  // Barrier absorption counts; a fully prevented hit does not. No further events are emitted.
  if (damage + absorbedTotal > 0)
    if (!blocksEnergy(target,battle.elapsed)) target.energy = Math.min(target.energyNeeded,target.energy+1);
  if (damage > 0) floatingDamage(battle, target, damage, magical ? 'special' : 'physical');
  target.flash = 0.19;
  if (damage > target.maxHp * .2 && target.hp > 0 && !target.leap && !target.combo) animate(target, 'Hurt', .28, target.spinTime > 0 ? 'Withdraw' : undefined);
  onSynergyHit(battle,source,target,hpBefore,damage+absorbedTotal,mode==='normal', {deal,heal,effect,stat});
  onAugmentDamage(battle,target);
  if(target.hp<=0 && !onSynergyDeath(battle,source,target,{deal,heal,effect,stat}))knockout(battle,source,target,damage);
  if (!magical && !charged && mode==='normal' && STATUS_RULES.sleeping.wakeOnPhysicalBasic && damage+absorbedTotal>0) wakeFromBasic(target);
  const actual=damage+absorbedTotal;
  if (mode==='normal' && actual>0) {
    if (attacker.vampirism>0 && source.hp>0) heal(battle,source,damage*attacker.vampirism,source);
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

function changeDittoShape(battle:Battle,unit:CombatUnit,family:CombatUnit['family'],stage:number,level:number,stats:CombatUnit['stats'],range:number,energyNeeded:number):void {
 const healthRatio=unit.hp/Math.max(1,unit.maxHp);
 unit.family=family;unit.stage=stage;unit.level=level;unit.stats={...stats};unit.maxHp=stats.hp;
 unit.hp=Math.min(unit.maxHp,Math.max(0,unit.maxHp*healthRatio));unit.range=range;unit.energyNeeded=energyNeeded;
 unit.energy=Math.min(unit.energy,unit.energyNeeded);
 unit.combo=null;unit.leap=null;unit.charge=null;unit.surf=null;unit.gasCharge=null;unit.support=null;
 unit.pendingPollen=null;unit.spinTime=0;unit.spinReduction=0;unit.hitmonAction=null;unit.ghost=null;unit.dig=null;
 unit.animation=null;unit.refractionUntil=0;unit.orbitFlames=[];unit.lullaby=null;unit.starWard=null;unit.statuses={};unit.hitmonGuaranteed=false;
 effect(battle,unit,unit,'transform',0);
}
function transformDitto(battle:Battle,ditto:CombatUnit,attacker:CombatUnit):void {
 const state=ditto.ditto;if(!state||state.used||!attacker.hp)return;
 const cfg=ATTACKS.moves['ditto-transform'];const level=Math.min(attacker.level,state.original.level+(cfg.levelBonusCap??6));
 const stage=attacker.stage;
 // Never inherit the enemy's items, cumulative buffs, or already-scaled final stats.
 // Ditto uses the copied species/IV progression with its own items and team bonuses.
 const next=bonusStats(calculateStats(attacker.family,level,attacker.iv,stage),ditto.equipment);
 const base=bonusStats(calculateStats(state.original.family,state.original.level,state.original.iv,state.original.stage),ditto.equipment);
 for(const key of Object.keys(next) as Array<keyof typeof next>){
   next[key]=Math.max(1,Math.round(next[key]*state.original.stats[key]/Math.max(1,base[key])));
 }
 state.used=true;state.active=true;
 const rangeBonus=state.original.range-getStageData(state.original.family,state.original.stage).range;
 changeDittoShape(battle,ditto,attacker.family,stage,level,next,getStageData(attacker.family,stage).range+rangeBonus,getStageData(attacker.family,stage).energy);
}
function revertDitto(battle:Battle,ditto:CombatUnit):void {
 const state=ditto.ditto;if(!state?.active)return;
 state.active=false;
 const original=state.original;
 changeDittoShape(battle,ditto,original.family,original.stage,original.level,original.stats,original.range,original.energyNeeded);
 // Original Ditto's passive is consumed for the remainder of the battle.
 ditto.energy=0;
}
function grantBarrier(battle: Battle, source: CombatUnit, moveId: string): void {
  const move = ATTACKS.moves[moveId];
  const hp = ((move.shieldBase || 0) + (move.shieldDefenseRatio || 0) * stat(source,'def') + (move.shieldSpaRatio || 0) * stat(source,'spa')) * shieldMultiplier(source)*sourceShieldMultiplier(source);
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

/** One shared movement/strike timeline for the Hitmons; animations and damage use
 * the same simulation clock. Paths and landing points never cross occupied units. */
function validHitmonLanding(battle:Battle,source:CombatUnit,x:number,y:number):boolean {
 const bounds=arenaBoundary(battle);
 if(x<bounds.minX||x>bounds.maxX||y<bounds.minY||y>bounds.maxY)return false;
 for(const unit of battle.units) if(unit!==source&&unit.hp>0) {
  if(Math.hypot(unit.x-x,unit.y-y)<.67)return false;
  if(segmentDistanceSq(source.x,source.y,x,y,unit.x,unit.y)<.55**2)return false;
 }
 return true;
}
function hitmonLocations(battle:Battle,source:CombatUnit,dash:number):Array<{x:number;y:number}> {
 const points=[{x:source.x,y:source.y}];
 // Finite, deterministic candidates, including the original point and short steps.
 for (let i=0;i<24;i++) for(const fraction of [.5,1]){
  const angle=i*Math.PI/12,dist=dash*fraction;
  const x=source.x+Math.cos(angle)*dist,y=source.y+Math.sin(angle)*dist;
  if(validHitmonLanding(battle,source,x,y))points.push({x,y});
 }
 return points;
}
function hitmonChoice(battle:Battle,source:CombatUnit,moveId:string):{x:number;y:number;target:CombatUnit}|null {
 const move=ATTACKS.moves[moveId],radius=move.hitRadius||1;
 const positions=hitmonLocations(battle,source,move.dashRange||1);
 const enemies=battle.units.filter(u=>u.playerId!==source.playerId&&isTargetable(u));
 if(move.effect==='hitmonchan-uppercut') {
  return enemies.flatMap(enemy=>positions.filter(point=>distance(point,enemy)<=radius+.01)
    .map(point=>({...point,target:enemy}))).sort((a,b)=>b.target.hp-a.target.hp
      ||distance(a,source)-distance(b,source)||a.target.id.localeCompare(b.target.id)||a.x-b.x||a.y-b.y)[0]||null;
 }
 const choices=positions.map(point=>{
  const hits=enemies.filter(enemy=>distance(point,enemy)<=(move.splashRange||1.25));
  return {...point,hits,hpTotal:hits.reduce((sum,u)=>sum+u.hp,0)};
 }).filter(c=>c.hits.length).sort((a,b)=>b.hits.length-a.hits.length||b.hpTotal-a.hpTotal
   ||distance(a,source)-distance(b,source)||a.x-b.x||a.y-b.y);
 const best=choices[0];
 if(!best)return null;
 return {x:best.x,y:best.y,target:best.hits.sort((a,b)=>a.id.localeCompare(b.id))[0]};
}
function activateHitmon(battle:Battle,source:CombatUnit,moveId:string):boolean {
 const move=ATTACKS.moves[moveId];
 if(move.effect==='hitmonlee-spin-kick'&&!source.hitmonGuaranteed) {
  // Same seed and cast sequence => same 50/50 sequence, no Math.random.
  const bits=(battle.seed^Math.imul(++source.hitSerial+source.metrics.casts,0x9e3779b9))>>>0;
  let x=bits^(bits>>>16);x=Math.imul(x,0x7feb352d);x^=x>>>15;
  if((x>>>0)/4294967296<(move.chance??.5)) {
   const spa=stat(source,'spa');
   const shield=(move.shieldBase||0)+spa*(move.shieldSpaRatio||0);
   const key='hitmonlee:guard:'+source.id;
   const cap=Math.max(0,source.maxHp*.35-source.barriers.filter(b=>b.sourceId!==key).reduce((v,b)=>v+b.hp,0));
   const old=source.barriers.find(b=>b.sourceId===key);
   if(old){old.hp=Math.max(old.hp,Math.min(shield*shieldMultiplier(source),cap));old.until=battle.elapsed+(move.shieldDuration||5);}
   else source.barriers.push({sourceId:key,kind:'item',hp:Math.min(shield*shieldMultiplier(source),cap),until:battle.elapsed+(move.shieldDuration||5)});
   const buffKey='hitmonlee:speed:'+source.id;
   const amount=(move.bonusBase||0)+spa*(move.bonusSpaRatio||0);
   const prev=source.buffs.find(b=>b.sourceId===buffKey&&b.stat==='speed');
   if(prev){prev.amount=amount;prev.until=battle.elapsed+(move.buffDuration||5);}
   else source.buffs.push({sourceId:buffKey,stat:'speed',amount,until:battle.elapsed+(move.buffDuration||5)});
   source.hitmonGuaranteed=true;
   animate(source,'Charge',.48);
   effect(battle,source,source,'shield',shield);
   return true;
  }
 }
 const choice=hitmonChoice(battle,source,moveId);
 if(!choice)return false;
 const moves=distance(source,choice)>.06;
 const action:NonNullable<CombatUnit['hitmonAction']>={phase:moves?'move':'strike',kind:move.effect==='hitmonchan-uppercut'?'uppercut':'kick',
  moveId,targetId:choice.target.id,fromX:source.x,fromY:source.y,toX:choice.x,toY:choice.y,
  elapsed:0,duration:moves?.27:.52,remaining:source.hitmonGuaranteed?2:1,hitDone:false};
 source.hitmonGuaranteed=false;
 source.hitmonAction=action;
 source.facingX=choice.target.x-source.x;source.facingY=choice.target.y-source.y;
 animate(source,moves?'Walk':getStageData(source.family,source.stage).chargedAnimation,action.duration);
 return true;
}
function tickHitmonAction(battle:Battle,source:CombatUnit,dt:number):void {
 const action=source.hitmonAction;if(!action)return;
 const move=ATTACKS.moves[action.moveId];
 action.elapsed=Math.min(action.duration,action.elapsed+dt);
 if(action.phase==='move'){
  const t=action.elapsed/action.duration;
  source.x=action.fromX+(action.toX-action.fromX)*t;
  source.y=action.fromY+(action.toY-action.fromY)*t;
  source.moving=true;
  if(t>=1){action.phase='strike';action.elapsed=0;action.duration=.52;animate(source,getStageData(source.family,source.stage).chargedAnimation,.52);}
  return;
 }
 if(action.phase==='pause'){
  if(action.elapsed>=action.duration){action.phase='strike';action.elapsed=0;action.duration=.52;action.hitDone=false;
   animate(source,'Kick',.52);}
  return;
 }
 if(!action.hitDone && action.elapsed>=(move.impactDelay||.25)){
  action.hitDone=true;
  const old=battle.units.find(u=>u.id===action.targetId);
  if(action.kind==='uppercut'){
   if(old&&isTargetable(old)&&distance(source,old)<=(move.hitRadius||1)+.14){
    const hp=old.hp;
    deal(battle,source,old,move.baseDamage+stat(source,'atk')*(move.attackRatio||0),false,true,'fighting');
    const seconds=Math.max(move.stunMin||.45,Math.min(move.stunMax||1.8,(move.stunBase||.65)+stat(source,'spa')*(move.stunSpaRatio||.008)-hp*(move.stunHpRatio||.0007)));
    if(old.hp>0&&!old.controlImmune && !(effectCount(old,'opening_immunity')&&battle.elapsed<ITEMS.combatIntroSeconds+numberParam('opening_immunity','duration'))){
     source.metrics.controlSeconds+=Math.max(0,battle.elapsed+seconds-Math.max(battle.elapsed,old.stunUntil));
     old.stunUntil=Math.max(old.stunUntil,battle.elapsed+seconds);
     old.stunTime=Math.max(0,old.stunUntil-battle.elapsed);
    }
    effect(battle,source,old,'kick-impact',.7);
   }
  }else{
   const victims=battle.units.filter(u=>u.playerId!==source.playerId&&isTargetable(u)&&distance(u,source)<=(move.splashRange||1.25))
     .sort((a,b)=>a.id.localeCompare(b.id));
   for(const victim of victims)deal(battle,source,victim,move.baseDamage+stat(source,'atk')*(move.attackRatio||0),false,true,'fighting');
   effect(battle,source,source,'hitmon-spin',move.splashRange||1.25);
  }
 }
 if(action.elapsed>=action.duration){
  action.remaining--;
  if(action.remaining>0){action.phase='pause';action.elapsed=0;action.duration=.12;}
  else source.hitmonAction=null;
 }
}

function spell(battle: Battle, source: CombatUnit, target: CombatUnit | null): void {
  const stage = getStageData(source.family, source.stage);
  const moveId = moveIdOf(source), move = ATTACKS.moves[moveId];
  source.metrics.casts++;
  onAugmentCast(battle,source);
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
  if(move.effect==='meteor-rain'){
    const sourceSeed=[...source.id].reduce((n,char)=>Math.imul(n^char.charCodeAt(0),16777619)>>>0,2166136261);
    const centers=meteorCenters(battle,source.metrics.casts^sourceSeed,move.meteorCount??4);
    const raw=move.baseDamage+s*move.specialRatio;
    const warning=Math.max(.1,move.warningSeconds??.4);
    const travel=1/Math.max(.1,move.fallSpeed??2.8);
    for(const [i,pos] of centers.entries())battle.effects.push({
      id:`${battle.id}:meteor:${source.id}:${source.metrics.casts}:${i}`,sourceId:source.id,
      kind:'meteor-fall',family:source.family,x:source.x,y:source.y,targetX:pos.x,targetY:pos.y,
      time:0,duration:warning+travel+.12,value:move.impactRadius??.7,
      meteor:{raw,radius:move.impactRadius??.7,fragmentRatio:move.fragmentRatio??.25,
        speed:move.fragmentSpeed??8,hitAt:warning+travel,warning,done:false}
    });
    animate(source,stage.chargedAnimation,.5);return;
  }
  if(move.effect==='cone-slash' && target){
    const range=move.coneRange??2.5,angle=move.coneAngle??65;
    battle.effects.push({id:`${battle.id}:cone:${source.id}:${source.metrics.casts}`,sourceId:source.id,
      kind:'cone-slash',family:source.family,x:source.x,y:source.y,targetX:target.x,targetY:target.y,
      time:0,duration:.37,value:range,
      cone:{raw:move.baseDamage+s*move.specialRatio,range,angle,executeThreshold:move.executeThreshold??0,hitAt:.16,done:false}});
    animate(source,stage.chargedAnimation,.3);return;
  }
  if(move.effect==='scizor-double' && target){
    const point=digDestination(battle,source,target);
    if(!point)return;
    const path=Math.hypot(point.x-source.x,point.y-source.y);
    source.scizorAction={targetId:target.id,fromX:source.x,fromY:source.y,toX:point.x,toY:point.y,
      elapsed:0,dashTime:Math.max(.08,path/Math.max(.1,move.dashSpeed??9)),hitsDone:0,nextHit:.04};
    animate(source,'Attack',.32);
    effect(battle,source,{x:point.x,y:point.y},'scizor-dash',path);
    battle.effects[battle.effects.length-1].duration=source.scizorAction.dashTime;
    return;
  }
  if(move.effect==='jynx-kiss' && target){
    const freeze=Math.min(move.freezeMax??2.6,(move.freezeBase??1.2)+s*(move.freezeSpaRatio??0));
    const raw=move.baseDamage+s*move.specialRatio;
    projectile(battle,source,target,'frost',raw,true,true,.8,undefined,source,moveId,'ice');
    // Keep freeze tied to projectile arrival via the existing pendingHit dispatch.
    battle.effects[battle.effects.length-1].pendingHit!.special='jynx-kiss';
    animate(source,stage.chargedAnimation,.4);return;
  }
  if(move.effect==='mime-wall'){
    animate(source,stage.chargedAnimation,.5);summonWalls(battle,source,move.wallDuration??3);
    return;
  }
  if(move.effect==='lullaby') {
    const span=Math.min(move.durationMax??6,(move.durationBaseByStage?.[source.stage]??2.2)+s*(move.durationSpaRatio??0));
    source.lullaby={until:battle.elapsed+span,instanceId:`${battle.id}:song:${source.id}:${source.metrics.casts}`,affected:[]};
    animate(source,'Withdraw',span);
    effect(battle,source,source,'lullaby-note',span);
    battle.effects[battle.effects.length-1].duration=span;
    return;
  }
  if(move.effect==='star-ward'){
    const id=`${battle.id}:star:${source.id}:${source.metrics.casts}`;
    source.barriers=source.barriers.filter(b=>b.kind!=='star-ward');
    const hp=((move.shieldBaseByStage?.[source.stage]??95)+s*(move.shieldSpaRatio??0))*shieldMultiplier(source);
    source.barriers.push({sourceId:source.id,kind:'star-ward',instanceId:id,hp,until:battle.elapsed+90});
    source.starWard={instanceId:id,nextStar:battle.elapsed+(move.starInterval??.75)};
    animate(source,stage.chargedAnimation,.55);effect(battle,source,source,'shield',hp);
    return;
  }
  if(move.effect==='flame-orbit'){
    animate(source,stage.chargedAnimation,.5);
    const count=Math.max(1,Math.min(4,Math.floor(move.orbCount??2)));
    const max=Math.max(1,Math.min(move.maxImpacts??20, Math.floor((move.impactsBase??3)+s/Math.max(1,move.spaPerExtraImpact??50))));
    // Recast restores missing orbs; existing orbs gain one charge up to the original cap.
    for(let i=0;i<count;i++){
      const existing=source.orbitFlames.find(orb=>orb.slot===i);
      if(existing){existing.impactsLeft=Math.min(max,existing.impactsLeft+1);existing.maxImpacts=max;continue;}
      // Slots are persistent. When one orb runs out, replacement must remain
      // diametrically opposite the survivor rather than copy its angle.
      const anchor=source.orbitFlames[0];
      const angle=anchor ? anchor.angle+(i-anchor.slot)*Math.PI*2/count : Math.PI*2*i/count;
      source.orbitFlames.push({slot:i,angle,impactsLeft:max,maxImpacts:max,bornAt:battle.elapsed,contacts:[],lastHit:{}});
    }
    effect(battle,source,source,'flame',0);
    return;
  }
  if(move.effect==='hitmonchan-uppercut'||move.effect==='hitmonlee-spin-kick'){activateHitmon(battle,source,moveId);return;}
  if(move.effect==='bite-shred'&&target){
    animate(source,stage.chargedAnimation,.4);
    projectile(battle,source,target,'bite-impact',move.baseDamage+a*(move.attackRatio||0),false,true,.3,
      undefined,source,moveId,stage.chargedType,'bite-shred');
    return;
  }
  if(move.effect==='wind-tornado'&&target){
    const dx=target.x-source.x,dy=target.y-source.y;
    const length=Math.hypot(dx,dy)||1;
    const ux=dx/length,uy=dy/length;
    animate(source,stage.chargedAnimation,.45);
    battle.effects.push({id:`${battle.id}:wind:${source.id}:${source.metrics.casts}`,kind:'wind-tornado',
      family:source.family,sourceId:source.id,x:source.x+ux*.38,y:source.y+uy*.38,
      targetX:target.x,targetY:target.y,time:0,duration:14,value:0,
      wind:{sourceId:source.id,raw:move.baseDamage+s*move.specialRatio,attackType:'flying',
        dx:ux,dy:uy,speed:move.tornadoSpeed||7,traveled:0,maxDistance:move.tornadoDistance||9,
        radius:move.tornadoRadius||.49,slowFactor:move.tornadoSlow??.5,speedFactor:1-(move.tornadoSpeedReduction??.8),hitIds:[]}});
    return;
  }
  if (move.effect === 'star-refraction') {
    // One activation, strictly 3 seconds of simulated combat time; no stacking.
    source.refractionUntil = battle.elapsed + (move.seconds || 3);
    animate(source, stage.chargedAnimation, .42);
    effect(battle, source, source, 'psychic-spark', 0);
    return;
  }
  const shot = (victim: CombatUnit, kind: CombatEffect['kind'], raw: number, magical: boolean,
    arrival: number, onHit?: 'drain' | 'burn' | 'slow' | 'poison') =>
    projectile(battle, source, victim, kind, raw, magical, true, arrival, onHit, source, moveId, stage.chargedType);

  if(move.effect==='desperate-splash'){
    animate(source, stage.chargedAnimation, .65);
    source.hitSerial++;
    let bits=(battle.seed ^ Math.imul(source.hitSerial+211,0x9e3779b9))>>>0;
    bits^=bits>>>16;bits=Math.imul(bits,0x7feb352d);bits^=bits>>>15;
    if((bits>>>0)/4294967296<(move.chance||0)){
      heal(battle,source,(move.healBase||0)+s*(move.healRatio||0),source);
      source.synergy!.splashBonus=(move.bonusBase||0)+s*(move.bonusSpaRatio||0);
      effect(battle,source,source,'water',1);
    }
    return;
  }
  if ((move.effect==='brutal-kick'||move.effect==='fang-tail')&&target){
    // The hit lands on the contact frame, not immediately when the cast starts.
    animate(source,move.effect==='brutal-kick'?'Kick':'RearUp',move.effect==='brutal-kick'?.47:.38);
    source.synergy!.pendingSkill={kind:move.effect==='brutal-kick'?'kick':'fang-tail',targetId:target.id,until:battle.elapsed+(move.effect==='brutal-kick'?.26:.38),moveId};
    return;
  }
  if (move.effect === 'self-explosion') {
    // Telegraph while the body pulses; damage and HP cost resolve on the flash.
    animate(source,stage.chargedAnimation,.45);
    source.synergy!.pendingSkill={kind:'explosion',targetId:source.id,until:battle.elapsed+.28,moveId};
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
  if (move.effect === 'ghost-ambush') {
    startGhost(battle, source, moveId);
    return;
  }
  if (move.effect === 'burrow') {
    source.preferredTargetId=battle.units.filter(u=>u.playerId!==source.playerId&&isTargetable(u))
      .sort((a,b)=>distance(source,b)-distance(source,a)||a.id.localeCompare(b.id))[0]?.id;
    animate(source,'Charge',.18);
    // No teleport, extra mound, or damage on casting. Emergence happens at the end of travel.
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
    animate(source,stage.chargedAnimation,.48);
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
      projectile(battle,source,target,'physical',move.baseDamage+a*(move.attackRatio||0)+s*move.specialRatio,false,true,.32,
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
      animate(source,stage.chargedAnimation,.42);
      projectile(battle,source,center,'ball',move.baseDamage + a*(move.attackRatio || 0),
        false,true,.83,undefined,source,moveId,stage.chargedType,'eevee-ball');
    }
    return;
  }
  if (move.effect === 'bone-throw' && target) {
    animate(source,stage.chargedAnimation,.4);
    projectile(battle,source,target,'bone',move.baseDamage + a*(move.attackRatio || 0),false,true,.78,
      undefined,source,moveId,stage.chargedType,'bone-throw');
    return;
  }
  if (move.effect === 'single-knockup' && target) {
    animate(source,stage.chargedAnimation,.45);
    projectile(battle,source,target,'physical',move.baseDamage + a*(move.attackRatio || 0),false,true,.32,
      undefined,source,moveId,stage.chargedType,'single-knockup');
    return;
  }
  if (move.effect === 'rock-strike' && target) {
    animate(source,stage.chargedAnimation,.44);
    projectile(battle,source,target,'physical',move.baseDamage + a*(move.attackRatio || 0),false,true,.32,
      undefined,source,moveId,stage.chargedType,'rock-strike');
    return;
  }
  if (move.effect === 'withdraw-guard') {
    source.guardUntil = battle.elapsed+(move.guardDuration || 4.5);
    source.guardReductionEffective=Math.min(move.guardMaxReduction??.75,(move.guardReduction??.35)+s*(move.guardSpaRatio||0));
    animate(source,'Withdraw',.62);
    effect(battle,source,source,'shield',0);
    return;
  }
  if (move.effect === 'healing-egg') {
    const center = bestEggCenter(battle,source,move.splashRange || 1.65,move.skillRange || 3.2);
    if (center) {
      animate(source,stage.chargedAnimation,.42);
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
    const hp=((move.shieldBase||0)+s*(move.shieldSpaRatio||0))*shieldMultiplier(source)*sourceShieldMultiplier(source);
    source.barrier={hp,maxHp:hp,time:move.shieldDuration||3.5};
    source.gasCharge={startedAt:battle.elapsed,maxDuration:move.chargeMaxDuration||3.5};
    effect(battle,source,source,'shield',hp);
    return;
  }
  if (move.effect === 'ditto-transform') return;
  if (move.effect === 'lapras-surf') { beginSurf(battle,source,moveId);return; }
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
    shot(target, 'physical', move.baseDamage + a * (move.attackRatio || 0), false, .36,'poison');
    return;
  }
  if (move.effect === 'flame-strike') {
    animate(source, 'Strike', .46);
    shot(target, 'flame', a * stageValue(move.damageRatioByStage, source.stage, 1.55), false, 1 / 2.7,'burn');
    return;
  }
  if (move.effect === 'shock') {
    animate(source, stage.chargedAnimation, .42);
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

/** Hex-grid directions, deterministic route scoring, swept hits and time-based Surf. */
function beginSurf(battle:Battle,source:CombatUnit,moveId:string):void {
 const move=ATTACKS.moves[moveId],bounds=arenaBoundary(battle);
 // Real hex world-space neighbours: 1.04 on X, approximately 1.05 diagonally.
 const directions=[[1,0],[-1,0],[.5,.8660254],[-.5,.8660254],[.5,-.8660254],[-.5,-.8660254]];
 const stepSize=.065, radius=collisionRadius(source.family,source.stage);
 const travelLimit=(move.surfSteps??2)*1.04,waveLimit=move.waveMaxDistance??11;
 const waveRadius=move.waveRadius??.6;
 const choices=directions.map(([dx,dy],order)=>{
   // The wave can travel to the arena boundary; Lapras itself must stay entirely inside it.
   const reach=(minX:number,maxX:number,minY:number,maxY:number)=>Math.max(0,Math.min(
     dx>0?(maxX-source.x)/dx:dx<0?(minX-source.x)/dx:Infinity,
     dy>0?(maxY-source.y)/dy:dy<0?(minY-source.y)/dy:Infinity));
   const maxWave=Math.min(waveLimit,reach(bounds.minX,bounds.maxX,bounds.minY,bounds.maxY));
   const maxTravel=Math.min(travelLimit,maxWave,reach(bounds.minX+radius,bounds.maxX-radius,bounds.minY+radius,bounds.maxY-radius));
   let travel=0;
   for(let step=stepSize;step<=maxTravel+stepSize*.5;step+=stepSize){
     const next=Math.min(step,maxTravel),x=source.x+dx*next,y=source.y+dy*next;
     if(!clearStep(battle,source,x,y))break;
     travel=next;
   }
   let hits=0,passHits=0;
   const endX=source.x+dx*maxWave,endY=source.y+dy*maxWave;
   for(const target of battle.units){
     if(!isTargetable(target) || target.playerId===source.playerId)continue;
     const along=(target.x-source.x)*dx+(target.y-source.y)*dy;
     if(along<0 || along>maxWave+waveRadius || segmentDistanceSq(source.x,source.y,endX,endY,target.x,target.y)>waveRadius**2)continue;
     hits++;
     if(along<=travel+waveRadius)passHits++;
   }
   return {dx,dy,order,travel,maxWave,hits,passHits};
 }).filter(c=>c.maxWave>.065).sort((a,b)=>b.hits-a.hits||b.passHits-a.passHits||b.travel-a.travel||a.order-b.order);
 const best=choices[0];if(!best)return;
 const fxId=`${battle.id}:${source.id}:surf:${source.hitSerial++}`;
 source.surf={dx:best.dx,dy:best.dy,travelled:0,waveTravel:0,maxTravel:best.travel,maxWave:best.maxWave,
   waveX:source.x,waveY:source.y,hitIds:[],shieldIds:[],fxId};
 source.facingX=best.dx;source.facingY=best.dy;
 animate(source,'Charge',Math.max(.5,best.maxWave/(move.waveSpeed??5.8)));
 battle.effects.push({id:fxId,sourceId:source.id,x:source.x,y:source.y,targetX:source.x,targetY:source.y,
   family:source.family,stage:source.stage,kind:'surf-wave',time:0,duration:best.maxWave/(move.waveSpeed??5.8)+.3,value:waveRadius});
}
function surfTick(battle:Battle,source:CombatUnit,dt:number):void {
 const surf=source.surf;if(!surf)return;
 const move=ATTACKS.moves['lapras-surf'];const speed=move.waveSpeed||5.8;
 const previousX=surf.waveX,previousY=surf.waveY;
 const waveStep=Math.min(surf.maxWave-surf.waveTravel,dt*speed);
 surf.waveTravel+=waveStep;surf.waveX+=surf.dx*waveStep;surf.waveY+=surf.dy*waveStep;
 if(surf.travelled<surf.maxTravel){
   const steps=Math.min(surf.maxTravel-surf.travelled,dt*speed);
   const nx=source.x+surf.dx*steps,ny=source.y+surf.dy*steps;
   if(clearStep(battle,source,nx,ny)){source.x=nx;source.y=ny;surf.travelled+=steps;source.moving=true;}
   else surf.maxTravel=surf.travelled; // Respect new obstacles after the route was chosen.
 }
 for(const target of battle.units){
   if(!isTargetable(target)||target.playerId===source.playerId||surf.hitIds.includes(target.id))continue;
   if(segmentDistanceSq(previousX,previousY,surf.waveX,surf.waveY,target.x,target.y)>(move.waveRadius||.6)**2)continue;
   surf.hitIds.push(target.id);
   const firstPhase=surf.maxTravel>.0001 && (target.x-(surf.waveX-surf.dx*surf.waveTravel))*surf.dx+(target.y-(surf.waveY-surf.dy*surf.waveTravel))*surf.dy<=surf.maxTravel+.00001;
   const before=target.hp;
   deal(battle,source,target,(move.baseDamage+stat(source,'spa')*move.specialRatio)
     *(firstPhase?1:move.continuationMultiplier??.5),true,true,'water');
   if(firstPhase && target.hp<before && !surf.shieldIds.includes(target.id)){
     surf.shieldIds.push(target.id);
     const hp=stat(source,'spa')*(move.shieldSpaRatio||0)*shieldMultiplier(source)*sourceShieldMultiplier(source);
     const shield=source.barriers.find(b=>b.sourceId===source.id && b.kind==='surf');
     if(shield)shield.hp+=hp;
     else source.barriers.push({sourceId:source.id,kind:'surf',hp,until:Infinity});
     effect(battle,source,source,'shield',hp);
   }
 }
 const fx=battle.effects.find(e=>e.id===surf.fxId);
 if(fx){fx.x=surf.waveX;fx.y=surf.waveY;fx.targetX=surf.waveX+surf.dx;fx.targetY=surf.waveY+surf.dy;}
 if(surf.waveTravel>=surf.maxWave-.00001){source.surf=null;if(fx)fx.time=fx.duration;}
}

function pendingSkillTick(battle:Battle,source:CombatUnit):boolean {
  const pending=source.synergy?.pendingSkill;
  if(!pending)return false;
  if(battle.elapsed<pending.until)return true;
  source.synergy!.pendingSkill=undefined; // Execute exactly once, even when hit events recurse.
  const target=battle.units.find(u=>u.id===pending.targetId);
  const move=ATTACKS.moves[pending.moveId];
  if(!target||!move)return true;
  if(pending.kind==='explosion') {
    effect(battle,source,source,'explosion',move.splashRange||1.45);
    for (const enemy of battle.units.filter(u=>u.playerId!==source.playerId && isTargetable(u) && distance(u,source)<=(move.splashRange||1.45)))
      deal(battle,source,enemy,move.baseDamage+stat(source,'spa')*move.specialRatio,true,true,getStageData(source.family,source.stage).chargedType);
    source.hp=Math.max(0,source.hp-source.maxHp*(move.selfHpCost||0));
    if(source.hp<=0) {source.hp=0;if(!onSynergyDeath(battle,source,source,{deal,heal,effect,stat}))knockout(battle,source,source,0);}
    return true;
  }
  const a=stat(source,'atk');
  if(pending.kind==='kick'){
    if(!isTargetable(target))return true;
    deal(battle,source,target,(move.baseDamage||0)+a*(move.attackRatio||0)+stat(source,'spa')*move.specialRatio,false,true,'fighting');
    if(target.hp>0){
      const push=pushTarget(battle,source,target,move.push||1);
      if(push.wall&&push.moved<(move.push||1)){
        deal(battle,source,target,move.wallDamage||0,false,false,'fighting','extra');
        if(target.hp>0)target.stunUntil=Math.max(target.stunUntil,battle.elapsed+(move.stunDuration||0));
        effect(battle,source,target,'kick-impact',move.wallDamage||0);
      }
    }
  } else {
    const facing=Math.hypot(source.facingX,source.facingY)||1;
    const vx=source.facingX/facing,vy=source.facingY/facing;
    if(isTargetable(target))deal(battle,source,target,(move.baseDamage||0)+a*(move.attackRatio||0)+stat(source,'spa')*move.specialRatio,false,true,'water');
    for(const enemy of battle.units){
      if(enemy.playerId===source.playerId||!isTargetable(enemy)||enemy===target)continue;
      const dx=enemy.x-source.x,dy=enemy.y-source.y;
      if(Math.hypot(dx,dy)>(move.tailRadius||2)||dx*vx+dy*vy>-.12)continue;
      deal(battle,source,enemy,(move.tailBase||0)+a*(move.tailRatio||0),false,true,'water');
      if(enemy.hp>0)pushTarget(battle,source,enemy,move.push||3);
    }
    animate(source,'Rumble',.34);
    effect(battle,source,source,'tail-sweep',move.tailRadius||2);
  }
  return true;
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
  if (source.gasCharge) {
    if(source.barrier && source.barrier.time>0 && source.barrier.hp>0 && battle.elapsed-source.gasCharge.startedAt<source.gasCharge.maxDuration)return;
    source.barrier=null;
  } else {
    source.gasTime -= dt;
    if (source.gasTime > 0) return;
  }
  source.gasTime=0;
  const move = ATTACKS.moves[getStageData(source.family, source.stage).move];
  const radius = stageValue(move.radiusByStage, source.stage, 1.85);
  const raw = stageValue(move.damageByStage, source.stage) + stat(source,'atk') * (move.gasAttackRatio ?? .25) + Math.min(move.chargeMaxDuration||3.5,source.gasCharge ? battle.elapsed-source.gasCharge.startedAt : 0)*(move.gasTimeRatio||0);
  for (const target of battle.units) {
    if (target.hp > 0 && target.playerId !== source.playerId && distance(source, target) <= radius)
      deal(battle,source,target,raw,false,true);
  }
  effect(battle,source,source,'gas',radius);
  source.gasCharge=null;
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
    applyKnockup(battle,source,target,move.stunDuration || 2,.35);
  }
  source.sleep={time:0,healed:0};
  animate(source,'Sleep',move.sleepDuration||3);
}
function sleepTick(battle:Battle,source:CombatUnit,dt:number):void {
 const sleep=source.sleep;if(!sleep)return;
 const move=ATTACKS.moves['heavy-stomp'];const duration=move.sleepDuration||3;
 sleep.time=Math.min(duration,sleep.time+dt);
 const ticks=move.sleepTicks||5;
 while(sleep.healed<ticks && sleep.time>=duration*(sleep.healed+1)/ticks-1e-7){
   heal(battle,source,(move.sleepHealBase||0)+stat(source,'spa')*(move.sleepHealSpaRatio||0),source);
   sleep.healed++;
 }
 if(sleep.time>=duration){source.sleep=null;source.animation=null;}
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
      deal(battle,source,target,move.baseDamage+stat(source,'atk')*(move.attackRatio||0)+stat(source,'spa')*move.specialRatio,false,true,'rock');
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
function emergeAfterWalk(battle:Battle,source:CombatUnit):void {
  if(source.family!=='diglett'||!source.wasMoving)return;
  source.wasMoving=false;
  const target=battle.units.find(u=>u.id===source.preferredTargetId&&isTargetable(u)) ||
    battle.units.filter(u=>u.playerId!==source.playerId&&isTargetable(u))
      .sort((a,b)=>distance(source,a)-distance(source,b)||a.id.localeCompare(b.id))[0];
  const move=ATTACKS.moves[moveIdOf(source)],raw=move.baseDamage+stat(source,'spa')*move.specialRatio;
  if(source.stage===0){if(target&&distance(source,target)<=2.5)deal(battle,source,target,raw,true,true,'ground');}
  else for(const enemy of battle.units)if(enemy.playerId!==source.playerId&&isTargetable(enemy)&&distance(source,enemy)<=(move.splashRange??1.5))
    deal(battle,source,enemy,raw,true,true,'ground');
  effect(battle,source,source,'earth-burst',source.stage?.8:.5);
  animate(source,'Attack',.24);
  source.attackClock=Math.max(source.attackClock,.22);
}

/** Deterministic ghost traversal: the whole path ignores occupied hexes, but the final spot does not. */
function ghostLanding(battle: Battle, caster: CombatUnit, target: CombatUnit): {x:number;y:number} | null {
  const d=Math.max(.001,distance(caster,target));
  const dx=(target.x-caster.x)/d,dy=(target.y-caster.y)/d;
  const bounds=arenaBoundary(battle);
  const options=[
    {x:target.x+dx*.9,y:target.y+dy*.9},
    {x:target.x+dx*.75-dy*.58,y:target.y+dy*.75+dx*.58},
    {x:target.x+dx*.75+dy*.58,y:target.y+dy*.75-dx*.58},
    {x:target.x-dy*.85,y:target.y+dx*.85},
    {x:target.x+dy*.85,y:target.y-dx*.85}
  ];
  // Packed teams can occupy every preferred square. Scan the one-tile ring
  // around the target so the ghost still finds a legal emergence location.
  for(const radius of [.85,1.0,1.08]) for(let index=0;index<16;index++) {
    const angle=Math.atan2(dy,dx)+(index%2===0 ? 1 : -1)*Math.ceil(index/2)*Math.PI/8;
    options.push({x:target.x+radius*Math.cos(angle),y:target.y+radius*Math.sin(angle)});
  }
  return options.find(p=>p.x>=bounds.minX&&p.x<=bounds.maxX&&p.y>=bounds.minY&&p.y<=bounds.maxY
    && !battle.units.some(u=>u!==caster&&u.hp>0&&Math.hypot(u.x-p.x,u.y-p.y)<.6)) || null;
}
function startGhost(battle: Battle, caster: CombatUnit, moveId: string): void {
  const move=ATTACKS.moves[moveId];
  const target=battle.units.filter(u=>u.playerId!==caster.playerId && isTargetable(u) && distance(u,caster)<=(move.skillRange||2))
    .sort((a,b)=>a.hp-b.hp||a.id.localeCompare(b.id))[0];
  if (!target) return;
  const destination=ghostLanding(battle,caster,target);
  if (!destination) return;
  caster.ghostCasts++;
  const scare=caster.family==='gastly' && caster.stage===2 && caster.ghostCasts%2===0;
  caster.ghost={phase:'fade',time:0,duration:.17,fromX:caster.x,fromY:caster.y,
    toX:destination.x,toY:destination.y,targetId:target.id,moveId,trailClock:0,scare};
  animate(caster,getStageData(caster.family,caster.stage).chargedAnimation,.2);
}
/** Push a frightened enemy up to one tile away, without overlapping another combatant. */
function scareTarget(battle: Battle,caster: CombatUnit,victim: CombatUnit, duration:number): void {
  if (victim.controlImmune || (effectCount(victim,'opening_immunity')
    && battle.elapsed<ITEMS.combatIntroSeconds+numberParam('opening_immunity','duration'))) return;
  const dist=Math.max(.001,distance(caster,victim));
  const dx=(victim.x-caster.x)/dist,dy=(victim.y-caster.y)/dist;
  const bounds=arenaBoundary(battle);
  let endpoint={x:victim.x,y:victim.y};
  for(let amount=1;amount>=.1;amount-=.1) {
    const x=victim.x+dx*amount,y=victim.y+dy*amount;
    if (x<bounds.minX||x>bounds.maxX||y<bounds.minY||y>bounds.maxY) continue;
    if(battle.units.some(u=>u!==victim&&u.hp>0&&Math.hypot(u.x-x,u.y-y)<.64)) continue;
    endpoint={x,y};break;
  }
  if (Math.hypot(endpoint.x-victim.x,endpoint.y-victim.y)<.08) return;
  victim.fear={fromX:victim.x,fromY:victim.y,toX:endpoint.x,toY:endpoint.y,time:0,duration:.28};
  victim.stunUntil=Math.max(victim.stunUntil,battle.elapsed+Math.max(duration,.35));
  caster.metrics.controlSeconds+=Math.max(duration,.35);
}
function ghostTick(battle: Battle,caster: CombatUnit,dt: number): void {
  const ghost=caster.ghost;
  if(!ghost) return;
  ghost.time=Math.min(ghost.duration,ghost.time+dt);
  if(ghost.phase==='fade' && ghost.time>=ghost.duration) {
    ghost.phase='travel';ghost.time=0;
    ghost.duration=Math.max(.28,distance({x:ghost.fromX,y:ghost.fromY},{x:ghost.toX,y:ghost.toY})/6.4);
    caster.animation=null;
  } else if(ghost.phase==='travel') {
    const t=ghost.time/ghost.duration;
    caster.x=ghost.fromX+(ghost.toX-ghost.fromX)*t;
    caster.y=ghost.fromY+(ghost.toY-ghost.fromY)*t;
    caster.facingX=ghost.toX-ghost.fromX;caster.facingY=ghost.toY-ghost.fromY;
    ghost.trailClock+=dt;
    if(ghost.trailClock>=.09) {ghost.trailClock%=.09;effect(battle,caster,caster,'ghost-trail',0);}
    if(ghost.time>=ghost.duration) {
      const target=battle.units.find(u=>u.id===ghost.targetId && isTargetable(u));
      const free=(target && ghostLanding(battle,caster,target)) || null;
      if(battle.units.some(u=>u!==caster&&u.hp>0&&distance(u,caster)<.6)) {
        if(free){caster.x=free.x;caster.y=free.y;}
        else {caster.x=ghost.fromX;caster.y=ghost.fromY;}
      }
      ghost.phase='appear';ghost.time=0;ghost.duration=.3;
      const move=ATTACKS.moves[ghost.moveId];
      const radius=move.splashRange||1.12;
      if(ghost.scare) {
        effect(battle,caster,caster,'ghost-scare',1.55);
        for(const victim of battle.units.filter(u=>u.playerId!==caster.playerId && isTargetable(u) && distance(u,caster)<=1.55))
          scareTarget(battle,caster,victim,move.controlDuration||.65);
      } else {
        effect(battle,caster,caster,'ghost-slash',caster.stage===0?.7:radius);
        // The chosen low-HP target must be hit even if three other enemies stand closer.
        const primary=target&&distance(target,caster)<=radius?[target]:[];
        const victims=caster.stage===0
          ? (target&&distance(target,caster)<=2.1?[target]:[])
          : [...primary,...battle.units.filter(u=>u.playerId!==caster.playerId && isTargetable(u)
              && u.id!==target?.id && distance(u,caster)<=radius)
            .sort((a,b)=>distance(a,caster)-distance(b,caster)||a.id.localeCompare(b.id))
            .slice(0,3-primary.length)];
        for(const victim of victims) deal(battle,caster,victim,move.baseDamage+stat(caster,'spa')*move.specialRatio,true,true,'ghost');
      }
      animate(caster,getStageData(caster.family,caster.stage).chargedAnimation,.3);
    }
  } else if(ghost.phase==='appear'&&ghost.time>=ghost.duration){caster.ghost=null;}
}
function fearTick(unit: CombatUnit,dt: number): void {
  const fear=unit.fear;
  if(!fear)return;
  fear.time=Math.min(fear.duration,fear.time+dt);
  const t=fear.time/fear.duration;
  unit.x=fear.fromX+(fear.toX-fear.fromX)*t;
  unit.y=fear.fromY+(fear.toY-fear.fromY)*t;
  unit.facingX=fear.toX-fear.fromX;unit.facingY=fear.toY-fear.fromY;
  unit.moving=true;
  if(fear.time>=fear.duration)unit.fear=null;
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
    battle.units.some(u => u.charge || u.dig || u.ghost || u.storm)) && battle.elapsed < 120) return;
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
  battle.obstacles=[];battle.obstacleVersion=(battle.obstacleVersion||0)+1;
  battle.effects=battle.effects.filter(fx=>fx.kind!=='lullaby-note'&&fx.kind!=='falling-star');
  battle.winner = battle.rankings[0] || null;
  battle.loser = battle.rankings[battle.rankings.length - 1] || null;
  for (const unit of battle.units) {
    if (unit.hp <= 0) continue;
    unit.orbitFlames=[];unit.statuses={};unit.lullaby=null;unit.starWard=null;
    unit.moving = false;
    unit.spinTime = 0;
    unit.pendingPollen = null;
    unit.buffs = []; unit.defenseShreds = []; unit.barriers = []; unit.guardUntil = 0;
    unit.combo = null;
    unit.leap = null;
    unit.charge = null;
    unit.scizorAction=undefined;unit.scizorPending=false;
    unit.dig = null; unit.ghost = null; unit.fear = null; unit.storm = null; unit.psychicImbuement = null; unit.refractionUntil = 0;
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
  summonPreparedPillars(battle,deal);
  expireObstacles(battle);
  tickSynergies(battle,dt,{deal,heal,effect,stat});
  tickCombatAugments(battle,heal,effect);
  // Periodic item effects belong to simulation time and are deterministic.
  for (const unit of battle.units) {
    unit.itemNow=battle.elapsed;
    expireStatus(unit,battle.elapsed);
    if(unit.hp<=0){unit.lullaby=null;unit.starWard=null;unit.orbitFlames.length=0;battle.effects=battle.effects.filter(fx=>fx.kind!=='lullaby-note'||fx.sourceId!==unit.id);continue;}
    const singing=unit.lullaby;
    if(singing){
      if(battle.elapsed>=singing.until||incapacitated(unit,battle.elapsed)){unit.lullaby=null;unit.animation=null;battle.effects=battle.effects.filter(fx=>fx.kind!=='lullaby-note'||fx.sourceId!==unit.id);}
      else {
        const song=ATTACKS.moves[moveIdOf(unit)];
        const radius=song.radiusByStage?.[unit.stage]??1.55;
        for(const foe of battle.units){
          if(foe.playerId===unit.playerId||foe.hp<=0||distance(foe,unit)>radius||singing.affected.includes(foe.id))continue;
          singing.affected.push(foe.id); // one sleep attempt per cast, no re-sleep on physical wake
          applyStatus(battle,foe,'sleeping',unit,song.sleepSeconds??1.15,`${singing.instanceId}:${foe.id}`);
        }
      }
    }
    const ward=unit.starWard;
    if(ward){
      if(!unit.barriers.some(b=>b.kind==='star-ward' && b.instanceId===ward.instanceId && b.hp>0))unit.starWard=null;
      else if(battle.elapsed>=ward.nextStar){
        const move=ATTACKS.moves[moveIdOf(unit)];
        const foes=battle.units.filter(u=>u.hp>0 && u.playerId!==unit.playerId).sort((a,b)=>b.metrics.dealt-a.metrics.dealt||a.id.localeCompare(b.id));
        if(foes[0]){
          const target=foes[0];
          const fall=move.starFallSeconds??.38;
          battle.effects.push({id:`${ward.instanceId}:${ward.nextStar}`,sourceId:unit.id,targetId:target.id,
            kind:'falling-star',family:unit.family,x:target.x,y:target.y-1.35,targetX:target.x,targetY:target.y,
            time:0,duration:fall,value:0,pendingHit:{sourceId:unit.id,targetId:target.id,raw:(move.starBaseByStage?.[unit.stage]??18)+stat(unit,'spa')*move.specialRatio,magical:true,charged:true,arrival:1,attackType:'fairy'}});
        }
        ward.nextStar+=move.starInterval??.75;
      }
    }

    unit.controlImmune=effectCount(unit,'opening_immunity')>0 && battle.elapsed<ITEMS.combatIntroSeconds+numberParam('opening_immunity','duration');
    if (unit.hp<=0) continue;
    const enemies=battle.units.filter(e=>e.playerId!==unit.playerId && e.hp>0);
    unit.focusCount=effectCount(unit,'focused_defense')
      ? countClosestThreats(battle,unit,numberParam('focused_defense','maxTargets')) : 0;
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
    if (unit.itemBurn && unit.itemBurn.until>battle.elapsed-dt && unit.hp>0) {
      const burner=battle.units.find(e=>e.id===unit.itemBurn!.sourceId);
      const burn=unit.itemBurn, portion=Math.min(dt,Math.max(0,burn.until-(battle.elapsed-dt)));
      burn.accumulator=(burn.accumulator||0)+burn.dps*portion;
      burn.tickTime=(burn.tickTime||0)+portion;
      if(burner && (burn.tickTime>=.5-1e-7||burn.until<=battle.elapsed)){
        deal(battle,burner,unit,burn.accumulator,true,true,undefined,'dot');burn.accumulator=0;burn.tickTime=0;
      }
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
      unit.dig = null; unit.ghost = null; unit.fear = null; unit.storm = null; unit.psychicImbuement = null;
      unit.buffs = []; unit.defenseShreds = []; unit.barriers = []; unit.guardUntil = 0;
      continue;
    }
    unit.moving = false;
    if (unit.refractionUntil <= battle.elapsed) unit.refractionUntil = 0;
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
      const portion=Math.min(dt,dot.time);
      dot.accumulator=(dot.accumulator||0)+dot.amount*portion;
      dot.tickTime=(dot.tickTime||0)+portion;
      dot.time-=portion;
      if(source && (dot.tickTime>=.5-1e-7 || dot.time<=0)){
        deal(battle,source,unit,dot.accumulator,true,true,undefined,'dot');dot.accumulator=0;dot.tickTime=0;
      }
      if(dot.time<=0)unit.damageOverTime=null;
    }
    if (unit.poison && unit.hp > 0) {
      const dot = unit.poison;
      const source = battle.units.find(other => other.id === dot.sourceId);
      const portion=Math.min(dt,dot.time);
      dot.accumulator+=dot.amount*portion;
      dot.time-=portion;
      // A separate clock for poison; no energy proc per rendering/simulation frame.
      const tickKey='poison_tick';unit.itemTimers[tickKey]=(unit.itemTimers[tickKey]||0)+portion;
      if(source && (unit.itemTimers[tickKey]>=.5-1e-7||dot.time<=0)){
        deal(battle,source,unit,dot.accumulator,true,true,'poison','dot');dot.accumulator=0;unit.itemTimers[tickKey]=0;
      }
      if(dot.time<=0){unit.poison=null;unit.itemTimers[tickKey]=0;}
    }
    if (unit.hp <= 0) continue;
    unit.stunTime = Math.max(0, unit.stunUntil - battle.elapsed);
    unit.knockUpTime = Math.max(0, unit.knockUpUntil - battle.elapsed);
    if (incapacitated(unit,battle.elapsed)||unit.lullaby){unit.moving=false;continue;}
    if (unit.fear) { fearTick(unit,dt); continue; }
    if (unit.ghost) { ghostTick(battle,unit,dt); continue; }
    if(unit.scizorAction){tickScizor(battle,unit,dt);continue;}
    if (unit.storm) { stormTick(battle,unit,dt); continue; }
    if(pendingSkillTick(battle,unit))continue;
    if(unit.hitmonAction){tickHitmonAction(battle,unit,dt);continue;}
    if(unit.synergy?.flight || (unit.synergy?.intangibleUntil && unit.synergy.intangibleUntil>battle.elapsed))continue;
    if (unit.charge) { chargeTick(battle,unit,dt); continue; }
    if (unit.surf) { surfTick(battle,unit,dt); continue; }
    if (unit.sleep) { sleepTick(battle,unit,dt); continue; }
    if (unit.gasCharge) { gasTick(battle,unit,dt); continue; }
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
    if (move.effect === 'ditto-transform')unit.energy=0;
    if (unit.attackClock <= 0 && unit.energy >= unit.energyNeeded &&
      (move.effect === 'healing-egg' || move.effect === 'withdraw-guard' || move.effect === 'mew-blessing' || move.effect === 'burrow' || move.effect === 'ghost-ambush')) {
      const center = move.effect === 'healing-egg'
        ? bestEggCenter(battle,unit,move.splashRange || 1.65,move.skillRange || 3.2)
        : move.effect === 'ghost-ambush'
        ? battle.units.some(e=>e.playerId!==unit.playerId && isTargetable(e)&&distance(e,unit)<=(move.skillRange||2)) ? unit : null
        : unit;
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
    if(unit.family==='diglett' && unit.preferredTargetId){
      const preferred=battle.units.find(u=>u.id===unit.preferredTargetId&&isTargetable(u));
      if(preferred){target=preferred;distanceSq=(target.x-unit.x)**2+(target.y-unit.y)**2;}
      else unit.preferredTargetId=undefined;
    }
    if (!target) continue;
    if(unit.family==='scizor'){
      if(unit.lastCombatTargetId&&unit.lastCombatTargetId!==target.id){unit.scizorPending=true;unit.energy=unit.energyNeeded;unit.attackClock=0;}
      unit.lastCombatTargetId=target.id;
      if(unit.scizorPending){unit.scizorPending=false;unit.energy=0;spell(battle,unit,target);unit.attackClock=unit.cooldown;continue;}
    }
    const d = Math.sqrt(distanceSq);
    unit.facingX = target.x - unit.x;
    unit.facingY = target.y - unit.y;
    if(unit.attackClock<=0 && unit.energy>=unit.energyNeeded &&
       (move.effect==='hitmonchan-uppercut'||move.effect==='hitmonlee-spin-kick') &&
       !!hitmonChoice(battle,unit,moveIdOf(unit))){
      unit.energy=0;spell(battle,unit,target);unit.attackClock=unit.cooldown*(unit.slow?1.3:1);continue;
    }
    if (unit.attackClock <= 0 && unit.energy >= unit.energyNeeded && move.effect === 'scizor-double'){
      unit.energy=0;spell(battle,unit,target);unit.attackClock=unit.cooldown;continue;
    }
    if (unit.attackClock <= 0 && unit.energy >= unit.energyNeeded && move.effect === 'stomp' && d <= (move.jumpRange || 3)) {
      unit.energy = 0;
      spell(battle, unit, target);
      unit.attackClock = unit.cooldown * (unit.slow ? 1.3 : 1);
      continue;
    }
    const obstruction=firstObstacle(battle,unit.playerId,unit.x,unit.y,target.x,target.y);
    if (!basicInRange(unit,target,battle.elapsed) || obstruction) {
      const reach=basicApproachDistance(unit,target,battle.elapsed);
      let travel=Math.min(Math.max(0,d-reach),dt*(.68+stat(unit,'speed')/180)*(unit.slow?.65:1));
      const bounds=arenaBoundary(battle);
      const waypoint=obstruction ? routeAround(battle,unit,target) : null;
      const moveTarget=waypoint||target;
      const movingDistance=Math.hypot(moveTarget.x-unit.x,moveTarget.y-unit.y)||.001;
      if(waypoint)travel=Math.min(dt*(.68+stat(unit,'speed')/180)*(unit.slow?.65:1),movingDistance);
      const dx=(moveTarget.x-unit.x)/movingDistance,dy=(moveTarget.y-unit.y)/movingDistance;
      // Local steering around nearby units; never move into another body.
      // Stable order + deterministic angles keeps replays identical across clients.
      let next:{x:number;y:number}|null=null;
      for(const angle of [0,.45,-.45,.9,-.9,1.35,-1.35]){
        const vx=dx*Math.cos(angle)-dy*Math.sin(angle);
        const vy=dx*Math.sin(angle)+dy*Math.cos(angle);
        const nx=unit.x+vx*travel,ny=unit.y+vy*travel;
        if(nx<bounds.minX||nx>bounds.maxX||ny<bounds.minY||ny>bounds.maxY)continue;
        if(!clearStep(battle,unit,nx,ny))continue;
        next={x:nx,y:ny};break;
      }
      if(next){unit.x=next.x;unit.y=next.y;}
      unit.moving=!!next&&travel>.001;
      if(unit.family==='diglett'){
        if(unit.moving)unit.wasMoving=true;else emergeAfterWalk(battle,unit);
      }
      continue;
    }
    if(unit.family==='diglett'&&unit.wasMoving){emergeAfterWalk(battle,unit);continue;}
    if (unit.attackClock > 0) continue;
    if (unit.energy >= unit.energyNeeded && move.effect !== 'ditto-transform'
      && !(move.effect === 'star-refraction' && unit.refractionUntil > battle.elapsed)
      && (move.effect !== 'heal-powder' || woundedAllies(battle, unit, move.healRange || 3.5, move.healTargets || 2).length)
      && (move.effect !== 'healing-egg' || bestEggCenter(battle,unit,move.splashRange || 1.65,move.skillRange || 3.2))) {
      unit.energy = 0;
      spell(battle, unit, target);
    } else {
      animate(unit, stage.basic.animation, Math.min(.4, unit.cooldown * .82), undefined, 'basic');
      const basic = ATTACKS.basic;
      const raw = rawBasicDamage(stat(unit,'atk'),basic.offensiveRatio);
      const ranged = !!stage.basic.projectile;
      const projectileKind = ranged ? 'basic-projectile' : 'physical';
      // Refraction targets must be distinct, targetable, in the *ordinary* range
      // and nearest to the original victim. Deterministic ties preserve replay.
      const multi = unit.refractionUntil > battle.elapsed && unit.family === 'staryu'
        ? Math.min(3, 2 + unit.stage) : 1;
      const extras = multi > 1 ? battle.units.filter(enemy => enemy.id !== target!.id
        && enemy.playerId !== unit.playerId && isTargetable(enemy)
        && basicInRange(unit,enemy,battle.elapsed))
        .sort((a,b) => distance(a,target!) - distance(b,target!) || a.id.localeCompare(b.id))
        .slice(0,multi-1) : [];
      for (const victim of [target,...extras]) {
        projectile(battle, unit, victim, projectileKind, raw, false, false,
          ranged ? ANIMATIONS.projectilesByType[stage.elements[0]].arrival : .35);
        if (ranged) battle.effects[battle.effects.length - 1].basicType = stage.elements[0];
        if(unit.family==='staryu' && unit.refractionUntil>battle.elapsed){
          projectile(battle,unit,victim,'water',stat(unit,'spa')*ATTACKS.moves['star-refraction'].specialRatio,true,true,
            ranged ? ANIMATIONS.projectilesByType[stage.elements[0]].arrival : .35);
        }
      }
      if(unit.synergy?.splashBonus){
        projectile(battle,unit,target,'water',unit.synergy.splashBonus,true,false,ranged?ANIMATIONS.projectilesByType[stage.elements[0]].arrival:.35);
        unit.synergy.splashBonus=0;
      }
      if (!blocksEnergy(unit,battle.elapsed)) unit.energy = Math.min(unit.energyNeeded, unit.energy + basic.energyGain + (effectCount(unit,'bonus_energy') ? numberParam('bonus_energy','energy') : 0));
      onAugmentBasic(battle,unit);
      bumpStack(unit,'guinsoo'); bumpStack(unit,'titan');
    }
    unit.cooldown=combatCooldown(unit,battle.elapsed);
    unit.attackClock = unit.cooldown * (unit.slow ? 1.3 : 1);
  }
  resolveBodies(battle,arenaBoundary(battle));
  tickFlameOrbits(battle,dt,deal,stat,isTargetable,segmentDistanceSq);
  updateSacredTiles(battle);
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
