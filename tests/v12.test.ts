import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateStats, SPECIES } from '../server/data';
import { GameEngine } from '../server/engine';
import { forceResolveBattle, tickBattle } from '../server/systems/combat';
import type { Family, Pokemon, Stats } from '../server/types';

const iv: Stats = { hp:50, atk:50, def:50, spa:50, spd:50, speed:50 };
const unit = (family:Family,id:string,stage:number,level:number,position:Pokemon['position']): Pokemon =>
  ({ id, family, stage, level, xp:level-1, iv:{...iv}, position });

test('v12: bônus base linear de 1% por nível, sem mudar vida ou IV base', () => {
  const base = SPECIES.charmander.base;
  assert.equal(calculateStats('charmander',1,iv,0).hp,base.hp);
  assert.equal(calculateStats('charmander',6,iv,0).hp,Math.round(base.hp*1.05));
  assert.equal(calculateStats('charmander',11,iv,0).atk,Math.round(base.atk*1.1));
});

test('v12: Vulpix é incomum e custa dois de ouro', () => {
  const game = new GameEngine(2);
  assert.equal(SPECIES.vulpix.rarity,2);
  game.players[0].shop[0] = { id:'test-vulpix', family:'vulpix', rarity:SPECIES.vulpix.rarity, price:SPECIES.vulpix.rarity };
  const old = game.players[0].gold;
  assert.equal(game.command({kind:'buy',slot:0}),null);
  assert.equal(game.players[0].gold,old-2);
});

test('v12: Venusaur final absorve clone ao soltar um sobre o outro (+5 permanentes)', () => {
  const game = new GameEngine(12);
  const p = game.players[0]; p.level=3;
  p.units = [unit('bulbasaur','lower',2,9,{area:'board',col:2,row:1}),
    unit('bulbasaur','higher',2,13,{area:'bench',index:0})];
  assert.equal(game.command({kind:'move',unitId:'higher',position:{area:'board',col:2,row:1}}),null);
  assert.equal(p.units.length,1);
  assert.equal(p.units[0].id,'higher');
  assert.equal(p.units[0].level,18);
  assert.equal(p.units[0].xp,17);
  assert.deepEqual(p.units[0].position,{area:'board',col:2,row:1});
  const visual = game.snapshot().visualEvents.find(e=>e.unitId==='higher'&&e.kind==='fusion');
  assert.equal(visual?.sources?.length,2);
  (game as any).round=2;
  (game as any).battles=[];
  (game as any).nextRound();
  assert.equal(p.units[0].level,18);
});

test('v12: empate mantém o Pokémon que recebe o clone; Snorlax também funde, nível no máximo 100', () => {
  const game = new GameEngine(13);
  const p = game.players[0];
  p.units = [unit('snorlax','source',0,98,{area:'bench',index:0}),
    unit('snorlax','target',0,98,{area:'bench',index:1})];
  assert.equal(game.command({kind:'move',unitId:'source',position:{area:'bench',index:1}}),null);
  assert.deepEqual(p.units.map(u=>u.id),['target']);
  assert.equal(p.units[0].level,100);
  assert.equal(p.units[0].xp,99);
});

test('v12: formas intermediárias apenas trocam posições; Eevee exige quatro cópias', () => {
  const game = new GameEngine(14);
  const p = game.players[0];
  p.units = [unit('bulbasaur','a',1,3,{area:'bench',index:0}),unit('bulbasaur','b',1,5,{area:'bench',index:1})];
  assert.equal(game.command({kind:'move',unitId:'a',position:{area:'bench',index:1}}),null);
  assert.equal(p.units.length,2);
  assert.deepEqual(p.units.find(u=>u.id==='a')?.position,{area:'bench',index:1});
  p.units = [unit('eevee','a',0,3,{area:'bench',index:0}),unit('eevee','b',0,5,{area:'bench',index:1})];
  assert.equal(game.command({kind:'move',unitId:'a',position:{area:'bench',index:1}}),null);
  assert.equal(p.units.length,2);
});

test('v12: treinador deve caminhar e tocar a moeda, que persiste na preparação seguinte', () => {
  const game = new GameEngine(15);
  const e = game as any;
  e.round=2; e.startCombat();
  const battle = e.battles.find((b:any)=>b.participants.includes('p0'));
  battle.goldDrops.push({id:'persistente',x:3,y:0,ownerId:'p0',claimed:false});
  const gold = game.players[0].gold;
  assert.equal(game.command({kind:'move-trainer',x:3,y:0}),null);
  assert.equal(gold,game.players[0].gold);
  e.nextRound();
  const afterIncome = game.players[0].gold;
  assert.equal(game.snapshot().collectibleGold.length,1);
  for(let i=0;i<40;i++) e.tickTrainer(.1);
  assert.equal(game.players[0].gold,afterIncome+1);
  assert.equal(game.snapshot().collectibleGold.length,0);
  for(let i=0;i<10;i++) e.tickTrainer(.1);
  assert.equal(game.players[0].gold,afterIncome+1,'a mesma moeda não pode ser coletada duas vezes');
  assert.equal(game.command({kind:'move-trainer',x:Infinity,y:0}),'Destino inválido');
});

test('v12.1: entrada no combate usa Idle, sem Rotate congelado ou giro coletivo', () => {
  const game = new GameEngine(121);
  const first = game.players[0];
  const second = game.players[1];
  first.units = [unit('bulbasaur','ally',0,1,{area:'board',col:2,row:1})];
  second.units = [unit('charmander','foe',0,1,{area:'board',col:2,row:1})];
  const e = game as any;
  e.round = 2;
  e.startCombat();
  const battle = e.battles.find((b:any) => b.participants.includes('p0') && b.units.length);
  assert.ok(battle);
  for (const fighter of battle.units) {
    assert.equal(fighter.animation,null);
    assert.equal(fighter.facingY,fighter.row < 4 ? 1 : -1);
  }
  tickBattle(battle,.3);
  assert.equal(battle.introElapsed,.3);
  assert.ok(battle.units.every((fighter:any) => fighter.animation === null), 'idle não fica preso em Rotate durante entrada');
  // O resultado conserva a direção: a virada curta de quem ganhou é feita no cliente.
  const before = battle.units.map((fighter:any) => ({ id:fighter.id, facingY:fighter.facingY }));
  forceResolveBattle(battle);
  assert.deepEqual(battle.units.map((fighter:any) => ({ id:fighter.id,facingY:fighter.facingY })),before);
});
