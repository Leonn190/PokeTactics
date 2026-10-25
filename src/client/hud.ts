import { calculateStats, displayName, ELEMENTS, PHASES, RARITY_COLORS, RULES, SPECIES } from '../../server/data';
import { shopOdds, typeBonus, typeInfluence } from '../../server/shop';
import type { Element, GameSnapshot, Pokemon, ShopOffer, Stats } from '../../server/types';
import type { ClientView } from './arena';

const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const safe = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const STAT_LABELS: Record<keyof Stats, string> = { hp: 'VIDA', speed: 'VEL', atk: 'ATK', def: 'DEF', spa: 'SPA', spd: 'SPD' };

const base = import.meta.env.BASE_URL;
const typeIcon = (type: Element, size = 18): string => `<img class="type-icon" src="${base}tipos/${type}.svg" width="${size}" height="${size}" alt="${safe(ELEMENTS[type].name)}" title="${safe(ELEMENTS[type].name)}" />`;
function portrait(family: keyof typeof SPECIES, size: number, stage = 0): string {
  const s = SPECIES[family];
  const id = s.pokedexIds[Math.min(stage, s.pokedexIds.length - 1)];
  return `<img class="pokemon-portrait" src="${base}portrait/${String(id).padStart(4, '0')}/Normal.png" width="${size}" height="${size}" alt="${safe(s.names[Math.min(stage, s.names.length - 1)])}" loading="lazy" draggable="false" />`;
}

export class Hud {
  private lastShop = '';
  private lastTraits = '';
  private lastRank = '';
  private lastCombat = '';
  private lastInspector = '';
  private lastTimeline = '';
  private panel: 'rank' | 'combat' = 'rank';
  private metric: 'status' | 'damage' | 'defense' | 'heal' = 'status';
  private toastTimer = 0;

  constructor() {
    document.querySelectorAll<HTMLButtonElement>('[data-panel]').forEach(button => button.addEventListener('click', () => {
      this.panel = button.dataset.panel as 'rank' | 'combat';
      this.lastCombat = '';
      this.setPanel();
    }));
    document.querySelectorAll<HTMLButtonElement>('[data-metric]').forEach(button => button.addEventListener('click', () => {
      this.metric = button.dataset.metric as typeof this.metric;
      this.lastCombat = '';
      document.querySelectorAll('[data-metric]').forEach(tab => tab.classList.toggle('active', tab === button));
    }));
    this.setPanel();
  }

  private setPanel(): void {
    element('rankPanel').classList.toggle('hidden', this.panel !== 'rank');
    element('combatPanel').classList.toggle('hidden', this.panel !== 'combat');
    element('tabRank').classList.toggle('active', this.panel === 'rank');
    element('tabCombat').classList.toggle('active', this.panel === 'combat');
  }

  toast(message: string): void {
    const node = element('toast');
    node.textContent = message; node.classList.remove('hidden');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => node.classList.add('hidden'), 1800);
  }

  render(snapshot: GameSnapshot, view: ClientView): void {
    const player = snapshot.players[0];
    const phaseLabels = { planning: 'PREPARAÇÃO', combat: 'COMBATE', result: 'RESULTADO', finished: 'ENCERRADO' };
    element('phaseLabel').textContent = snapshot.accelerated ? 'COMBATE ACELERADO' : phaseLabels[snapshot.phase];
    element('roundLabel').textContent = `${snapshot.chapter}-${snapshot.stage}`;
    element('countdown').textContent = snapshot.phase === 'finished' ? '—' : String(Math.ceil(snapshot.timeLeft));
    const progress = element('stageProgress');
    progress.style.width = `${Math.max(0, Math.min(100, snapshot.phaseSeconds ? snapshot.timeLeft / snapshot.phaseSeconds * 100 : 0))}%`;
    progress.classList.toggle('fast', snapshot.accelerated);
    element('goldCount').textContent = String(player.gold);
    const streak = (RULES.streakBonuses as Record<string, number>)[String(Math.min(5, Math.abs(player.streak)))] || 0;
    const interest = Math.min(RULES.maxInterest, Math.floor(player.gold / RULES.interestEveryGold));
    const victory = player.roundVictory ? RULES.victoryIncome : 0;
    element('incomeCount').textContent = `+${RULES.baseIncome + interest + victory + streak}`;
    const streakText = player.streak > 0 ? `${player.streak} vitórias seguidas` : player.streak < 0 ? `${-player.streak} derrotas seguidas` : 'sem sequência';
    element('incomeBreakdown').innerHTML = `<strong>PRÓXIMA RENDA</strong><div>Renda base <b>+${RULES.baseIncome}</b></div><div>Juros (${player.gold} ÷ ${RULES.interestEveryGold}, limite ${RULES.maxInterest}) <b>+${interest}</b></div><div>Última vitória <b>+${victory}</b></div><div>Sequência (${streakText}) <b>+${streak}</b></div><hr /><div class="total">Total projetado <b>+${RULES.baseIncome + interest + victory + streak}</b></div><small>Se vencer a próxima batalha, receberá +${RULES.victoryIncome} no pagamento seguinte. Juros e sequência serão recalculados.</small>`;
    element('levelNumber').textContent = String(player.level);
    const fielded = player.units.filter(unit => unit.position.area === 'board');
    const odds = shopOdds(player.level);
    const rarities = ['COMUM', 'INCOMUM', 'RARO', 'ÉPICO', 'LENDÁRIO'];
    element('shopChances').innerHTML = rarities.map((label, i) => `<div class="rarity-chance" title="${label}: peso ${odds[i]}%${odds.reduce((a,b) => a+b,0) !== 100 ? ' (pesos normalizados no sorteio)' : ''}"><i style="background:${RARITY_COLORS[i]}"></i><span>${label}</span><b>${odds[i]}%</b></div>`).join('');
    const influence = typeInfluence(player);
    const topTypes = (Object.keys(influence.points) as Element[]).sort((a,b) => (influence.points[b] || 0) - (influence.points[a] || 0) || a.localeCompare(b)).slice(0, RULES.typeShopBias.maxShown);
    element('typeInfluence').innerHTML = `<span class="influence-caption" title="Influência de tipos na loja: ativos valem ${RULES.typeShopBias.activePoints} pontos e banco ${RULES.typeShopBias.benchPoints}. Não concede bônus de combate.">TIPOS</span><div class="influence-track">${topTypes.length ? topTypes.map(type => {
      const info = ELEMENTS[type], fraction = influence.shares[type] || 0;
      return `<div class="influence-segment" style="width:${fraction * 100}%;--type-color:${info.color}" title="${info.name}: ${influence.points[type]} pontos • ${(fraction * 100).toFixed(1)}% da influência">${typeIcon(type, 16)}<span>${(fraction * 100).toFixed(0)}%</span></div>`;
    }).join('') : '<span class="influence-empty">Sem tipos</span>'}</div>`;
    element('rerollButton').toggleAttribute('disabled', snapshot.phase === 'finished' || player.gold < RULES.rerollCost || player.eliminated);
    element('lockButton').classList.toggle('locked', player.locked);
    element('lockButton').innerHTML = player.locked ? '▣ <span>TRAVADA</span>' : '◇ <span>TRAVAR</span>';

    const timeline = Array.from({ length: PHASES.stagesPerChapter }, (_, i) => {
        const stage = i + 1;
        const outcome = player.history[(snapshot.chapter - 1) * PHASES.stagesPerChapter + i];
        const state = stage === snapshot.stage ? 'current' : outcome === 'win' ? 'victory' : outcome === 'loss' || outcome === 'fourth' ? 'defeat' : outcome ? 'neutral' : 'next';
        const type = PHASES.stages[i].type;
        return `<div class="chapter-dot ${state} ${type}" title="${snapshot.chapter}-${stage} • ${PHASES.stages[i].name}${outcome ? ` • ${outcome}` : ''}" aria-label="Etapa ${snapshot.chapter}-${stage}"><i></i><small>${stage}</small></div>`;
      }).join('');
    if (timeline !== this.lastTimeline) { element('chapterTrack').innerHTML = timeline; this.lastTimeline = timeline; }
    element('stageName').textContent = snapshot.stageName.toUpperCase();

    const shopHtml = player.shop.map((offer: ShopOffer | null, i) => {
      if (!offer) return '<div class="shop-empty"></div>';
      const data = SPECIES[offer.family];
      const disabled = player.gold < offer.price || snapshot.phase === 'finished' || player.eliminated;
      return `<button class="shop-card" data-shop="${i}" style="--rarity:${RARITY_COLORS[offer.rarity - 1]};--glow:${data.glow}" ${disabled ? 'disabled' : ''} title="${data.ability} • ${data.energy} de energia • alcance ${data.range} • bônus de tipo no peso: +${(100 * typeBonus(offer.family, typeInfluence(player).shares)).toFixed(1)}%">
          <div class="shop-portrait">${portrait(offer.family, 44)}</div><div class="shop-name">${data.names[0]}</div>
          <div class="shop-type">${data.elements.map(type => typeIcon(type, 19)).join('')}</div>
          <div class="shop-cost"><i>◈</i> ${offer.price}</div></button>`;
    }).join('');
    if (shopHtml !== this.lastShop) { element('shopCards').innerHTML = shopHtml; this.lastShop = shopHtml; }

    const counts: Partial<Record<Element, number>> = {};
    const unique = new Set<string>();
    fielded.forEach(u => {
      const key = `${u.family}:${u.stage}`;
      if (unique.has(key)) return;
      unique.add(key);
      SPECIES[u.family].elements.forEach(type => counts[type] = (counts[type] || 0) + 1);
    });
    const traitsHtml = (Object.keys(ELEMENTS) as Element[]).map(type => {
      const trait = ELEMENTS[type], count = counts[type] || 0;
      return `<div class="trait-row ${count ? 'active' : ''}" title="${trait.name}: ${count} Pokémon diferentes em campo; sem bônus de sinergia">${typeIcon(type, 24)}<span class="trait-name">${trait.name}</span><span class="trait-count">${count}</span></div>`;
    }).join('');
    if (this.lastTraits !== traitsHtml) { element('traitRows').innerHTML = traitsHtml; this.lastTraits = traitsHtml; }

    const ranked = [...snapshot.players].sort((a, b) => Number(a.eliminated) - Number(b.eliminated) || b.health - a.health || a.name.localeCompare(b.name));
    const possibilities = snapshot.possibleOpponents.p0 || [];
    const pve = snapshot.stageType === 'bot' || snapshot.stageType === 'boss';
    const likely = new Set(snapshot.phase === 'planning' && !pve ? possibilities.flat() : []);
    const ranks = ranked.map((p, i) => {
      return `<button class="rank-row ${p.id === 'p0' ? 'you' : ''} ${view.scoutId === p.id && p.id !== 'p0' ? 'scouting' : ''} ${p.eliminated ? 'out' : ''}" data-scout="${p.id}" title="${p.id === 'p0' ? 'Sua arena' : `Inspecionar arena de ${p.name}`}">
      <span class="rank-position">${p.placement || i + 1}</span><span class="rank-token"></span><span class="rank-name">${p.name}</span>${likely.has(p.id) ? '<span class="match-icon" title="Pode ser seu adversário nesta rodada">⚔</span>' : ''}<span class="rank-hp ${p.health === 0 ? 'dead' : p.health < 30 ? 'low' : ''}">${p.health}</span></button>`;
    }).join('');
    if (this.lastRank !== ranks) { element('rankRows').innerHTML = ranks; this.lastRank = ranks; }

    const statsForView = snapshot.observedId === view.scoutId ? snapshot.combatStats[view.scoutId] || {} : {};
    const owner = snapshot.players.find(p => p.id === view.scoutId) || player;
    const battleUnits = snapshot.observedId === view.scoutId ? snapshot.visibleBattle?.units || [] : [];
    const entries = owner.units.filter(u => u.position.area === 'board').map(unit => {
      const metrics = statsForView[unit.id];
      const combatant = battleUnits.find(u => u.sourceId === unit.id && u.playerId === owner.id);
      const maxHp = combatant?.maxHp || Math.round(calculateStats(unit.family, unit.level, unit.iv, unit.stage).hp * RULES.combatHealthMultiplier + RULES.combatHealthFlat);
      const hp = combatant ? Math.max(0, combatant.hp) : maxHp;
      const phys = metrics?.physicalDealt || 0, special = metrics?.specialDealt || 0;
      const value = this.metric === 'status' ? hp : this.metric === 'damage' ? phys + special : this.metric === 'defense' ? (metrics?.blocked || 0) : (metrics?.healed || 0);
      return { unit, value, hp, maxHp, phys, special };
    }).sort((a, b) => b.value - a.value);
    const max = Math.max(1, ...entries.map(e => e.value));
    const combatHtml = entries.length ? entries.map(({ unit, value, hp, maxHp, phys, special }) => {
      const isDamage = this.metric === 'damage', isStatus = this.metric === 'status';
      const valueText = isStatus ? `${Math.ceil(hp)}/${maxHp}` : String(Math.round(value));
      const bar = isDamage
        ? `<div class="damage-split"><div class="physical" style="width:${phys / max * 100}%"></div><div class="special" style="width:${special / max * 100}%"></div></div>`
        : `<div class="combat-track"><div class="combat-fill" style="width:${Math.round((isStatus ? hp / maxHp : value / max) * 100)}%;background:${isStatus ? '#83d49f' : SPECIES[unit.family].glow}"></div></div>`;
      return `<div class="combat-entry"><div class="combat-line">
        <span class="combat-mini-shape">${portrait(unit.family, 31, unit.stage)}</span>
        <span class="combat-name">${displayName(unit.family, unit.stage)}</span><span class="combat-val">${valueText}</span></div>${bar}</div>`;
    }).join('') + (this.metric === 'damage' ? '<div class="metric-legend"><span><i class="phys"></i>FÍSICO</span><span><i class="spec"></i>ESPECIAL</span></div>' : '')
      : '<div style="padding:12px;color:#7c9a9c;font-size:12px">Sem Pokémon em campo</div>';
    if (combatHtml !== this.lastCombat) { element('combatRows').innerHTML = combatHtml; this.lastCombat = combatHtml; }

    const scout = view.scoutId !== 'p0' ? snapshot.players.find(p => p.id === view.scoutId) : null;
    element('scoutBadge').classList.toggle('hidden', !scout);
    element('scoutName').textContent = scout ? `OBSERVANDO ${scout.name}` : '';
    const pendingCoins = snapshot.visibleBattle?.goldDrops.filter(d => !d.claimed && d.ownerId === 'p0').length || 0;
    if (snapshot.phase === 'planning') {
      element('battleStatus').textContent = scout ? `ARENA DE ${scout.name}` : `PREPARE SUA FORMAÇÃO • ${snapshot.stageName.toUpperCase()}`;
    } else element('battleStatus').textContent = pendingCoins && !scout ? `CLIQUE NAS MOEDAS • ${pendingCoins} PARA COLETAR` : scout ? `ASSISTINDO ${scout.name}` : snapshot.accelerated ? `COMBATE ACELERADO ${RULES.combatAcceleration}×` : snapshot.log || phaseLabels[snapshot.phase];

    const inspected = player.units.find(u => u.id === view.selectedId);
    const inspector = inspected ? this.inspector(inspected) : '';
    element('unitInspector').classList.toggle('hidden', !inspected);
    if (inspector !== this.lastInspector) { element('unitInspector').innerHTML = inspector; this.lastInspector = inspector; }

    const final = snapshot.phase === 'finished';
    element('finalBanner').classList.toggle('hidden', !final);
    if (final) {
      const humanWon = snapshot.winnerId === 'p0';
      element('finalKicker').textContent = humanWon ? 'ÚLTIMO SOBREVIVENTE' : 'PARTIDA ENCERRADA';
      element('finalTitle').textContent = humanWon ? 'VITÓRIA' : 'ELIMINADO';
      element('finalSubtitle').textContent = humanWon ? '1º LUGAR · 8 JOGADORES' : `COLOCAÇÃO ${player.placement || '—'}º · VENCEDOR: ${snapshot.players.find(p => p.id === snapshot.winnerId)?.name}`;
    }
  }

  private inspector(pokemon: Pokemon): string {
    const data = SPECIES[pokemon.family];
    const stats = calculateStats(pokemon.family, pokemon.level, pokemon.iv, pokemon.stage);
    return `<div class="inspector-top">${portrait(pokemon.family, 42, pokemon.stage)}<div><div class="inspector-name">${safe(displayName(pokemon.family, pokemon.stage))}</div><div class="inspector-sub">NÍVEL ${pokemon.level} · ALCANCE ${data.range}</div></div></div>
      <div class="inspector-stats">${(Object.keys(stats) as Array<keyof Stats>).map(key => `<div class="inspector-stat" title="IV: ${pokemon.iv[key]}%"><small>${STAT_LABELS[key]}</small><b>${stats[key]} <small style="color:#819a9a">${pokemon.iv[key]} IV</small></b></div>`).join('')}</div>
      <div class="inspector-footer">${safe(data.ability)} · ${data.energy} energia<div class="inspector-types">${data.elements.map(t => typeIcon(t, 20)).join('')}<span>E para vender</span></div></div>`;
  }
}
