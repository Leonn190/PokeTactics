import { itemImage } from './item-sprites';
import { alternativeForm } from '../../server/forms';
import { SynergyPanel } from './synergies/panel';
import { interestCap,hasAugment } from '../../server/systems/augments';
import { inventoryUsed,BALLS } from '../../server/systems/inventory';
import { calculateStats, displayName, ELEMENTS, PHASES, RARITY_COLORS, RULES, SPECIES, evolutionCopies, getStageData, ATTACKS, rangeLabel, steppedRange } from '../../server/data';
import { totalPower } from '../../server/formulas';
import { bonusStats, bonusStat, effectivePercents, itemTooltip, ITEM_COLORS, ITEMS, RECIPES, numberParam } from '../../server/systems/items';
import { LOOT } from '../../server/systems/loot';
import { shopOdds, typeBonus, typeInfluence } from '../../server/shop';
import { trainerXpNeeded } from '../../server/trainer-xp';
import { moveDescription } from './menus';
import { previewAbility } from '../../server/damage-preview';
import { damageHtml, damageRows } from './damage-labels';
import type { CombatUnit, Element, GameSnapshot, Pokemon, ShopOffer, Stats, EquippedItem, BallKind, Player } from '../../server/types';
import type { ClientView } from './arena';

const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const safe = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"','&quot;');
const modifierClass = (value:number,baseValue:number):string => value>baseValue+.001?'stat-mod-up':value<baseValue-.001?'stat-mod-down':'';
const STAT_LABELS: Record<keyof Stats, string> = { hp: 'VIDA', speed: 'VEL', atk: 'ATK', def: 'DEF', spa: 'SPA', spd: 'SPD' };
/** Small monochrome vector pictograms, sized and tinted by the character sheet. */
const STAT_GLYPHS = {
  atk: 'M5 3l9 9-2 2-9-9 2-2zm5 10l4 4m-8 3l3-5',
  def: 'M12 2L4 5v6c0 5 3.3 8.2 8 11 4.7-2.8 8-6 8-11V5l-8-3zm0 4v11',
  spa: 'M12 2l2.3 7.7L22 12l-7.7 2.3L12 22l-2.3-7.7L2 12l7.7-2.3L12 2z',
  spd: 'M12 2l8 4v6c0 4.2-3 7.5-8 10-5-2.5-8-5.8-8-10V6l8-4zm-4 10h8m-4-4v8',
  speed: 'M3 12h12m-5-6l6 6-6 6M4 7h5M4 17h5',
  critChance: 'M12 2v4m0 12v4M2 12h4m12 0h4M12 7a5 5 0 100 10 5 5 0 000-10zm0 3v4m-2-2h4',
  critDamage: 'M12 2l2.6 6.9L22 12l-7.4 3.1L12 22l-2.6-6.9L2 12l7.4-3.1L12 2zm-2 8l4 4m0-4l-4 4',
  vampirism: 'M12 2C9 7 5 11 5 15a7 7 0 0014 0c0-4-4-8-7-13zm-3 13c0 2 1 3 3 3',
  durability: 'M12 2l8 5v6c0 4-3 7-8 9-5-2-8-5-8-9V7l8-5zm-4 10l3 3 5-6',
  amplification: 'M12 2l4 8h-3v5l6-2-7 9-7-9 6 2v-5H8l4-8z'
} as const;
const statIcon=(key:keyof typeof STAT_GLYPHS):string =>
  '<svg class="inspector-stat-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="'+STAT_GLYPHS[key]+'"/></svg>';

const base = import.meta.env.BASE_URL;
const typeIcon = (type: Element, size = 18): string => `<img class="type-icon" src="${base}tipos/${type}.svg" width="${size}" height="${size}" alt="${safe(ELEMENTS[type].name)}" title="${safe(ELEMENTS[type].name)}" />`;
const icon = itemImage;
/** The same item slots are used for your tray and for read-only enemy trays. */
export function itemRackSlots(items:EquippedItem[],selectedId:string|null=null,readonly=false):string {
 const slots=items.map(item=>`<${readonly?'span':'button type="button"'} class="inventory-slot inventory-item ${selectedId===item.id?'selected':''}" ${readonly?'':'data-inventory-item="'+safe(item.id)+'"'} title="${safe(itemTooltip(item))}" data-item-tooltip="${safe(itemTooltip(item))}">${icon(item)}</${readonly?'span':'button'}>`);
 while(slots.length<ITEMS.inventorySlots)slots.push('<span class="inventory-slot empty" aria-hidden="true"><i></i></span>');
 return `<div class="inventory-grid" role="group" aria-label="Itens no chão">${slots.join('')}</div>`;
}
function portrait(family: keyof typeof SPECIES, size: number, stage = 0, formId?:string): string {
  const s = SPECIES[family];
  const form=alternativeForm(family,stage,formId);
  const id = form?.pokedexId||s.pokedexIds[Math.min(stage, s.pokedexIds.length - 1)];
  const src=form?`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`:`${base}portrait/${String(id).padStart(4, '0')}/Normal.png`;
  return `<img class="pokemon-portrait" src="${src}" width="${size}" height="${size}" alt="${safe(s.names[Math.min(stage, s.names.length - 1)])}" loading="lazy" draggable="false" />`;
}

export class Hud {
  private lastShop = '';
  private lastLootMessage = '';
  private inventoryPage = 0;
  private readonly synergyPanel:SynergyPanel;
  private lastRank = '';
  private lastCombat = '';
  private lastOpponentCombat = '';
  private lastInspector = '';
  private lastTimeline = '';
  private panel: 'rank' | 'combat' = 'rank';
  private metric: 'status' | 'damage' | 'mitigation' = 'status';
  private showOpponent = false;
  private latestSnapshot: GameSnapshot | null = null;
  private latestView: ClientView | null = null;
  private toastTimer = 0;
  private readonly fragmentCache = new Map<string, {html:string;node:HTMLElement;first:ChildNode|null;length:number}>();
  private updateHTML(id: string, html: string): void {
    const node=element(id);
    const old=this.fragmentCache.get(id);
    if(old?.html===html && old.node===node && old.first===node.firstChild && old.length===node.childNodes.length)return;
    node.innerHTML=html;
    this.fragmentCache.set(id,{html,node,first:node.firstChild,length:node.childNodes.length});
  }

  constructor() {
    this.synergyPanel=new SynergyPanel(element('traitRows'),typeIcon,portrait);
    document.querySelectorAll<HTMLButtonElement>('[data-panel]').forEach(button => button.addEventListener('click', () => {
      this.panel = button.dataset.panel as 'rank' | 'combat';
      this.lastCombat = '';
      this.setPanel();
      if (this.latestSnapshot && this.latestView) this.render(this.latestSnapshot, this.latestView);
    }));
    document.querySelectorAll<HTMLButtonElement>('[data-metric]').forEach(button => button.addEventListener('click', () => {
      this.metric = button.dataset.metric as typeof this.metric;
      this.lastCombat = '';
      this.lastOpponentCombat = '';
      document.querySelectorAll('[data-metric]').forEach(tab => tab.classList.toggle('active', tab === button));
      if (this.latestSnapshot && this.latestView) this.render(this.latestSnapshot, this.latestView);
    }));
    element<HTMLButtonElement>('combatSideButton').addEventListener('click', () => {
      this.showOpponent = !this.showOpponent;
      this.lastOpponentCombat = '';
      if (this.latestSnapshot && this.latestView) this.render(this.latestSnapshot, this.latestView);
    });
    this.setPanel();
  }

  private setPanel(): void {
    element('rankPanel').classList.toggle('hidden', this.panel !== 'rank');
    element('combatPanel').classList.toggle('hidden', this.panel !== 'combat');
    element('tabRank').classList.toggle('active', this.panel === 'rank');
    element('tabCombat').classList.toggle('active', this.panel === 'combat');
    element('rightPanel').classList.toggle('combat-active', this.panel === 'combat');
  }

  changeInventoryPage(direction:number):void{this.inventoryPage=Math.max(0,this.inventoryPage+direction);}

  toast(message: string): void {
    const node = element('toast');
    node.textContent = message; node.classList.remove('hidden');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => node.classList.add('hidden'), 1800);
  }

  /** Lightweight frequent timer update; no shop/rank DOM rebuilding. */
  renderClock(snapshot: GameSnapshot): void {
    const value = snapshot.sandbox&&snapshot.phase==='planning' ? '∞' : snapshot.phase === 'finished' ? '—' : String(Math.ceil(snapshot.timeLeft));
    const countdown = element('countdown');
    if (countdown.textContent !== value) countdown.textContent = value;
    const progress = element('stageProgress');
    progress.style.transform = `scaleX(${Math.max(0, Math.min(1, snapshot.phaseSeconds ? snapshot.timeLeft / snapshot.phaseSeconds : 0))})`;
    progress.classList.toggle('fast', snapshot.accelerated);
  }

  /** Each HUD region renders independently. No animation, hidden panel or failed section
   * can block the shop, gold, synergies, ranking or the selected Pokemon. */
  render(snapshot:GameSnapshot,view:ClientView):void {
    this.latestSnapshot=snapshot;
    this.latestView=view;
    const human=snapshot.players[0];
    const watched=snapshot.players.find(p=>p.id===view.scoutId)||human;
    const rosterKey=(p:Player)=>p.units.map(u=>[u.id,u.family,u.stage,u.level,u.position,u.equipment,u.xp]);
    const shopKey=human.shop.map(offer=>offer&&[offer.id,offer.family,offer.price,offer.rarity]);
    const influenceRoster=human.units.map(u=>[u.family,u.stage,u.position.area]);
    this.region('economy',()=>[snapshot.phase,snapshot.accelerated,snapshot.chapter,snapshot.stage,human.gold,human.level,human.trainerXp,human.augments,human.streak,human.roundVictory],()=>this.renderEconomy(snapshot,view));
    this.region('shopOffers',()=>[shopKey,human.gold,human.eliminated,snapshot.phase,influenceRoster],()=>this.renderShopOffers(snapshot,view));
    this.region('shopInfo',()=>[human.gold,human.level,human.eliminated,human.locked,human.augmentCounters?.['B02:free'],snapshot.phase,influenceRoster],()=>this.renderShopInfo(snapshot,view));
    this.region('inventory',()=>[human.itemInventory,human.consumables,view.scoutId,view.selectedBall,view.inventoryItemId,this.inventoryPage,snapshot.lootMessageId],()=>this.renderInventory(snapshot,view));
    this.region('synergies',()=>[view.scoutId,watched.augments,watched.units.map(u=>[u.id,u.family,u.stage,u.position])],()=>this.renderSynergies(snapshot,view));
    this.region('ranking',()=>[view.scoutId,snapshot.players.map(p=>[p.id,p.name,p.health,p.eliminated,p.placement]),snapshot.phase,snapshot.stageType,snapshot.possibleOpponents.p0,snapshot.battleStatuses,snapshot.visualEvents.filter(e=>e.kind==='trainer-damage'&&e.age<1.05).map(e=>[e.id,e.ownerId,e.age,e.value])],()=>this.renderRanking(snapshot,view));
    this.region('timeline',()=>[snapshot.chapter,snapshot.stage,snapshot.stageName,human.history],()=>this.renderTimeline(snapshot,view));
    this.region('status',()=>[view.scoutId,snapshot.phase,snapshot.accelerated,snapshot.stageName,snapshot.log,snapshot.visibleBattle?.goldDrops.map(d=>[d.claimed,d.ownerId]),snapshot.players.map(p=>[p.id,p.name])],()=>this.renderStatus(snapshot,view));
    const inspected = snapshot.players.flatMap(p=>p.units).find(u=>u.id===view.selectedId);
    const activeBattle=snapshot.observedId===view.scoutId ? snapshot.visibleBattle : null;
    const battleInspected=activeBattle?.units.find(u=>u.id===view.selectedId||u.sourceId===view.selectedId);
    this.region('inspector',()=>[view.selectedId,view.scoutId,snapshot.observedId,snapshot.phase,
      human.augments?.includes('P11'),snapshot.players.map(p=>p.units.map(u=>[u.family,u.stage])),
      inspected&&[inspected.id,inspected.family,inspected.stage,inspected.level,inspected.iv,inspected.xp,inspected.equipment],
      battleInspected&&[battleInspected.id,battleInspected.family,battleInspected.stage,battleInspected.level,battleInspected.iv,battleInspected.stats,battleInspected.equipment,battleInspected.buffs,battleInspected.synergy,battleInspected.ditto,battleInspected.range,battleInspected.focusCount,battleInspected.refractionUntil>battleInspected.itemNow]
    ],()=>this.renderInspector(snapshot,view));
    this.isolated('inspector-resources',()=>{
      if(!view.selectedId)return;
      const pokemon=inspected||(battleInspected?this.fromCombat(battleInspected):null);
      if(pokemon)this.renderInspectorResources(battleInspected,pokemon);
    });
    // The inactive combat panel is not rendered every 85ms. Its cache is caught up
    // immediately when opened, including the latest damage metrics.
    if(this.panel==='combat')this.region('combat',()=>[view.scoutId,this.metric,this.showOpponent,snapshot.phase,snapshot.observedId,
      snapshot.opponentId,snapshot.lastOpponentId,snapshot.combatStats,rosterKey(watched),
      activeBattle?.id,activeBattle?.units.map(u=>[u.id,u.sourceId,u.hp,u.maxHp,u.stats,u.equipment])],()=>this.renderCombat(snapshot,view));
    this.region('final',()=>[snapshot.phase,snapshot.winnerId,human.placement,snapshot.players.map(p=>[p.id,p.name])],()=>this.renderFinal(snapshot,view));
  }

  private regionSignatures=new Map<string,{key:string; nodes:Array<{node:HTMLElement;first:ChildNode|null; length:number}>}>();
  private failedRegions=new Set<string>();
  /** Signature calculation and DOM writes are both inside this error boundary. */
  private region(name:string, fingerprint:()=>unknown, draw:()=>void):void {
    try {
      const signature=JSON.stringify(fingerprint());
      const cached=this.regionSignatures.get(name);
      const targets=this.regionTargets[name]||[];
      if(cached?.key===signature && cached.nodes.every((previous,i)=>{
        const node=element(targets[i]);
        return previous.node===node && previous.first===node.firstChild && previous.length===node.childNodes.length;
      }))return;
      draw();
      this.regionSignatures.set(name,{key:signature,nodes:targets.map(id=>{
        const node=element(id);return {node,first:node.firstChild,length:node.childNodes.length};
      })});
      this.failedRegions.delete(name);
    }catch(error){this.failure(name,error);}
  }
  private isolated(name:string,draw:()=>void):void {
    try {draw();this.failedRegions.delete(name);}
    catch(error){this.failure(name,error);}
  }
  private failure(name:string,error:unknown):void {
    this.regionSignatures.delete(name);
    if(!this.failedRegions.has(name))console.error(`[HUD V22.6] Falha em ${name}; as outras regiões continuam atualizando`,error);
    this.failedRegions.add(name);
  }
  private readonly regionTargets:Record<string,string[]>={"inventory": ["itemInventory", "shopFooter", "inventoryContents", "inventoryCounter", "eeveeEvolution"], "economy": ["phaseLabel", "roundLabel", "goldCount", "incomeCount", "incomeBreakdown", "levelNumber", "trainerXpCaption", "trainerXpFill", "buyXpButton"], "shopInfo": ["shopChances", "typeInfluence", "rerollButton", "lockButton"], "timeline": ["chapterTrack", "stageName"], "shopOffers": ["shopCards"], "synergies": ["traitRows"], "ranking": ["rankRows"], "combat": ["combatRows", "opponentCombatRows", "combatOwnLabel", "opponentCombatPanel"], "status": ["scoutBadge", "battleStatus"], "inspector": ["unitInspector"], "final": ["finalBanner"]};
  reset():void {
    this.regionSignatures.clear();this.failedRegions.clear();this.fragmentCache.clear();
    this.latestSnapshot=null;this.latestView=null;this.lastLootMessage='';this.lastRank='';this.inventoryPage=0;
    this.synergyPanel.reset();
    element('shopCards').innerHTML='';element('rankRows').innerHTML='';
    element('unitInspector').innerHTML='';element('unitInspector').classList.add('hidden');
  }

  private renderInventory(snapshot:GameSnapshot,view:ClientView):void {
    const player=snapshot.players[0];
    element('shopFooter').classList.toggle('hidden',view.scoutId!=='p0');
    element('itemInventory').classList.toggle('hidden',view.scoutId!=='p0');
    if (snapshot.lootMessage && snapshot.lootMessageId!==this.lastLootMessage) {
      this.lastLootMessage=snapshot.lootMessageId;this.toast(snapshot.lootMessage);
    }
    const inventory=player.itemInventory||[];
    const itemGrid=itemRackSlots(inventory,view.inventoryItemId,false).replace(/(<button[^>]+data-inventory-item="sandbox:[^"]+"[^>]*>[\s\S]*?)(<\/button>)/g,'$1<span class="infinite-marker">∞</span>$2');
    const balls:string[]=[];
    for(const ball of BALLS){
      const count=player.consumables?.[ball]||0;
      if(!count)continue;
      const names=LOOT.ballNames;
      const files:Record<BallKind,string>={pokeball:'poke-ball',greatball:'great-ball',ultraball:'ultra-ball',masterball:'master-ball'};
      balls.push(`<button class="inventory-slot inventory-ball ${view.selectedBall===ball?'selected':''}" data-inventory-ball="${ball}" title="${safe(names[ball])}: duplique um Pokémon elegível" aria-label="${safe(names[ball])}, ${count} disponíveis"><img src="${base}pokebolas/${files[ball]}.png" alt="" draggable="false"><small>×${count}</small></button>`);
    }
    this.updateHTML('inventoryContents',`${itemGrid}${balls.length?`<div class="ball-ground" role="group" aria-label="Pokébolas no chão">${balls.join('')}</div>`:''}`);
    element('inventoryCounter').textContent=`${inventoryUsed(player)}/${ITEMS.inventorySlots}`;
    // Branch evolutions now resolve immediately in the authoritative engine.
    element('eeveeEvolution').classList.add('hidden');
  }

  private renderEconomy(snapshot:GameSnapshot,view:ClientView):void {
    const player=snapshot.players[0];
    const phaseLabels = { planning: 'PREPARAÇÃO', combat: 'COMBATE', result: 'RESULTADO', finished: 'ENCERRADO' };
    element('phaseLabel').textContent = snapshot.accelerated ? 'COMBATE ACELERADO' : phaseLabels[snapshot.phase];
    element('roundLabel').textContent = `${snapshot.chapter}-${snapshot.stage}`;
    element('goldCount').textContent = snapshot.sandbox?'∞':String(player.gold);
    const streak = (RULES.streakBonuses as Record<string, number>)[String(Math.min(5, Math.abs(player.streak)))] || 0;
    const interestLimit=interestCap(player.augments||[]);
    const interest = Math.min(interestLimit, Math.floor(player.gold / RULES.interestEveryGold));
    const victory = player.roundVictory ? RULES.victoryIncome : 0;
    element('incomeCount').textContent = `+${RULES.baseIncome + interest + victory + streak}`;
    const streakText = player.streak > 0 ? `${player.streak} vitórias seguidas` : player.streak < 0 ? `${-player.streak} derrotas seguidas` : 'sem sequência';
    this.updateHTML('incomeBreakdown', `<strong>PRÓXIMA RENDA</strong><div>Renda base <b>+${RULES.baseIncome}</b></div><div>Juros (${player.gold} ÷ ${RULES.interestEveryGold}, limite ${interestLimit}) <b>+${interest}</b></div><div>Última vitória <b>+${victory}</b></div><div>Sequência (${streakText}) <b>+${streak}</b></div><hr /><div class="total">Total projetado <b>+${RULES.baseIncome + interest + victory + streak}</b></div><small>Se vencer a próxima batalha, receberá +${RULES.victoryIncome} no pagamento seguinte. Juros e sequência serão recalculados.</small>`);
    const number=element('levelNumber');
    if(number.textContent!==String(player.level)){
      number.textContent=String(player.level);number.classList.remove('xp-level-up');void number.offsetWidth;number.classList.add('xp-level-up');
    }
    const needed=trainerXpNeeded(player.level),atMax=needed<=0;
    element('trainerXpCaption').textContent=atMax?'NÍVEL MÁXIMO':`${player.trainerXp} / ${needed} XP`;
    element('trainerXpFill').style.width=`${atMax?100:100*Math.min(1,player.trainerXp/needed)}%`;
    const buy=element<HTMLButtonElement>('buyXpButton');
    buy.disabled=atMax||player.gold<RULES.trainerProgression.buyXpCost||player.eliminated||snapshot.phase!=='planning';
    buy.innerHTML=atMax?'NÍVEL MÁXIMO':`COMPRAR XP <span>◈ ${RULES.trainerProgression.buyXpCost}</span>`;

  }

  private renderShopInfo(snapshot:GameSnapshot,view:ClientView):void {
    const player=snapshot.players[0];
    const odds = shopOdds(player.level);
    const rarities = ['COMUM', 'INCOMUM', 'RARO', 'ÉPICO', 'LENDÁRIO'];
    this.updateHTML('shopChances', rarities.map((label, i) => `<div class="rarity-chance" title="${label}: peso ${odds[i]}%${odds.reduce((a,b) => a+b,0) !== 100 ? ' (pesos normalizados no sorteio)' : ''}"><i style="background:${RARITY_COLORS[i]}"></i><span>${label}</span><b>${odds[i]}%</b></div>`).join(''));
    const influence = typeInfluence(player);
    const topTypes = (Object.keys(influence.points) as Element[])
      .filter(type=>(influence.points[type]||0)>0)
      .sort((a,b)=>(influence.points[b]||0)-(influence.points[a]||0)||a.localeCompare(b)).slice(0,4);
    const visibleTotal=topTypes.reduce((sum,type)=>sum+(influence.points[type]||0),0);
    let sweep=0;
    const wheelStops=topTypes.map(type=>{
      const from=sweep;
      sweep+=(influence.points[type]||0)/visibleTotal*100;
      return `${ELEMENTS[type].color} ${from.toFixed(3)}% ${sweep.toFixed(3)}%`;
    });
    const legend=topTypes.map(type=>`<div class="type-wheel-legend-row"><i style="background:${ELEMENTS[type].color}"></i>${typeIcon(type,16)}<span>${safe(ELEMENTS[type].name)}</span><b>${((influence.shares[type]||0)*100).toFixed(1)}%</b></div>`).join('');
    const summary=topTypes.length?topTypes.map(type=>`${ELEMENTS[type].name} ${((influence.shares[type]||0)*100).toFixed(0)}%`).join(', '):'Sem tipos ativos';
    this.updateHTML('typeInfluence',`<div class="type-wheel" tabindex="0" role="img" aria-label="Influência dos tipos: ${safe(summary)}" title="${safe(summary)}"><div class="type-wheel-chart" style="background:conic-gradient(${wheelStops.length?wheelStops.join(','):'#334952 0% 100%'})"><span>TIPOS</span></div><div class="type-wheel-popover" role="tooltip"><strong>INFLUÊNCIA DA EQUIPE</strong>${legend||'<small>Coloque Pokémon no campo ou banco</small>'}<small>Exibe até 4 tipos. Fatias proporcionais aos tipos exibidos; percentuais reais da equipe.</small></div></div>`);
    const freeShopReroll=(player.augmentCounters?.['B02:free']||0)>0;
    element('rerollButton').toggleAttribute('disabled', snapshot.phase === 'finished' || (!freeShopReroll&&player.gold < RULES.rerollCost) || player.eliminated);
    element('rerollButton').setAttribute('title',freeShopReroll?'Atualização gratuita do Comprador Persistente':`Atualizar loja por ${RULES.rerollCost} de ouro`);
    const shopRerollCost=element('rerollButton').querySelector('small');if(shopRerollCost)shopRerollCost.textContent=freeShopReroll?'GRÁTIS':`◈ ${RULES.rerollCost}`;
    element('lockButton').classList.toggle('locked', player.locked);
    this.updateHTML('lockButton', player.locked ? '▣' : '◇');
    element('lockButton').setAttribute('aria-label', player.locked ? 'Destravar loja' : 'Travar loja');
    element('lockButton').setAttribute('title', player.locked ? 'Destravar loja' : 'Travar loja');

  }

  private renderTimeline(snapshot:GameSnapshot,view:ClientView):void {
    const player=snapshot.players[0];
    const timeline = Array.from({ length: PHASES.stagesPerChapter }, (_, i) => {
        const stage = i + 1;
        const outcome = player.history[(snapshot.chapter - 1) * PHASES.stagesPerChapter + i];
        const state = stage === snapshot.stage ? 'current' : outcome === 'win' ? 'victory' : outcome === 'loss' || outcome === 'fourth' ? 'defeat' : outcome ? 'neutral' : 'next';
        const type = PHASES.stages[i].type;
        return `<div class="chapter-dot ${state} ${type}" title="${snapshot.chapter}-${stage} • ${PHASES.stages[i].name}${outcome ? ` • ${outcome}` : ''}" aria-label="Etapa ${snapshot.chapter}-${stage}"><i></i><small>${stage}</small></div>`;
      }).join('');
    this.updateHTML('chapterTrack', timeline);
    element('stageName').textContent = snapshot.stageName.toUpperCase();

  }

  private renderShopOffers(snapshot:GameSnapshot,view:ClientView):void {
    const player=snapshot.players[0];
    const influence=typeInfluence(player);
    const shopHtml = player.shop.map((offer: ShopOffer | null, i) => {
      if (!offer) return '<div class="shop-empty"></div>';
      const data = SPECIES[offer.family];
      // Some V22.5 species define range only by rangeClass/stage. Never read their absent
      // legacy species.range: it throws in rangeLabel and used to freeze the entire HUD.
      const stage=getStageData(offer.family,0);
      const disabled = player.gold < offer.price || snapshot.phase === 'finished' || player.eliminated;
      return `<button class="shop-card" data-shop="${i}" data-shop-offer="${offer.id}" style="--rarity:${RARITY_COLORS[offer.rarity - 1]};--glow:${data.glow}" ${disabled?'disabled':''} title="${safe(data.ability)} • ${stage.energy} de energia • alcance ${rangeLabel(stage.range)} • bônus de tipo +${(100*typeBonus(offer.family,influence.shares)).toFixed(1)}%" aria-label="Comprar ${safe(data.names[0])} por ${offer.price} de ouro">
        <div class="shop-portrait">${portrait(offer.family,128)}</div>
        <div class="shop-card-footer"><div class="shop-card-identity"><span class="shop-name">${safe(data.names[0])}</span><span class="shop-type">${data.elements.map(type=>typeIcon(type,18)).join('')}</span></div><span class="shop-cost"><i>◈</i>${offer.price}</span></div></button>`;
    }).join('');
    this.updateHTML('shopCards', shopHtml);

  }

  private renderSynergies(snapshot:GameSnapshot,view:ClientView):void {
    const player=snapshot.players[0];
    const watched = snapshot.players.find(p => p.id === view.scoutId) || player;
    this.synergyPanel.update(watched);

  }

  private renderRanking(snapshot:GameSnapshot,view:ClientView):void {
    const ranked = [...snapshot.players].sort((a, b) => Number(a.eliminated) - Number(b.eliminated) || b.health - a.health || a.name.localeCompare(b.name));
    const possibilities = snapshot.possibleOpponents.p0 || [];
    const pve = snapshot.stageType === 'bot' || snapshot.stageType === 'boss';
    const likely = new Set(snapshot.phase === 'planning' && !pve ? possibilities.flat() : []);
    // Preserve the DOM for unchanged ranking order: CSS dot animations do not restart on each snapshot.
    const rankOrder = ranked.map((p,i)=>`${p.id}:${p.name}:${p.placement||i+1}:${p.eliminated}`).join('|')
      + `|scout:${view.scoutId}|likely:${[...likely].sort().join(',')}`;
    const rankStatus = (id: string): string => snapshot.battleStatuses[id] === 'battling'
      ? 'Batalhando<span class="rank-dots"><i>.</i><i>.</i><i>.</i></span>'
      : snapshot.battleStatuses[id] === 'victorious' ? 'Vitorioso'
      : snapshot.battleStatuses[id] === 'defeated' ? 'Derrotado' : '';
    const shownHp=(p:Player):number => p.health;
    const rowHpClass = (health: number): string => health === 0 ? 'dead' : health < 30 ? 'low' : '';
    if (this.lastRank !== rankOrder || element('rankRows').children.length!==ranked.length || ranked.some((p,i)=>(element('rankRows').children[i] as HTMLElement | undefined)?.dataset.scout!==p.id)) {
      const ranks = ranked.map((p,i)=>`<button class="rank-row ${p.id==='p0'?'you':''} ${view.scoutId===p.id&&p.id!=='p0'?'scouting':''} ${p.eliminated?'out':''}" data-scout="${p.id}" title="${p.id==='p0'?'Sua arena':`Inspecionar arena de ${safe(p.name)}`}" >
        <span class="rank-position">${p.placement||i+1}</span><span class="rank-token"></span><span class="rank-name">${safe(p.name)}</span><span class="rank-combat-status ${snapshot.battleStatuses[p.id]||''}">${rankStatus(p.id)}</span>${likely.has(p.id)?'<span class="match-icon" title="Pode ser seu adversário nesta rodada">⚔</span>':''}<span class="rank-hp ${rowHpClass(shownHp(p))}">${shownHp(p)}</span></button>`).join('');
      element('rankRows').innerHTML = ranks;
      this.lastRank = rankOrder;
    } else {
      const nodes = element('rankRows').children;
      ranked.forEach((p,i)=>{
        const row = nodes[i] as HTMLElement;
        const hp = row.querySelector<HTMLElement>('.rank-hp');
        const status = row.querySelector<HTMLElement>('.rank-combat-status');
        if (hp) {
          if (hp.textContent !== String(shownHp(p))) hp.textContent = String(shownHp(p));
          const color = rowHpClass(shownHp(p));
          if (hp.className !== `rank-hp ${color}`) hp.className = `rank-hp ${color}`;
        }
        if (status) {
          const next = rankStatus(p.id);
          if (status.innerHTML !== next) status.innerHTML = next;
          const state = snapshot.battleStatuses[p.id] || '';
          if (status.className !== `rank-combat-status ${state}`) status.className = `rank-combat-status ${state}`;
        }
      });
    }

  }

  private renderCombat(snapshot:GameSnapshot,view:ClientView):void {
    const watched=snapshot.players.find(p=>p.id===view.scoutId)||snapshot.players[0];
    const battle = snapshot.observedId === view.scoutId ? snapshot.visibleBattle : null;
    const opponentId = battle?.participants.find(id => id !== view.scoutId)
      || (view.scoutId === 'p0' ? snapshot.opponentId || snapshot.lastOpponentId : null);
    const battleUnits = snapshot.observedId === view.scoutId ? snapshot.visibleBattle?.units || [] : [];
    const entriesFor = (id: string) => {
      const owner = snapshot.players.find(p => p.id === id);
      const roster = owner?.units.filter(u => u.position.area === 'board') || battleUnits.filter(u => u.playerId === id).map(u => this.fromCombat(u));
      const metricsByUnit = snapshot.combatStats[id] || {};
      return roster.map(unit => {
        const metrics = metricsByUnit[unit.id];
        const combatant = battleUnits.find(u => u.sourceId === unit.id && u.playerId === id);
        const maxHp = combatant?.maxHp || bonusStats(calculateStats(unit.family, unit.level, unit.iv, unit.stage),unit.equipment).hp;
        const hp = combatant ? Math.max(0, combatant.hp) : maxHp;
        const phys = metrics?.physicalDealt || 0, special = metrics?.specialDealt || 0;
        const physicalMitigated = metrics?.blockedPhysical || 0;
        const specialMitigated = metrics?.blockedSpecial || 0;
        const healed = metrics?.healed || 0;
        const barrierAbsorbed = metrics?.barrierAbsorbed || 0;
        const value = this.metric === 'status' ? hp : this.metric === 'damage' ? phys + special : physicalMitigated + specialMitigated + healed;
        return { unit, value, hp, maxHp, phys, special, physicalMitigated, specialMitigated, healed, barrierAbsorbed };
      }).sort((a, b) => b.value - a.value);
    };
    const ownEntries = entriesFor(view.scoutId);
    const enemyEntries = opponentId ? entriesFor(opponentId) : [];
    const max = Math.max(1, ...ownEntries.map(e => e.value), ...enemyEntries.map(e => e.value));
    const combatHtml = (entries: ReturnType<typeof entriesFor>) => entries.length ? entries.map(({ unit, value, hp, maxHp, phys, special, physicalMitigated, specialMitigated, healed, barrierAbsorbed }) => {
      const isDamage = this.metric === 'damage', isStatus = this.metric === 'status';
      const valueText = isStatus ? `${Math.ceil(hp)}/${maxHp}` : String(Math.round(value));
      const bar = isDamage
        ? `<div class="damage-split"><div class="physical" style="width:${phys / max * 100}%"></div><div class="special" style="width:${special / max * 100}%"></div></div>`
        : this.metric === 'mitigation'
        ? `<div class="damage-split mitigation-split"><div class="mitigation-def" style="width:${physicalMitigated / max * 100}%"></div><div class="mitigation-spd" style="width:${specialMitigated / max * 100}%"></div><div class="mitigation-heal" style="width:${healed / max * 100}%"></div></div>`
        : `<div class="combat-track"><div class="combat-fill" style="width:${Math.round((isStatus ? hp / maxHp : value / max) * 100)}%;background:${isStatus ? '#83d49f' : SPECIES[unit.family].glow}"></div></div>`;
      return `<div class="combat-entry"><div class="combat-line">
        <span class="combat-mini-shape">${portrait(unit.family, 31, unit.stage,unit.formId)}</span>
        <span class="combat-name">${displayName(unit.family, unit.stage,unit.formId)}</span><span class="combat-val">${valueText}</span></div>${bar}${this.metric === 'mitigation' && barrierAbsorbed > 0 ? `<span class="barrier-absorbed" title="Dano absorvido por barreira, não incluído na mitigação de DEF/SpD">◇ Barreira absorvida: ${Math.round(barrierAbsorbed)}</span>` : ''}</div>`;
    }).join('') + (this.metric === 'damage' ? '<div class="metric-legend"><span><i class="phys"></i>FÍSICO</span><span><i class="spec"></i>ESPECIAL</span></div>' : this.metric === 'mitigation' ? '<div class="metric-legend"><span><i class="def"></i>DEF</span><span><i class="spd"></i>SPD</span><span><i class="heal"></i>CURA</span></div>' : '')
      : '<div style="padding:12px;color:#7c9a9c;font-size:12px">Sem Pokémon em campo</div>';
    const ownHtml = combatHtml(ownEntries), enemyHtml = combatHtml(enemyEntries);
    this.updateHTML('combatRows',ownHtml);
    this.updateHTML('opponentCombatRows',enemyHtml);
    element('combatOwnLabel').textContent = `EQUIPE · ${watched.name}`;
    element('combatSideLabel').textContent = `ADVERSÁRIO · ${snapshot.players.find(p => p.id === opponentId)?.name || opponentId?.replace('bot:', 'BOT ') || '—'}`;
    const toggle = element<HTMLButtonElement>('combatSideButton');
    toggle.classList.toggle('hidden', this.panel !== 'combat');
    toggle.disabled = !opponentId;
    toggle.classList.toggle('active', this.showOpponent && !!opponentId);
    toggle.textContent = this.showOpponent ? '›' : '‹';
    toggle.setAttribute('aria-expanded', String(this.showOpponent && !!opponentId));
    toggle.setAttribute('aria-label', this.showOpponent ? 'Ocultar equipe adversária' : 'Mostrar equipe adversária');
    element('opponentCombatPanel').classList.toggle('hidden', this.panel !== 'combat' || !this.showOpponent || !opponentId);

  }

  private renderStatus(snapshot:GameSnapshot,view:ClientView):void {
    const phaseLabels = { planning: 'PREPARAÇÃO', combat: 'COMBATE', result: 'RESULTADO', finished: 'ENCERRADO' };
    const scout = view.scoutId !== 'p0' ? snapshot.players.find(p => p.id === view.scoutId) : null;
    element('scoutBadge').classList.toggle('hidden', !scout);
    element('scoutName').textContent = scout ? `OBSERVANDO ${scout.name}` : '';
    const pendingCoins = snapshot.visibleBattle?.goldDrops.filter(d => !d.claimed && d.ownerId === 'p0').length || 0;
    if (snapshot.phase === 'planning') {
      element('battleStatus').textContent = scout ? `ARENA DE ${scout.name}` : `PREPARE SUA FORMAÇÃO • ${snapshot.stageName.toUpperCase()}`;
    } else element('battleStatus').textContent = pendingCoins && !scout ? `CLIQUE NAS MOEDAS • ${pendingCoins} PARA COLETAR` : scout ? `ASSISTINDO ${scout.name}` : snapshot.accelerated ? `COMBATE ACELERADO ${RULES.combatAcceleration}×` : snapshot.log || phaseLabels[snapshot.phase];

  }

  private renderInspector(snapshot:GameSnapshot,view:ClientView):void {
    const battleUnits = snapshot.observedId===view.scoutId ? snapshot.visibleBattle?.units || [] : [];
    const inspected = snapshot.players.flatMap(p => p.units.map(unit => ({ unit, owner: p.name })))
      .find(item => item.unit.id === view.selectedId);
    const battleInspected = battleUnits.find(u => u.id === view.selectedId || u.sourceId === view.selectedId);
    const inspectedPokemon = inspected?.unit || (battleInspected ? this.fromCombat(battleInspected) : null);
    const inspectOwner = inspected?.owner || (battleInspected ? snapshot.players.find(p => p.id === battleInspected.playerId)?.name || 'BOT' : '');
    const inspector = inspectedPokemon ? this.inspector(inspectedPokemon, inspectOwner, battleInspected) : '';
    element('unitInspector').classList.toggle('hidden', !inspectedPokemon);
    // The inspector may have been removed/hidden by a screen transition despite an unchanged HTML cache.
    this.updateHTML('unitInspector',inspector);
    if (inspectedPokemon) this.renderInspectorResources(battleInspected, inspectedPokemon);

  }

  private renderFinal(snapshot:GameSnapshot,view:ClientView):void {
    const player=snapshot.players[0];
    const final = snapshot.phase === 'finished';
    element('finalBanner').classList.toggle('hidden', !final);
    if (final) {
      const humanWon = snapshot.winnerId === 'p0';
      element('finalKicker').textContent = humanWon ? 'ÚLTIMO SOBREVIVENTE' : 'PARTIDA ENCERRADA';
      element('finalTitle').textContent = humanWon ? 'VITÓRIA' : 'ELIMINADO';
      element('finalSubtitle').textContent = humanWon ? '1º LUGAR · 8 JOGADORES' : `COLOCAÇÃO ${player.placement || '—'}º · VENCEDOR: ${snapshot.players.find(p => p.id === snapshot.winnerId)?.name}`;
    }
  }

  private renderInspectorResources(battle: CombatUnit | undefined, pokemon: Pokemon): void {
    const stats = battle?.stats || bonusStats(calculateStats(pokemon.family, pokemon.level, pokemon.iv, pokemon.stage,false,false,pokemon.formId),pokemon.equipment);
    const energyNeeded = Math.max(1, battle?.energyNeeded ?? getStageData(pokemon.family, pokemon.stage,pokemon.formId).energy);
    const hp = Math.max(0, battle?.hp ?? stats.hp);
    const maxHp = Math.max(1, battle?.maxHp ?? stats.hp);
    const energy = Math.max(0, battle?.energy ?? 0);
    const panel = element('unitInspector');
    const hpNode = panel.querySelector<HTMLElement>('.inspector-resource-track .hp');
    const energyNode = panel.querySelector<HTMLElement>('.inspector-resource-track .energy');
    if (hpNode) hpNode.style.width = `${Math.min(100, hp / maxHp * 100)}%`;
    if (energyNode) energyNode.style.width = `${Math.min(100, energy / energyNeeded * 100)}%`;
    const values = panel.querySelectorAll<HTMLElement>('.inspector-resource b');
    if (values[0]) values[0].textContent = `${Math.ceil(hp)} / ${Math.ceil(maxHp)}`;
    if (values[1]) values[1].textContent = `${Math.floor(energy)} / ${energyNeeded}`;
    const percents=effectivePercents(battle || {equipment:pokemon.equipment||[],itemStacks:{},itemTimers:{}},battle?.itemNow||0);
    for(const [key,value] of Object.entries(percents)) {
      const element=panel.querySelector<HTMLElement>(`[data-percent="${key}"]`);
      if (element){element.textContent=`${(value*100).toFixed(0)}%`;const original=ITEMS.defaults[key as keyof typeof ITEMS.defaults];element.classList.toggle('stat-mod-up',value>original+.0001);element.classList.toggle('stat-mod-down',value<original-.0001);}
    }
  }

  private fromCombat(unit: CombatUnit): Pokemon {
    return { id: unit.sourceId, family: unit.family, stage: unit.stage, level: unit.level,
      iv: unit.iv, formId:unit.formId,equipment:unit.equipment, xp: 0, position: { area: 'board', col: unit.col, row: unit.row } };
  }

  private inspector(pokemon: Pokemon, owner: string, combatant?: CombatUnit): string {
    const displayFamily=combatant?.family||pokemon.family;
    const displayStage=combatant?.stage??pokemon.stage;
    const displayLevel=combatant?.level??pokemon.level;
    const formId=combatant?.formId||pokemon.formId;
    const mewtwoMode=combatant?.mewtwoMode || (displayFamily==='mewtwo'&&pokemon.position.area==='board'?(pokemon.position.row<=1?'melee':'ranged'):undefined);
    const stage = getStageData(displayFamily,displayStage,formId,mewtwoMode);
    const naturalStats=calculateStats(displayFamily,displayLevel,combatant?.iv||pokemon.iv,displayStage,false,false,formId);
    const stats = combatant?.stats || bonusStats(calculateStats(pokemon.family, pokemon.level, pokemon.iv, pokemon.stage,false,false,pokemon.formId),pokemon.equipment);
    const ivAverage = Object.values(pokemon.iv).reduce((a, b) => a + b, 0) / Object.keys(pokemon.iv).length;
    const power = totalPower(stats);
    const move = ATTACKS.moves[stage.move];
    const description = moveDescription(move);
    const preview = previewAbility(displayFamily,displayStage,stats,formId,mewtwoMode);
    const hp = combatant?.hp??stats.hp;
    const maxHp = Math.max(1,combatant?.maxHp??stats.hp);
    const energy = combatant?.energy??0;
    const energyNeeded = Math.max(1,combatant?.energyNeeded??stage.energy);
    const hpPercent = Math.min(100, hp / maxHp * 100);
    const energyPercent = Math.min(100, energy / energyNeeded * 100);
    const refraction=combatant?.family==='staryu'&&combatant.stage===1&&combatant.refractionUntil>combatant.itemNow;
    const stageRange=refraction ? steppedRange(stage.rangeLevel,1) : stage.range;
    const basicRange=combatant?.range??(stageRange+(pokemon.equipment||[]).filter(item=>item.recipe==='red+red').length*numberParam('longbow','range'));
    const rangeTitle=rangeLabel(basicRange);
    const percents=effectivePercents(combatant||{equipment:pokemon.equipment||[],itemStacks:{},itemTimers:{}},combatant?.itemNow||0);
    const powerClass=modifierClass(power,totalPower(naturalStats));
const statCards = (['atk','def','spa','spd','speed'] as const).map(key =>
      `<div class="inspector-stat" title="${STAT_LABELS[key]} · IV ${pokemon.iv[key]}%">
        <div class="inspector-stat-heading">${statIcon(key)}<span>${STAT_LABELS[key]}</span></div>
        <b class="${modifierClass(stats[key],naturalStats[key])}">${Math.round(stats[key])}</b>
        <small>IV ${pokemon.iv[key]}%</small>
      </div>`).join('');
    const percentCards = ([
      ['critChance','CRÍTICO'],['critDamage','DANO CRÍT'],['vampirism','VAMP'],
      ['durability','DURAB'],['amplification','AMPLIF']
    ] as const).map(([key,label]) =>
      `<div class="inspector-percent" title="${label}">
        <div class="inspector-stat-heading">${statIcon(key)}<small>${label}</small></div>
        <b class="${modifierClass(percents[key],ITEMS.defaults[key])}" data-percent="${key}">${(percents[key]*100).toFixed(0)}%</b>
      </div>`).join('');
    const slots = Array.from({length:ITEMS.maxSlots},(_,index)=>{
      const item=pokemon.equipment?.[index];
      const tag=owner==='VOCÊ'?'button':'span';
      return `<${tag} ${tag==='button'?'type="button"':''} class="inspector-slot ${item?'occupied':''}" data-gear-slot="${index}" data-gear-unit="${pokemon.id}" title="${item?safe(itemTooltip(item)):'Espaço livre'}" ${item?'data-item-tooltip="'+safe(itemTooltip(item))+'"':''} ${tag==='span'?'tabindex="0" aria-disabled="true"':''}>${item?icon(item):'<span class="inspector-empty-slot">+</span>'}</${tag}>`;
    }).join('');
    return `<div class="inspector-top">
      <div class="inspector-portrait">${portrait(displayFamily,64,displayStage,formId)}</div>
      <div class="inspector-identity">
        <div class="inspector-name" title="${safe(displayName(displayFamily,displayStage,formId))}">${safe(displayName(displayFamily,displayStage,formId))}${combatant?.ditto?.active?' · DITTO':''}${formId?'<small class="mega-label">✦ MEGA</small>':''}</div>
        <div class="inspector-header-types">${stage.elements.map(t=>typeIcon(t,19)).join('')}${mewtwoMode?'<span class="inspector-mode">'+safe(mewtwoMode.toUpperCase())+'</span>':''}</div>
      </div>
      <div class="inspector-level" title="${pokemon.xp} XP"><small>NÍVEL</small><b>${displayLevel}</b></div>
    </div>
    <div class="inspector-resources" aria-label="Vida e energia">
      <div class="inspector-resource"><span>VIDA</span><div class="inspector-resource-track"><i class="hp" style="width:${hpPercent}%"></i></div><b>${Math.ceil(hp)} / ${Math.ceil(maxHp)}</b></div>
      <div class="inspector-resource"><span>ENERGIA</span><div class="inspector-resource-track"><i class="energy" style="width:${energyPercent}%"></i></div><b>${Math.floor(energy)} / ${energyNeeded}</b></div>
    </div>
    <div class="inspector-equipment">
      <div class="inspector-equipment-row" aria-label="Até três itens equipados">${slots}</div>
      <div class="inspector-equipment-summary">
        <div><span>IV MÉDIO</span><b>${ivAverage.toFixed(1).replace('.',',')}${Object.values(pokemon.iv).every(v=>v===100)?' ✦':''}</b></div>
        <div><span>PODER TOTAL</span><b class="${powerClass}">${power.toLocaleString('pt-BR')}</b></div>
      </div>
    </div>
    <div class="inspector-stats" aria-label="Atributos e IV individuais">${statCards}</div>
    <div class="inspector-percentages" aria-label="Atributos percentuais">${percentCards}</div>
    <div class="inspector-ability-wrap">
      <span class="inspector-ability-label">HABILIDADE CARREGADA</span>
      <div class="inspector-ability-row">
        <button type="button" class="inspector-ability" aria-describedby="inspectorAbilityTooltip" title="Passe o mouse para conhecer a habilidade">${safe(move.name)}</button>
        <div class="inspector-range" title="Alcance de ataque regular: ${rangeTitle}"><small>ALCANCE</small><b>${rangeTitle}</b></div>
        <div id="inspectorAbilityTooltip" class="inspector-ability-tooltip" role="tooltip"><strong>${safe(move.name)}</strong><div class="inspector-ability-meta">CUSTO: ${stage.energy} ENERGIA <span>•</span> ALCANCE: ${rangeLabel(stage.range)}</div><p>${safe(description)}</p><div class="inspector-damage-list">${damageRows(preview)}</div><small class="inspector-damage-note">Valores antes da defesa, tipos e escudos do alvo.</small></div>
      </div>
    </div>`;

  }
}
