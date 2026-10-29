import { BENCH_SIZE, BOARD_COLUMNS, BOARD_ROWS, calculateStats, EEVEE_BRANCHES, LEGENDARY_FAMILIES, PHASES, RULES, SHOP_FAMILIES, SHOP_SIZE, SPECIES } from './data';
import { rollFamily } from './shop';
import { battleMetrics, createBattleGroup, forceResolveBattle, survivors, tickBattle } from './systems/combat';
import { totalPower } from './formulas';
import { chapterForRound, roundTimers } from './chapter-timers';
import type { Battle, Family, GameCommand, GameSnapshot, GoldDrop, Phase, Player, Pokemon, ShopOffer, StageResult, Stats, UnitPosition, UnitVisualEvent } from './types';

class Rng {
  constructor(private seed: number) { this.seed ||= 1; }
  next(): number {
    let x = this.seed | 0;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.seed = x;
    return (x >>> 0) / 4294967296;
  }
  int(max: number): number { return Math.floor(this.next() * max); }
  pick<T>(items: T[]): T { return items[this.int(items.length)]; }
  shuffle<T>(items: T[]): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.int(i + 1); [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
}

const NAMES = ['VOCÊ', 'KAI', 'NOVA', 'LUNA', 'ASTRA', 'NIX', 'ECHO', 'ORION'];
const FAMILIES = SHOP_FAMILIES;
const currentStage = (round: number) => PHASES.stages[(round - 1) % PHASES.stagesPerChapter];
export function chapterDamage(chapter: number): number { return chapter + RULES.chapterBaseDamageOffset; }
export function streakIncome(streak: number): number {
  const bonuses = RULES.streakBonuses as Record<string, number>;
  return bonuses[String(Math.min(Math.abs(streak), Math.max(...Object.keys(bonuses).map(Number))))] || 0;
}
export function projectedIncome(player: Player): number {
  return RULES.baseIncome + Math.min(RULES.maxInterest, Math.floor(player.gold / RULES.interestEveryGold))
    + (player.roundVictory ? RULES.victoryIncome : 0) + streakIncome(player.streak);
}

export class GameEngine {
  private rng: Rng;
  private idCounter = 0;
  private serial = 0;
  private clock = 0;
  private duration = roundTimers(1).preparationSeconds;
  private phase: Phase = 'planning';
  private round = 1;
  private battles: Battle[] = [];
  private opponentId: string | null = null;
  private lastOpponentId: string | null = null;
  private visualEvents: UnitVisualEvent[] = [];
  private schedules: string[][][] = [];
  private encounterCounts = new Map<string, number>();
  private lastOpponents = new Set<string>();
  private log = '';
  private winnerId: string | null = null;
  private lastCombatStats: GameSnapshot['combatStats'] = {};
  private trainer = { x: -4.75, y: 3.57, targetX: -4.75, targetY: 3.57 };
  private savedCoins: GoldDrop[] = [];
  readonly players: Player[];

  constructor(seed = Date.now()) {
    this.rng = new Rng(seed);
    this.players = NAMES.slice(0, RULES.players).map((name, i) => ({
      id: `p${i}`, name, health: RULES.startingHealth, gold: RULES.startingGold, level: 1,
      units: [], shop: Array(SHOP_SIZE).fill(null), locked: false,
      eliminated: false, lastWin: false, streak: 0, roundVictory: false, history: [], placement: null
    }));
    this.players.forEach((player, i) => {
      const family = i === 0 ? 'bulbasaur' : this.rng.pick(FAMILIES.slice(0, 3));
      player.units.push(this.makePokemon(family, { area: 'board', col: i % 3 + 2, row: 1 }));
      this.refreshShop(player);
    });
    this.prepareMatchmaking();
  }

  private id(): string { return `u${++this.idCounter}`; }

  private makePokemon(family: Family, position: UnitPosition): Pokemon {
    const iv = Object.fromEntries((Object.keys(SPECIES[family].base) as Array<keyof Stats>)
      .map(stat => [stat, this.rng.int(101)])) as unknown as Stats;
    return { id: this.id(), family, stage: 0, level: 1, xp: 0, iv, position };
  }

  private levelForRound(): number {
    return RULES.levelMilestones.reduce((level, start, i) => this.round >= start ? i + 1 : level, 1);
  }

  private refreshShop(player: Player): void {
    player.shop = Array.from({ length: SHOP_SIZE }, () => {
      const { family, rarity } = rollFamily(player, () => this.rng.next());
      return { id: this.id(), family, rarity, price: rarity };
    });
  }

  private pairKey(a: string, b: string): string { return [a, b].sort().join(':'); }

  /** Três calendários completos possíveis, sorteados com chances iguais no começo da luta.
   * O custo desencoraja repetir um confronto antes de encontrar outros jogadores. */
  private prepareMatchmaking(): void {
    const active = this.players.filter(p => !p.eliminated).map(p => p.id);
    if (currentStage(this.round).type === 'bot' || currentStage(this.round).type === 'boss' || active.length < 2) {
      this.schedules = []; this.cachedMatchupOptions = null; return;
    }
    const quad = currentStage(this.round).type === 'quad';
    const groupSize = (remaining: number): number => {
      if (quad) return remaining === 5 || remaining === 6 || remaining === 3 ? 3 : remaining >= 4 ? 4 : 2;
      return remaining % 2 === 1 ? 3 : 2;
    };
    const pickCombos = (list: string[], n: number): string[][] => {
      if (n === 0) return [[]];
      return list.flatMap((id, i) => pickCombos(list.slice(i + 1), n - 1).map(tail => [id, ...tail]));
    };
    const partitions = (remaining: string[]): string[][][] => {
      if (!remaining.length) return [[]];
      const [first, ...rest] = remaining;
      const size = Math.min(remaining.length, groupSize(remaining.length));
      if (size < 2) return [];
      return pickCombos(rest, size - 1).flatMap(members => {
        const group = [first, ...members];
        const leftover = rest.filter(id => !members.includes(id));
        return partitions(leftover).map(tail => [group, ...tail]);
      });
    };
    const candidates = partitions(active);
    const pairs = (schedule: string[][]) => schedule.flatMap(group => group.flatMap((id, i) => group.slice(i + 1).map(other => this.pairKey(id, other))));
    const score = (schedule: string[][]) => pairs(schedule).reduce((total, key) => total + (this.encounterCounts.get(key) || 0) * RULES.matchmaking.repeatPenalty + (this.lastOpponents.has(key) ? RULES.matchmaking.recentRepeatPenalty : 0), 0);
    const chosen: string[][][] = [];
    while (chosen.length < RULES.matchmaking.options && candidates.length) {
      const rank = candidates.map((groups, i) => ({ groups, i, value: score(groups) + chosen.reduce((sum, prior) => {
        const seen = new Set(pairs(prior));
        return sum + pairs(groups).filter(key => seen.has(key)).length * RULES.matchmaking.repeatPenalty * 1.5;
      }, 0) + this.rng.next() * 12 })).sort((a, b) => a.value - b.value);
      const winner = rank[0];
      chosen.push(winner.groups);
      candidates.splice(winner.i, 1);
    }
    this.schedules = chosen.length ? Array.from({ length: RULES.matchmaking.options }, (_, i) => chosen[i % chosen.length]) : [];
    this.cachedMatchupOptions = null;
  }

  private cachedMatchupOptions: Record<string, string[][]> | null = null;
  private matchupOptions(): Record<string, string[][]> {
    if (this.cachedMatchupOptions) return this.cachedMatchupOptions;
    return this.cachedMatchupOptions = Object.fromEntries(this.players.map(player => [player.id, this.schedules.map(schedule => {
      const group = schedule.find(g => g.includes(player.id)) || [];
      return group.filter(id => id !== player.id);
    })]));
  }

  private findFreeBench(player: Player): number {
    for (let i = 0; i < BENCH_SIZE; i++) {
      if (!player.units.some(u => u.position.area === 'bench' && u.position.index === i)) return i;
    }
    return -1;
  }

  private merge(player: Player): void {
    let changed = true;
    while (changed) {
      changed = false;
      for (const family of FAMILIES) {
        if (family === 'eevee') {
          const eevees = player.units.filter(u => u.family === 'eevee');
          if (eevees.length >= 4) {
            if (player.id === 'p0') player.pendingEvolution = eevees.slice(0, 4).map(u => u.id);
            else this.chooseEevee(player, this.rng.pick(EEVEE_BRANCHES));
            if (player.id !== 'p0') changed = true;
          } else player.pendingEvolution = undefined;
          continue;
        }
        const maxStage = SPECIES[family].names.length - 1;
        for (let stage = 0; stage < maxStage; stage++) {
          const matches = player.units.filter(u => u.family === family && u.stage === stage);
          if (matches.length < 3) continue;
          const triple = matches.slice(0, 3);
          const anchor = triple.find(u => u.position.area === 'board') || triple[0];
          const iv = Object.fromEntries((Object.keys(anchor.iv) as Array<keyof Stats>).map(stat => [
            stat, Math.max(...triple.map(u => u.iv[stat]))
          ])) as unknown as Stats;
          player.units = player.units.filter(u => !triple.includes(u));
          const evolved: Pokemon = {
            id: this.id(), family, stage: stage + 1, iv,
            level: Math.max(...triple.map(u => u.level)),
            xp: Math.max(...triple.map(u => u.xp)), position: { ...anchor.position }
          };
          player.units.push(evolved);
          this.visualEvents.push({
            id: this.id(), unitId: evolved.id, ownerId: player.id, kind: 'evolve', age: 0,
            delay: triple.some(u => this.visualEvents.some(e => e.kind === 'summon' && e.unitId === u.id && e.age < .2)) ? .63 : 0,
            sources: triple.map(u => ({ id: u.id, family: u.family, stage: u.stage, level: u.level, position: { ...u.position } })),
            pokemon: { family: evolved.family, stage: evolved.stage, level: evolved.level, position: { ...evolved.position } }
          });
          if (player.id === 'p0') this.log = `${SPECIES[family].names[stage + 1]} evoluiu!`;
          changed = true;
          break;
        }
        if (changed) break;
      }
    }
  }

  private chooseEevee(player: Player, branch: Family): void {
    const four = player.units.filter(u => u.family === 'eevee').slice(0, 4);
    if (four.length !== 4) return;
    const anchor = four.find(u => u.position.area === 'board') || four[0];
    const iv = Object.fromEntries((Object.keys(anchor.iv) as Array<keyof Stats>).map(key =>
      [key, Math.max(...four.map(unit => unit.iv[key]))])) as Stats;
    player.units = player.units.filter(unit => !four.includes(unit));
    const evolved: Pokemon = { id:this.id(), family:branch, stage:1, iv,
      level:Math.max(...four.map(u => u.level)), xp:Math.max(...four.map(u => u.xp)), position:{...anchor.position} };
    player.units.push(evolved);
    player.pendingEvolution = undefined;
    this.visualEvents.push({ id:this.id(), unitId:evolved.id, ownerId:player.id, kind:'evolve', age:0,
      delay: four.some(u => this.visualEvents.some(e => e.kind === 'summon' && e.unitId === u.id && e.age < .2)) ? .63 : 0,
      sources:four.map(u => ({ id:u.id, family:u.family, stage:u.stage, level:u.level, position:{...u.position} })),
      pokemon:{ family:evolved.family, stage:evolved.stage, level:evolved.level, position:{...evolved.position} } });
    if (player.id === 'p0') this.log = `${SPECIES[branch].names[0]} evoluiu!`;
  }

  private buy(player: Player, slot: number): string | null {
    const offer = player.shop[slot];
    if (!offer) return 'Slot vazio';
    if (player.gold < offer.price) return 'Ouro insuficiente';
    const free = this.findFreeBench(player);
    const eligibleMerge = player.units.filter(u => u.family === offer.family && u.stage === 0).length >= (offer.family === 'eevee' ? 3 : 2);
    if (free < 0 && !eligibleMerge) return `Banco cheio (${BENCH_SIZE}/${BENCH_SIZE})`;
    player.gold -= offer.price;
    const bought = this.makePokemon(offer.family, { area: 'bench', index: free < 0 ? BENCH_SIZE : free });
    player.units.push(bought);
    player.shop[slot] = null;
    this.visualEvents.push({ id: this.id(), unitId: bought.id, ownerId: player.id, kind: 'summon', age: 0,
      pokemon: { family: bought.family, stage: bought.stage, level: bought.level, position: { ...bought.position } } });
    this.merge(player);
    return null;
  }

  /** Coordinates visible to the player; duels are mirrored when they spawn above. */
  private collectibleGold(): GoldDrop[] {
    const battle = this.battles.find(b => b.participants.includes('p0'));
    const flipped = !!battle && battle.participants.length === 2 && battle.playerB === 'p0';
    const live = this.phase === 'planning' || !battle ? [] : battle.goldDrops
      .filter(coin => coin.ownerId === 'p0' && !coin.claimed)
      .map(coin => ({ ...coin, y: flipped ? -coin.y : coin.y }));
    return [...this.savedCoins.filter(coin => !coin.claimed), ...live];
  }

  private tickTrainer(dt: number): void {
    const dx = this.trainer.targetX - this.trainer.x, dy = this.trainer.targetY - this.trainer.y;
    const length = Math.hypot(dx, dy);
    if (length > 0.001) {
      const distance = Math.min(length, 3.8 * dt);
      this.trainer.x += dx / length * distance;
      this.trainer.y += dy / length * distance;
    }
    for (const coin of this.collectibleGold()) {
      if (Math.hypot(this.trainer.x - coin.x, this.trainer.y - coin.y) > 0.36) continue;
      const original = this.savedCoins.find(saved => saved.id === coin.id)
        || this.battles.flatMap(b => b.goldDrops).find(drop => drop.id === coin.id);
      if (original && !original.claimed) {
        original.claimed = true;
        this.players[0].gold += RULES.goldDropPerKnockout;
      }
    }
  }

  private fuseFinalForms(player: Player, source: Pokemon, target: Pokemon): boolean {
    if (source.id === target.id || source.family !== target.family || source.stage !== target.stage) return false;
    if (source.family === 'eevee' || source.stage < SPECIES[source.family].names.length - 1) return false;
    const stronger = source.level > target.level ? source : target;
    const consumed = stronger.id === source.id ? target : source;
    const where = { ...target.position };
    const sources = [source, target].map(unit => ({ id: unit.id, family: unit.family, stage: unit.stage, level: unit.level, position: { ...unit.position } }));
    player.units = player.units.filter(unit => unit.id !== consumed.id);
    stronger.position = where;
    stronger.level = Math.min(RULES.maxPokemonLevel, stronger.level + 5);
    stronger.xp = Math.max(stronger.xp, stronger.level - 1);
    this.visualEvents.push({ id: this.id(), unitId: stronger.id, ownerId: player.id, kind: 'fusion', age: 0, sources,
      pokemon: { family: stronger.family, stage: stronger.stage, level: stronger.level, position: { ...stronger.position } } });
    if (player.id === 'p0') this.log = `${SPECIES[stronger.family].names[Math.min(stronger.stage, SPECIES[stronger.family].names.length - 1)]} • +5 níveis pela fusão!`;
    return true;
  }

  command(command: GameCommand): string | null {
    const human = this.players[0];
    if (human.eliminated || this.phase === 'finished') return 'A partida já terminou para você';
    if (command.kind === 'move-trainer') {
      if (!Number.isFinite(command.x) || !Number.isFinite(command.y)) return 'Destino inválido';
      this.trainer.targetX = Math.max(-10, Math.min(10, command.x));
      this.trainer.targetY = Math.max(-4.5, Math.min(4.65, command.y));
      return null;
    }
    if (command.kind === 'choose-eevee') {
      if (!EEVEE_BRANCHES.includes(command.branch)) return 'Evolução inválida';
      const ids = human.pendingEvolution;
      if (!ids || ids.length !== 4 || ids.some(id => !human.units.some(u => u.id === id && u.family === 'eevee'))) return 'Reúna quatro Eevee para evoluir';
      this.chooseEevee(human, command.branch);
      this.merge(human);
      return null;
    }
    if (command.kind === 'buy') {
      if (!Number.isInteger(command.slot) || command.slot < 0 || command.slot >= SHOP_SIZE) return 'Slot inválido';
      return this.buy(human, command.slot);
    }
    if (command.kind === 'reroll') {
      if (human.gold < RULES.rerollCost) return 'Ouro insuficiente';
      human.gold -= RULES.rerollCost;
      this.refreshShop(human);
      return null;
    }
    if (command.kind === 'lock') { human.locked = !human.locked; return null; }
    const unit = human.units.find(u => u.id === command.unitId);
    if (!unit) return 'Pokémon não encontrado';
    if (this.phase !== 'planning' && unit.position.area === 'board') return 'Pokémon em campo não pode ser movido durante o combate';
    if (command.kind === 'sell') {
      human.gold += SPECIES[unit.family].rarity * (SPECIES[unit.family].eeveeBranch ? 4 : 3 ** unit.stage);
      human.units = human.units.filter(u => u.id !== unit.id);
      if (human.pendingEvolution?.includes(unit.id)) this.merge(human);
      return null;
    }
    if (command.kind === 'move') {
      const target = command.position;
      if (this.phase !== 'planning' && target.area === 'board') return 'Você só pode reorganizar o banco durante o combate';
      if (target.area === 'board') {
        if (!Number.isInteger(target.col) || !Number.isInteger(target.row) || target.col < 0 || target.col >= BOARD_COLUMNS || target.row < 0 || target.row >= BOARD_ROWS) return 'Hexágono inválido';
        const deployed = human.units.filter(u => u.position.area === 'board').length;
        if (unit.position.area !== 'board' && deployed >= human.level && !human.units.some(u => u.position.area === 'board' && u.position.col === target.col && u.position.row === target.row)) return `Limite de equipe: ${human.level}`;
      } else if (!Number.isInteger(target.index) || target.index < 0 || target.index >= BENCH_SIZE) return 'Banco inválido';
      const displaced = human.units.find(u => u.id !== unit.id && samePosition(u.position, target));
      if (displaced && this.fuseFinalForms(human, unit, displaced)) return null;
      const old = unit.position;
      unit.position = { ...target };
      if (displaced) displaced.position = { ...old };
      return null;
    }
    return null;
  }

  private runCPU(player: Player): void {
    if (player.eliminated) return;
    const available = player.shop
      .map((offer, i) => ({ offer, i }))
      .filter((entry): entry is { offer: ShopOffer; i: number } => !!entry.offer && entry.offer.price <= player.gold)
      .sort((a, b) => {
        const aCopies = player.units.filter(u => u.family === a.offer.family).length;
        const bCopies = player.units.filter(u => u.family === b.offer.family).length;
        return (bCopies * 3 + b.offer.price) - (aCopies * 3 + a.offer.price);
      });
    let purchases = Math.min(3, available.length);
    for (const item of available) {
      if (purchases <= 0 || player.gold < item.offer.price) break;
      if (player.gold < 2 && player.units.length >= player.level) break;
      if (this.buy(player, item.i) === null) purchases--;
    }
    // Deploy the strongest available units; the same positional rules apply to CPUs.
    const favorites = [...player.units].sort((a, b) => {
      const score = (u: Pokemon) => {
        const stats = calculateStats(u.family, u.level, u.iv, u.stage);
        return u.stage * 500 + totalPower(stats) + SPECIES[u.family].rarity * 15;
      };
      return score(b) - score(a);
    });
    const fielded = favorites.slice(0, player.level);
    const remaining = favorites.slice(player.level);
    fielded.forEach((u, i) => {
      const front = u.family === 'bulbasaur' || u.family === 'squirtle';
      u.position = { area: 'board', col: [3, 2, 4, 1, 5, 0, 6][i], row: front ? 0 : Math.min(3, 2 + Math.floor(i / 4)) };
    });
    remaining.slice(0, BENCH_SIZE).forEach((u, index) => { u.position = { area: 'bench', index }; });
    // AI does not have access to extra bench capacity.
    if (remaining.length > BENCH_SIZE) {
      const extra = new Set(remaining.slice(BENCH_SIZE).map(u => u.id));
      player.units = player.units.filter(u => !extra.has(u.id));
    }
  }

  private createNPC(player: Player, kind: 'bot' | 'boss', legendary: Family | null): Player {
    const chapter = chapterForRound(this.round);
    const isBoss = kind === 'boss';
    const size = isBoss ? 1 : Math.min(PHASES.bot.maxUnits, 1 + (chapter - 1) * PHASES.bot.extraUnitsEveryChapter);
    const level = isBoss ? chapter * PHASES.boss.levelPerChapter : PHASES.bot.baseLevel + (chapter - 1) * PHASES.bot.levelsPerChapter;
    const ivValue = isBoss ? chapter === 1 ? PHASES.boss.firstChapterIv : chapter === 2 ? PHASES.boss.secondChapterIv : PHASES.boss.laterChapterIv : PHASES.bot.iv;
    const units = Array.from({ length: size }, (_, i) => {
      const family = isBoss ? legendary! : this.rng.pick(FAMILIES);
      const pokemon = this.makePokemon(family, { area: 'board', col: [3, 2, 4, 1, 5, 0][i], row: i % 2 });
      pokemon.level = level;
      pokemon.iv = Object.fromEntries(Object.keys(pokemon.iv).map(stat => [stat, ivValue])) as Stats;
      return pokemon;
    });
    return {
      id: `bot:${player.id}`, name: isBoss ? SPECIES[legendary!].names[0] : `BOT ${chapter}`,
      health: 100, gold: 0, level: size, units, shop: [], locked: false,
      eliminated: false, lastWin: false, streak: 0, roundVictory: false, history: [], placement: null
    };
  }

  private startCombat(): void {
    this.phase = 'combat'; this.clock = 0; this.duration = roundTimers(this.round).combatSeconds;
    const stage = currentStage(this.round);
    const alive = this.players.filter(p => !p.eliminated);
    this.battles = [];
    this.opponentId = null;
    if (stage.type === 'bot' || stage.type === 'boss') {
      const legendary = stage.type === 'boss' ? this.rng.pick(LEGENDARY_FAMILIES) : null;
      alive.forEach((player, i) => this.battles.push(createBattleGroup(
        [player, this.createNPC(player, stage.type as 'bot' | 'boss', legendary)], `r${this.round}:${i}`, stage.type
      )));
      this.opponentId = 'bot:p0'; this.lastOpponentId = this.opponentId;
      this.log = stage.type === 'boss' ? `CHEFE • ${SPECIES[legendary!].names[0]}` : 'BATALHA PvE • TREINADORES BOT';
      return;
    }
    if (!this.schedules.length) this.prepareMatchmaking();
    const selected = this.schedules[this.rng.int(this.schedules.length)] || [];
    this.lastOpponents.clear();
    selected.forEach((ids, i) => {
      const group = ids.map(id => alive.find(p => p.id === id)).filter((p): p is Player => !!p);
      if (group.length < 2) return;
      this.battles.push(createBattleGroup(group, `r${this.round}:${i}`, stage.type));
      if (group.some(p => p.id === 'p0')) this.opponentId = group.find(p => p.id !== 'p0')?.id || null;
      ids.forEach((id, index) => ids.slice(index + 1).forEach(other => {
        const key = this.pairKey(id, other);
        this.encounterCounts.set(key, (this.encounterCounts.get(key) || 0) + 1);
        this.lastOpponents.add(key);
      }));
    });
    if (this.opponentId) this.lastOpponentId = this.opponentId;
    this.log = `${stage.name} • ${this.opponentId ? this.players.find(p => p.id === this.opponentId)?.name || '' : ''}`;
  }

  private recordResult(player: Player, result: StageResult): void {
    player.history[this.round - 1] = result;
    player.roundVictory = result === 'win';
    if (result === 'win') { player.lastWin = true; player.streak = player.streak > 0 ? player.streak + 1 : 1; }
    else if (result === 'loss' || result === 'fourth') {
      player.lastWin = false; player.streak = player.streak < 0 ? player.streak - 1 : -1;
    }
    // 2nd/3rd in a 4-player round: no +1 for victory and no change to either streak.
  }

  private finishCombat(): void {
    this.phase = 'result'; this.clock = 0; this.duration = RULES.resultSeconds;
    this.lastCombatStats = {};
    const beforeDamage = new Map(this.players.map(p => [p.id, p.health]));
    const stage = currentStage(this.round);
    for (const battle of this.battles) {
      forceResolveBattle(battle);
      Object.assign(this.lastCombatStats, battleMetrics(battle));
      const winnerId = battle.rankings[0];
      const quad = stage.type === 'quad' && battle.participants.length >= 3;
      battle.rankings.forEach((id, index) => {
        const player = this.players.find(p => p.id === id);
        if (!player) return;
        const place = index + 1;
        const result: StageResult = place === 1 ? 'win' : quad ? place === 2 ? 'second' : place === 3 ? 'third' : 'fourth' : 'loss';
        this.recordResult(player, result);
        if (place === 1) {
          if (stage.type === 'gold') player.gold += RULES.goldRoundWinnerBonus;
          return;
        }
        let damage = chapterDamage(chapterForRound(this.round));
        if (quad) {
          damage += RULES.quadPlacementExtraDamage[String(place) as keyof typeof RULES.quadPlacementExtraDamage] || 0;
        } else {
          damage += survivors(battle, winnerId) * RULES.survivingUnitDamage;
          if (stage.type === 'double') damage *= RULES.doubleDamageMultiplier;
        }
        player.health = Math.max(0, player.health - damage);
        if (player.id === 'p0') this.log = `${stage.name} • ${quad ? `${place}º lugar` : 'Derrota'} • -${damage} de vida`;
      });
      if (winnerId === 'p0') this.log = stage.type === 'gold' ? `Vitória • +${RULES.goldRoundWinnerBonus} ouro bônus` : `Vitória • ${stage.name}`;
      // CPUs collect automatically; the human trainer must physically reach their coins.
      for (const coin of battle.goldDrops) {
        const cpu = this.players.find(p => p.id === coin.ownerId && p.id !== 'p0');
        if (cpu && !coin.claimed) { cpu.gold += RULES.goldDropPerKnockout; coin.claimed = true; }
      }
    }
    // Simultaneous eliminations should not erase the match champion.
    if (this.players.every(p => p.eliminated || p.health <= 0)) {
      const survivor = [...this.players].filter(p => !p.eliminated).sort((a, b) => (beforeDamage.get(b.id) || 0) - (beforeDamage.get(a.id) || 0))[0];
      if (survivor) survivor.health = 1;
    }
    // Emit the actual post-clamp, post-champion-correction damage once per affected trainer.
    for (const player of this.players) {
      const amount = (beforeDamage.get(player.id) || 0) - player.health;
      if (amount <= 0) continue;
      const battle = this.battles.find(b => b.participants.includes(player.id));
      if (!battle) continue;
      this.visualEvents.push({ id: this.id(), kind: 'trainer-damage', unitId: player.id,
        ownerId: player.id, battleId: battle.id, age: 0, value: amount });
    }
    for (const p of this.players) if (!p.eliminated && p.health === 0) p.eliminated = true;
    const eliminated = this.players.filter(p => p.eliminated && p.placement === null)
      .sort((a, b) => (beforeDamage.get(a.id) || 0) - (beforeDamage.get(b.id) || 0));
    for (const p of eliminated) p.placement = this.players.filter(q => q.placement === null).length;
    for (const p of this.players) {
      for (const unit of p.units) {
        unit.xp += unit.position.area === 'board' ? RULES.pokemonExperience.activePerBattle : RULES.pokemonExperience.benchPerBattle;
        unit.level = Math.min(RULES.maxPokemonLevel, 1 + unit.xp);
      }
    }
    const surviving = this.players.filter(p => !p.eliminated);
    if (surviving.length === 1) {
      this.winnerId = surviving[0].id;
      surviving[0].placement = 1;
      this.phase = 'finished'; this.duration = 0;
      this.log = surviving[0].id === 'p0' ? 'VITÓRIA' : `${surviving[0].name} VENCEU`;
    }
  }

  private nextRound(): void {
    const recent = this.battles.find(b => b.participants.includes('p0'));
    if (recent) {
      const flipped = recent.participants.length === 2 && recent.playerB === 'p0';
      this.savedCoins.push(...recent.goldDrops.filter(c => c.ownerId === 'p0' && !c.claimed)
        .map(c => ({ ...c, y: flipped ? -c.y : c.y })));
    }
    this.savedCoins = this.savedCoins.filter(c => !c.claimed);
    this.round++;
    this.phase = 'planning'; this.clock = 0; this.duration = roundTimers(this.round).preparationSeconds;
    for (const p of this.players) {
      if (p.eliminated) continue;
      p.gold += projectedIncome(p);
      p.roundVictory = false;
      p.level = this.levelForRound();
      if (!p.locked) this.refreshShop(p);
      if (p.id !== 'p0') this.runCPU(p);
    }
    this.prepareMatchmaking();
    this.log = `Preparação • Rodada ${this.round}`;
  }

  tick(dt: number): void {
    if (this.phase === 'finished') return;
    const step = Math.max(0, Math.min(0.1, dt));
    this.tickTrainer(step);
    for (const animation of this.visualEvents) animation.age += step;
    this.visualEvents = this.visualEvents.filter(animation => animation.age < 1.7);
    this.clock += step;
    if (this.phase === 'planning' && this.clock >= this.duration) this.startCombat();
    else if (this.phase === 'combat') {
      const accelerated = this.clock >= roundTimers(this.round).combatSeconds;
      for (const battle of this.battles) tickBattle(battle, accelerated ? step * RULES.combatAcceleration : step);
      // Last-resort resolution prevents regeneration stalemates, without truncating normal fights at 30s.
      if (this.clock >= roundTimers(this.round).safetySeconds) this.battles.forEach(forceResolveBattle);
      if (this.battles.every(b => b.resolved && b.outcomeElapsed >= 1.5)) this.finishCombat();
    } else if (this.phase === 'result' && this.clock >= this.duration) this.nextRound();
  }

  snapshot(observedId = 'p0'): GameSnapshot {
    const watched = this.players.some(p => p.id === observedId) ? observedId : 'p0';
    const battle = this.battles.find(b => b.participants.includes(watched)) || null;
    const stats = battle ? battleMetrics(battle) : this.lastCombatStats;
    return {
      serial: ++this.serial, phase: this.phase, phaseSeconds: this.duration,
      timeLeft: Math.max(0, this.duration - this.clock), round: this.round,
      chapter: chapterForRound(this.round),
      stage: ((this.round - 1) % PHASES.stagesPerChapter) + 1,
      stageType: currentStage(this.round).type,
      stageName: currentStage(this.round).name,
      accelerated: this.phase === 'combat' && this.clock >= roundTimers(this.round).combatSeconds,
      observedId: watched,
      players: this.players.map(p => ({
        ...p, units: p.units.map(u => ({ ...u, iv: { ...u.iv }, position: { ...u.position } })),
        shop: p.id === 'p0' ? p.shop.map(offer => offer && { ...offer }) : []
      })),
      opponentId: this.phase === 'planning' ? null : this.opponentId,
      lastOpponentId: this.lastOpponentId,
      visualEvents: this.visualEvents.filter(a => a.ownerId === watched || a.ownerId === 'p0' || (a.kind === 'trainer-damage' && a.battleId === battle?.id)).map(a => ({ ...a })),
      possibleOpponents: this.phase === 'planning' ? this.matchupOptions() : {},
      // postMessage performs the one structured clone at the worker boundary.
      visibleBattle: battle,
      combatStats: stats,
      battleStatuses: this.phase === 'combat' || this.phase === 'result'
        ? Object.fromEntries(this.players.map(p => {
          const game = this.battles.find(b => b.participants.includes(p.id));
          if (!game) return [p.id,null];
          if (!game.resolved) return [p.id,'battling'];
          // An all-knockout tie never fabricates a victory in the sidebar.
          const actualWinner = game.units.some(u => u.playerId === game.winner && u.hp > 0) ? game.winner : null;
          return [p.id, actualWinner ? (p.id === actualWinner ? 'victorious' : 'defeated') : null];
        })) : {},
      log: this.log, winnerId: this.winnerId,
      trainer: { ...this.trainer }, collectibleGold: this.collectibleGold()
    };
  }
}

function samePosition(a: UnitPosition, b: UnitPosition): boolean {
  return a.area === b.area && (a.area === 'board'
    ? b.area === 'board' && a.col === b.col && a.row === b.row
    : b.area === 'bench' && a.index === b.index);
}
