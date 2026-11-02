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
export function previewAbility(family: Family, stage: number, stats: Stats, formId?:string, mewtwoMode?:'melee'|'ranged'): DamagePreview[] {
  const stageData = getStageData(family, stage,formId,mewtwoMode);
  const move: MoveData = ATTACKS.moves[stageData.move];
  const a = stats.atk, s = stats.spa;
  const physical = (label: string, value: number) => entry(label, value, 'physical');
  const special = (label: string, value: number) => entry(label, value, 'special');
  switch (move.effect) {
    case 'mewtwo-barrage':return [special('RAJADA (3 + 5)',move.baseDamage+s*move.specialRatio),special('PROJÉTIL FINAL PERFORANTE',(move.finalDamage||0)+s*(move.finalSpaRatio||0))];
    case 'mewtwo-impact':return [physical('SOCO EM ÁREA',move.baseDamage+a*(move.attackRatio||0)),entry('BARREIRA',stats.hp*(move.barrierMaxHpFraction||0),'heal')];
    case 'moltres-fire':return [special('AURA POR INTERVALO',(move.auraBase||0)+s*(move.auraSpaRatio||0)),special('QUEIMADURA POR SEGUNDO',(move.burnBase||0)+s*(move.burnSpaRatio||0))];
    case 'zapdos-storm':return [special('DANO POR CASA',move.baseDamage+s*move.specialRatio)];
    case 'articuno-blizzard':return [special('DANO INICIAL EM ÁREA',move.baseDamage+s*move.specialRatio)];
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

/** Coefficients read directly from the same move config consumed by the combat engine.
 * No client-side damage simulation or invented level scaling: these are raw formulas,
 * before defense, type effectiveness, crits and any temporary modifiers. */
export type AbilityScalingRow = {
  label: string;
  flat?: number;
  atk?: number;
  spa?: number;
  def?: number;
  hp?: number;
  suffix?: string;
  note?: string;
};

export function abilityScaling(move: MoveData, stage: number, family?: Family): AbilityScalingRow[] {
  const rows: AbilityScalingRow[] = [];
  const add = (label: string, flat = 0, ratios: Partial<Pick<AbilityScalingRow,'atk'|'spa'|'def'|'hp'>> = {}, note?: string, suffix?: string): void => {
    rows.push({label, flat, ...ratios, ...(note ? {note} : {}), ...(suffix ? {suffix} : {})});
  };
  const base = move.baseDamage || 0;
  const a = move.attackRatio || 0;
  const s = move.specialRatio || 0;
  const byStage = (values: number[] | undefined, fallback = 0) => stageValue(values,stage,fallback);
  switch(move.effect) {
    case 'ditto-transform':
      return rows;
    case 'withdraw-guard':
      add('Redução de dano', Math.round((move.guardReduction??.35)*100), {}, `+ ${((move.guardSpaRatio||0)*100).toLocaleString('pt-BR',{maximumFractionDigits:3})} ponto percentual por SPA, até o limite.`, '%');
      return rows;
    case 'lullaby':
      add('Duração inicial',byStage(move.durationBaseByStage,move.sleepSeconds||0),{},`+ ${(move.durationSpaRatio||0).toLocaleString('pt-BR',{maximumFractionDigits:3})} s por SPA, até o limite.`, 's');
      return rows;
    case 'shield':
      add('Barreira',move.shieldBase||0,{def:move.shieldDefenseRatio,spa:move.shieldSpaRatio});
      return rows;
    case 'healing-egg':
    case 'heal-powder':
      add('Cura por aliado',byStage(move.healByStage,move.healBase||0),{spa:move.healRatio});
      return rows;
    case 'mew-blessing':
      add('Cura',move.healBase||0,{spa:move.healRatio});
      add('Barreira',move.shieldBase||0,{spa:move.shieldSpaRatio});
      add('Extra por ataque',move.bonusBase||0,{spa:move.bonusSpaRatio});
      return rows;
    case 'star-ward':
      add('Barreira',byStage(move.shieldBaseByStage,move.shieldBase||0),{spa:move.shieldSpaRatio});
      add('Dano por estrela',byStage(move.starBaseByStage),{spa:move.specialRatio});
      return rows;
    case 'mime-wall':
      add('Dano da parede',move.pillarDamageBase||0,{spa:move.pillarSpaRatio});
      add('Extra no básico',0,{spa:move.wallBonusRatio});
      return rows;
    case 'star-refraction':
      add('Extra por ataque regular',0,{spa:s});
      add('Alvos por ataque',byStage(move.secondaryTargetsByStage,2));
      return rows;
    case 'moltres-fire':
      add('Dano da aura',move.auraBase||0,{spa:move.auraSpaRatio});
      add('Queimadura por segundo',move.burnBase||0,{spa:move.burnSpaRatio});
      add('Barreira por inimigo queimado',move.barrierPerBurn||65,{},'Limitada pela porcentagem de Vida máxima configurada.');
      return rows;
    case 'mewtwo-impact':
      add('Dano do soco',base,{atk:a});
      add('Barreira por uso',0,{hp:move.barrierMaxHpFraction??.13});
      return rows;
    case 'mewtwo-barrage':
      add('Dano por projétil',base,{spa:s});
      add('Projétil final',move.finalDamage||0,{spa:move.finalSpaRatio});
      return rows;
    case 'psychic-teleport':
      if(byStage(move.shotCountByStage)>0) {
        add('Dano por projétil',base,{spa:s});
        add('Quantidade de tiros',byStage(move.shotCountByStage));
      }
      return rows;
    case 'flame-strike':
      add('Dano físico',0,{atk:byStage(move.damageRatioByStage,1.55)});
      break;
    case 'shock':
      add('Dano elétrico',0,{spa:byStage(move.damageRatioByStage,1.05)});
      add('Dano do salto',Math.round(byStage(move.secondaryRatioByStage,.5)*100),{},'Em relação ao dano inicial.','%');
      add('Alvos adicionais',byStage(move.secondaryTargetsByStage,1));
      return rows;
    case 'gas':
      add('Nuvem após a barreira',byStage(move.damageByStage),{atk:move.gasAttackRatio},'Acrescenta dano conforme o tempo protegido.');
      break;
    case 'solar-beam':
    case 'pollen':
    case 'spin':
      add(move.effect==='spin'?'Dano por segundo':move.effect==='pollen'?'Dano em área':'Dano do raio',byStage(move.damageByStage),{spa:s});
      break;
    case 'furious-leap':
      add('Dano do salto',byStage(move.damageByStage,base),{spa:byStage(move.damageRatioByStage,s)});
      add('ATK e VEL por acerto recebido',Math.round(byStage(move.ragePercentByStage)*10000)/100,{},undefined,'%');
      return rows;
    case 'absorbing-vine':
      add('Dano ao conectar',byStage(move.damageByStage,base),{spa:s});
      add('Cura na execução',Math.round((move.executeHealRatio||0)*100),{},'Da própria Vida máxima.','%');
      return rows;
    case 'electromagnetic-ball':
      add('Dano inicial',base,{spa:s});
      add('Dano por pulso',move.pulseBase||0,{spa:move.pulseSpaRatio});
      add('Número de pulsos',byStage(move.pulsesByStage));
      return rows;
    case 'sludge-absorb':
      add('Dano inicial',base,{spa:s});
      add('Dano por absorção',move.absorbDamageBase||0,{spa:move.absorbDamageRatio});
      return rows;
    case 'hitmonchan-uppercut':
      add('Dano do soco',base,{atk:a});
      add('Atordoamento inicial',move.stunBase||0,{},`+ ${(move.stunSpaRatio||0).toLocaleString('pt-BR',{maximumFractionDigits:3})} s por SPA, reduzido pela Vida do alvo e limitado pela habilidade.`,'s');
      return rows;
    case 'hitmonlee-spin-kick':
      add('Dano por chute',base,{atk:a});
      add('Barreira (outra opção)',move.shieldBase||0,{spa:move.shieldSpaRatio});
      return rows;
    case 'scizor-double':
      add('Dano por golpe',base,{spa:s});
      add('Quantidade de golpes',move.hits||2);
      return rows;
    case 'brutal-kick':
      add('Dano do chute',base,{atk:a,spa:s});
      add('Colisão com a parede',move.wallDamage||0);
      return rows;
    case 'fang-tail':
      add('Mordida',base,{atk:a,spa:s});
      add('Caudada',move.tailBase||0,{atk:move.tailRatio});
      return rows;
    case 'desperate-splash':
      add('Cura (50% de chance)',move.healBase||0,{spa:move.healRatio});
      add('Bônus no próximo ataque',move.bonusBase||0,{spa:move.bonusSpaRatio});
      return rows;
    case 'multi':
      add('Dano por golpe físico',base,{atk:a});
      add('Golpe final venenoso',0,{spa:s});
      return rows;
    case 'stomp':
      add('Dano físico',base,{atk:a});
      add('Cura por instância',move.sleepHealBase||0,{spa:move.sleepHealSpaRatio});
      return rows;
    case 'lapras-surf':
      add('Dano na passagem',base,{spa:s});
      add('Dano da onda',Math.round((move.continuationMultiplier??.5)*100),{},'Em relação ao dano na passagem.','%');
      return rows;
    case 'eevee-ball':
      add('Impacto',base,{atk:a});
      if(s) add('Explosão',0,{spa:s});
      return rows;
    case 'dragon-cyclone':
      add('Dano central',base,{spa:s});
      add('Dano adjacente',Math.round((move.splashMultiplier??.5)*100),{},'Em relação ao dano central.','%');
      return rows;
    case 'meteor-rain':
      add('Dano por meteoro',base,{spa:s});
      add('Dano do fragmento',Math.round((move.fragmentRatio??.25)*100),{},'Em relação ao dano do meteoro.','%');
      return rows;
    case 'electric-punch':
      add('Dano no alvo',base,{spa:s});
      if(byStage(move.secondaryRatioByStage)>0)
        add('Dano adjacente',Math.round(byStage(move.secondaryRatioByStage)*100),{},'Em relação ao dano no alvo.','%');
      if(stage>0 && move.shieldSpaRatio) add('Barreira',move.shieldBase||0,{spa:move.shieldSpaRatio},'A energia drenada também aumenta a barreira.');
      return rows;
    case 'flame-jet':
      add('Dano por acerto',base,{spa:s});
      add('Duração do jato',family==='magby'?(move.babyDuration??2):byStage(move.durationByStage,3),{},undefined,'s');
      return rows;
    case 'terrain-poison-shot':
      add('Poder da semente venenosa',base,{spa:s});
      add('Duração do terreno',byStage(move.initialSecondsByStage),{},undefined,'s');
      return rows;
    case 'self-explosion':
      add('Dano da explosão',base,{spa:s});
      add('Vida consumida',Math.round((move.selfHpCost??.2)*100),{},'Da própria Vida máxima.','%');
      return rows;
    default:
      if(base||a||s) add('Dano da habilidade',base,{atk:a,spa:s});
  }

  // Additional independent effects (one formula for each, rather than obscuring
  // their scaling in the prose).
  if(move.effect==='pollen') add('Cura por aliado',byStage(move.healByStage,move.healBase||0),{spa:move.healRatio});
  if(move.effect==='spin') add('Redução de dano',Math.round(byStage(move.shieldByStage)*100),{},undefined,'%');
  if(move.effect==='flame-strike'||move.effect==='poison-shot'||move.effect==='burn'||move.effect==='sting')
    if(move.dotBase||move.dotRatio) add(move.effect==='burn'||move.effect==='flame-strike'?'Queimadura por segundo':'Veneno por segundo',move.dotBase||0,{spa:move.dotRatio});
  if(move.effect==='chain') add('Dano dos saltos',move.chainBase||0,{spa:move.chainRatio});
  if(move.effect==='drain') add('Cura',move.healBase||0,{spa:move.healRatio});
  if(move.effect==='poison-shot' && move.shieldBase) add('Barreira',move.shieldBase,{def:move.shieldDefenseRatio,spa:move.shieldSpaRatio});
  if(move.effect==='jynx-kiss') add('Congelamento inicial',move.freezeBase||0,{},`+ ${(move.freezeSpaRatio||0).toLocaleString('pt-BR',{maximumFractionDigits:3})} s por SPA, até o limite.`,'s');
  if(move.effect==='gas') add('Barreira',move.shieldBase||0,{spa:move.shieldSpaRatio});
  if(move.effect==='bite-shred'||move.effect==='bone-throw') add('Redução da defesa',move.shredBase||0,{spa:move.shredRatio},'Aplicada ao alvo.');
  return rows;
}
