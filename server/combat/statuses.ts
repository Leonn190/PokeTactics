/** Shared logical status engine. Legacy poison/burn DOT ownership remains where applied.
 * Nothing here depends on the render clock. All expiry times use Battle.elapsed. */
import EFFECTS from '../../config/efeitos.json';
import type {Battle,CombatUnit,StatusKey} from '../types';
export const STATUS_RULES=EFFECTS;
export function active(unit:CombatUnit,key:StatusKey,now:number):boolean {
 if(key==='poisoned')return !!(unit.poison?.time && unit.poison.time>0 || unit.synergy?.poisoned && unit.synergy.poisoned.until>now);
 if(key==='burning')return !!(unit.damageOverTime?.time && unit.damageOverTime.time>0 || unit.itemBurn && unit.itemBurn.until>now);
 if(key==='paralyzed')return !!(unit.stunUntil>now || unit.statuses?.paralyzed && unit.statuses.paralyzed.until>now);
 return !!unit.statuses?.[key] && unit.statuses[key]!.until>now;
}
export function incapacitated(u:CombatUnit,now:number):boolean {
 return active(u,'frozen',now)||active(u,'sleeping',now)||active(u,'paralyzed',now);
}
export function blocksEnergy(u:CombatUnit,now:number):boolean {return active(u,'sleeping',now)||active(u,'frozen',now);}
export function apply(b:Battle,u:CombatUnit,key:Exclude<StatusKey,'poisoned'|'burning'>,source:CombatUnit,seconds:number,instanceId:string):boolean {
 if(u.hp<=0||u.controlImmune||seconds<=0)return false;
 const previous=u.statuses[key];
 if(previous?.instanceId===instanceId && previous.until>b.elapsed) return false;
 const until=b.elapsed+seconds;
 if(previous && previous.until>b.elapsed && STATUS_RULES[key].reapply==='longer' && until<=previous.until)return false;
 u.statuses[key]={sourceId:source.id,started:b.elapsed,until:Math.max(previous?.until||0,until),instanceId};
 source.metrics.controlSeconds+=Math.max(0,until-Math.max(previous?.until||b.elapsed,b.elapsed));
 if(key==='paralyzed'){u.stunUntil=Math.max(u.stunUntil,until);u.stunTime=u.stunUntil-b.elapsed;}
 return true;
}
export function expire(u:CombatUnit,now:number):void {
 for(const key of Object.keys(u.statuses) as StatusKey[]) if(u.hp<=0||u.statuses[key]!.until<=now) delete u.statuses[key];
}
export function wakeFromBasic(u:CombatUnit):void {delete u.statuses.sleeping;}
