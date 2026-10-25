import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateStats, LEGENDARY_FAMILIES, PHASES, RULES, SHOP_FAMILIES, SPECIES } from '../server/data';
import { chapterDamage, GameEngine, projectedIncome, streakIncome } from '../server/engine';
import { normalizedOdds, rollFamily, shopOdds, typeBonus, typeInfluence } from '../server/shop';
import { createBattle, createBattleGroup, tickBattle } from '../server/systems/combat';
import { chargedEffectiveness } from '../server/systems/effectiveness';
import type { Stats } from '../server/types';

const all = (value: number): Stats => ({ hp: value, speed: value, atk: value, def: value, spa: value, spd: value });

test('IV 0 / 50 / 100 e +3% por nível após o nível 1, inclusive chefes', () => {
  const base = SPECIES.bulbasaur.base;
  assert.equal(calculateStats('bulbasaur', 0, all(0), 0).hp, Math.round(base.hp * .8));
  assert.equal(calculateStats('bulbasaur', 0, all(50), 0).atk, base.atk);
  assert.equal(calculateStats('bulbasaur', 0, all(100), 0).spa, Math.round(base.spa * 1.2));
  assert.equal(calculateStats('bulbasaur', 1, all(50), 0).hp, base.hp);
  assert.equal(calculateStats('bulbasaur', 2, all(50), 0).hp, Math.round(base.hp * 1.03));
  assert.equal(calculateStats('bulbasaur', 100, all(50), 0).hp, Math.round(base.hp * 3.97));
  assert.equal(calculateStats('bulbasaur', 250, all(50), 0).hp, Math.round(base.hp * 8.47));
});

test('as quatro configurações são reais, chefes são Gen 1/2 e lendários ficam fora da loja', () => {
  assert.equal(PHASES.stagesPerChapter, 10);
  assert.deepEqual(PHASES.stages.map(s => s.type), ['battle','gold','battle','quad','bot','battle','gold','battle','double','boss']);
  assert.equal(LEGENDARY_FAMILIES.length, 11);
  assert.equal(SHOP_FAMILIES.length, 4);
  assert.ok(LEGENDARY_FAMILIES.every(f => !SPECIES[f].shop && SPECIES[f].sprites[0].includes('.png')));
  for (const species of Object.values(SPECIES)) {
    assert.equal(species.names.length, species.sprites.length);
    for (const sprite of species.sprites) {
      assert.match(sprite, /^\.\/sprites\/\d+\.png$/, `Referência PNG inválida: ${sprite}`);
    }
  }
  assert.equal(RULES.maxInterest, 5);
});

test('renda = 5 + juros até 5 + vitória + streak de 2 a 5', () => {
  const player = new GameEngine(99).players[0];
  player.gold = 59; player.streak = 2; player.roundVictory = true;
  assert.equal(projectedIncome(player), 12);
  player.gold = 200; player.streak = -5; player.roundVictory = false;
  assert.equal(projectedIncome(player), 14);
  assert.equal(streakIncome(1), 0);
  assert.equal(streakIncome(3), 2);
  assert.equal(streakIncome(4), 3);
  assert.equal(streakIncome(18), 4);
});

test('dano por capítulo escala como 2, 3, 4; bônus por peças vivas e rodada dupla', () => {
  assert.equal(chapterDamage(1), 2);
  assert.equal(chapterDamage(2), 3);
  assert.equal(chapterDamage(3), 4);
  const game = new GameEngine(76);
  const anyGame = game as any;
  anyGame.round = 9;
  const battle = createBattle(game.players[0], game.players[1], 'double-test');
  battle.resolved = true; battle.winner = 'p0'; battle.loser = 'p1'; battle.rankings = ['p0','p1'];
  anyGame.battles = [battle]; anyGame.finishCombat();
  assert.equal(game.players[1].health, 100 - (2 + 1) * 2);
});

test('batalha quádrupla une quatro equipes, preserva streak neutro e aplica +1/+4/+7', () => {
  const game = new GameEngine(72);
  const anyGame = game as any;
  anyGame.round = 4;
  game.players[1].streak = 3;
  game.players[2].streak = -2;
  const battle = createBattleGroup(game.players.slice(0, 4), 'quad-test', 'quad');
  assert.equal(battle.participants.length, 4);
  assert.equal(new Set(battle.units.map(u => `${u.x},${u.y}`)).size, 4);
  battle.rankings = ['p0','p1','p2','p3']; battle.resolved = true; battle.winner = 'p0'; battle.loser = 'p3';
  anyGame.battles = [battle]; anyGame.finishCombat();
  assert.equal(game.players[0].health, 100);
  assert.equal(game.players[1].health, 97);
  assert.equal(game.players[2].health, 94);
  assert.equal(game.players[3].health, 91);
  assert.equal(game.players[1].streak, 3);
  assert.equal(game.players[2].streak, -2);
  assert.equal(game.players[3].streak, -1);
  assert.equal(game.players[1].roundVictory, false);
});

test('moedas surgem em KO na etapa 2, só o dono coleta e prêmio +4 para vencedor', () => {
  const game = new GameEngine(13);
  const anyGame = game as any;
  anyGame.round = 2; anyGame.startCombat();
  const battle = createBattleGroup(game.players.slice(0, 2), 'coin-test', 'gold');
  const attacker = battle.units.find(u => u.playerId === 'p0')!;
  const victim = battle.units.find(u => u.playerId === 'p1')!;
  attacker.x = victim.x; attacker.y = victim.y;
  attacker.animation = null; // Contorna a rotação; o dano deve aguardar o projétil.
  battle.introElapsed = 1.5;
  attacker.attackClock = 0; victim.attackClock = 100;
  victim.hp = 1;
  tickBattle(battle, .1);
  assert.equal(battle.goldDrops.length, 0, 'a moeda só surge quando o projétil alcança o alvo');
  attacker.attackClock = 100;
  for (let i = 0; i < 7; i++) tickBattle(battle, .1);
  assert.equal(battle.goldDrops.length, 1);
  const coin = battle.goldDrops[0];
  anyGame.battles = [battle];
  assert.equal(game.command({ kind: 'collect', dropId: coin.id }), null);
  assert.equal(game.command({ kind: 'collect', dropId: coin.id }), 'Moeda indisponível');
  assert.equal(game.players[0].gold, 10);
  anyGame.finishCombat();
  assert.equal(game.players[0].gold, 14);
});

test('PvE na etapa 5 e lendário na etapa 10 com nível e IV prescritos por capítulo', () => {
  for (const chapter of [1, 2, 3]) {
    const game = new GameEngine(130 + chapter);
    const anyGame = game as any;
    anyGame.round = (chapter - 1) * 10 + 5;
    anyGame.startCombat();
    assert.equal(game.snapshot().stageType, 'bot');
    assert.ok(game.snapshot().visibleBattle?.units.some(u => u.playerId === 'bot:p0'));
    anyGame.round = chapter * 10;
    anyGame.startCombat();
    const snapshot = game.snapshot();
    assert.equal(snapshot.stageType, 'boss');
    const boss = snapshot.visibleBattle?.units.find(u => u.playerId === 'bot:p0');
    assert.ok(boss);
    assert.ok(LEGENDARY_FAMILIES.includes(boss.family));
    assert.equal(boss.level, chapter * 100);
    assert.equal(boss.stats.hp, calculateStats(boss.family, chapter * 100, all(chapter === 1 ? 50 : chapter === 2 ? 75 : 100), 0).hp);
  }
});

test('o servidor cria oito participantes, vida cheia, loja seis e dez posições de banco', () => {
  const game = new GameEngine(42);
  assert.equal(game.players.length, 8);
  assert.ok(game.players.every(p => p.health === 100 && p.shop.length === 6));
  assert.equal(game.snapshot().phase, 'planning');
  assert.equal(game.snapshot().players[0].units.length, 1);
  assert.equal(game.snapshot().players[1].shop.length, 0, 'a loja da CPU não é exposta ao cliente');
});

test('seis tabelas da loja reproduzem os pesos pedidos; níveis 5/6 normalizam 101%', () => {
  assert.deepEqual(RULES.shopOddsByLevel, [[38,33,29,0,0],[36,33,30,1,0],[32,34,31,3,0],[29,31,32,7,1],[26,29,34,10,2],[25,27,31,15,3]]);
  assert.deepEqual(shopOdds(7), shopOdds(6));
  assert.ok(Math.abs(normalizedOdds(5).reduce((a,b) => a+b, 0) - 1) < 1e-10);
  const game = new GameEngine(33);
  game.players[0].level = 6;
  const rolled = Array.from({length:100}, () => rollFamily(game.players[0], Math.random));
  assert.ok(rolled.every(offer => SPECIES[offer.family].shop && offer.rarity <= 3));
});

test('influência dos tipos inclui ativos e banco; tipos duplos recebem bônus secundário pela metade', () => {
  const game = new GameEngine(3), player = game.players[0];
  const starter = player.units[0];
  starter.family = 'bulbasaur';
  const another = { ...starter, id:'bench-test', family: 'squirtle' as const, position: {area:'bench' as const,index:0} };
  player.units.push(another);
  const result = typeInfluence(player);
  assert.equal(result.points.grass, 2);
  assert.equal(result.points.poison, 2);
  assert.equal(result.points.water, 1);
  assert.equal(result.total, 5);
  assert.equal(typeBonus('bulbasaur', { grass: .3, poison: .5 }), .25 + .075);
});

test('fraqueza e resistência são reduzidas à metade, tipos duplos combinam sem imunidade', () => {
  assert.equal(chargedEffectiveness('fire', ['grass']), 1.5);
  assert.equal(chargedEffectiveness('fire', ['water']), .75);
  assert.equal(chargedEffectiveness('fire', ['grass', 'ice']), 2.5);
  assert.equal(chargedEffectiveness('grass', ['fire', 'poison']), .625);
  assert.equal(chargedEffectiveness('psychic', ['electric']), 1);
});

test('vitória executa Shoot, dispara projéteis para o treinador e termina em idle', () => {
  const game = new GameEngine(303);
  const battle = createBattle(game.players[0], game.players[1], 'finisher');
  battle.introElapsed = 1.5;
  battle.units[1].hp = 0;
  tickBattle(battle, .1);
  assert.equal(battle.resolved, true);
  assert.equal(battle.winner, 'p0');
  tickBattle(battle, .3);
  tickBattle(battle, .1);
  assert.equal(battle.units[0].animation?.name, 'Shoot');
  const shot = battle.effects.find(fx => fx.kind === 'trainer-hit');
  assert.ok(shot && shot.targetX > 4 && shot.targetY < 0);
  tickBattle(battle, 1);
  assert.equal(battle.units[0].animation, null);
  assert.ok(battle.outcomeElapsed >= 1.4);
});

test('trava mantém ofertas entre rodadas e clique alterna o estado', () => {
  const game = new GameEngine(313);
  const before = game.players[0].shop.map(offer => offer?.id);
  assert.equal(game.command({ kind: 'lock' }), null);
  (game as any).nextRound();
  assert.deepEqual(game.players[0].shop.map(offer => offer?.id), before);
  assert.equal(game.command({ kind: 'lock' }), null);
  (game as any).nextRound();
  assert.notDeepEqual(game.players[0].shop.map(offer => offer?.id), before);
});

test('milestones de jogador e experiência de cada Pokémon na primeira batalha', () => {
  const game = new GameEngine(91);
  const player = game.players[0];
  const benchPokemon = { ...player.units[0], id:'new-bench', position: { area: 'bench' as const, index: 0 }, xp:0, level:1 };
  player.units.push(benchPokemon);
  const anyGame = game as any;
  anyGame.round = 1;
  const battle = createBattle(game.players[0], game.players[1], 'xp-test');
  battle.rankings = ['p0','p1']; battle.resolved = true;
  anyGame.battles = [battle]; anyGame.finishCombat();
  assert.equal(player.units[0].level, 3);
  assert.equal(benchPokemon.level, 2);
  for (const [round, level] of [[1,1],[3,2],[7,3],[12,4],[16,5],[21,6]]) {
    anyGame.round = round;
    assert.equal(anyGame.levelForRound(), level);
  }
});

test('pré-confrontos geram três calendários igualmente sorteáveis e não vazam o próximo rival', () => {
  const game = new GameEngine(452);
  const planned = game.snapshot();
  assert.equal(planned.opponentId, null);
  assert.equal(planned.possibleOpponents.p0.length, 3);
  for (const player of game.players) {
    assert.equal(planned.possibleOpponents[player.id].length, 3);
    assert.ok(planned.possibleOpponents[player.id].every(option => option.length === 1));
  }
  (game as any).startCombat();
  assert.ok(planned.possibleOpponents.p0.some(option => option.includes(game.snapshot().opponentId!)));
  const battles = (game as any).battles;
  assert.equal(new Set(battles.flatMap((battle: any) => battle.participants)).size, 8);
});

test('arena quádrupla distribui equipes em quadrantes exclusivos e dano gera popup no alvo', () => {
  const game = new GameEngine(10);
  const battle = createBattleGroup(game.players.slice(0, 4), 'quad-layout', 'quad');
  assert.ok(battle.units[0].x < 0 && battle.units[0].y > 0);
  assert.ok(battle.units[1].x < 0 && battle.units[1].y < 0);
  assert.ok(battle.units[2].x > 0 && battle.units[2].y < 0);
  assert.ok(battle.units[3].x > 0 && battle.units[3].y > 0);
  assert.ok(Math.max(...battle.units.map(u => u.x)) - Math.min(...battle.units.map(u => u.x)) > 8, 'arenas lado a lado');
  const duel = createBattle(game.players[0], game.players[1], 'damage-anchors');
  duel.units[0].animation = null;
  duel.units[0].attackClock = 0;
  duel.units[1].attackClock = 100;
  duel.units[0].range = 100;
  duel.introElapsed = 1.5;
  tickBattle(duel, .1);
  assert.ok(duel.effects.some(fx => fx.pendingHit), 'projétil em voo ainda não deve criar popup');
  assert.ok(!duel.effects.some(fx => fx.kind === 'damage'));
  duel.units[0].attackClock = 100;
  for (let i = 0; i < 7; i++) tickBattle(duel, .1);
  const popup = duel.effects.find(fx => fx.kind === 'damage');
  assert.ok(popup && popup.targetId === duel.units[1].id);
  assert.ok(Math.abs(popup.x - duel.units[1].x) < .05, 'o popup surge na posição do alvo no momento do dano');
});

test('três cópias evoluem herdando o maior IV de cada atributo', () => {
  const game = new GameEngine(42);
  const player = game.players[0];
  const starter = player.units[0];
  starter.iv = all(50);
  player.shop[0] = { id: 'force-a', family: 'bulbasaur', rarity: 1, price: 1 };
  assert.equal(game.command({ kind: 'buy', slot: 0 }), null);
  const second = player.units.find(u => u.position.area === 'bench')!;
  second.iv = { hp: 80, speed: 30, atk: 90, def: 5, spa: 25, spd: 70 };
  player.shop[0] = { id: 'force-b', family: 'bulbasaur', rarity: 1, price: 1 };
  assert.equal(game.command({ kind: 'buy', slot: 0 }), null);
  assert.equal(player.units.length, 1);
  assert.equal(player.units[0].stage, 1);
  assert.equal(player.units[0].position.area, 'board');
  const merged = player.units[0];
  assert.equal(merged.iv.hp, Math.max(50, 80, merged.iv.hp));
  assert.ok(merged.iv.atk >= 90 && merged.iv.speed >= 50);
  const evolution = game.snapshot().visualEvents.find(event => event.kind === 'evolve' && event.unitId === merged.id);
  assert.ok(evolution);
  assert.equal(evolution.sources?.length, 3, 'os três Pokémon originais são preservados na animação de fusão');
  assert.equal(evolution.sources?.filter(unit => unit.position.area === 'board').length, 1);
});

test('comandos não podem superar limite de campo nem gastar ouro sem saldo', () => {
  const game = new GameEngine(22);
  const player = game.players[0];
  player.shop[0] = { id: 'force', family: 'charmander', rarity: 1, price: 1 };
  assert.equal(game.command({ kind: 'buy', slot: 0 }), null);
  const bench = player.units.find(u => u.position.area === 'bench')!;
  assert.match(game.command({ kind: 'move', unitId: bench.id, position: { area: 'board', col: 0, row: 1 } })!, /Limite/);
  assert.equal(bench.position.area, 'bench');
  player.gold = 0;
  assert.match(game.command({ kind: 'reroll' })!, /insuficiente/);
  assert.match(game.command({ kind: 'move', unitId: bench.id, position: { area: 'board', col: -1, row: 0 } })!, /inválido/);
});

test('oito CPUs simulam confrontos e a próxima rodada traz renda e nível automático', () => {
  const game = new GameEngine(532);
  let witnessedCombat = false, witnessedResult = false;
  for (let step = 0; step < 1250; step++) {
    game.tick(.1);
    const s = game.snapshot();
    witnessedCombat ||= s.phase === 'combat';
    witnessedResult ||= s.phase === 'result';
    if (s.round >= 2) break;
  }
  assert.equal(witnessedCombat, true);
  assert.equal(witnessedResult, true);
  assert.equal(game.snapshot().round, 2);
  assert.ok(game.players[0].gold >= 14);
});

test('unidades escolhem alvo, avançam até o alcance e atacam/geram energia', () => {
  const game = new GameEngine(180);
  const playerA = game.players[0], playerB = game.players[1];
  playerA.units[0].position = { area: 'board', col: 0, row: 3 };
  playerB.units[0].position = { area: 'board', col: 6, row: 3 };
  const battle = createBattle(playerA, playerB, 'unit-test');
  const [a, b] = battle.units;
  const startDistance = Math.hypot(a.x - b.x, a.y - b.y);
  for (let i = 0; i < 120 && !battle.resolved; i++) tickBattle(battle, .05);
  const distanceNow = Math.hypot(a.x - b.x, a.y - b.y);
  assert.ok(distanceNow < startDistance, 'as unidades se aproximaram dos alvos');
  assert.ok(a.hp < a.maxHp || b.hp < b.maxHp, 'ataques realmente causaram dano');
  assert.ok(a.metrics.dealt > 0 || b.metrics.dealt > 0, 'métricas do combate foram registradas');
});

test('uma partida completa termina com exatamente um campeão e posições finais', () => {
  const game = new GameEngine(42);
  let finished = false;
  for (let i = 0; i < 25000; i++) {
    game.tick(.1);
    if (i % 100 === 0 && game.snapshot().phase === 'finished') { finished = true; break; }
  }
  const snapshot = game.snapshot();
  assert.ok(finished, 'a simulação concluiu');
  assert.equal(snapshot.players.filter(p => !p.eliminated).length, 1);
  assert.equal(snapshot.players.find(p => p.id === snapshot.winnerId)?.placement, 1);
  assert.deepEqual(snapshot.players.map(p => p.placement).sort((a, b) => Number(a) - Number(b)), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('preparação tem 40 segundos e cada capítulo possui exatamente dez etapas', () => {
  const game = new GameEngine(92);
  assert.equal(game.snapshot().phaseSeconds, 40);
  assert.equal(game.snapshot().chapter, 1);
  assert.equal(game.snapshot().stage, 1);
  for (let i = 0; i < 20000 && game.snapshot().round < 11; i++) game.tick(.1);
  const snapshot = game.snapshot();
  assert.equal(snapshot.round, 11);
  assert.equal(snapshot.chapter, 2);
  assert.equal(snapshot.stage, 1);
});

test('comprar, roletar e reorganizar banco funcionam durante o combate; campo fica travado', () => {
  const game = new GameEngine(340);
  const player = game.players[0];
  player.shop[0] = { id: 'extra', family: 'squirtle', rarity: 2, price: 2 };
  for (let i = 0; i < 402; i++) game.tick(.1);
  assert.equal(game.snapshot().phase, 'combat');
  assert.equal(game.command({ kind: 'buy', slot: 0 }), null);
  const bench = player.units.find(u => u.position.area === 'bench')!;
  assert.equal(game.command({ kind: 'move', unitId: bench.id, position: { area: 'bench', index: 9 } }), null);
  assert.match(game.command({ kind: 'move', unitId: bench.id, position: { area: 'board', col: 3, row: 0 } })!, /banco/);
  assert.match(game.command({ kind: 'sell', unitId: player.units.find(u => u.position.area === 'board')!.id })!, /campo/);
  assert.equal(game.command({ kind: 'reroll' }), null);
  assert.equal(game.snapshot('p3').observedId, 'p3');
  assert.ok(game.snapshot('p3').visibleBattle?.units.some(u => u.playerId === 'p3'));
});

test('após 30 segundos com combate pendente entra aceleração 3×', () => {
  const game = new GameEngine(13);
  for (let i = 0; i < 402; i++) game.tick(.1);
  const battle = game.snapshot().visibleBattle!;
  // Mantém este confronto vivo para testar a regra de aceleração.
  for (const unit of battle.units) {
    unit.hp = 1_000_000;
    unit.maxHp = 1_000_000;
    unit.attackClock = 100_000;
  }
  for (let i = 0; i < 302; i++) game.tick(.1);
  const snapshot = game.snapshot();
  assert.equal(snapshot.phase, 'combat');
  assert.equal(snapshot.accelerated, true);
  assert.equal(snapshot.timeLeft, 0);
  const before = snapshot.visibleBattle!.elapsed;
  game.tick(.1);
  assert.ok(game.snapshot().visibleBattle!.elapsed - before > .25);
});

test('painel recebe dano físico e especial separados por Pokémon', () => {
  const game = new GameEngine(7);
  const [a, b] = game.players;
  a.units[0].position = { area: 'board', col: 3, row: 0 };
  b.units[0].position = { area: 'board', col: 3, row: 0 };
  const battle = createBattle(a, b, 'damage-split');
  for (let i = 0; i < 300 && !battle.resolved; i++) tickBattle(battle, .05);
  const dealt = battle.units.reduce((sum, u) => sum + u.metrics.dealt, 0);
  const physical = battle.units.reduce((sum, u) => sum + u.metrics.physicalDealt, 0);
  const special = battle.units.reduce((sum, u) => sum + u.metrics.specialDealt, 0);
  assert.ok(physical > 0);
  assert.ok(special > 0);
  assert.ok(Math.abs(dealt - physical - special) < 0.001);
});
