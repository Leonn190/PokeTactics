import type { Player,BallKind } from '../types';
import { ITEMS } from './items';
export const BALLS:BallKind[]=['pokeball','greatball','ultraball','masterball'];
/** Balls consume one shared cell per nonempty stack, regardless of stack size. */
export function inventoryUsed(player:Pick<Player,'itemInventory'|'consumables'>):number {
 return (player.itemInventory?.length||0)+BALLS.filter(b=>(player.consumables?.[b]||0)>0).length;
}
export function canReceive(player:Pick<Player,'itemInventory'|'consumables'>,newItems=0,ball?:BallKind):boolean {
 const newBall=ball && !(player.consumables?.[ball]||0)?1:0;
 return inventoryUsed(player)+newItems+newBall<=ITEMS.inventorySlots;
}
