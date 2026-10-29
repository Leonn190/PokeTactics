const test=require('node:test');
const assert=require('node:assert/strict');
const {SPECIES,getStageData,calculateStats,SHOP_FAMILIES,LEGENDARY_FAMILIES,ATTACKS,RULES}=require('./.build/server/data.js');
const {createBattleGroup,tickBattle}=require('./.build/server/systems/combat.js');
const {GameEngine}=require('./.build/server/engine.js');
const {normalizedOdds,rollFamily}=require('./.build/server/shop.js');
function pokemon(family,stage=0,col=3,row=0,id=family){return {id,family,stage,level:1,xp:0,iv:{hp:50,atk:50,def:50,spa:50,spd:50,speed:50},position:{area:'board',col,row}};}
function player(id,units){return {id,name:id,health:100,gold:20,level:5,units,shop:[],locked:false,eliminated:false,lastWin:false,streak:0,roundVictory:false,history:[],placement:null};}
function build(a,b,kind='battle'){return createBattleGroup([player('p0',a),player(kind==='boss'?'bot:p0':'p1',b)],'test-'+Math.random(),kind);}
function unit(b,pk){const u=b.units.find(v=>v.sourceId===pk);assert.ok(u,pk);return u;}
function advance(b,n=20,dt=.05){for(let i=0;i<n;i++)tickBattle(b,dt);}
test('configurations: all forms, rarities, progression and shop odds',()=>{
  assert.equal(SPECIES.dratini.rarity,3);assert.equal(SPECIES.diglett.rarity,1);
  assert.equal(SPECIES.mew.rarity,5); assert.equal(SPECIES.mew.shop,true);
  assert.equal(SPECIES.mew.bossOnly,true);assert.ok(LEGENDARY_FAMILIES.includes('mew'));
  assert.ok(SHOP_FAMILIES.includes('dratini'));assert.ok(SHOP_FAMILIES.includes('diglett'));assert.ok(SHOP_FAMILIES.includes('mew'));
  for(const [f,expected] of [['dratini',[4,2,1]],['diglett',[1,1]],['mew',[5]]]) expected.forEach((range,i)=>assert.equal(getStageData(f,i).range,range));
  assert.deepEqual([0,1,2].map(i=>getStageData('dratini',i).energy),[60,75,90]);
  assert.deepEqual([0,1].map(i=>getStageData('diglett',i).energy),[60,65]);
  assert.equal(getStageData('mew',0).energy,80);
  assert.deepEqual([0,1,2].map(i=>getStageData('dratini',i).basic.category),['special','special','physical']);
  assert.equal(getStageData('diglett',0).basic.category,'physical');assert.equal(getStageData('mew',0).basic.category,'special');
  assert.equal(RULES.statFormula.levelPerPoint,.01);
  const s1=calculateStats('diglett',1,pokemon('diglett').iv,0),s2=calculateStats('diglett',2,pokemon('diglett').iv,0);
  assert.equal(s2.hp,Math.round(s1.hp*1.01));
  assert.equal(normalizedOdds(6)[4],3/101);
  assert.equal(rollFamily(player('p1',[]),()=>.999999).rarity,5);
});
test('boss Mew stays PvE-only profile and separate from purchasable Mew',()=>{
  const p=pokemon('mew',0,3,1,'play'),npc=pokemon('mew',0,3,1,'boss');
  const b=build([p],[npc],'boss');
  const a=unit(b,'play'),boss=unit(b,'boss');
  assert.equal(a.range,5);assert.equal(a.energyNeeded,80);assert.equal(a.bossMove,undefined);
  assert.equal(boss.range,3);assert.equal(boss.energyNeeded,65);assert.equal(boss.bossMove,'legendary-psychic');
  assert.ok(boss.maxHp>a.maxHp);
});
test('Diglett burrows towards farthest enemy, hides during travel, never overlaps, damages only on emergence',()=>{
  const b=build([pokemon('diglett',0,2,0,'dig')],[pokemon('snorlax',0,0,3,'far'),pokemon('squirtle',0,2,3,'near')]);
  const dig=unit(b,'dig'),far=unit(b,'far'),near=unit(b,'near');
  far.x=3.4;far.y=-3; near.x=0;near.y=.5;
  for (const u of b.units) if(u!==dig) {u.stunUntil=100;u.attackClock=1000;}
  dig.energy=60;dig.attackClock=0;
  tickBattle(b,1.51);
  assert.equal(dig.dig?.phase,'sink');assert.equal(dig.dig.targetId,far.id);
  const hp=far.hp,origin={x:dig.x,y:dig.y};
  advance(b,20,.05);assert.notEqual(dig.x,origin.x);assert.equal(far.hp,hp);
  const effectWasCreated=()=>b.effects.some(f=>f.kind==='earth-trail'||f.kind==='earth-burst');
  let soilSeen=effectWasCreated();
  for(let i=0;i<60;i++){tickBattle(b,.05);soilSeen ||= effectWasCreated();}
  assert.ok(soilSeen,'procedural dirt effects emitted during travel');
  assert.equal(dig.dig,null); assert.ok(Math.hypot(far.x-dig.x,far.y-dig.y)<=2.5);
  assert.ok(far.hp<hp,'impact after emergence');
  assert.ok(!b.units.some(u=>u!==dig && u.hp>0 && Math.hypot(u.x-dig.x,u.y-dig.y)<.6));

});
test('Dragonite casts exactly 3 area pulses; first knockup happens once and triggers Cubone/Marowak',()=>{
  const b=build([pokemon('dratini',2,3,0,'dragon'),pokemon('cubone',1,4,0,'marowak')],[pokemon('snorlax',0,3,2,'tank')]);
  const dragon=unit(b,'dragon'),tank=unit(b,'tank'),cubone=unit(b,'marowak');
  tank.x=dragon.x+.7;tank.y=dragon.y-.6;
  for(const u of b.units) if(u!==dragon){u.stunUntil=100;u.attackClock=1e6;}
  dragon.energy=90;dragon.attackClock=0;
  const hp=tank.hp;
  tickBattle(b,1.51);
  assert.ok(dragon.storm);
  advance(b,24,.05);
  assert.equal(dragon.storm,null);
  assert.equal(b.knockupEvents.filter(e=>e.target_unit_id===tank.id).length,1);
  assert.ok(tank.hp<hp);assert.ok(cubone.metrics.casts===0,'Cubone only reacts without spending energy');
  assert.ok(b.effects.some(e=>e.kind==='dragon-wave'||e.kind==='dragon-tornado'));
});
test('Mew finds lowest % HP, heals, shields, buffs basic hits but not charged abilities',()=>{
  const b=build([pokemon('mew',0,2,1,'support'),pokemon('snorlax',0,1,1,'absolute'),pokemon('charmander',0,3,1,'percent')],[pokemon('snorlax',0,2,0,'enemy')]);
  const mew=unit(b,'support'),a=unit(b,'absolute'),c=unit(b,'percent'),enemy=unit(b,'enemy');
  a.hp=a.maxHp*.65;c.hp=c.maxHp*.3;
  enemy.stunUntil=100;enemy.attackClock=1000;
  a.attackClock=1000;a.stunUntil=100;c.attackClock=1000;c.stunUntil=100;
  mew.energy=80;mew.attackClock=0;
  tickBattle(b,1.51);
  const fx=b.effects.find(f=>f.pendingHit?.special==='mew-blessing');assert.equal(fx?.pendingHit.targetId,c.id);
  advance(b,12,.05);
  assert.ok(c.hp>c.maxHp*.3);assert.ok(c.barriers.some(bar=>bar.kind==='mew'));assert.ok(c.psychicImbuement);
  assert.equal(a.psychicImbuement,null);
  // Restore actor from stun and record a real regular attack impact.
  c.stunUntil=0;c.attackClock=0;c.energy=0;
  enemy.x=c.x+.6;enemy.y=c.y-.65;
  mew.attackClock=1000;
  const specialBefore=mew.metrics.specialDealt;
  advance(b,14,.05);
  assert.ok(mew.metrics.specialDealt>specialBefore,'bonus is attributed to Mew on a basic impact');
  assert.ok(c.psychicImbuement);
  const creditBeforeCharge = mew.metrics.specialDealt;
  c.energy=c.energyNeeded;c.attackClock=0;
  advance(b,12,.05);
  assert.equal(mew.metrics.specialDealt,creditBeforeCharge,'charged abilities cannot trigger the psychic bonus');
  c.attackClock=1000;c.stunUntil=100;
  advance(b,80,.05);
  assert.equal(c.psychicImbuement,null);assert.ok(!c.barriers.some(bar=>bar.kind==='mew'));
});
test('ranking snapshot derives eight independent statuses and resets at planning',()=>{
  const engine=new GameEngine(42);
  assert.equal(Object.keys(engine.snapshot().battleStatuses).length,0);
  for(let i=0;i<251;i++)engine.tick(.1);
  assert.equal(engine.snapshot().phase,'combat');
  assert.equal(Object.values(engine.snapshot().battleStatuses).filter(s=>s==='battling').length,8);
  for(let i=0;i<950 && engine.snapshot().phase!=='planning' && engine.snapshot().phase!=='finished';i++)engine.tick(.1);
  const phase=engine.snapshot().phase;
  if(phase==='planning') assert.deepEqual(engine.snapshot().battleStatuses,{});
  else assert.equal(phase,'finished');
});
test('engine evolves both new families and fuses final stages without altering Mew evolution',()=>{
  const e=new GameEngine(19),p=e.players[0];p.gold=250;
  const buy=(family)=>{p.shop[0]={id:'shop',family,rarity:SPECIES[family].rarity,price:SPECIES[family].rarity};assert.equal(e.command({kind:'buy',slot:0}),null);};
  for(let i=0;i<3;i++)buy('diglett');
  assert.equal(p.units.filter(u=>u.family==='diglett'&&u.stage===1).length,1);
  for(let i=0;i<27;i++)buy('dratini');
  const final=p.units.filter(u=>u.family==='dratini'&&u.stage===2);
  assert.equal(final.length,3);
  assert.equal(e.command({kind:'move',unitId:final[0].id,position:{...final[1].position}}),null);
  assert.equal(p.units.filter(u=>u.family==='dratini'&&u.stage===2).length,2);
  assert.ok(p.units.some(u=>u.family==='dratini'&&u.stage===2&&u.level===6));
  buy('mew');buy('mew');
  const mews=p.units.filter(u=>u.family==='mew');assert.equal(mews.length,2);
  assert.equal(e.command({kind:'move',unitId:mews[0].id,position:{...mews[1].position}}),null);
  assert.equal(p.units.filter(u=>u.family==='mew').length,1);
  assert.equal(p.units.find(u=>u.family==='mew').level,6);
});
test('Dragonair cyclone: splash half central damage and 15% attack speed reduction on both victims',()=>{
  const b=build([pokemon('dratini',1,2,0,'air')],[pokemon('snorlax',0,3,0,'primary'),pokemon('snorlax',0,4,0,'secondary')]);
  const air=unit(b,'air'),p=unit(b,'primary'),q=unit(b,'secondary');
  p.x=air.x+.5;p.y=air.y-1.0;q.x=air.x+1.0;q.y=air.y-1.15;
  p.stunUntil=100;q.stunUntil=100;p.attackClock=1000;q.attackClock=1000;
  air.energy=75;air.attackClock=0;
  tickBattle(b,1.51);advance(b,12,.05);
  assert.ok(p.hp<p.maxHp);assert.ok(q.hp<q.maxHp);
  assert.ok(p.maxHp-p.hp > q.maxHp-q.hp,'center is stronger');
  assert.ok(p.attackSpeedDebuffUntil>b.elapsed && q.attackSpeedDebuffUntil>b.elapsed);
  const slowed=p.cooldown;
  advance(b,43,.05);
  assert.equal(p.attackSpeedDebuffUntil<b.elapsed,true);
  assert.ok(p.cooldown<slowed);
});
test('a Diglett does not get stuck when its target dies while burrowing',()=>{
  const b=build([pokemon('diglett',0,0,0,'dig')],[pokemon('snorlax',0,4,0,'target'),pokemon('snorlax',0,3,1,'backup')]);
  const dig=unit(b,'dig'),target=unit(b,'target'),backup=unit(b,'backup');
  for(const u of [target,backup]){u.stunUntil=100;u.attackClock=1000;}
  dig.energy=60;dig.attackClock=0;target.x=3;target.y=-2;
  tickBattle(b,1.51);assert.ok(dig.dig);
  target.hp=0;
  advance(b,90,.05);
  assert.equal(dig.dig,null);
  assert.ok(Number.isFinite(dig.x) && Number.isFinite(dig.y));
  assert.ok(backup.hp<=backup.maxHp);
});

test('Mew psychic bonus works with ranged special basic attacks',()=>{
  const b=build([pokemon('mew',0,1,1,'mew'),pokemon('dratini',0,2,1,'caster')],[pokemon('snorlax',0,2,0,'enemy')]);
  const mew=unit(b,'mew'),caster=unit(b,'caster'),enemy=unit(b,'enemy');
  caster.hp=caster.maxHp*.4;caster.stunUntil=100;caster.attackClock=1000;
  enemy.stunUntil=100;enemy.attackClock=1000;
  mew.energy=80;mew.attackClock=0;
  tickBattle(b,1.51);advance(b,12,.05);
  assert.ok(caster.psychicImbuement);
  caster.stunUntil=0;caster.attackClock=0;caster.energy=0;
  mew.attackClock=1000;
  enemy.x=caster.x+.5;enemy.y=caster.y-1.5;
  const old=mew.metrics.specialDealt;
  advance(b,17,.05);
  assert.ok(mew.metrics.specialDealt>old);
});
