/** V25: immutable alternative-form definitions. Only the owning server may write formId. */
import config from '../config/mega_formas.json';
import type { Element, Family, Stats, Pokemon } from './types';
export interface AlternativeForm {id:string;family:Family;stage:number;name:string;elements:Element[];base:Stats;pokedexId:number}
export const MEGA = config;
const entries=config.forms as AlternativeForm[];
const index=new Map(entries.map(form=>[`${form.family}:${form.stage}:${form.id}`,form]));
export function alternativeForm(family:Family,stage:number,formId?:string):AlternativeForm|undefined {
 return formId?index.get(`${family}:${stage}:${formId}`):undefined;
}
export function eligibleForm(pokemon:Pick<Pokemon,'family'|'stage'|'level'|'formId'>):AlternativeForm|undefined {
 return !pokemon.formId && pokemon.level>=MEGA.minLevel
  ? entries.find(f=>f.family===pokemon.family&&f.stage===pokemon.stage):undefined;
}
export function nextFormStage(family:Family,stage:number,formId?:string):string|undefined {
 return alternativeForm(family,stage,formId)?formId:undefined;
}
export function hasRegionalEvolution(family:Family,stage:number,formId?:string):boolean {
 return !!formId&&!!alternativeForm(family,stage+1,formId);
}
