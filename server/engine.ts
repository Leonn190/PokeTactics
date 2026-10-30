import { applyPokemonAugments, applyEvolutionAugments, addLevels, battleExperience, chapterPayment, hasAugment, immediateAugment, interestCap, nextTrainerLevel, offerAugments, purchasedPokemon, rerollAugment, startedPreparation, tierParam } from './systems/augments';
import { inventoryUsed,canReceive } from './systems/inventory';
import { BENCH_SIZE, BOARD_COLUMNS, BOARD_ROWS, calculateStats, EEVEE_BRANCHES, LEGENDARY_FAMILIES, PHASES, RULES, SHOP_FAMILIES, SHOP_SIZE, SPECIES, evolutionCopies } from './data';
import { rollFamily } from './shop';
import { battleMetrics, createBattleGroup, forceResolveBattle, survivors, tickBattle } from './systems/combat';
import { totalPower } from './formulas';
import { craft, makeComponent, ITEM_COLORS, ITEMS } from './systems/items';
import { LOOT, eligibleForLoot, rollColor, rollReward } from './systems/loot';
import { chapterForRound, roundTimers } from './chapter-timers';
import type { Battle, Family, GameCommand, GameSnapshot, GoldDrop, LootDrop, LootReward, BallKind, Phase, Player, Pokemon, ShopOffer, StageResult, Stats, UnitPosition, UnitVisualEvent } from './types';

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
  return RULES.baseIncome + Math.min(interestCap(player.augments||[]), Math.floor(player.gold / RULES.interestEveryGold))
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
  private savedLoot: LootDrop[] = [];
  private lootMessage = '';
  private lootMessageId = '';
  readonly players: Player[];

  constructor(seed = Date.now()) {
    this.rng = new Rng(seed);
    this.players = NAMES.slice(0, RULES.players).map((name, i) => ({
      id: `p${i}`, name, health: RULES.startingHealth, gold: RULES.startingGold, level: 1,
      units: [], shop: Array(SHOP_SIZE).fill(null), locked: false, itemInventory: [],
      consumables: { pokeball:0,greatball:0,ultraball:0,masterball:0 },
      eliminated: false, lastWin: false, streak: 0, roundVictory: false, history: [], placement: null
    }));
    this.players.forEach((player, i) => {
      const family = i === 0 ? 'bulbasaur' : this.rng.pick(FAMILIES.slice(0, 3));
      player.units.push(this.makePokemon(family, { area: 'board', col: i % 3 + 2, row: 1 }));
      this.refreshShop(player);
    });
    this.startAugmentChapter(1);
    this.prepareMatchmaking();
  }

  private startAugmentChapter(chapter:number):void {
    for(const player of this.players){
      if(player.eliminated||player.augmentChoice?.chapter===chapter)continue;
      player.currentRound=this.round;
      player.augmentChoice=offerAugments(player,chapter,()=>this.rng.next());
      if(player.id!=='p0')this.chooseAugment(player,this.rng.int(3));
    }
  }
  private chooseAugment(player:Player,slot:number):string|null {
    const choice=player.augmentChoice;
    if(!choice||choice.status!=='pending'||!Number.isInteger(slot)||slot<0||slot>=3)return 'Escolha de aprimoramento indisponível';
    const id=choice.offers[slot];
    if(!id||player.augments?.includes(id))return 'Aprimoramento inválido';
    choice.status='chosen';choice.selected=id;
    (player.augments||=[]).push(id);
    (player.augmentChosenChapters||={})[id]=choice.chapter;
    immediateAugment(player,id,choice.chapter,()=>this.rng.next(),()=>this.id());
    if(id==='B10'||id==='S10'||id==='G10'||id==='P10')
      for(const unit of player.units)applyPokemonAugments(player,unit,choice.chapter);
    if(id==='P11')this.merge(player);
    if(id==='B02') {
      player.augmentCounters||={};
      player.augmentCounters['B02:preparations']=0;
      startedPreparation(player);
    }
    player.level=Math.max(player.level,nextTrainerLevel(this.round,player.augments||[]));
    return null;
  }
  private id(): string { return `u${++this.idCounter}`; }

  private makePokemon(family: Family, position: UnitPosition): Pokemon {
    const iv = Object.fromEntries((Object.keys(SPECIES[family].base) as Array<keyof Stats>)
      .map(stat => [stat, this.rng.int(101)])) as unknown as Stats;
    return { id: this.id(), family, stage: 0, level: 1, xp: 0, iv, position, equipment: [], acquiredChapter:chapterForRound(this.round), appliedAugments:[] };
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
        if (family === 'scyther') {
          const scythers=player.units.filter(u=>u.family==='scyther');
          const needed=evolutionCopies('scyther',0,hasAugment(player,'P11'));
          if(scythers.length>=needed && !player.pendingEvolution){
            if(player.id==='p0'){player.pendingEvolution=scythers.slice(0,needed).map(u=>u.id);player.pendingEvolutionKind='scyther';}
            else {this.chooseEevee(player,this.rng.pick(['scizor','kleavor']));changed=true;}
          }
          continue;
        }
        if (family === 'tyrogue') {
          const babies=player.units.filter(u=>u.family==='tyrogue' && u.stage===0);
          const needed=evolutionCopies('tyrogue',0,hasAugment(player,'P11'));
          if(babies.length>=needed){
            if(player.id==='p0' && !player.pendingEvolution){player.pendingEvolution=babies.slice(0,needed).map(u=>u.id);player.pendingEvolutionKind='tyrogue';}
            else if(player.id!=='p0'){this.chooseEevee(player,this.rng.pick(['hitmonchan','hitmonlee']));changed=true;}
          }else if(player.pendingEvolutionKind==='tyrogue'){player.pendingEvolution=undefined;player.pendingEvolutionKind=undefined;}
          continue;
        }
        if (family === 'eevee') {
          const eevees = player.units.filter(u => u.family === 'eevee');
          const needed=evolutionCopies('eevee',0,hasAugment(player,'P11'));
          if (eevees.length >= needed) {
            if (player.id === 'p0' && !player.pendingEvolution){player.pendingEvolution = eevees.slice(0, needed).map(u => u.id);player.pendingEvolutionKind='eevee';}
            else this.chooseEevee(player, this.rng.pick(EEVEE_BRANCHES));
            if (player.id !== 'p0') changed = true;
          } else if(player.pendingEvolutionKind==='eevee'){player.pendingEvolution=undefined;player.pendingEvolutionKind=undefined;}
          continue;
        }
        const babyDestination=SPECIES[family].babyEvolution;
        if(babyDestination){
          const matches=player.units.filter(u=>u.family===family&&u.stage===0);
          const required=evolutionCopies(family,0,hasAugment(player,'P11'));
          if(matches.length>=required){
            const sources=matches.slice(0,required);
            const anchor=sources.find(u=>u.position.area==='board')||sources[0];
            player.units=player.units.filter(u=>!sources.includes(u));
            const iv=Object.fromEntries((Object.keys(anchor.iv) as Array<keyof Stats>).map(stat=>[stat,RULES.baby.perfectEvolutionIV])) as Stats;
            const evolved:Pokemon={id:this.id(),family:babyDestination,stage:0,iv,
              level:Math.max(...sources.map(u=>u.level)),xp:Math.max(...sources.map(u=>u.xp)),position:{...anchor.position}};
            evolved.equipment=this.preserveEquipment(player,sources);
            evolved.acquiredChapter=Math.min(...sources.map(u=>u.acquiredChapter||1));
            evolved.appliedAugments=[...new Set(sources.flatMap(u=>u.appliedAugments||[]))];
            applyEvolutionAugments(player,evolved,chapterForRound(this.round));
            player.units.push(evolved);
            this.visualEvents.push({id:this.id(),unitId:evolved.id,ownerId:player.id,kind:'evolve',age:0,
              sources:sources.map(u=>({id:u.id,family:u.family,stage:u.stage,level:u.level,position:{...u.position}})),
              pokemon:{family:evolved.family,stage:0,level:evolved.level,position:{...evolved.position}}});
            if(player.id==='p0')this.log=`${SPECIES[babyDestination].names[0]} nasceu com IV 100!`;
            changed=true;
          }
          if(changed)break;
          continue;
        }
        const maxStage = SPECIES[family].names.length - 1;
        for (let stage = 0; stage < maxStage; stage++) {
          const matches = player.units.filter(u => u.family === family && u.stage === stage);
          const required=evolutionCopies(family,stage,hasAugment(player,'P11'));
          if (matches.length < required) continue;
          const triple = matches.slice(0, required);
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
          evolved.equipment = this.preserveEquipment(player, triple);
          evolved.acquiredChapter=Math.min(...triple.map(u=>u.acquiredChapter||1));
          evolved.appliedAugments=[...new Set(triple.flatMap(u=>u.appliedAugments||[]))];
          applyEvolutionAugments(player,evolved,chapterForRound(this.round));
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
    const family=branch==='hitmonchan'||branch==='hitmonlee'?'tyrogue':branch==='scizor'||branch==='kleavor'?'scyther':'eevee';
    const needed=evolutionCopies(family,0,hasAugment(player,'P11'));
    const four = player.units.filter(u => u.family === family).slice(0, needed);
    if (four.length !== needed) return;
    const anchor = four.find(u => u.position.area === 'board') || four[0];
    const iv = Object.fromEntries((Object.keys(anchor.iv) as Array<keyof Stats>).map(key =>
      [key, family==='tyrogue' ? RULES.baby.perfectEvolutionIV : Math.max(...four.map(unit => unit.iv[key]))])) as Stats;
    player.units = player.units.filter(unit => !four.includes(unit));
    const evolved: Pokemon = { id:this.id(), family:branch, stage:family==='scyther'||family==='tyrogue'?0:1, iv,
      level:Math.max(...four.map(u => u.level)), xp:Math.max(...four.map(u => u.xp)), position:{...anchor.position} };
    evolved.equipment = this.preserveEquipment(player,four);
    evolved.acquiredChapter=Math.min(...four.map(u=>u.acquiredChapter||1));
    evolved.appliedAugments=[...new Set(four.flatMap(u=>u.appliedAugments||[]))];
    applyEvolutionAugments(player,evolved,chapterForRound(this.round));
    player.units.push(evolved);
    player.pendingEvolution = undefined;player.pendingEvolutionKind=undefined;
    this.visualEvents.push({ id:this.id(), unitId:evolved.id, ownerId:player.id, kind:'evolve', age:0,
      delay: four.some(u => this.visualEvents.some(e => e.kind === 'summon' && e.unitId === u.id && e.age < .2)) ? .63 : 0,
      sources:four.map(u => ({ id:u.id, family:u.family, stage:u.stage, level:u.level, position:{...u.position} })),
      pokemon:{ family:evolved.family, stage:evolved.stage, level:evolved.level, position:{...evolved.position} } });
    if (player.id === 'p0') this.log = `${SPECIES[branch].names[0]} evoluiu!`;
  }

  private releasePendingItems(player:Player):void {
    const pending=player.pendingItems;
    if(!pending?.length)return;
    player.itemInventory ||= [];
    while(pending.length&&canReceive(player,1))player.itemInventory.push(pending.shift()!);
  }

  private preserveEquipment(player: Player, sources: Pokemon[]): Pokemon['equipment'] {
    const items = sources.flatMap(source => source.equipment || []);
    const kept = items.slice(0, ITEMS.maxSlots);
    player.itemInventory ||= [];
    for(const item of items.slice(ITEMS.maxSlots)){
      if(canReceive(player,1))player.itemInventory.push(item);
      else (player.pendingItems ||= []).push(item);
    }
    return kept;
  }

  private freePlaceForReward(player: Player): UnitPosition | null {
    const bench = this.findFreeBench(player);
    if (bench >= 0) return { area:'bench', index: bench };
    // An automatic merge may temporarily use an overflow slot, just like a shop purchase.
    return null;
  }

  private rewardLoot(drop: LootDrop): boolean {
    if (drop.claimed) return true;
    const player = this.players.find(p=>p.id === drop.ownerId);
    if (!player || player.eliminated) return false;
    const reward = drop.reward;
    if(!canReceive(player,reward.kind==='component'?1:0,reward.bonusBall)){drop.pending=true;return false;}
    if (reward.kind === 'pokemon') {
      if (!reward.family) return false;
      const pos = this.freePlaceForReward(player);
      const mergeable = player.units.filter(u=>u.family===reward.family && u.stage===0).length >= (evolutionCopies(reward.family,0,hasAugment(player,'P11'))-1);
      if (!pos && !mergeable) { drop.pending=true; return false; }
      const unit = this.makePokemon(reward.family,pos || {area:'bench',index:BENCH_SIZE});
      applyPokemonAugments(player,unit,chapterForRound(this.round));
      player.units.push(unit);
      this.visualEvents.push({ id:this.id(), unitId:unit.id, ownerId:player.id, kind:'summon', age:0,
        pokemon:{family:unit.family,stage:unit.stage,level:unit.level,position:{...unit.position}} });
      this.merge(player);
      this.lootMessage = `Espólio: ${SPECIES[reward.family].names[0]}`;
    } else if (reward.kind === 'gold') {
      player.gold += reward.amount || 0;
      this.lootMessage = `Espólio: +${reward.amount} ouro`;
    } else {
      player.itemInventory ||= [];
      player.itemInventory.push(makeComponent(this.id(),reward.color || ITEM_COLORS[0]));
      this.lootMessage = `Espólio: componente ${(ITEMS.components[reward.color || ITEM_COLORS[0]]).name}`;
    }
    if (reward.bonusBall) {
      player.consumables ||= {pokeball:0,greatball:0,ultraball:0,masterball:0};
      player.consumables[reward.bonusBall]++;
      this.lootMessage += ` + ${LOOT.ballNames[reward.bonusBall]}`;
    }
    this.lootMessageId=drop.id;
    drop.claimed=true; drop.pending=false;
    return true;
  }

  /** Count components in both crafted gear and unequipped gear, plus owned but unopened orbs.
   * An orb already awaiting the human player is an earned allocation, not a new deficit. */
  private componentCount(player: Player): number {
    return (player.itemInventory || []).reduce((sum,item)=>sum+item.components.length,0)
      + player.units.reduce((sum,unit)=>(sum+(unit.equipment || []).reduce((n,item)=>n+item.components.length,0)),0)
      + this.savedLoot.filter(drop=>!drop.claimed && drop.ownerId===player.id && drop.reward.kind==='component').length;
  }

  /** The CPUs actually equip their share, instead of receiving invisible artificial stats. */
  private equipCPU(player: Player): void {
    if(player.id==='p0') return;
    const pending=player.itemInventory || [];
    const targets=[...player.units].sort((a,b)=>{
      const pa=a.position.area==='board'?1:0,pb=b.position.area==='board'?1:0;
      return pb-pa || b.stage-a.stage || a.id.localeCompare(b.id);
    });
    for(const item of [...pending]){
      for(const pokemon of targets){
        const held=pokemon.equipment ||= [];
        const component=item.kind==='component' ? held.find(i=>i.kind==='component') : undefined;
        if(component){
          const combined=craft(this.id(),component,item);
          if(combined){held[held.indexOf(component)]=combined;pending.splice(pending.indexOf(item),1);break;}
        }else if(held.length<ITEMS.maxSlots){held.push(item);pending.splice(pending.indexOf(item),1);break;}
      }
    }
  }

  /** Grant only lagging players until everyone has the same component allotment.
   * When tied, one seeded shared drop round advances all 8 players together. */
  private balanceComponents(): void {
    if(!LOOT.componentFairness.enabled)return;
    const active=this.players.filter(player=>!player.eliminated);
    if(!active.length)return;
    const counts=active.map(p=>this.componentCount(p));
    const highest=Math.max(...counts),lowest=Math.min(...counts);
    if(highest===lowest && this.rng.next()>=LOOT.componentFairness.sharedRoundChance)return;
    const target=highest===lowest ? highest+1 : highest;
    for(const player of active){
      const grants=Math.min(LOOT.componentFairness.maxGrantPerRound,Math.max(0,target-this.componentCount(player)));
      for(let i=0;i<grants;i++){
        const color=this.rng.pick(ITEM_COLORS);
        if(player.id==='p0'){
          this.savedLoot.push({id:this.id(),ownerId:player.id,
            x:-2.65+this.rng.next()*5.3,y:.8+this.rng.next()*2.1,
            color:'blue',claimed:false,reward:{kind:'component',color}});
        }else{
          player.itemInventory ||= [];
          player.itemInventory.push(makeComponent(this.id(),color));
          this.equipCPU(player);
        }
      }
    }
  }

  private spawnLoot(): void {
    if (!eligibleForLoot(currentStage(this.round).type)) return;
    const chapter = chapterForRound(this.round);
    if(this.rng.next()<LOOT.chancePerRound){
      const amount = LOOT.count.min + this.rng.int(LOOT.count.max - LOOT.count.min + 1);
      for (let i=0;i<amount;i++) {
        const color=rollColor(()=>this.rng.next(),chapter);
        this.savedLoot.push({id:this.id(),ownerId:'p0',x:-2.65+this.rng.next()*5.3,
          y:.8+this.rng.next()*2.1,color,claimed:false,reward:rollReward(color,()=>this.rng.next())});
      }
    }
    this.balanceComponents();
  }

  private buy(player: Player, slot: number): string | null {
    const offer = player.shop[slot];
    if (!offer) return 'Slot vazio';
    if (player.gold < offer.price) return 'Ouro insuficiente';
    const free = this.findFreeBench(player);
    const eligibleMerge = player.units.filter(u => u.family === offer.family && u.stage === 0).length >= (evolutionCopies(offer.family,0,hasAugment(player,'P11'))-1);
    if (free < 0 && !eligibleMerge) return `Banco cheio (${BENCH_SIZE}/${BENCH_SIZE})`;
    player.gold -= offer.price;
    const bought = this.makePokemon(offer.family, { area: 'bench', index: free < 0 ? BENCH_SIZE : free });
    applyPokemonAugments(player,bought,chapterForRound(this.round));
    player.units.push(bought);
    if(this.phase==='planning')purchasedPokemon(player);
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

  private tickTrainer(dt: number, canCollectLoot = true): void {
    const dx = this.trainer.targetX - this.trainer.x, dy = this.trainer.targetY - this.trainer.y;
    const length = Math.hypot(dx, dy);
    if (length > 0.001) {
      const distance = Math.min(length, 3.8 * dt);
      this.trainer.x += dx / length * distance;
      this.trainer.y += dy / length * distance;
    }
    for (const loot of canCollectLoot ? this.savedLoot : []) {
      if (!loot.claimed && Math.hypot(this.trainer.x-loot.x,this.trainer.y-loot.y) <= .38) this.rewardLoot(loot);
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
    const preserved = this.preserveEquipment(player,[stronger,consumed]);
    stronger.equipment = preserved;
    stronger.position = where;
    const fusionLevels = hasAugment(player,'S08') ? tierParam('S08','levels',1) : RULES.fusionLevels;
    addLevels(stronger,fusionLevels);
    if(hasAugment(player,'S08')){
      const keys=(Object.keys(stronger.iv) as Array<keyof Stats>).sort((a,b)=>stronger.iv[a]-stronger.iv[b]||a.localeCompare(b)).slice(0,tierParam('S08','smallest',1));
      for(const key of keys)stronger.iv[key]=Math.min(100,stronger.iv[key]+tierParam('S08','iv',1));
    }
    this.visualEvents.push({ id: this.id(), unitId: stronger.id, ownerId: player.id, kind: 'fusion', age: 0, sources,
      pokemon: { family: stronger.family, stage: stronger.stage, level: stronger.level, position: { ...stronger.position } } });
    if (player.id === 'p0') this.log = `${SPECIES[stronger.family].names[Math.min(stronger.stage, SPECIES[stronger.family].names.length - 1)]} • +${fusionLevels} níveis pela fusão!`;
    return true;
  }

  command(command: GameCommand): string | null {
    const human = this.players[0];
    if (human.eliminated || this.phase === 'finished') return 'A partida já terminou para você';
    if(command.kind==='augment-choose'||command.kind==='augment-reroll'){
      if(this.phase!=='planning'||human.augmentChoice?.chapter!==chapterForRound(this.round))return 'Fora da fase de escolha';
      return command.kind==='augment-choose'?this.chooseAugment(human,command.slot)
        :rerollAugment(human.augmentChoice,human,command.slot,()=>this.rng.next());
    }
    if (command.kind === 'mime-pillar') {
      if(this.phase !== 'planning')return 'Os pilares só podem ser reposicionados na preparação';
      const mime=human.units.find(u=>u.id===command.unitId&&(u.family==='mr-mime'||u.family==='mime-jr')&&u.position.area==='board');
      if(!mime)return 'Mr. Mime precisa estar no campo';
      if(!Number.isInteger(command.index)||command.index<0||command.index>1||!Number.isInteger(command.col)||!Number.isInteger(command.row)
       ||command.col<0||command.col>=BOARD_COLUMNS||command.row<0||command.row>=BOARD_ROWS)return 'Posição inválida';
      const marks=mime.mimePillars?.map(p=>({...p}))||[{col:2,row:1},{col:4,row:2}];
      if(marks.some((p,i)=>i!==command.index&&p.col===command.col&&p.row===command.row))return 'Os pilares não podem se sobrepor';
      if(human.units.some(other=>other.id!==mime.id&&(other.family==='mr-mime'||other.family==='mime-jr')&&other.position.area==='board'&&
        (other.mimePillars||[{col:2,row:1},{col:4,row:2}]).some(p=>p.col===command.col&&p.row===command.row)))return 'Outra estrutura já ocupa a casa';
      marks[command.index]={col:command.col,row:command.row};mime.mimePillars=marks;
      return null;
    }
    if (command.kind === 'move-trainer') {
      if (!Number.isFinite(command.x) || !Number.isFinite(command.y)) return 'Destino inválido';
      this.trainer.targetX = Math.max(-10, Math.min(10, command.x));
      this.trainer.targetY = Math.max(-4.5, Math.min(4.65, command.y));
      return null;
    }
    if (command.kind === 'choose-eevee') {
      const scytherChoice=human.pendingEvolutionKind==='scyther';
      const tyrogueChoice=human.pendingEvolutionKind==='tyrogue';
      if(!(tyrogueChoice ? (command.branch==='hitmonchan'||command.branch==='hitmonlee') : scytherChoice ? (command.branch==='scizor'||command.branch==='kleavor') : EEVEE_BRANCHES.includes(command.branch))) return 'Evolução inválida';
      const ids = human.pendingEvolution;
      const family=tyrogueChoice?'tyrogue':scytherChoice?'scyther':'eevee';
      if(!ids || ids.length!==evolutionCopies(family,0,hasAugment(human,'P11')) || ids.some(id=>!human.units.some(u=>u.id===id&&u.family===family)))return 'Reúna as cópias para evoluir';
      this.chooseEevee(human, command.branch);
      this.merge(human);
      return null;
    }
    if (command.kind === 'equip-item') {
      const item=human.itemInventory?.find(i=>i.id===command.itemId);
      const target=human.units.find(u=>u.id===command.unitId);
      if (!item || !target) return 'Item ou Pokémon inválido';
      if (this.phase !== 'planning' && target.position.area === 'board') return 'Equipamentos de Pokémon em combate estão travados';
      const equipped=target.equipment ||= [];
      const slot=command.ontoSlot;
      const already=slot!==undefined && Number.isInteger(slot) && slot>=0 && slot<equipped.length ? equipped[slot] : null;
      const component=already || (item.kind === 'component' ? equipped.find(i=>i.kind==='component') : null);
      if (item.kind === 'component' && component?.kind === 'component') {
        const assembled=craft(this.id(),item,component);
        if (!assembled) return 'Receita inválida';
        const index=equipped.findIndex(i=>i.id===component.id);
        equipped[index]=assembled;
      } else {
        if (equipped.length>=ITEMS.maxSlots) return 'Limite de dois equipamentos';
        equipped.push(item);
      }
      human.itemInventory=human.itemInventory!.filter(i=>i.id!==item.id);
      this.releasePendingItems(human);
      return null;
    }
    if (command.kind === 'unequip-item') {
      const unit=human.units.find(u=>u.id===command.unitId);
      if (!unit || !Number.isInteger(command.slot) || command.slot<0 || command.slot>=(unit.equipment?.length||0)) return 'Equipamento inválido';
      if (this.phase !== 'planning' && unit.position.area==='board') return 'Equipamentos travados durante combate';
      human.itemInventory ||= [];
      if(!canReceive(human,1))return `Mochila cheia (${ITEMS.inventorySlots} itens)`;
      human.itemInventory.push(unit.equipment!.splice(command.slot,1)[0]);
      return null;
    }
    if (command.kind === 'use-ball') {
      const target=human.units.find(u=>u.id===command.unitId);
      const tier:Record<BallKind,number>={pokeball:1,greatball:2,ultraball:3,masterball:5};
      if (!target || !Object.hasOwn(tier,command.ball) || SPECIES[target.family].rarity>tier[command.ball]) return 'Pokébola não aceita esse Pokémon';
      if (!(human.consumables?.[command.ball] || 0)) return 'Pokébola indisponível';
      const pos=this.freePlaceForReward(human);
      if (!pos) return 'Banco cheio: libere uma vaga para duplicar';
      const clone:Pokemon={ ...target,id:this.id(),iv:{...target.iv},position:pos,equipment:[] };
      clone.acquiredChapter=chapterForRound(this.round);clone.appliedAugments=[...target.appliedAugments||[]];
      applyPokemonAugments(human,clone,chapterForRound(this.round));
      human.units.push(clone);
      human.consumables![command.ball]--;
      this.releasePendingItems(human);
      this.visualEvents.push({id:this.id(),unitId:clone.id,ownerId:human.id,kind:'summon',age:0,
        pokemon:{family:clone.family,stage:clone.stage,level:clone.level,position:{...clone.position}}});
      this.merge(human);
      this.log = `${SPECIES[clone.family].names[clone.stage]} duplicado!`;
      return null;
    }
    if (command.kind === 'buy') {
      if (!Number.isInteger(command.slot) || command.slot < 0 || command.slot >= SHOP_SIZE) return 'Slot inválido';
      return this.buy(human, command.slot);
    }
    if (command.kind === 'reroll') {
      const free=human.augmentCounters?.['B02:free']||0;
      if (!free && human.gold < RULES.rerollCost) return 'Ouro insuficiente';
      if (free)human.augmentCounters!['B02:free']=free-1;
      else human.gold -= RULES.rerollCost;
      this.refreshShop(human);
      return null;
    }
    if (command.kind === 'lock') { human.locked = !human.locked; return null; }
    const unit = human.units.find(u => u.id === command.unitId);
    if (!unit) return 'Pokémon não encontrado';
    if (this.phase !== 'planning' && unit.position.area === 'board') return 'Pokémon em campo não pode ser movido durante o combate';
    if (command.kind === 'sell') {
      if(!canReceive(human,unit.equipment?.length||0))return `Mochila cheia: libere espaço para recuperar equipamentos`;
      human.gold += SPECIES[unit.family].rarity * (SPECIES[unit.family].eeveeBranch ? 4 : 3 ** unit.stage);
      human.units = human.units.filter(u => u.id !== unit.id);
      human.itemInventory ||= []; human.itemInventory.push(...(unit.equipment || []));
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
      u.position = { area: 'board', col: [3, 2, 4, 1, 5, 0, 6, 2, 4][i], row: i<7?(front ? 0 : Math.min(3, 2 + Math.floor(i / 4))):3 };
    });
    fielded.filter(u=>(u.family==='mr-mime'||u.family==='mime-jr')).forEach((mime,index)=>{
      const colA=(2+index*2)%7,colB=(4+index*2)%7;
      mime.mimePillars=[{col:colA,row:1},{col:colB,row:2}];
    });
    remaining.slice(0, BENCH_SIZE).forEach((u, index) => { u.position = { area: 'bench', index }; });
    this.equipCPU(player);
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
      const pokemon = this.makePokemon(family, { area: 'board', col: [3, 2, 4, 1, 5, 0, 6, 2, 4][i], row: i < 7 ? i % 2 : 2 });
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

  private deployAvailableBench(player:Player):void {
    const occupied=new Set(player.units.filter(u=>u.position.area==='board').map(u=>u.position.area==='board'?`${u.position.col}:${u.position.row}`:''));
    const onBoard=occupied.size;
    if(onBoard>=player.level)return;
    const free:Array<{col:number;row:number}>=[];
    for(let row=BOARD_ROWS-1;row>=0;row--)for(let col=0;col<BOARD_COLUMNS;col++){
      if(!occupied.has(`${col}:${row}`))free.push({col,row});
    }
    const bank=player.units.filter(u=>u.position.area==='bench').sort((a,b)=>
      (a.position.area==='bench'?a.position.index:0)-(b.position.area==='bench'?b.position.index:0)||a.id.localeCompare(b.id));
    for(const unit of bank.slice(0,Math.max(0,player.level-onBoard))){
      const pos=free.shift();if(!pos)break;
      unit.position={area:'board',...pos};
    }
  }

  private startCombat(): void {
    for(const p of this.players){
      if(!p.eliminated)this.deployAvailableBench(p);
      if(p.augmentChoice?.status==='pending'&&!p.eliminated)this.chooseAugment(p,this.rng.int(3));
      if(p.augmentCounters)p.augmentCounters['B02:free']=0;
    }
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
        if(stage.type!=='bot'&&stage.type!=='boss'&&hasAugment(player,'G07')){
          player.gold+=tierParam('G07',place===1?'win':'loss',chapterForRound(this.round));
        }
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
    const starter=PHASES.firstBattleItem;
    if(starter.enabled && chapterForRound(this.round)===starter.chapter && ((this.round-1)%PHASES.stagesPerChapter)+1===starter.stage){
      for(const player of this.players){
        if(player.firstBattleItemGranted || (player.id!=='p0'&&!starter.grantToBots))continue;
        const item=makeComponent(this.id(),starter.color);
        if(canReceive(player,1))(player.itemInventory||=[]).push(item);
        else (player.pendingItems||=[]).push(item);
        player.firstBattleItemGranted=true;
        if(player.id==='p0'){this.lootMessage=`Primeiro combate: ${ITEMS.components[starter.color].name} garantido!`;this.lootMessageId=this.id();}
      }
    }
    this.spawnLoot();
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
        const cap=SPECIES[unit.family].babyEvolution ? RULES.baby.levelCap : RULES.maxPokemonLevel;
        unit.xp = Math.min(cap - 1,unit.xp + battleExperience(p,unit));
        unit.level = Math.min(cap, 1 + unit.xp);
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
    this.savedLoot = this.savedLoot.filter(d => !d.claimed);
    this.round++;
    this.phase = 'planning'; this.clock = 0; this.duration = roundTimers(this.round).preparationSeconds;
    for (const p of this.players) {
      if (p.eliminated) continue;
      p.gold += projectedIncome(p);
      p.roundVictory = false;
      p.currentRound=this.round;
      p.level=Math.max(p.level,nextTrainerLevel(this.round,p.augments||[]));
      if(((this.round-1)%PHASES.stagesPerChapter)===0)chapterPayment(p,chapterForRound(this.round));
      startedPreparation(p);
      if (!p.locked) this.refreshShop(p);
      if (p.id !== 'p0') this.runCPU(p);
    }
    if(((this.round-1)%PHASES.stagesPerChapter)===0)this.startAugmentChapter(chapterForRound(this.round));
    this.prepareMatchmaking();
    this.log = `Preparação • Rodada ${this.round}`;
  }

  tick(dt: number, canCollectLoot = true): void {
    if (this.phase === 'finished') return;
    const step = Math.max(0, Math.min(0.1, dt));
    this.tickTrainer(step, canCollectLoot);
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
        ...p, units: p.units, // postMessage immediately structured-clones this ephemeral view
        itemInventory:p.id==='p0' ? (p.itemInventory||[]) : [],
        consumables:p.id==='p0' ? p.consumables as NonNullable<Player['consumables']> : {pokeball:0,greatball:0,ultraball:0,masterball:0},
        shop: p.id === 'p0' ? p.shop : []
      })),
      opponentId: this.phase === 'planning' ? null : this.opponentId,
      lastOpponentId: this.lastOpponentId,
      visualEvents: this.visualEvents.filter(a => a.ownerId === watched || a.ownerId === 'p0' || (a.kind === 'trainer-damage' && a.battleId === battle?.id)),
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
      trainer: { ...this.trainer }, collectibleGold: this.collectibleGold(),
      collectibleLoot:this.savedLoot.filter(d=>!d.claimed).map(d=>({...d,reward:{...d.reward}})),lootMessage:this.lootMessage,lootMessageId:this.lootMessageId
    };
  }
}

function samePosition(a: UnitPosition, b: UnitPosition): boolean {
  return a.area === b.area && (a.area === 'board'
    ? b.area === 'board' && a.col === b.col && a.row === b.row
    : b.area === 'bench' && a.index === b.index);
}
