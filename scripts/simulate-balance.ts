/** Relatório determinístico do balanceamento inicial; não modifica números do jogo. */
import { GameEngine } from '../server/engine';
import { SHOP_FAMILIES, SPECIES } from '../server/data';
import { createBattle, forceResolveBattle, tickBattle } from '../server/systems/combat';
import type { Family, Pokemon, Stats } from '../server/types';

const iv: Stats = { hp: 50, atk: 50, def: 50, spa: 50, spd: 50, speed: 50 };
const unit = (family: Family, stage: number, id: string, col = 3): Pokemon => ({
  id, family, stage, level: 1, xp: 0, iv: { ...iv }, position: { area: 'board', col, row: 1 }
});
type Tally = { fights: number; win: number; dps: number; seconds: number; casts: number; heal: number; barrier: number; control: number };
const fresh = (): Tally => ({ fights: 0, win: 0, dps: 0, seconds: 0, casts: 0, heal: 0, barrier: 0, control: 0 });
const game = new GameEngine(484);
function simulate(teamA: Array<[Family, number]>, teamB: Array<[Family, number]>) {
  for (const [team, player] of [[teamA, game.players[0]], [teamB, game.players[1]]] as const) {
    player.units = team.map(([family, stage], i) => unit(family, stage, `${player.id}:${i}`, 2 + i));
  }
  const battle = createBattle(game.players[0], game.players[1], 'simulation');
  battle.introElapsed = 1.5;
  for (let i = 0; i < 600 && !battle.resolved; i++) tickBattle(battle, .05);
  if (!battle.resolved) forceResolveBattle(battle);
  return battle;
}
const report = [];
for (const evolved of [false, true]) {
  const totals = Object.fromEntries(SHOP_FAMILIES.map(f => [f, fresh()])) as Record<Family, Tally>;
  for (const a of SHOP_FAMILIES) for (const b of SHOP_FAMILIES) {
    for (const swapped of [false, true]) {
      const stageA = evolved ? SPECIES[a].names.length - 1 : 0;
      const stageB = evolved ? SPECIES[b].names.length - 1 : 0;
      const battle = swapped ? simulate([[b,stageB]], [[a,stageA]]) : simulate([[a,stageA]], [[b,stageB]]);
      const side = swapped ? 'p1' : 'p0', source = battle.units.find(u => u.playerId === side)!;
      const tally = totals[a];
      tally.fights++;
      tally.win += battle.winner === side ? 1 : 0;
      tally.seconds += battle.elapsed;
      tally.dps += source.metrics.dealt / Math.max(0.05, battle.elapsed);
      tally.casts += source.metrics.casts;
      tally.heal += source.metrics.healed;
      tally.barrier += source.metrics.barrierAbsorbed;
      tally.control += source.metrics.controlSeconds;
    }
  }
  for (const family of SHOP_FAMILIES) {
    const t = totals[family];
    report.push({ phase: evolved ? 'Evolução final' : 'Forma inicial', family,
      rarity: SPECIES[family].rarity,
      winPct: +(100 * t.win / t.fights).toFixed(1),
      dps: +(t.dps / t.fights).toFixed(1),
      duration: +(t.seconds / t.fights).toFixed(1),
      casts: +(t.casts / t.fights).toFixed(2),
      healed: +(t.heal / t.fights).toFixed(1),
      barrier: +(t.barrier / t.fights).toFixed(1),
      control: +(t.control / t.fights).toFixed(2)
    });
  }
}
console.log('Duelo 1v1 de todos contra todos, incluindo lados invertidos (IV 50, nível 1):');
console.table(report);
const teams: Array<[string, Array<[Family,number]>, Array<[Family,number]>]> = [
  ['Tanque + cura vs dois atacantes', [['squirtle',2],['caterpie',2]], [['weedle',2],['pikachu',1]]],
  ['Tanque + veneno vs dois ofensivos', [['koffing',1],['caterpie',1]], [['charmander',2],['bulbasaur',2]]],
  ['Controle + suporte vs ataque rápido', [['snorlax',0],['caterpie',2]], [['pikachu',1],['weedle',2]]],
  ['Área vs dois corpo a corpo', [['bulbasaur',2],['koffing',1]], [['charmander',2],['squirtle',2]]]
];
console.log('Confrontos 2v2 (lados invertidos):');
console.table(teams.map(([match, a, b]) => {
  const first = simulate(a,b), second = simulate(b,a);
  return { match, vitóriasEquipeA: Number(first.winner === 'p0') + Number(second.winner === 'p1'),
    duraçãoMédia: +((first.elapsed + second.elapsed)/2).toFixed(1),
    curaEquipeA: +(first.units.filter(u=>u.playerId==='p0').reduce((n,u)=>n+u.metrics.healed,0)).toFixed(1),
    controleEquipeA: +(first.units.filter(u=>u.playerId==='p0').reduce((n,u)=>n+u.metrics.controlSeconds,0)).toFixed(1) };
}));
