/** Ícones do TFT Set 10 via CommunityDragon, conforme public/itens/manifest.json. */
import manifest from '../../public/itens/manifest.json';
import type { EquippedItem, ItemColor } from '../../server/types';
const components=manifest.components as Record<ItemColor,string>;
const recipes=manifest.recipes as Record<string,string>;
export function itemRecipeSprite(key:string):string{return recipes[key]||'';}
export function itemComponentSprite(key:ItemColor):string{return components[key]||'';}
export function itemSprite(item:EquippedItem):string {
 if(item.kind==='mega-stone')return '';
 if(item.kind==='remover'||item.kind==='reforger')return manifest.tools[item.kind];
 return (item.recipe&&recipes[item.recipe])||components[item.components[0]]||'';
}
export function itemAssetUrl(src:string):string{return /^https?:\/\//.test(src)?src:import.meta.env.BASE_URL+src.replace(/^\//,'');}
export function itemImage(item:EquippedItem):string {
 if(item.kind==='mega-stone')return '<span class="gear-icon mega-stone-icon" aria-label="Mega Pedra">💎</span>';
 const src=itemSprite(item);
 return `<span class="gear-icon"><img src="${itemAssetUrl(src)}" alt="" loading="lazy" draggable="false" onerror="this.hidden=true;this.parentElement?.classList.add('missing-icon')"/></span>`;
}
