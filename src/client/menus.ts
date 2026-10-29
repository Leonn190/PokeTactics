import { ATTACKS, ELEMENTS, getStageData, RARITY_COLORS, SPECIES } from '../../server/data';
import type { MoveData } from '../../server/data';
import { previewAbility, previewBasic } from '../../server/damage-preview';
import { damageRows, damageHtml } from './damage-labels';
import type { Family, Stats } from '../../server/types';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const escapeHTML = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const baseUrl = import.meta.env.BASE_URL;
const rarityNames = ['COMUM', 'INCOMUM', 'RARO', 'ÉPICO', 'LENDÁRIO'];
const statNames: Record<keyof Stats, string> = { hp:'VIDA', atk:'ATAQUE', def:'DEFESA', spa:'AT. ESP.', spd:'DEF. ESP.', speed:'VELOCIDADE' };
const evolutionCopies: Record<string, number> = { magikarp:5, exeggcute:4, growlithe:4, shellder:4, eevee:4 };
type Entry = { family: Family; stage: number; name: string; dex: number };
const entries: Entry[] = (Object.keys(SPECIES) as Family[]).flatMap(family => SPECIES[family].names.map((name, stage) => ({
  family, stage, name, dex: SPECIES[family].pokedexIds[stage]
}))).sort((a,b) => a.dex - b.dex || a.name.localeCompare(b.name));

function portrait(dex: number, name: string, className: string): string {
  return `<img class="${className}" src="${baseUrl}portrait/${String(dex).padStart(4,'0')}/Normal.png" alt="${escapeHTML(name)}" loading="lazy" draggable="false" />`;
}

export function moveDescription(move: MoveData): string {
  const effects: Record<MoveData['effect'], string> = {
    drain:'Drena vida do inimigo e restaura a própria vida.',
    burn:'Causa dano e aplica queimadura no alvo.',
    slow:'Causa dano e reduz a velocidade dos adversários.',
    chain:'Lança energia que salta entre inimigos próximos.',
    blast:'Desencadeia uma explosão de dano em área.',
    pollen:'Dispara pólen em área e cura aliados próximos.',
    spin:'Gira, atingindo adversários ao redor e fortalecendo a própria defesa.',
    'flame-strike':'Golpe de fogo poderoso contra um alvo.',
    shock:'Descarga elétrica que se propaga para outros inimigos.',
    'poison-shot':'Projétil que envenena o alvo e causa dano ao longo do tempo.',
    'heal-powder':'Espalha pó curativo entre aliados feridos próximos.',
    sting:'Ferroada concentrada com dano elevado.',
    shield:'Cria uma barreira protetora que absorve dano.',
    multi:'Executa múltiplos golpes consecutivos no mesmo alvo.',
    gas:'Emite gás nocivo que atinge inimigos ao redor.',
    stomp:'Salta e atinge a área, levantando os adversários.',
    'eevee-ball':'Arremessa uma esfera no maior grupo inimigo: seu dano em área gera um efeito para dois aliados próximos.',
    'bone-throw':'Arremessa um osso que enfraquece a defesa do alvo; também reage aos inimigos levantados.',
    'single-knockup':'Golpe pesado em um alvo, causando dano e arremessando-o para cima.',
    'rock-strike':'Desfere uma pancada rochosa de alto dano em um alvo.',
    'withdraw-guard':'Recolhe-se na carapaça e reduz o dano recebido em 60% por um período.',
    'healing-egg':'Joga um ovo curativo no maior grupo de aliados próximos.',
    'rock-charge':'Investe por até duas casas, parando na terceira e levantando inimigos em linha.',
    'piercing-fire':'Dispara fogo em linha reta, atravessando o alvo e os inimigos atrás dele.',
    'dragon-breath':'Projétil dracônico que diminui a velocidade de ataque do alvo em 15% por 2 segundos.',
    'dragon-cyclone':'Tornado dracônico que atinge o alvo e inimigos próximos, reduzindo a velocidade de ataque.',
    'dragon-storm':'Invoca três ondas dracônicas e levanta inimigos na primeira.',
    burrow:'Escava até o inimigo mais distante, emergindo junto dele para causar dano especial.',
    'mew-blessing':'Cura e protege o aliado com menor porcentagem de vida; seus ataques básicos causam dano especial extra por 3 segundos.'
  };
  const conversion = move.conversion;
  const buffs: Record<string,string> = { atk:'ATAQUE', def:'DEFESA', spa:'ATAQUE ESPECIAL', spd:'DEFESA ESPECIAL', speed:'VELOCIDADE' };
  const effect = conversion?.kind === 'stat_buff' ? ` A energia gerada aumenta ${buffs[conversion.stat || 'atk']} dos aliados.`
    : conversion?.kind === 'heal' ? ' Parte do dano vira cura para aliados.'
    : conversion?.kind === 'barrier' ? ' Parte do dano vira escudo para aliados.' : '';
  return (effects[move.effect] || 'Habilidade especial de combate.') + effect;
}

export class Menus {
  private selected: Entry = entries[0];
  private filter: 'all' | 'shop' | 'legendary' = 'all';
  private queued = false;
  private queueTimeout: number | null = null;
  private queueTicker: number | null = null;
  private startAt = 0;

  constructor(private startMatch: () => void) {
    $('findMatchButton').addEventListener('click', () => this.queue());
    $('openRosterButton').addEventListener('click', () => this.showRoster());
    $('rosterBack').addEventListener('click', () => this.showHome());
    $('cancelQueueButton').addEventListener('click', () => this.showHome());
    $('rosterSearch').addEventListener('input', () => this.renderList());
    $('rosterFilters').addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-filter]');
      if (!button) return;
      this.filter = button.dataset.filter as typeof this.filter;
      $('rosterFilters').querySelectorAll('button').forEach(element => element.classList.toggle('active',element === button));
      this.renderList();
    });
    $('rosterGrid').addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-index]');
      if (!button) return;
      this.selected = entries[Number(button.dataset.index)];
      this.renderList(); this.renderDetails();
    });
    this.renderList(); this.renderDetails();
  }

  private screen(name: 'home' | 'roster' | 'queue' | 'game'): void {
    $('menuLayer').classList.toggle('hidden',name === 'game');
    $('homeScreen').classList.toggle('hidden',name !== 'home');
    $('rosterScreen').classList.toggle('hidden',name !== 'roster');
    $('queueScreen').classList.toggle('hidden',name !== 'queue');
  }

  showHome(): void {
    this.queued = false;
    if (this.queueTimeout !== null) window.clearTimeout(this.queueTimeout);
    if (this.queueTicker !== null) window.clearInterval(this.queueTicker);
    this.queueTimeout = null; this.queueTicker = null;
    this.screen('home');
  }

  private showRoster(): void {
    this.screen('roster'); this.renderList(); this.renderDetails();
  }

  private queue(): void {
    this.screen('queue'); this.queued = true;
    this.startAt = performance.now();
    $('queueFill').style.width = '10%';
    $('queueCount').textContent = '1 / 8 TREINADORES';
    this.queueTicker = window.setInterval(() => {
      const progress = Math.min(1,(performance.now() - this.startAt) / 1800);
      const found = Math.min(8, 1 + Math.floor(progress * 7));
      $('queueCount').textContent = `${found} / 8 TREINADORES`;
      $('queueFill').style.width = `${12 + progress * 88}%`;
    },80);
    this.queueTimeout = window.setTimeout(() => {
      if (!this.queued) return;
      this.queued = false;
      if (this.queueTicker !== null) window.clearInterval(this.queueTicker);
      this.queueTicker = null; this.queueTimeout = null;
      this.screen('game'); this.startMatch();
    },1900);
  }

  private renderList(): void {
    const query = $<HTMLInputElement>('rosterSearch').value.trim().toLocaleLowerCase('pt-BR');
    const showing = entries.filter(entry => {
      const species = SPECIES[entry.family];
      if (this.filter === 'shop' && !species.shop) return false;
      if (this.filter === 'legendary' && species.rarity !== 5) return false;
      const move = ATTACKS.moves[getStageData(entry.family,entry.stage).move];
      return !query || `${entry.name} ${species.names.join(' ')} ${species.elements.map(type=>ELEMENTS[type].name).join(' ')} ${move.name}`.toLocaleLowerCase('pt-BR').includes(query);
    });
    $('rosterCount').textContent = `${showing.length} / ${entries.length} POKÉMON`;
    $('rosterGrid').innerHTML = showing.map(entry => {
      const species = SPECIES[entry.family];
      const index = entries.indexOf(entry);
      const active = this.selected === entry;
      return `<button class="roster-card ${active ? 'active' : ''}" data-index="${index}" style="--pokemon-color:${species.glow};--rarity-color:${RARITY_COLORS[species.rarity-1]}"><span class="roster-dex">#${String(entry.dex).padStart(3,'0')}</span>${portrait(entry.dex,entry.name,'roster-card-art')}<strong>${escapeHTML(entry.name)}</strong><small>${rarityNames[species.rarity-1]}</small></button>`;
    }).join('') || '<p class="roster-empty">Nenhum Pokémon encontrado. Tente outro nome ou filtro.</p>';
  }

  private renderDetails(): void {
    const { family, stage, name, dex } = this.selected;
    const species = SPECIES[family];
    const data = getStageData(family, stage);
    const move = ATTACKS.moves[data.move];
    const stats = species.stageBases?.[stage] || species.base;
    const total = Math.round(stats.hp / 5 + stats.atk + stats.def + stats.spa + stats.spd + stats.speed);
    const damage = previewAbility(family, stage, stats);
    const basic = previewBasic(family, stage, stats);
    const chain = species.eeveeBranch ? ['Eevee', name] : species.names;
    const copies = evolutionCopies[family] || 3;
    $('rosterDetails').innerHTML = `<div class="detail-splash" style="--detail-glow:${species.glow}"><div class="detail-title"><span>#${String(dex).padStart(3,'0')} • ${rarityNames[species.rarity-1]}</span><h3>${escapeHTML(name)}</h3><div class="detail-types">${data.elements.map(t => `<span style="--type:${ELEMENTS[t].color}">${ELEMENTS[t].name}</span>`).join('')}</div></div>${portrait(dex,name,'detail-art')}</div>
      <div class="detail-scroll">
      <div class="detail-section"><span class="detail-label">LINHA EVOLUTIVA</span><div class="detail-evolution">${chain.map((n,i) => `${i ? '<span class="detail-arrow">›</span>' : ''}<span class="${n === name ? 'current' : ''}">${escapeHTML(n)}</span>`).join('')}</div>${species.eeveeBranch ? '<p class="detail-tip">Evolui de Eevee, reunindo 4 cópias e escolhendo o ramo.</p>' : chain.length === 1 ? '<p class="detail-tip">Forma final: pode absorver uma cópia idêntica para ganhar +5 níveis.</p>' : `<p class="detail-tip">Evolução por ${copies} cópias da mesma forma. Formas finais idênticas se fundem: +5 níveis.</p>`}</div>
      <div class="detail-section"><div class="detail-heading"><span class="detail-label">STATUS BASE</span><strong>${total} <small>PODER</small></strong></div><div class="detail-stats">${(Object.keys(statNames) as Array<keyof Stats>).map(key => `<div class="detail-stat"><span>${statNames[key]}</span><div class="detail-stat-track"><i style="width:${Math.min(100,stats[key]/(key === 'hp' ? 600 : 120)*100)}%"></i></div><b>${stats[key]}</b></div>`).join('')}</div><p class="detail-tip">Atributos sem IV e sem bônus de nível • HP conta como 1/5 do poder total.</p></div>
      <div class="detail-section"><span class="detail-label">HABILIDADE CARREGADA</span><div class="detail-ability"><b>${escapeHTML(move.name)}</b><span>${data.energy} ENERGIA • ${data.range} ALCANCE</span><p>${moveDescription(move)}</p><div class="detail-damage-list">${damageRows(damage)}</div></div><p class="detail-basic">Ataque regular: ${damageHtml(basic)} de dano ${basic.kind === 'special' ? 'especial (SPA)' : 'físico (ATK)'} • gera energia. Valores de base, sem IV/nível ou defesa do alvo.</p></div>
      <div class="detail-note">${species.shop ? `Disponível na loja • custo ${species.rarity} de ouro` : species.bossOnly ? 'Encontro especial: chefe lendário' : 'Adquirido por evolução de outra forma'}</div></div>`;
  }
}
