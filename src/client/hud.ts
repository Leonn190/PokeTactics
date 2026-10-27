import { calculateStats, displayName, EEVEE_BRANCHES, ELEMENTS, PHASES, RARITY_COLORS, RULES, SPECIES, getStageData, ATTACKS } from '../../server/data';
import { totalPower } from '../../server/formulas';
import { shopOdds, typeBonus, typeInfluence } from '../../server/shop';
import { moveDescription } from './menus';
import type { CombatUnit, Element, GameSnapshot, Pokemon, ShopOffer, Stats } from '../../server/types';
import type { ClientView } from './arena';

const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const safe = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const STAT_LABELS: Record<keyof Stats, string> = { hp: 'VIDA', speed: 'VEL', atk: 'ATK', def: 'DEF', spa: 'SPA', spd: 'SPD' };

const base = import.meta.env.BASE_URL;
const typeIcon = (type: Element, size = 18): string => ['ground','rock','steel','dark','fairy'].includes(type)
  ? `<span class="type-fallback" title="${safe(ELEMENTS[type].name)}" style="width:${size}px;height:${size}px;background:${ELEMENTS[type].color}">${ELEMENTS[type].name.slice(0,2).toUpperCase()}</span>`
  : `<img class="type-icon" src="${base}tipos/${type}.svg" width="${size}" height="${size}" alt="${safe(ELEMENTS[type].name)}" title="${safe(ELEMENTS[type].name)}" />`;
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
  private lastOpponentCombat = '';
  private lastInspector = '';
  private lastTimeline = '';
  private panel: 'rank' | 'combat' = 'rank';
  private metric: 'status' | 'damage' | 'mitigation' = 'status';
  private showOpponent = false;
  private latestSnapshot: GameSnapshot | null = null;
  private latestView: ClientView | null = null;
  private toastTimer = 0;

  constructor() {
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

  toast(message: string): void {
    const node = element('toast');
    node.textContent = message; node.classList.remove('hidden');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => node.classList.add('hidden'), 1800);
  }

  render(snapshot: GameSnapshot, view: ClientView): void {
    this.latestSnapshot = snapshot;
    this.latestView = view;
    const player = snapshot.players[0];
    const choosing = (player.pendingEvolution?.length || 0) === 4;
    element('eeveeEvolution').classList.toggle('hidden', !choosing);
    if (choosing) element('eeveeBranches').innerHTML = EEVEE_BRANCHES.map(branch => {
      const s = SPECIES[branch], move = ATTACKS.moves[s.attack];
      return `<button class="evolution-choice" data-eevee-branch="${branch}" style="--evo-glow:${s.glow}">
        ${portrait(branch,70)}<strong>${s.names[0]}</strong><small>${s.elements.map(t=>typeIcon(t,16)).join('')} ${safe(move.name)}</small></button>`;
    }).join('');
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
    element('lockButton').innerHTML = player.locked ? '▣' : '◇';
    element('lockButton').setAttribute('aria-label', player.locked ? 'Destravar loja' : 'Travar loja');
    element('lockButton').setAttribute('title', player.locked ? 'Destravar loja' : 'Travar loja');

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
          <div class="shop-portrait">${portrait(offer.family, 100)}</div><div class="shop-card-footer"><span class="shop-name">${data.names[0]}</span>
          <span class="shop-type">${data.elements.map(type => typeIcon(type, 18)).join('')}</span>
          <span class="shop-cost"><i>◈</i>${offer.price}</span></div></button>`;
    }).join('');
    if (shopHtml !== this.lastShop) { element('shopCards').innerHTML = shopHtml; this.lastShop = shopHtml; }

    const watched = snapshot.players.find(p => p.id === view.scoutId) || player;
    const counts: Partial<Record<Element, number>> = {};
    const unique = new Set<string>();
    watched.units.filter(u => u.position.area === 'board').forEach(u => {
      const key = `${u.family}:${u.stage}`;
      if (unique.has(key)) return;
      unique.add(key);
      getStageData(u.family, u.stage).elements.forEach(type => counts[type] = (counts[type] || 0) + 1);
    });
    const traitsHtml = (Object.keys(ELEMENTS) as Element[]).filter(type => !!counts[type]).map(type => {
      const trait = ELEMENTS[type], count = counts[type] || 0;
      return `<div class="trait-row ${count ? 'active' : ''}" title="${trait.name}: ${count} Pokémon diferentes em campo; sem bônus de sinergia">${typeIcon(type, 24)}<span class="trait-name">${trait.name}</span><span class="trait-count">${count}</span></div>`;
    }).join('') || '<div class="traits-empty">Nenhum tipo em campo</div>';
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
        const maxHp = combatant?.maxHp || calculateStats(unit.family, unit.level, unit.iv, unit.stage).hp;
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
        <span class="combat-mini-shape">${portrait(unit.family, 31, unit.stage)}</span>
        <span class="combat-name">${displayName(unit.family, unit.stage)}</span><span class="combat-val">${valueText}</span></div>${bar}${this.metric === 'mitigation' && barrierAbsorbed > 0 ? `<span class="barrier-absorbed" title="Dano absorvido por barreira, não incluído na mitigação de DEF/SpD">◇ Barreira absorvida: ${Math.round(barrierAbsorbed)}</span>` : ''}</div>`;
    }).join('') + (this.metric === 'damage' ? '<div class="metric-legend"><span><i class="phys"></i>FÍSICO</span><span><i class="spec"></i>ESPECIAL</span></div>' : this.metric === 'mitigation' ? '<div class="metric-legend"><span><i class="def"></i>DEF</span><span><i class="spd"></i>SPD</span><span><i class="heal"></i>CURA</span></div>' : '')
      : '<div style="padding:12px;color:#7c9a9c;font-size:12px">Sem Pokémon em campo</div>';
    const ownHtml = combatHtml(ownEntries), enemyHtml = combatHtml(enemyEntries);
    if (ownHtml !== this.lastCombat) { element('combatRows').innerHTML = ownHtml; this.lastCombat = ownHtml; }
    if (enemyHtml !== this.lastOpponentCombat) { element('opponentCombatRows').innerHTML = enemyHtml; this.lastOpponentCombat = enemyHtml; }
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

    const scout = view.scoutId !== 'p0' ? snapshot.players.find(p => p.id === view.scoutId) : null;
    element('scoutBadge').classList.toggle('hidden', !scout);
    element('scoutName').textContent = scout ? `OBSERVANDO ${scout.name}` : '';
    const pendingCoins = snapshot.visibleBattle?.goldDrops.filter(d => !d.claimed && d.ownerId === 'p0').length || 0;
    if (snapshot.phase === 'planning') {
      element('battleStatus').textContent = scout ? `ARENA DE ${scout.name}` : `PREPARE SUA FORMAÇÃO • ${snapshot.stageName.toUpperCase()}`;
    } else element('battleStatus').textContent = pendingCoins && !scout ? `CLIQUE NAS MOEDAS • ${pendingCoins} PARA COLETAR` : scout ? `ASSISTINDO ${scout.name}` : snapshot.accelerated ? `COMBATE ACELERADO ${RULES.combatAcceleration}×` : snapshot.log || phaseLabels[snapshot.phase];

    const inspected = snapshot.players.flatMap(p => p.units.map(unit => ({ unit, owner: p.name })))
      .find(item => item.unit.id === view.selectedId);
    const battleInspected = battleUnits.find(u => u.id === view.selectedId || u.sourceId === view.selectedId);
    const inspectedPokemon = inspected?.unit || (battleInspected ? this.fromCombat(battleInspected) : null);
    const inspectOwner = inspected?.owner || (battleInspected ? snapshot.players.find(p => p.id === battleInspected.playerId)?.name || 'BOT' : '');
    const inspector = inspectedPokemon ? this.inspector(inspectedPokemon, inspectOwner, battleInspected) : '';
    element('unitInspector').classList.toggle('hidden', !inspectedPokemon);
    if (inspector !== this.lastInspector) { element('unitInspector').innerHTML = inspector; this.lastInspector = inspector; }
    const liveHp = document.getElementById('inspectorCombatHp');
    if (liveHp && battleInspected) liveHp.textContent = `VIDA NO COMBATE ${Math.ceil(battleInspected.hp)} / ${Math.ceil(battleInspected.maxHp)}`;

    const final = snapshot.phase === 'finished';
    element('finalBanner').classList.toggle('hidden', !final);
    if (final) {
      const humanWon = snapshot.winnerId === 'p0';
      element('finalKicker').textContent = humanWon ? 'ÚLTIMO SOBREVIVENTE' : 'PARTIDA ENCERRADA';
      element('finalTitle').textContent = humanWon ? 'VITÓRIA' : 'ELIMINADO';
      element('finalSubtitle').textContent = humanWon ? '1º LUGAR · 8 JOGADORES' : `COLOCAÇÃO ${player.placement || '—'}º · VENCEDOR: ${snapshot.players.find(p => p.id === snapshot.winnerId)?.name}`;
    }
  }

  private fromCombat(unit: CombatUnit): Pokemon {
    return { id: unit.sourceId, family: unit.family, stage: unit.stage, level: unit.level,
      iv: unit.iv, xp: 0, position: { area: 'board', col: unit.col, row: unit.row } };
  }

  private inspector(pokemon: Pokemon, owner: string, combatant?: CombatUnit): string {
    const data = SPECIES[pokemon.family];
    const stage = getStageData(pokemon.family, pokemon.stage);
    const stats = calculateStats(pokemon.family, pokemon.level, pokemon.iv, pokemon.stage);
    const ivAverage = Object.values(pokemon.iv).reduce((a, b) => a + b, 0) / Object.keys(pokemon.iv).length;
    const power = totalPower(stats);
    const move = ATTACKS.moves[stage.move];
    const description = moveDescription(move);
    return `<div class="inspector-top">${portrait(pokemon.family, 56, pokemon.stage)}<div><div class="inspector-name">${safe(displayName(pokemon.family, pokemon.stage))}</div><div class="inspector-sub">${safe(owner)} · NÍVEL ${pokemon.level} · ALCANCE ${stage.range}</div></div></div>
      <div class="inspector-totals"><span>PODER TOTAL <b>${power.toLocaleString('pt-BR')}</b></span><span>IV MÉDIO <b>${ivAverage.toFixed(1).replace('.', ',')}</b></span></div>
      <div class="inspector-stats">${(Object.keys(stats) as Array<keyof Stats>).map(key => `<div class="inspector-stat" title="IV: ${pokemon.iv[key]}%"><small>${STAT_LABELS[key]}</small><b>${stats[key]} <small style="color:#819a9a">${pokemon.iv[key]} IV</small></b></div>`).join('')}</div>
      <div class="inspector-ability-wrap"><span class="inspector-ability-label">HABILIDADE CARREGADA</span><button type="button" class="inspector-ability" aria-describedby="inspectorAbilityTooltip" title="Passe o mouse para conhecer o ataque">${safe(move.name)}</button><div id="inspectorAbilityTooltip" class="inspector-ability-tooltip" role="tooltip"><strong>${safe(move.name)}</strong><div class="inspector-ability-meta">CUSTO: ${stage.energy} ENERGIA <span>•</span> ALCANCE: ${stage.range}</div><p>${safe(description)}</p></div></div>
      <div class="inspector-footer">${combatant ? '<span id="inspectorCombatHp" class="inspector-live-hp"></span>' : ''}<div class="inspector-types">${stage.elements.map(t => typeIcon(t, 20)).join('')}${owner === 'VOCÊ' ? '<span>E para vender</span>' : ''}</div></div>`;
  }
}
