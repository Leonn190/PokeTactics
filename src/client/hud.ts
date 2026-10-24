import { BENCH_SIZE, calculateStats, displayName, ELEMENTS, RARITY_COLORS, SPECIES } from '../../server/data';
import type { Element, GameSnapshot, Pokemon, ShopOffer, Stats } from '../../server/types';
import type { ClientView } from './arena';

const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const safe = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const STAT_LABELS: Record<keyof Stats, string> = { hp: 'VIDA', speed: 'VEL', atk: 'ATK', def: 'DEF', spa: 'SPA', spd: 'SPD' };

function shape(family: keyof typeof SPECIES, size: number, stage = 0): string {
  const s = SPECIES[family];
  return `<span class="shape ${s.shape} ${stage ? 'evolved' : ''}" style="height:${size}px;width:${size}px;--shape-color:${s.color};--shape-glow:${s.glow}"></span>`;
}

export class Hud {
  private lastBench = '';
  private lastShop = '';
  private lastTraits = '';
  private lastRank = '';
  private lastCombat = '';
  private lastInspector = '';
  private lastChapter = -1;
  private panel: 'rank' | 'combat' = 'rank';
  private metric: 'dealt' | 'taken' | 'healed' | 'blocked' = 'dealt';
  private toastTimer = 0;

  constructor() {
    element('benchSlots').innerHTML = Array.from({ length: BENCH_SIZE }, (_, i) => `<div class="bench-slot" data-bench="${i}"><span class="bench-index">${i + 1}</span></div>`).join('');
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
    element('phaseLabel').textContent = phaseLabels[snapshot.phase];
    element('roundLabel').textContent = `${snapshot.chapter} — ${((snapshot.round - 1) % 3) + 1}`;
    element('countdown').textContent = snapshot.phase === 'finished' ? '—' : String(Math.ceil(snapshot.timeLeft));
    element('goldCount').textContent = String(player.gold);
    element('incomeCount').textContent = `+${5 + Math.min(3, Math.floor(player.gold / 10)) + (player.lastWin ? 1 : 0)}`;
    element('levelNumber').textContent = String(player.level);
    const fielded = player.units.filter(unit => unit.position.area === 'board');
    element('fieldCount').textContent = `${fielded.length} / ${player.level}`;
    element('benchCapacity').textContent = `${player.units.filter(u => u.position.area === 'bench').length} / 10`;
    element('rerollButton').toggleAttribute('disabled', snapshot.phase !== 'planning' || player.gold < 2 || player.eliminated);
    element('lockButton').classList.toggle('locked', player.locked);
    element('lockButton').innerHTML = player.locked ? '▣ <span>TRAVADA</span>' : '◇ <span>TRAVAR</span>';

    if (snapshot.chapter !== this.lastChapter) {
      element('chapterTrack').innerHTML = Array.from({ length: 10 }, (_, i) => {
        const chapter = i + 1;
        const state = chapter < snapshot.chapter ? 'past' : chapter === snapshot.chapter ? 'current' : 'next';
        return `<div class="chapter ${state}" title="Capítulo ${chapter}">${chapter}</div>`;
      }).join('');
      this.lastChapter = snapshot.chapter;
    }

    const benchHtml = Array.from({ length: BENCH_SIZE }, (_, index) => {
      const unit = player.units.find(u => u.position.area === 'bench' && u.position.index === index);
      return `<div class="bench-slot ${unit ? 'occupied' : ''} ${view.selectedId === unit?.id ? 'selected' : ''}" data-bench="${index}" ${unit ? `data-unit="${unit.id}"` : ''}>
        <span class="bench-index">${index + 1}</span>${unit ? `<div class="bench-unit">${shape(unit.family, 27, unit.stage)}<small>${displayName(unit.family, unit.stage)}</small></div>` : ''}</div>`;
    }).join('');
    if (benchHtml !== this.lastBench) { element('benchSlots').innerHTML = benchHtml; this.lastBench = benchHtml; }

    const shopHtml = player.shop.map((offer: ShopOffer | null, i) => {
      if (!offer) return '<div class="shop-empty"></div>';
      const data = SPECIES[offer.family];
      const disabled = player.gold < offer.price || snapshot.phase !== 'planning' || player.eliminated;
      return `<button class="shop-card" data-shop="${i}" style="--rarity:${RARITY_COLORS[offer.rarity - 1]};--glow:${data.glow}" ${disabled ? 'disabled' : ''} title="${data.ability} • ${data.energy} de energia • alcance ${data.range}">
          <div class="shop-portrait">${shape(offer.family, 38)}</div><div class="shop-name">${data.names[0]}</div>
          <div class="shop-type">${data.elements.map(type => ELEMENTS[type].name).join(' / ')}</div>
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
      return `<div class="trait-row ${count ? 'active' : ''}" title="${trait.description}"><span class="trait-emblem" style="color:${trait.color}"><i>${trait.name[0]}</i></span><span class="trait-name">${trait.name}</span><span class="trait-count">${count}</span></div>`;
    }).join('');
    if (this.lastTraits !== traitsHtml) { element('traitRows').innerHTML = traitsHtml; this.lastTraits = traitsHtml; }

    const ranked = [...snapshot.players].sort((a, b) => Number(a.eliminated) - Number(b.eliminated) || b.health - a.health || a.name.localeCompare(b.name));
    const ranks = ranked.map((p, i) => `<button class="rank-row ${p.id === 'p0' ? 'you' : ''} ${view.scoutId === p.id && p.id !== 'p0' ? 'scouting' : ''} ${p.eliminated ? 'out' : ''}" data-scout="${p.id}" title="${p.id === 'p0' ? 'Sua arena' : `Inspecionar arena de ${p.name}`}">
      <span class="rank-position">${p.placement || i + 1}</span><span class="rank-token"></span><span class="rank-name">${p.name}</span><span class="rank-hp ${p.health === 0 ? 'dead' : p.health < 30 ? 'low' : ''}">${p.health}</span></button>`).join('');
    if (this.lastRank !== ranks) { element('rankRows').innerHTML = ranks; this.lastRank = ranks; }

    const statsForView = snapshot.combatStats[view.scoutId] || snapshot.combatStats.p0 || {};
    const owner = snapshot.players.find(p => p.id === view.scoutId) || player;
    const entries = owner.units.map(unit => ({ unit, value: statsForView[unit.id]?.[this.metric] || 0 }))
      .filter(item => item.unit.position.area === 'board').sort((a, b) => b.value - a.value);
    const max = Math.max(1, ...entries.map(e => e.value));
    const combatHtml = entries.length ? entries.map(({ unit, value }) => `<div class="combat-entry"><div class="combat-line">
      <span class="combat-mini-shape">${shape(unit.family, 14, unit.stage)}</span>
      <span class="combat-name">${displayName(unit.family, unit.stage)}</span><span class="combat-val">${Math.round(value)}</span></div>
      <div class="combat-track"><div class="combat-fill" style="width:${Math.round(value / max * 100)}%;background:${SPECIES[unit.family].glow}"></div></div></div>`).join('') : '<div style="padding:12px;color:#7c9a9c;font-size:12px">Sem Pokémon em campo</div>';
    if (combatHtml !== this.lastCombat) { element('combatRows').innerHTML = combatHtml; this.lastCombat = combatHtml; }

    const scout = view.scoutId !== 'p0' ? snapshot.players.find(p => p.id === view.scoutId) : null;
    element('scoutBadge').classList.toggle('hidden', !scout || snapshot.phase !== 'planning');
    element('scoutName').textContent = scout ? `OBSERVANDO ${scout.name}` : '';
    if (snapshot.phase === 'planning') {
      element('battleStatus').textContent = scout ? `ARENA DE ${scout.name}` : 'PREPARE SUA FORMAÇÃO';
    } else element('battleStatus').textContent = snapshot.log || phaseLabels[snapshot.phase];

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
    return `<div class="inspector-top">${shape(pokemon.family, 35, pokemon.stage)}<div><div class="inspector-name">${safe(displayName(pokemon.family, pokemon.stage))}</div><div class="inspector-sub">NÍVEL ${pokemon.level} · ALCANCE ${data.range}</div></div></div>
      <div class="inspector-stats">${(Object.keys(stats) as Array<keyof Stats>).map(key => `<div class="inspector-stat" title="IV: ${pokemon.iv[key]}%"><small>${STAT_LABELS[key]}</small><b>${stats[key]} <small style="color:#819a9a">${pokemon.iv[key]} IV</small></b></div>`).join('')}</div>
      <div class="inspector-footer">${safe(data.ability)} · ${data.energy} energia<br />${data.elements.map(t => ELEMENTS[t].name).join(' / ')} · <span style="color:#d9bc8f">E para vender</span></div>`;
  }
}
