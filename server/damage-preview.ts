/** Tooltip preview of raw ability damage at the current level, IV and stage.
 * The engine later applies defense, elemental matchups, shields and other modifiers.
 * All values are intentionally rounded for display (math remains fractional in simulation). */
import { ATTACKS, getStageData, type MoveData } from './data';
import type { Family, Stats } from './types';
import { rawBasicDamage, stageValue } from './formulas';
export type DamagePreview = { label: string; value: number; kind: 'physical' | 'special' | 'heal' };
const entry = (label: string, amount: number, kind: DamagePreview['kind']): DamagePreview =>
  ({ label, value: Math.round(amount), kind });

export function previewBasic(family: Family, stage: number, stats: Stats): DamagePreview {
  const attack = getStageData(family, stage).basic;
  const fraction=family==='abra'?(ATTACKS.moves['psychic-teleport'].basicSpaFraction??.3):0;
  return entry('ATAQUE REGULAR',rawBasicDamage(stats.atk*(1-fraction)+stats.spa*fraction,ATTACKS.basic.offensiveRatio),attack.category);
}

/** Raw values before enemy mitigation. Special effects are annotated by hit/DPS. */
export function previewAbility(family: Family, stage: number, stats: Stats): DamagePreview[] {
  const stageData = getStageData(family, stage);
  const move: MoveData = ATTACKS.moves[stageData.move];
  const a = stats.atk, s = stats.spa;
  const physical = (label: string, value: number) => entry(label, value, 'physical');
  const special = (label: string, value: number) => entry(label, value, 'special');
  switch (move.effect) {
    case 'psychic-teleport':return stage===0?[]:[special(`DANO POR DISPARO × ${move.shotCountByStage?.[stage]||0}`,move.baseDamage+s*move.specialRatio)];
    case 'absorbing-vine':return [special('DANO AO CONECTAR',(move.damageByStage?.[stage]??move.baseDamage)+s*move.specialRatio),entry('CURA AO EXECUTAR',stats.hp*(move.executeHealRatio??.10),'heal')];
    case 'flame-jet':return [special('DANO POR INSTÂNCIA',move.baseDamage+s*move.specialRatio)];
    case 'electric-punch':return [special('PANCADA NO ALVO',move.baseDamage+s*move.specialRatio),special('DANO ADJACENTE', (move.baseDamage+s*move.specialRatio)*(move.secondaryRatioByStage?.[stage]||0))];
    case 'flame-orbit': return [special('DANO ESPECIAL POR CONTATO',move.baseDamage+s*move.specialRatio)];
    case 'hitmonchan-uppercut': return [physical('SOCO ASCENDENTE',move.baseDamage+a*(move.attackRatio||0))];
    case 'hitmonlee-spin-kick': return [physical('DANO POR CHUTE (ATÉ 2)',move.baseDamage+a*(move.attackRatio||0))];
    case 'star-refraction': return [physical('BÁSICO POR ALVO',rawBasicDamage(a,ATTACKS.basic.offensiveRatio)),special('EXTRA POR ACERTO (3 S)',s*move.specialRatio)];
    case 'brutal-kick': return [physical('DANO DO CHUTE',move.baseDamage+a*(move.attackRatio||0)+s*move.specialRatio),physical('DANO DE COLISÃO',move.wallDamage||0)];
    case 'desperate-splash': return [entry('CURA (50% DE CHANCE)',(move.healBase||0)+s*(move.healRatio||0),'heal'),special('PRÓXIMO BÁSICO EXTRA',(move.bonusBase||0)+s*(move.bonusSpaRatio||0))];
    case 'fang-tail': return [physical('DANO DA MORDIDA',move.baseDamage+a*(move.attackRatio||0)+s*move.specialRatio),physical('CAUDADA TRASEIRA',(move.tailBase||0)+a*(move.tailRatio||0))];
    case 'self-explosion': return [special('DANO AOS INIMIGOS PRÓXIMOS',move.baseDamage+s*move.specialRatio), entry('CUSTO EM VIDA MÁXIMA', stats.hp*(move.selfHpCost||0), 'physical')];
    case 'mew-blessing': return [entry('CURA', (move.healBase || 0) + s*(move.healRatio || 0), 'heal'),
      special('DANO EXTRA POR BÁSICO', (move.bonusBase || 0) + s*(move.bonusSpaRatio || 0))];
    case 'dragon-storm': return [special('DANO POR ONDA ×3', move.baseDamage + s*move.specialRatio)];
    case 'dragon-cyclone': return [special('DANO CENTRAL', move.baseDamage + s*move.specialRatio), special('DANO ADJACENTE', (move.baseDamage + s*move.specialRatio)*(move.splashMultiplier || .5))];
    case 'ghost-ambush': return stage===2 ? [special('DANO DA ARRANHADA',move.baseDamage+s*move.specialRatio)] : [special(stage===1?'DANO ATÉ 3 ALVOS':'DANO NO ALVO',move.baseDamage+s*move.specialRatio)];
    case 'burrow': return [special(stage>0?'DANO EM ÁREA':'DANO NO ALVO',move.baseDamage+s*move.specialRatio)];
    case 'dragon-breath': return [special('DANO', move.baseDamage + s*move.specialRatio)];
    case 'withdraw-guard': case 'shield': return [];
    case 'healing-egg': return [entry('CURA POR ALIADO', (move.healBase || 0) + s*(move.healRatio || 0), 'heal')];
    case 'heal-powder': return [entry('CURA POR ALIADO', stageValue(move.healByStage,stage)+(move.healRatio || 0)*s, 'heal')];
    case 'flame-strike': return [physical('DANO',a*stageValue(move.damageRatioByStage,stage,1.55)),special('QUEIMADURA/SEGUNDO',(move.dotBase||0)+s*(move.dotRatio||0))];
    case 'shock': return [special('DANO INICIAL', s*stageValue(move.damageRatioByStage,stage,1.05)),
      special('DANO DO SALTO', s*stageValue(move.damageRatioByStage,stage,1.05)*stageValue(move.secondaryRatioByStage,stage,.5))];
    case 'solar-beam': return [special(`RAIO SOLAR (ALCANCE ${stageValue(move.beamRangeByStage,stage,2)})`,stageValue(move.damageByStage,stage)+s*move.specialRatio)];
    case 'pollen': return [special('DANO EM ÁREA', stageValue(move.damageByStage,stage)+s*move.specialRatio),
      entry('CURA POR ALIADO',stageValue(move.healByStage,stage)+s*(move.healRatio || 0),'heal')];
    case 'spin': return [special('DANO POR SEGUNDO',stageValue(move.damageByStage,stage)+s*move.specialRatio)];
    case 'gas': return [physical('NUVEM APÓS BARREIRA',stageValue(move.damageByStage,stage)+a*(move.gasAttackRatio||0)+(move.chargeMaxDuration||0)*(move.gasTimeRatio||0))];
    case 'lapras-surf': return [special('DANO NA PASSAGEM',move.baseDamage+s*move.specialRatio),special('ONDA APÓS PARAR',(move.baseDamage+s*move.specialRatio)*(move.continuationMultiplier||.5))];
    case 'ditto-transform': return [];
    case 'stomp': case 'rock-charge': case 'bone-throw': case 'single-knockup': case 'rock-strike': case 'sting':
      return [physical('DANO',move.baseDamage+a*(move.attackRatio || 0)+s*(move.effect==='rock-charge'?move.specialRatio:0))];
    case 'multi': return [physical(`DANO POR GOLPE × ${move.hits || 4}`, move.baseDamage+a*(move.attackRatio || 0))];
    case 'meteor-rain': return [special('DANO DE CADA METEORO',move.baseDamage+s*move.specialRatio),special('FRAGMENTO CARDINAL',(move.baseDamage+s*move.specialRatio)*(move.fragmentRatio??.25))];
    case 'cone-slash': return [special(move.executeThreshold?'CORTE EXECUTANTE':'CORTE EM CONE',move.baseDamage+s*move.specialRatio)];
    case 'scizor-double': return [special('DANO POR GOLPE × 2',move.baseDamage+s*move.specialRatio)];
    case 'jynx-kiss': return [special('BEIJO GLACIAL',move.baseDamage+s*move.specialRatio)];
    case 'piercing-fire': return [special('DANO POR ALVO',move.baseDamage+s*move.specialRatio)];
    case 'eevee-ball': {
      const damage=move.baseDamage+a*(move.attackRatio||0);
      return [physical('IMPACTO FÍSICO',damage),...(family==='eevee'?[special('EXPLOSÃO ESPECIAL',s*move.specialRatio)]:[])];
    }
    case 'poison-shot': return [special('DANO INICIAL',move.baseDamage+s*move.specialRatio),
      special('VENENO POR SEGUNDO', (move.dotBase || 0)+s*(move.dotRatio || 0))];
    case 'burn': return [special('DANO INICIAL',move.baseDamage+a*(move.attackRatio || 0)+s*move.specialRatio),
      special('QUEIMADURA POR SEGUNDO',(move.dotBase || 0)+s*(move.dotRatio || 0))];
    case 'chain': return [special('DANO INICIAL',move.baseDamage+a*(move.attackRatio || 0)+s*move.specialRatio),
      special('DANO NO SALTO',(move.chainBase || 0)+s*(move.chainRatio || 0))];
    default: return [special('DANO',move.baseDamage+a*(move.attackRatio || 0)+s*move.specialRatio)];
  }
}
