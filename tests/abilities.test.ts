import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import pmd from '../src/client/pmd-manifest.json';
import { SPECIES } from '../server/data';
import { GameEngine } from '../server/engine';
import { createBattle, tickBattle } from '../server/systems/combat';
import type { Family, Pokemon, Stats } from '../server/types';

const iv: Stats = { hp: 50, speed: 50, atk: 50, def: 50, spa: 50, spd: 50 };

function fixture(family: Family, enemies: number, stage = 0, allies = 0) {
  const game = new GameEngine(17);
  const make = (name: Family, id: string, col: number, stage = 0): Pokemon => ({
    id, family: name, stage, level: 1, xp: 0, iv,
    position: { area: 'board', col, row: 1 }
  });
  game.players[0].units = [make(family, 'source', 0, stage), ...Array.from({ length: allies }, (_, i) => make('charmander', `ally${i}`, i + 1))];
  game.players[1].units = Array.from({ length: enemies }, (_, i) => make('charmander', `enemy${i}`, i));
  const battle = createBattle(game.players[0], game.players[1], 'abilities');
  battle.introElapsed = 1.5; // Contorno do ritual de entrada ao testar somente habilidades.
  battle.traitsByPlayer.p0 = {}; // Testes unitários isolam a força da habilidade das sinergias de tipo.
  const attacker = battle.units.find(u => u.sourceId === 'source')!;
  const friends = battle.units.filter(u => u.playerId === 'p0' && u !== attacker);
  const foes = battle.units.filter(u => u.playerId === 'p1');
  attacker.x = 0; attacker.y = 0; attacker.animation = null;
  attacker.attackClock = 0; attacker.energy = attacker.energyNeeded; attacker.range = 100;
  friends.forEach((u, i) => { u.x = -1 + i * .3; u.y = 0; u.attackClock = 100; u.animation = null; });
  foes.forEach((u, i) => { u.x = 1 + i * .3; u.y = 0; u.attackClock = 100; u.animation = null; });
  return { battle, attacker, friends, foes };
}

test('metadados PMD das 11 evoluções usam os caminhos reais do GitHub sem duplicar os assets', () => {
  const arenaSource = readFileSync(resolve('src/client/arena.ts'), 'utf8');
  const hudSource = readFileSync(resolve('src/client/hud.ts'), 'utf8');
  assert.ok(arenaSource.includes('BASE_URL}sprite/'));
  assert.ok(hudSource.includes('portrait/${String(id).padStart'));
  assert.ok(hudSource.includes('tipos/${type}.svg'));
  for (const id of [1, 2, 3, 4, 5, 6, 7, 8, 9, 25, 26]) {
    const anims = (pmd as Record<string, Record<string, { file: string; width: number; height: number; durations: number[]; directions: number }>>)[String(id)];
    assert.ok(anims, `Pokémon ${id} sem manifest`);
    for (const action of ['Idle', 'Walk', 'Sleep', 'Hurt', 'Rotate', 'Attack']) {
      assert.ok(anims[action], `Pokémon ${id} sem animação ${action}`);
      const entry = anims[action];
      assert.ok(entry.file.endsWith('-Anim.png'));
      assert.ok(entry.width > 0 && entry.height > 0 && entry.durations.length > 0);
      assert.ok(entry.directions === 1 || entry.directions === 8);
    }
  }
  assert.ok((pmd as any)['7'].Withdraw);
  assert.ok((pmd as any)['1'].Shoot && (pmd as any)['1'].Charge);
  assert.ok((pmd as any)['4'].Strike);
});

test('sinergias não alteram dano, velocidade, cura ou mitigação', () => {
  const neutral = fixture('charmander', 1);
  neutral.attacker.energy = 0;
  neutral.foes[0].hp = neutral.foes[0].maxHp = 10000;
  tickBattle(neutral.battle, .05);
  const base = neutral.attacker.metrics.dealt;

  const boosted = fixture('charmander', 1);
  boosted.attacker.energy = 0;
  boosted.foes[0].hp = boosted.foes[0].maxHp = 10000;
  boosted.battle.traitsByPlayer.p0 = { grass: 6, fire: 6, poison: 6, electric: 6 };
  boosted.battle.traitsByPlayer.p1 = { water: 6 };
  tickBattle(boosted.battle, .05);
  assert.equal(boosted.attacker.metrics.dealt, base);
  assert.equal(boosted.attacker.cooldown, neutral.attacker.cooldown);
  assert.equal(boosted.foes[0].damageOverTime, null);
  const previouslyHit = boosted.attacker.hp = boosted.attacker.maxHp * .5;
  boosted.attacker.attackClock = 100;
  boosted.foes[0].attackClock = 100;
  tickBattle(boosted.battle, .05);
  assert.equal(boosted.attacker.hp, previouslyHit);
});

test('vantagem elemental altera apenas carregados, inclusive golpes físicos carregados', () => {
  const { battle, attacker, foes } = fixture('charmander', 1);
  foes[0].family = 'squirtle';
  foes[0].stats.def = 0;
  foes[0].maxHp = foes[0].hp = 10000;
  attacker.stats.atk = 100;
  attacker.energy = 0;
  tickBattle(battle, .05);
  assert.equal(attacker.metrics.dealt, 8 + 100 * .48, 'ataque básico sem resistência');
  attacker.attackClock = 0;
  attacker.energy = attacker.energyNeeded;
  tickBattle(battle, .05);
  assert.equal(attacker.metrics.dealt, 8 + 100 * .48 + 100 * 1.5 * .75,
    'golpe carregado de fogo resistido por água, multiplicador 0,75×');
});

test('Bulbasaur atinge o maior grupo, cura aliados e mantém Charge → Shoot', () => {
  const { battle, attacker, friends, foes } = fixture('bulbasaur', 3, 0, 1);
  foes[0].x = 1; foes[1].x = 1.5; foes[2].x = 5;
  friends[0].hp -= 80;
  const before = friends[0].hp;
  tickBattle(battle, .05);
  assert.equal(foes[0].hp, foes[0].maxHp, 'Charge não causa dano antes de Shoot');
  assert.equal(friends[0].hp, before, 'a cura aguarda o impacto');
  assert.equal(attacker.animation?.name, 'Charge');
  assert.equal(attacker.animation?.next, 'Shoot');
  for (let i = 0; i < 7; i++) tickBattle(battle, .05);
  assert.equal(attacker.animation?.name, 'Shoot');
  assert.ok(battle.effects.some(fx => fx.kind === 'pollen'), 'o projétil é lançado após Charge');
  for (let i = 0; i < 6; i++) tickBattle(battle, .05);
  assert.ok(foes[0].hp < foes[0].maxHp && foes[1].hp < foes[1].maxHp);
  assert.equal(foes[2].hp, foes[2].maxHp);
  assert.ok(friends[0].hp > before);
});

test('Morteiro de Pólen escala dano e cura por evolução mantendo a mesma mecânica', () => {
  const values: number[] = [], heals: number[] = [];
  for (const stage of [0, 1, 2]) {
    const { battle, attacker, friends, foes } = fixture('bulbasaur', 1, stage, 1);
    attacker.stats.spa = 90;
    friends[0].hp = 1;
    foes[0].maxHp = 4000; foes[0].hp = 4000; foes[0].stats.spd = 0;
    tickBattle(battle, .05);
    for (let i = 0; i < 13; i++) tickBattle(battle, .05);
    values.push(4000 - foes[0].hp);
    heals.push(friends[0].hp - 1);
  }
  assert.deepEqual(values, [77.25, 92.25, 114.75]);
  assert.ok(heals.every((value, i) => Math.abs(value - [52, 67, 87][i]) < 1), `cura inesperada: ${heals}`);
});

test('Squirtle canaliza Giro Aquático (SpA, duração, escudo) sem atacar ou andar durante o giro', () => {
  const { battle, attacker, foes } = fixture('squirtle', 2);
  attacker.stats.spa = 160;
  foes.forEach(u => { u.hp = u.maxHp = 5000; u.stats.spd = 0; });
  tickBattle(battle, .05);
  assert.equal(attacker.spinTime, 2.5);
  assert.equal(attacker.spinReduction, .2);
  assert.equal(attacker.animation?.name, 'Withdraw');
  for (let i = 0; i < 10; i++) tickBattle(battle, .05);
  assert.ok(foes.every(u => u.hp < 5000));
  assert.ok(attacker.spinTime > 0 && !attacker.moving);
  for (let i = 0; i < 40; i++) tickBattle(battle, .05);
  assert.equal(attacker.spinTime, 0);
  assert.equal(attacker.spinReduction, 0);
  assert.ok(battle.effects.every(fx => fx.kind !== 'water' || fx.duration > 0));
});

test('Golpe Flamejante escala com Atk (150/155/165%), é físico e ativa Hurt acima de 20%', () => {
  for (const [stage, ratio] of [1.5, 1.55, 1.65].entries()) {
    const { battle, attacker, foes } = fixture('charmander', 1, stage);
    attacker.stats.atk = 200;
    foes[0].stats.def = 0;
    foes[0].hp = foes[0].maxHp = 1000;
    tickBattle(battle, .05);
    assert.equal(foes[0].hp, 1000 - 200 * ratio * .75);
    assert.equal(attacker.animation?.name, 'Strike');
    assert.equal(foes[0].animation?.name, 'Hurt');
    assert.equal(attacker.metrics.physicalDealt, 200 * ratio * .75);
    assert.equal(attacker.metrics.specialDealt, 0);
  }
});

test('Pikachu atinge 1 alvo passivo até 2 casas e Raichu atinge 2 com coeficientes novos', () => {
  for (const stage of [0, 1]) {
    const { battle, attacker, foes } = fixture('pikachu', 4, stage);
    attacker.stats.spa = 100; attacker.range = 100;
    foes.forEach(u => { u.hp = u.maxHp = 1000; u.stats.spd = 0; });
    foes[0].x = 1; foes[1].x = 1.7; foes[2].x = 2.1; foes[3].x = 5;
    tickBattle(battle, .05);
    assert.equal(foes[0].hp, 1000 - (stage ? 130 : 120));
    assert.equal(foes[1].hp, 1000 - (stage ? 65 : 60));
    assert.equal(foes[2].hp, 1000 - (stage ? 65 : 0));
    assert.equal(foes[3].hp, 1000);
    assert.equal(battle.effects.filter(fx => fx.kind === 'lightning').length, stage ? 3 : 2);
  }
});

test('somente Bulbasaur é ranged; Walk controla o deslocamento dos outros', () => {
  assert.ok(SPECIES.bulbasaur.range > 2.5);
  assert.ok(SPECIES.charmander.range < 1 && SPECIES.squirtle.range < 1 && SPECIES.pikachu.range < 1);
  const { battle, attacker, foes } = fixture('charmander', 1);
  attacker.energy = 0; attacker.range = .94; foes[0].x = 5;
  tickBattle(battle, .1);
  assert.ok(attacker.moving);
  assert.ok(attacker.x > 0);
});
