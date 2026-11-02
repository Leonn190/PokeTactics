import { ATTACKS, EEVEE_BRANCHES, getStageData, SPECIES } from '../../server/data';
import { abilityScaling, type AbilityScalingRow, type DamagePreview } from '../../server/damage-preview';
import type { Family } from '../../server/types';

const escapeHTML = (value: string): string => value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const format = (value: number): string => Number(value.toFixed(2)).toLocaleString('pt-BR',{maximumFractionDigits:2});

export const damageHtml = (preview: DamagePreview): string =>
  `<span class="damage-value damage-${preview.kind}" title="Valor antes da defesa, resistência de tipo e escudos">${preview.value.toLocaleString('pt-BR')}</span>`;
export const damageRows = (values: DamagePreview[]): string =>
  values.map(item => `<span class="damage-row"><span>${item.label}:</span> ${damageHtml(item)}</span>`).join('');

/** One formatter for the in-game hover/click portal and the Pokédex roster.
 * Multipliers come from config/ataques.json via abilityScaling, never from
 * a second set of invented balance values in the client. */
function formula(row: AbilityScalingRow): string {
  const tokens: string[] = [];
  const ratios = (['atk','spa','def','hp'] as const).filter(key => row[key] !== undefined && row[key] !== 0);
  if (row.flat !== undefined && (row.flat !== 0 || ratios.length === 0)) {
    tokens.push(`<span class="ability-flat">${format(row.flat)}${row.suffix ? escapeHTML(row.suffix) : ''}</span>`);
  }
  for (const key of ratios) {
    const label = key === 'hp' ? 'VIDA' : key.toUpperCase();
    tokens.push(`<span class="ability-coefficient ability-coefficient-${key}">${format(row[key]! * 100)}% <small>${label}</small></span>`);
  }
  return tokens.join('<span class="ability-plus"> + </span>') || '<span class="ability-flat">—</span>';
}

type EvolutionStage = { family: Family; stage: number; name: string };

/** The motor may evolve into a different family (babies, Eevee, Scyther,
 * Tyrogue), not just increment the stage within the same family. */
function evolutionLine(family: Family): EvolutionStage[] {
  const species = SPECIES[family];
  const self: EvolutionStage[] = species.names.map((name,stage)=>({family,stage,name}));
  const branching: Family[] = family==='eevee' ? EEVEE_BRANCHES
    : family==='scyther' ? ['scizor','kleavor']
    : family==='tyrogue' ? ['hitmonchan','hitmonlee']
    : species.babyEvolutionOptions || (species.babyEvolution ? [species.babyEvolution] : []);
  if(branching.length) {
    const next=branching.flatMap(nextFamily=>SPECIES[nextFamily].names.map((name,stage)=>({family:nextFamily,stage,name})));
    return [...self,...next];
  }
  const origin=(Object.keys(SPECIES) as Family[]).find(candidate=>{
    const source=SPECIES[candidate];
    return source.babyEvolution===family || source.babyEvolutionOptions?.includes(family)
      || (candidate==='eevee' && species.eeveeBranch)
      || (candidate==='scyther' && (family==='scizor'||family==='kleavor'));
  });
  return origin ? [{family:origin,stage:0,name:SPECIES[origin].names[0]},...self] : self.length>1?self:[];
}

function stageSummary(family: Family, stage: number): {moveName:string; primary:string; extra?:string} {
  const move = ATTACKS.moves[getStageData(family,stage).move];
  const rows=abilityScaling(move,stage);
  const primary=rows[0] ? formula(rows[0]) : '<span class="ability-flat">Efeito utilitário</span>';
  // A few abilities improve their number of hits, healing, protection or
  // duration rather than their first damage line. Show that evolution too.
  const priority=/Quantidade de tiros|Número de pulsos|Alvos por ataque|Alvos adicionais|Redução de dano|Duração do terreno|Duração do jato|ATK e VEL por acerto recebido|Dano adjacente|Cura por aliado|Barreira/;
  const extra=rows.slice(1).find(row=>priority.test(row.label));
  return {moveName:move.name,primary,...(extra?{extra:`${escapeHTML(extra.label)}: ${formula(extra)}`}:{})};
}

/** Shared rich TFT-style skill card for all normal stages, forms and Mewtwo modes. */
export function abilityCard(family: Family, stage: number, description: string, formId?: string, mewtwoMode?: 'melee'|'ranged'): string {
  const stageData = getStageData(family,stage,formId,mewtwoMode);
  const move = ATTACKS.moves[stageData.move];
  const rows = abilityScaling(move,stage);
  const hasAttack = rows.some(row => (row.atk || 0) > 0);
  const hasSpecial = rows.some(row => (row.spa || 0) > 0);
  const theme = hasAttack && hasSpecial ? 'hybrid' : hasAttack ? 'physical' : hasSpecial ? 'special' : 'utility';
  const tag = theme==='hybrid'?'HÍBRIDA':theme==='physical'?'FÍSICA':theme==='special'?'ESPECIAL':'UTILIDADE';
  const mode = family === 'mewtwo' ? `<span class="ability-mode">${mewtwoMode==='melee'?'CORPO A CORPO':'À DISTÂNCIA'}</span>` : '';
  const scale = rows.length
    ? `<div class="ability-section-title">ESCALAMENTO DA HABILIDADE</div><div class="ability-scaling">${rows.map(row =>
      `<div class="ability-scaling-row"><div class="ability-scaling-label">${escapeHTML(row.label)}</div><div class="ability-scaling-values">${formula(row)}</div>${row.note ? `<small class="ability-scaling-note">${escapeHTML(row.note)}</small>` : ''}</div>`
    ).join('')}</div>`
    : '<div class="ability-utility-note">Esta habilidade atua por efeito, sem dano direto calculado.</div>';
  const stages = evolutionLine(family);
  const evolution = stages.length > 1
    ? `<div class="ability-evolution"><div class="ability-section-title">EVOLUÇÃO <span>COEFICIENTES POR ESTÁGIO</span></div>
      <div class="ability-evolution-grid">${stages.map((entry,index)=>{
        const data=stageSummary(entry.family,entry.stage);
        const current=entry.family===family && entry.stage===stage;
        return `<div class="ability-evolution-stage ${current?'is-current':''}" title="${escapeHTML(data.moveName)}">
          <small>${current?'ATUAL':`FORMA ${index+1}`}</small>
          <b>${escapeHTML(entry.name)}</b>
          <span>${escapeHTML(data.moveName)}</span>
          <div class="ability-evolution-power">${data.primary}</div>${data.extra ? `<div class="ability-evolution-extra">${data.extra}</div>` : ''}
        </div>`;
      }).join('')}</div></div>`
    : '';
  return `<div class="ability-card ability-card-${theme}">
    <div class="ability-card-header">
      <span class="ability-card-eyebrow">HABILIDADE CARREGADA</span><span class="ability-card-category">${tag}</span>
    </div>
    <div class="ability-card-name">${escapeHTML(move.name)}${mode}</div>
    <p class="ability-card-description">${escapeHTML(description)}</p>
    ${scale}${evolution}
    <div class="ability-card-footer">Percentuais sobre os atributos da unidade. Dano mostrado antes das resistências e dos modificadores do alvo.</div>
  </div>`;
}
