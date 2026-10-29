import assert from 'node:assert/strict';
import test from 'node:test';
import spec from '../config/v11-spec.json';
import { ATTACKS, calculateStats, EEVEE_BRANCHES, LEGENDARY_FAMILIES, SHOP_FAMILIES, SPECIES, getStageData } from '../server/data';
import { GameEngine } from '../server/engine';
import { createBattle, tickBattle } from '../server/systems/combat';
import type { Battle, CombatUnit, Family, Pokemon, Stats } from '../server/types';

const iv: Stats = { hp:50, atk:50, def:50, spa:50, spd:50, speed:50 };
const pokemon = (family: Family, id: string, col: number, stage=0): Pokemon =>
  ({ id,family,stage,level:1,xp:0,iv:{...iv},position:{area:'board',col,row:1} });
const tick = (battle: Battle, secs: number) => {
  for(let t=0;t<secs-.00001;t+=.05) tickBattle(battle,Math.min(.05,secs-t));
};
function scene(caster: Family, allies: Family[] = [], enemies: Family[] = ['snorlax','snorlax','snorlax'], stage=0) {
  const game = new GameEngine(992);
  game.players[0].units = [pokemon(caster,'source',0,stage),...allies.map((f,i)=>pokemon(f,`friend${i}`,i+1))];
  game.players[1].units = enemies.map((f,i)=>pokemon(f,`foe${i}`,i));
  const battle = createBattle(game.players[0],game.players[1],`v11-${caster}`);
  const attacker = battle.units.find(u=>u.sourceId==='source')!;
  const friends = battle.units.filter(u=>u.playerId==='p0' && u!==attacker);
  const foes = battle.units.filter(u=>u.playerId==='p1');
  battle.introElapsed = 1.5;
  attacker.animation=null;attacker.x=0;attacker.y=0;attacker.attackClock=0;
  friends.forEach((u,i)=>{u.animation=null;u.attackClock=1000;u.x=-.35-i*.3;u.y=0;});
  foes.forEach((u,i)=>{u.animation=null;u.attackClock=1000;u.x=1+i*.23;u.y=0;u.hp=u.maxHp=1500;u.stats.def=0;u.stats.spd=0;});
  return {battle,attacker,friends,foes};
}
const stopped = (units: CombatUnit[]) => units.forEach(u=>u.attackClock=1000);

test('49 fichas herdadas da v11.2, mais dez novas formas nas versões seguintes', () => {
  assert.equal(Object.values(SPECIES).reduce((n,s)=>n+s.names.length,0),59);
  assert.equal(SHOP_FAMILIES.length,18);
  assert.equal(LEGENDARY_FAMILIES.length,11);
  for (const [id, form] of Object.entries(spec.pokemon)) {
    const family = form.family as Family;
    const index = family==='eevee' ? 0 : form.stage;
    // Mew agora possui ficha de loja própria na V16, mas o chefe mantém os atributos históricos.
    const actual = id === 'mew' ? SPECIES.mew.bossBase!
      : EEVEE_BRANCHES.includes(id as Family) ? SPECIES[id as Family].base
      : SPECIES[family].stageBases![index];
    assert.deepEqual(actual,form.base_stats,id);
    assert.ok(actual.hp>=0 && actual.hp<=700,id);
    for(const key of ['atk','def','spa','spd','speed'] as const) assert.ok(actual[key]>=0 && actual[key]<=120,`${id}/${key}`);
  }
  assert.equal(SPECIES.chansey.stageBases![1].hp,700);
  assert.equal(calculateStats('geodude',1,iv,2).hp,610);
  assert.equal(calculateStats('geodude',1,iv,1).hp,480);
  assert.equal(getStageData('onix',1).chargedType,'steel');
});

test('Eevee só evolui após 4 cópias, exige escolha e preserva IV/XP/posição', () => {
  const game = new GameEngine(40), player=game.players[0];
  player.units=Array.from({length:4},(_,i)=>({ ...pokemon('eevee',`e${i}`,i),
    level:i+1,xp:i*2,iv:{...iv,spd:25+i*20} }));
  (game as any).merge(player);
  assert.equal(player.units.length,4);
  assert.equal(player.pendingEvolution?.length,4);
  assert.equal(game.command({kind:'choose-eevee',branch:'snorlax'}), 'Evolução inválida');
  assert.equal(game.command({kind:'choose-eevee',branch:'umbreon'}),null);
  assert.equal(player.units.length,1);
  assert.equal(player.units[0].family,'umbreon');
  assert.equal(player.units[0].stage,1);
  assert.equal(player.units[0].iv.spd,85);
  assert.equal(player.units[0].level,4);
  assert.equal(player.units[0].xp,6);
  assert.deepEqual(player.units[0].position,{area:'board',col:0,row:1});
});

test('Eevee e evoluções disparam básico de alvo único sem conversão, carregado em área no impacto', () => {
  for(const family of ['eevee',...EEVEE_BRANCHES] as Family[]) {
    const {battle,attacker,friends,foes}=scene(family,['charmander','charmander']);
    friends.forEach(u=>u.hp-=100);
    attacker.energy=0;
    tickBattle(battle,.05);
    assert.equal(battle.effects.filter(f=>f.pendingHit?.special==='eevee-ball').length,0,family);
    stopped([attacker]);tick(battle,.7);
    assert.ok(foes[0].hp<1500,family);
    assert.equal(foes[1].hp,1500,`${family}: básico sem splash`);
    assert.equal(friends.reduce((n,u)=>n+u.buffs.length+u.barriers.length,0),0);
    assert.equal(friends[0].hp,friends[0].maxHp-100);
    attacker.attackClock=0;attacker.energy=attacker.energyNeeded;
    tickBattle(battle,.05);
    assert.ok(battle.effects.some(f=>f.pendingHit?.special==='eevee-ball'),family);
    const before=foes.map(u=>u.hp);
    stopped([attacker]);tick(battle,.25);
    assert.deepEqual(foes.map(u=>u.hp),before,`${family}: dano só no impacto`);
    tick(battle,.38);
    assert.ok(foes[1].hp<1500 && foes[2].hp<1500,`${family}: AoE carregado`);
    assert.equal(attacker.buffs.length,0,`${family}: sem bônus próprio`);
    const move=ATTACKS.moves[getStageData(family,0).move];
    if(move.conversion?.kind==='stat_buff') {
      assert.ok(friends.every(u=>u.buffs.some(b=>b.stat===move.conversion?.stat)),family);
    } else if(move.conversion?.kind==='barrier') assert.ok(friends.every(u=>u.barriers.length===1),family);
    else if(move.conversion?.kind==='heal') assert.ok(friends.every(u=>u.hp>u.maxHp-100),family);
    else assert.ok(friends.every(u=>!u.buffs.length&&!u.barriers.length&&u.hp===u.maxHp-100));
  }
});

test('A bola maximiza grupo dentro do alcance e nunca seleciona centro distante', () => {
  const {battle,attacker,foes}=scene('umbreon',[],['snorlax','snorlax','snorlax','snorlax']);
  foes[0].x=.5;foes[1].x=2.8;foes[2].x=3;foes[3].x=8;
  attacker.energy=attacker.energyNeeded;
  tickBattle(battle,.05);
  const shot = battle.effects.find(e=>e.pendingHit?.special==='eevee-ball');
  assert.equal(shot?.pendingHit?.targetId,foes[1].id);
  stopped([attacker]);tick(battle,.6);
  assert.ok(foes[1].hp<1500 && foes[2].hp<1500);
  assert.equal(foes[0].hp,1500);
  assert.equal(foes[3].hp,1500);
});

test('Conversão considera somente HP e barreira efetivamente consumidos, sem overkill', () => {
  const {battle,attacker,friends,foes}=scene('flareon',['charmander','charmander'],['snorlax','snorlax','snorlax']);
  foes.slice(0,2).forEach(u=>{u.hp=u.maxHp=10;});
  foes[2].x=8;
  foes[0].barrier={hp:50,maxHp:50,time:10};
  attacker.energy=attacker.energyNeeded;
  tickBattle(battle,.05);stopped([attacker]);tick(battle,.6);
  // D=50 barreira +10 HP do primeiro +10 HP do segundo = 70.
  assert.equal(friends[0].buffs.find(b=>b.stat==='atk')?.amount,Math.floor(70*.065));
  assert.equal(friends[1].buffs.find(b=>b.stat==='atk')?.amount,Math.floor(70*.065));
  assert.equal(foes[0].metrics.barrierAbsorbed,50);
});

test('Osso reduz DEF após causar dano e a redução temporária nunca altera a ficha base', () => {
  const {battle,attacker,foes}=scene('cubone',[],['snorlax','snorlax']);
  foes.forEach(u=>{u.stats.def=100;u.hp=u.maxHp=3000;});
  attacker.energy=attacker.energyNeeded;
  tickBattle(battle,.05);stopped([attacker]);tick(battle,.2);
  assert.equal(foes[0].defenseShreds.length,0);
  assert.equal(foes[0].hp,3000);
  tick(battle,.4);
  assert.ok(foes[0].hp<3000);
  assert.equal(foes[0].stats.def,100);
  assert.equal(foes[0].defenseShreds.length,1);
  assert.ok(foes[0].defenseShreds[0].amount<=30);
  tick(battle,5.2);
  assert.equal(foes[0].defenseShreds.length,0);
  assert.equal(foes[0].stats.def,100);
});

test('Golem usa Withdraw e recebe 60% menos dano após DEF, sem converter proteção em cura', () => {
  const guarded=scene('geodude',[],['charmander'],2);
  const exposed=scene('geodude',[],['charmander'],2);
  guarded.attacker.energy=guarded.attacker.energyNeeded;
  tickBattle(guarded.battle,.05);
  assert.ok(guarded.attacker.guardUntil>guarded.battle.elapsed);
  assert.equal(guarded.attacker.animation?.name,'Withdraw');
  guarded.foes[0].attackClock=0;exposed.foes[0].attackClock=0;
  guarded.attacker.attackClock=1000;exposed.attacker.attackClock=1000;
  tickBattle(guarded.battle,.05);tickBattle(exposed.battle,.05);
  tick(guarded.battle,.35);tick(exposed.battle,.35);
  const receivedGuard=guarded.attacker.maxHp-guarded.attacker.hp;
  const receivedNormal=exposed.attacker.maxHp-exposed.attacker.hp;
  assert.ok(receivedNormal>0);
  assert.ok(Math.abs(receivedGuard/receivedNormal-.4)<.01,`${receivedGuard}/${receivedNormal}`);
  assert.ok(guarded.attacker.metrics.abilityMitigated>0);
  assert.equal(guarded.foes[0].hp,1500);
  tick(guarded.battle,4.7);
  assert.ok(guarded.attacker.guardUntil<guarded.battle.elapsed);
});

test('Snorlax lança vários inimigos e cada Cubone aliado atira um osso gratuito por alvo', () => {
  const {battle,attacker,friends,foes}=scene('snorlax',['cubone','cubone'],['charmander','charmander','charmander']);
  attacker.energy=attacker.energyNeeded;
  stopped(friends);
  tickBattle(battle,.05);
  tick(battle,.6);
  assert.equal(battle.knockupEvents.length,3);
  assert.equal(new Set(battle.knockupEvents.map(e=>e.target_unit_id)).size,3);
  assert.equal(battle.effects.filter(f=>f.pendingHit?.special==='bone-throw').length,6);
  assert.equal(friends[0].energy,0);
  tick(battle,.7);
  assert.ok(foes.every(u=>u.defenseShreds.length===2));
  assert.ok(foes.every(u=>u.stats.def===0));
});

test('Onix e Steelix levantam um único alvo e Cubone reage, enquanto rock strike não lança', () => {
  for(const stage of [0,1]) {
    const {battle,attacker,foes}=scene('onix',['cubone'],['snorlax','snorlax'],stage);
    attacker.energy=attacker.energyNeeded;
    tickBattle(battle,.05); stopped([attacker]);tick(battle,.35);
    assert.equal(battle.knockupEvents.length,1);
    assert.equal(battle.knockupEvents[0].source_unit_id,attacker.id);
    assert.ok(foes[0].knockUpUntil>battle.elapsed);
    assert.equal(battle.effects.filter(f=>f.pendingHit?.special==='bone-throw').length,1);
  }
  for(const stage of [0,1]) {
    const {battle,attacker}=scene('geodude',[],['snorlax'],stage);
    attacker.energy=attacker.energyNeeded;tickBattle(battle,.05);stopped([attacker]);tick(battle,.4);
    assert.equal(battle.knockupEvents.length,0);
    assert.equal(attacker.animation?.name,'Strike');
  }
});

test('Ovo de Chansey/Blissey cura grupo aliado, nunca inimigo, e não gasta energia sem feridos', () => {
  for(const stage of [0,1]) {
    const {battle,attacker,friends,foes}=scene('chansey',['charmander','charmander','charmander'],['snorlax'],stage);
    attacker.energy=attacker.energyNeeded;
    tickBattle(battle,.05);
    assert.equal(attacker.energy,attacker.energyNeeded);
    tick(battle,.4); // conclui o básico legítimo disparado enquanto todos estavam saudáveis
    const foeHpBeforeEgg = foes[0].hp;
    attacker.attackClock=0;
    friends.forEach(u=>u.hp=u.maxHp-110);
    tickBattle(battle,.05);
    assert.equal(attacker.energy,0);
    assert.ok(battle.effects.some(f=>f.pendingHit?.special==='healing-egg'));
    stopped([attacker]);tick(battle,.3);
    assert.ok(friends.every(u=>u.hp===u.maxHp-110));
    tick(battle,.3);
    assert.ok(friends.every(u=>u.hp>u.maxHp-110));
    assert.equal(foes[0].hp,foeHpBeforeEgg);
    assert.ok(attacker.metrics.healed>0);
  }
});
