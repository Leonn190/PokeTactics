import assert from 'node:assert/strict';
import test from 'node:test';
import { ATTACKS, getStageData, SHOP_FAMILIES, SPECIES } from '../server/data';
import { GameEngine } from '../server/engine';
import { rollFamily } from '../server/shop';
import { createBattle, tickBattle } from '../server/systems/combat';
import type { Battle, CombatUnit, Family, Pokemon, Stats } from '../server/types';

const iv: Stats = { hp: 50, atk: 50, def: 50, spa: 50, spd: 50, speed: 50 };
function make(family: Family, id: string, col: number, stage = 0): Pokemon {
  return { family, id, stage, level: 1, xp: 0, iv: { ...iv }, position: { area:'board', col, row:1 } };
}
function setup(family: Family, friends: Family[] = [], enemyCount=3, stage=0) {
  const game = new GameEngine(541);
  game.players[0].units = [make(family, 'caster', 0, stage), ...friends.map((f,i)=>make(f,`friend${i}`,i+1))];
  game.players[1].units = Array.from({length:enemyCount},(_,i)=>make('snorlax',`foe${i}`,i));
  const battle = createBattle(game.players[0],game.players[1],`new-${family}`);
  battle.introElapsed = 1.5;
  const caster = battle.units.find(u=>u.sourceId==='caster')!;
  const allies = battle.units.filter(u=>u.playerId===caster.playerId && u!==caster);
  const enemies = battle.units.filter(u=>u.playerId!==caster.playerId);
  caster.animation = null; caster.x = 0; caster.y = 0; caster.attackClock = 0;
  allies.forEach((a,i)=>{ a.animation=null; a.attackClock=1000; a.x=-2+i*.35; a.y=1.2; });
  enemies.forEach((e,i)=>{ e.animation=null; e.attackClock=1000; e.x=1+i; e.y=0;
    e.hp=e.maxHp=2000; e.stats.def=0; e.stats.spd=0; });
  return { battle, caster, allies, enemies };
}
function advance(battle: Battle, duration: number, dt=.025) {
  for (let time=0; time<duration-1e-8;time+=dt) tickBattle(battle, Math.min(dt,duration-time));
}
const passive = (unit: CombatUnit) => { unit.attackClock=1000; };

test('as cinco novas formas têm o BST exato; Rhyhorn raro e Vulpix incomum', () => {
  const expected: Record<string,number[]> = { rhyhorn:[320,430,540], vulpix:[235,400] };
  for (const [family,values] of Object.entries(expected)) {
    const spec = SPECIES[family as Family];
    assert.equal(spec.rarity,family==='vulpix'?2:3); assert.equal(spec.shop,true);
    assert.ok(SHOP_FAMILIES.includes(family as Family));
    for (const [i,stats] of spec.stageBases!.entries()) {
      const bst = stats.hp/5+stats.atk+stats.def+stats.spa+stats.spd+stats.speed;
      assert.equal(bst,values[i],spec.names[i]);
      assert.ok(stats.hp>=0&&stats.hp<=600);
      assert.ok(['atk','def','spa','spd','speed'].every(k=>stats[k as keyof Stats]>=0&&stats[k as keyof Stats]<=120));
    }
  }
  assert.deepEqual(SPECIES.rhyhorn.pokedexIds,[111,112,464]);
  assert.deepEqual(SPECIES.vulpix.pokedexIds,[37,38]);
  const player = new GameEngine(1).players[0]; player.level=4;
  let seed=12345;
  const rand=()=>((seed=seed*16807%2147483647)-1)/2147483646;
  const observed = new Set(Array.from({length:10000},()=>rollFamily(player,rand)).map(o=>o.family));
  assert.ok(observed.has('rhyhorn')&&observed.has('vulpix'));
});

test('três cópias evoluem Rhyhorn até Rhyperior e Vulpix até Ninetales', () => {
  const game = new GameEngine(99);
  const player = game.players[0];
  player.units = Array.from({length:9},(_,i)=>make('rhyhorn',`r${i}`,i%7));
  (game as any).merge(player);
  assert.equal(player.units.length,1);
  assert.equal(player.units[0].stage,2);
  assert.equal(player.units[0].family,'rhyhorn');
  player.units = Array.from({length:3},(_,i)=>make('vulpix',`v${i}`,i));
  (game as any).merge(player);
  assert.equal(player.units.length,1);
  assert.equal(player.units[0].stage,1);
});

test('Rhyhorn investe de verdade; dois levantamentos geram dois ossos por aliado', () => {
  const {battle,caster,allies,enemies}=setup('rhyhorn',['cubone','cubone'],2);
  caster.energy=caster.energyNeeded;
  tickBattle(battle,.025);
  assert.ok(caster.charge);
  assert.equal(caster.x,0);
  assert.equal(enemies[0].hp,2000);
  passive(caster);
  advance(battle,.18);
  assert.ok(caster.x>.5&&caster.x<3,'o deslocamento deve ser progressivo');
  const bones = new Set(battle.effects.filter(f=>f.kind==='bone').map(f=>f.id));
  for (let t=0;t<.5-1e-8;t+=.025) {
    tickBattle(battle,.025);
    battle.effects.filter(f=>f.kind==='bone').forEach(f=>bones.add(f.id));
  }
  assert.ok(caster.x>2.4 && caster.x<=3);
  assert.ok(enemies.every(e=>e.hp<2000));
  assert.equal(battle.knockupEvents.length,2);
  assert.equal(new Set(battle.knockupEvents.map(e=>e.target_unit_id)).size,2);
  assert.equal(bones.size,4);
  assert.equal(allies.reduce((sum,u)=>sum+u.metrics.casts,0),0,'os ossos reativos são gratuitos');
  advance(battle,.55);
  assert.ok(enemies.every(e=>e.defenseShreds.length===2));
});

test('investida respeita imunidade, borda, terceiro espaço ocupado e caminho curto', () => {
  const immune=setup('rhyhorn',[],1);
  immune.enemies[0].controlImmune=true;
  immune.caster.energy=70;
  tickBattle(immune.battle,.025); passive(immune.caster); advance(immune.battle,.52);
  assert.ok(immune.enemies[0].hp<2000);
  assert.equal(immune.battle.knockupEvents.length,0);

  const blocked=setup('rhyhorn',['cubone'],2);
  blocked.allies[0].x=3;blocked.allies[0].y=0;
  blocked.enemies[1].x=1.6;
  blocked.caster.energy=70;tickBattle(blocked.battle,.025);
  const toX=blocked.caster.charge!.toX;
  assert.ok(toX>1.5&&toX<2.6,`ponto final livre: ${toX}`);
  passive(blocked.caster); advance(blocked.battle,.6);
  assert.ok(Math.abs(blocked.caster.x-blocked.allies[0].x)>.58);
  assert.equal(blocked.battle.knockupEvents.length,2);

  const edge=setup('rhyhorn',[],1);
  edge.caster.x=3.5;edge.enemies[0].x=3.83;
  edge.caster.energy=70;tickBattle(edge.battle,.025);passive(edge.caster);advance(edge.battle,.6);
  assert.ok(edge.caster.x<=3.95,'não atravessa a borda');
  assert.ok(edge.enemies[0].hp<2000,'o caminho reduzido ainda acerta');
});

test('todas as evoluções escalam dano físico e controle da investida', () => {
  for (const [stage,raw,seconds] of [[0,28+81*.8,.4],[1,36+110*.9,.5],[2,44+119,.6]]) {
    const s=setup('rhyhorn',[],1,stage);
    s.caster.energy=s.caster.energyNeeded;
    tickBattle(s.battle,.025);passive(s.caster);advance(s.battle,.22);
    assert.equal(s.enemies[0].hp,2000-raw);
    assert.ok(Math.abs(s.enemies[0].knockUpDuration-seconds)<1e-6);
  }
});

test('chama perfurante só dá dano no contato, atravessa vários alvos, não duplica acertos', () => {
  for (const stage of [0,1]) {
    const {battle,caster,enemies}=setup('vulpix',[],3,stage);
    enemies[0].x=1.2; enemies[1].x=2.45; enemies[2].x=3.3;
    caster.energy=caster.energyNeeded;
    tickBattle(battle,.025);
    const shot=battle.effects.find(f=>f.kind==='piercing-flame')!;
    assert.ok(shot?.piercing);
    assert.ok(shot.targetX>3.3);
    passive(caster);
    assert.ok(enemies.every(e=>e.hp===2000));
    advance(battle,.04,.04);
    assert.ok(enemies.every(e=>e.hp===2000),'não há dano instantâneo');
    advance(battle,.3);
    const expected=stage===0 ? 14+63*.65 : 22+106*.75;
    assert.ok(enemies.every(e=>Math.abs(e.hp-(2000-expected))<1e-6));
    advance(battle,.4);
    assert.ok(enemies.every(e=>Math.abs(e.hp-(2000-expected))<1e-6),'sem hits repetidos');
    assert.equal(shot.piercing!.hitIds.length,3);
  }
});

test('chama atravessa quase-sobrepostos até a borda e a versão regular tem alvo único', () => {
  const {battle,caster,enemies}=setup('vulpix',[],3);
  enemies[0].x=1; enemies[1].x=1.05; enemies[2].x=3.8;
  caster.energy=65;tickBattle(battle,.025);passive(caster);
  // Frames largos não podem pular duas unidades próximas.
  advance(battle,.6,.2);
  assert.ok(enemies.every(e=>e.hp<2000));
  assert.ok(!battle.effects.some(f=>f.kind==='piercing-flame'&&f.time<f.duration));

  const regular=setup('vulpix',[],3);
  regular.caster.energy=0;
  tickBattle(regular.battle,.025);passive(regular.caster);
  assert.equal(regular.caster.energy,10);
  advance(regular.battle,.65);
  assert.ok(regular.enemies[0].hp<2000);
  assert.ok(regular.enemies.slice(1).every(e=>e.hp===2000));
  assert.equal(getStageData('vulpix',1).range,4);
  assert.equal(ATTACKS.moves['pierce-ninetales'].specialRatio,.75);
});
