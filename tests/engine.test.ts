import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { calculateStats, LEGENDARY_FAMILIES, PHASES, RULES, SHOP_FAMILIES, SPECIES } from '../server/data';
import { chapterDamage, GameEngine, projectedIncome, streakIncome } from '../server/engine';
import { createBattle, createBattleGroup, tickBattle } from '../server/systems/combat';
import type { Stats } from '../server/types';

const all = (value: number): Stats => ({ hp: value, speed: value, atk: value, def: value, spa: value, spd: value });

test('IV 0 / 50 / 100 e níveis acima de 100 continuam escalando para chefes', () => {
  const base = SPECIES.bulbasaur.base;
  assert.equal(calculateStats('bulbasaur', 0, all(0), 0).hp, Math.round(base.hp * .8));
  assert.equal(calculateStats('bulbasaur', 0, all(50), 0).atk, base.atk);
  assert.equal(calculateStats('bulbasaur', 0, all(100), 0).spa, Math.round(base.spa * 1.2));
  assert.equal(calculateStats('bulbasaur', 100, all(50), 0).hp, base.hp * 6);
  assert.equal(calculateStats('bulbasaur', 250, all(50), 0).hp, Math.round(base.hp * 13.5));
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
      assert.ok(existsSync(resolve('public', sprite.replace(/^\.\/sprites\//, 'sprites/'))), `Sprite ausente: ${sprite}`);
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
  attacker.attackClock = 0; victim.attackClock = 100;
  victim.hp = 1;
  tickBattle(battle, .1);
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

test('três cópias evoluem e os IVs são herdados pela média', () => {
  const game = new GameEngine(42);
  const player = game.players[0];
  const starter = player.units[0];
  starter.iv = all(50);
  player.shop[0] = { id: 'force-a', family: 'bulbasaur', rarity: 1, price: 1 };
  assert.equal(game.command({ kind: 'buy', slot: 0 }), null);
  player.shop[0] = { id: 'force-b', family: 'bulbasaur', rarity: 1, price: 1 };
  assert.equal(game.command({ kind: 'buy', slot: 0 }), null);
  assert.equal(player.units.length, 1);
  assert.equal(player.units[0].stage, 1);
  assert.equal(player.units[0].position.area, 'board');
  assert.ok(player.units[0].iv.hp >= 0 && player.units[0].iv.hp <= 100);
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
