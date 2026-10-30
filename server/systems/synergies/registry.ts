import config from '../../../config/sinergias.json';
import type { Element } from '../../types';

export type SynergyTier = { count:number; [property:string]:number|number[] };
export type SynergySpec = { name:string; subtitle:string; description:string; tiers:SynergyTier[]; params: Record<string,number|number[]> };
export const SYNERGIES = config.synergies as Record<Element,SynergySpec>;
export function tierFor(type:Element, count:number):SynergyTier|null {
  const tiers=SYNERGIES[type]?.tiers || [];
  for(let i=tiers.length-1;i>=0;i--)if(count>=tiers[i].count)return tiers[i];
  return null;
}
export function numeric(tier:SynergyTier|null, key:string):number {return Number(tier?.[key] || 0);}
export function param(type:Element,key:string):number {return Number(SYNERGIES[type]?.params[key] || 0);}
export function arrayParam(type:Element,key:string):number[] {const value=SYNERGIES[type]?.params[key];return Array.isArray(value)?value:[];}
