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
  return entry('ATAQUE REGULAR', rawBasicDamage(stats[attack.stat], ATTACKS.basic.offensiveRatio), attack.category);
}

/** Raw values before enemy mitigation. Special effects are annotated by hit/DPS. */
export function previewAbility(family: Family, stage: number, stats: Stats): DamagePreview[] {
  const stageData = getStageData(family, stage);
  const move: MoveData = ATTACKS.moves[stageData.move];
  const a = stats.atk, s = stats.spa;
  const physical = (label: string, value: number) => entry(label, value, 'physical');
  const special = (label: string, value: number) => entry(label, value, 'special');
  switch (move.effect) {
    case 'self-explosion': return [special('DANO AOS INIMIGOS PRÓXIMOS',move.baseDamage+s*move.specialRatio), entry('CUSTO EM VIDA MÁXIMA', stats.hp*(move.selfHpCost||0), 'physical')];
    case 'mew-blessing': return [entry('CURA', (move.healBase || 0) + s*(move.healRatio || 0), 'heal'),
      special('DANO EXTRA POR BÁSICO', (move.bonusBase || 0) + s*(move.bonusSpaRatio || 0))];
    case 'dragon-storm': return [special('DANO POR ONDA ×3', move.baseDamage + s*move.specialRatio)];
    case 'dragon-cyclone': return [special('DANO CENTRAL', move.baseDamage + s*move.specialRatio), special('DANO ADJACENTE', (move.baseDamage + s*move.specialRatio)*(move.splashMultiplier || .5))];
    case 'burrow': case 'dragon-breath': return [special('DANO', move.baseDamage + s*move.specialRatio)];
    case 'withdraw-guard': case 'shield': return [];
    case 'healing-egg': return [entry('CURA POR ALIADO', (move.healBase || 0) + s*(move.healRatio || 0), 'heal')];
    case 'heal-powder': return [entry('CURA POR ALIADO', stageValue(move.healByStage,stage)+(move.healRatio || 0)*s, 'heal')];
    case 'flame-strike': return [physical('DANO', a*stageValue(move.damageRatioByStage,stage,1.55))];
    case 'shock': return [special('DANO INICIAL', s*stageValue(move.damageRatioByStage,stage,1.05)),
      special('DANO DO SALTO', s*stageValue(move.damageRatioByStage,stage,1.05)*stageValue(move.secondaryRatioByStage,stage,.5))];
    case 'pollen': return [special('DANO EM ÁREA', stageValue(move.damageByStage,stage)+s*move.specialRatio),
      entry('CURA POR ALIADO',stageValue(move.healByStage,stage)+s*(move.healRatio || 0),'heal')];
    case 'spin': return [special('DANO POR SEGUNDO',stageValue(move.damageByStage,stage)+s*move.specialRatio)];
    case 'gas': return [physical('DANO EM ÁREA',stageValue(move.damageByStage,stage)+a*stageValue(move.attackRatioByStage,stage,.9))];
    case 'stomp': case 'rock-charge': case 'bone-throw': case 'single-knockup': case 'rock-strike': case 'sting':
      return [physical('DANO',move.baseDamage+a*(move.attackRatio || 0))];
    case 'multi': return [physical(`DANO POR GOLPE × ${move.hits || 4}`, move.baseDamage+a*(move.attackRatio || 0))];
    case 'piercing-fire': return [special('DANO POR ALVO',move.baseDamage+s*move.specialRatio)];
    case 'eevee-ball': {
      const source = stageData.basic.stat === 'atk' ? a : s;
      const damage = move.baseDamage+source*(move.attackRatio || 0);
      return [entry('DANO EM ÁREA',damage,stageData.basic.category),
        entry('ALVOS SECUNDÁRIOS',damage*(move.splashMultiplier || .85),stageData.basic.category)];
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
