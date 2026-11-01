/** Item paths from public/itens/manifest.json; assets remain owned by public/. */
import type { EquippedItem, ItemColor } from '../../server/types';
const components: Record<ItemColor,string> = {"green": "/itens/green.png", "blue": "/itens/blue.png", "purple": "/itens/purple.png", "orange": "/itens/orange.png", "yellow": "/itens/yellow.png", "red": "/itens/red.png"};
const recipes: Record<string,string> = {"green+green": "/itens/regeneration.png", "green+blue": "/itens/adaptive_shield.png", "green+purple": "/itens/ally_healing.png", "green+orange": "/itens/vampirism.png", "green+yellow": "/itens/burn_aura.png", "green+red": "/itens/cast_haste.png", "blue+blue": "/itens/magic_guard.png", "blue+purple": "/itens/scaling_spa.png", "blue+orange": "/itens/opening_immunity.png", "blue+yellow": "/itens/focused_defense.png", "blue+red": "/itens/bonus_energy.png", "purple+purple": "/itens/archmage.png", "purple+orange": "/itens/spell_critical.png", "purple+yellow": "/itens/magic_sunder.png", "purple+red": "/itens/cast_wave.png", "orange+orange": "/itens/executioner.png", "orange+yellow": "/itens/armor_break.png", "orange+red": "/itens/guinsoo.png", "yellow+yellow": "/itens/bramble.png", "yellow+red": "/itens/titan.png", "red+red": "/itens/longbow.png"};
export function itemRecipeSprite(key:string):string {return recipes[key]||'';}
export function itemComponentSprite(key:ItemColor):string {return components[key]||'';}
export function itemSprite(item:EquippedItem):string { if(item.kind==='mega-stone')return ''; return (item.recipe && recipes[item.recipe]) || components[item.components[0]] || ''; }
export function itemImage(item:EquippedItem):string {
 if(item.kind==='mega-stone')return '<span class="gear-icon mega-stone-icon" aria-label="Mega Pedra">💎</span>';
 const src=itemSprite(item);
 return `<span class="gear-icon"><img src="${import.meta.env.BASE_URL}${src.replace(/^\//,'')}" alt="" loading="lazy" draggable="false" onerror="this.hidden=true;this.parentElement?.classList.add('missing-icon')"/></span>`;
}
