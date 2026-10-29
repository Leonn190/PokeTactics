import assert from 'node:assert/strict';
import test from 'node:test';
import { SPECIES, SHOP_FAMILIES, LEGENDARY_FAMILIES, getStageData, ATTACKS, calculateStats } from '../server/data';
import { GameEngine } from '../server/engine';
import { createBattleGroup, tickBattle } from '../server/systems/combat';
import type { Pokemon, Player } from '../server/types';

const iv = {hp:50,atk:50,def:50,spa:50,spd:50,speed:50};
const make = (family: Pokemon['family'], id:string, stage=0): Pokemon => ({
  family, id, stage, level:1, xp:0, iv:{...iv}, position:{area:'board',col:2,row:1}
});
const side = (id:string, units: Pokemon[]):Player => ({
  id,name:id,health:100,gold:10,level:5,units,shop:[],locked:false,eliminated:false,
  lastWin:false,streak:0,roundVictory:false,history:[],placement:null
});

test('v16 IR: 59 formas, 18 famílias na loja e somente Mew é chefe comprável',()=>{
  assert.equal(Object.values(SPECIES).reduce((total,s)=>total+s.names.length,0),59);
  assert.equal(SHOP_FAMILIES.length,18);
  assert.deepEqual(SHOP_FAMILIES.filter(f => LEGENDARY_FAMILIES.includes(f)),['mew']);
  assert.deepEqual([0,1,2].map(i=>getStageData('dratini',i).range),[4,2,1]);
  assert.deepEqual([0,1].map(i=>getStageData('diglett',i).energy),[60,65]);
  assert.equal(getStageData('mew',0).range,5);
});

test('v16 IR: o Mew comprado mantém perfil distinto do chefe PvE',()=>{
  const mew=make('mew','ally');const boss=make('mew','boss');
  const battle=createBattleGroup([side('p0',[mew]),side('bot:p0',[boss])],'mew-ir','boss');
  const bought=battle.units.find(u=>u.sourceId==='ally')!;
  const npc=battle.units.find(u=>u.sourceId==='boss')!;
  assert.equal(bought.range,5);
  assert.equal(bought.energyNeeded,80);
  assert.equal(npc.range,3);
  assert.equal(npc.energyNeeded,65);
  assert.ok(npc.maxHp>bought.maxHp);
  assert.equal(calculateStats('mew',1,iv,0).hp,SPECIES.mew.base.hp);
});

test('v16 IR: escavação cancela a vulnerabilidade e a emersão não ocupa uma casa já usada',()=>{
  const dig=make('diglett','dig');const far=make('snorlax','far');
  const battle=createBattleGroup([side('p0',[dig]),side('p1',[far])],'dig-ir');
  const actor=battle.units.find(u=>u.sourceId==='dig')!;
  const enemy=battle.units.find(u=>u.sourceId==='far')!;
  enemy.x=3;enemy.y=-2;enemy.stunUntil=100;enemy.attackClock=1000;
  actor.energy=actor.energyNeeded;
  tickBattle(battle,1.51);
  assert.equal(actor.dig?.phase,'sink');
  for(let i=0;i<100 && actor.dig?.phase!=='rise';i++)tickBattle(battle,.05);
  assert.ok(actor.dig);
  enemy.x=actor.x;enemy.y=actor.y; // target can enter an intended resting spot during travel
  for(let i=0;i<20;i++)tickBattle(battle,.05);
  assert.equal(actor.dig,null);
  assert.ok(Math.hypot(actor.x-enemy.x,actor.y-enemy.y)>=.62);
});

test('v16 IR: painel tem estados independentes dos oito participantes',()=>{
  const game=new GameEngine(42);
  assert.deepEqual(game.snapshot().battleStatuses,{});
  for(let i=0;i<260;i++)game.tick(.1);
  const statuses=game.snapshot().battleStatuses;
  assert.equal(Object.keys(statuses).length,8);
  assert.ok(Object.values(statuses).every(s=>s==='battling'||s==='victorious'||s==='defeated'||s===null));
});

// Intentional assert that the support move is configured as a support ability, not generic damage.
test('v16 IR: Mew cura e fortalece sem converter ataque básico em carregado',()=>{
  const move=ATTACKS.moves[getStageData('mew',0).move];
  assert.equal(move.effect,'mew-blessing');
  assert.equal(move.buffDuration,3);
  assert.equal(move.bonusSpaRatio,.2);
  assert.equal(getStageData('mew',0).basic.category,'special');
});
