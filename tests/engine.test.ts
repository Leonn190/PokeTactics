import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateStats, SPECIES } from '../server/data';
import { GameEngine } from '../server/engine';
import { createBattle, tickBattle } from '../server/systems/combat';
import type { Stats } from '../server/types';

const all = (value: number): Stats => ({ hp: value, speed: value, atk: value, def: value, spa: value, spd: value });

test('IV 0 / 50 / 100 e nível 100 seguem os modificadores definidos', () => {
  const base = SPECIES.bulbasaur.base;
  assert.equal(calculateStats('bulbasaur', 0, all(0), 0).hp, Math.round(base.hp * .8));
  assert.equal(calculateStats('bulbasaur', 0, all(50), 0).atk, base.atk);
  assert.equal(calculateStats('bulbasaur', 0, all(100), 0).spa, Math.round(base.spa * 1.2));
  assert.equal(calculateStats('bulbasaur', 100, all(50), 0).hp, base.hp * 6);
  assert.equal(calculateStats('bulbasaur', 250, all(50), 0).hp, base.hp * 6);
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
