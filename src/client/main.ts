import './augments.css';
import { AugmentView } from './augments';
import { Arena, type ClientView } from './arena';
import { Hud } from './hud';
import { ObservedItemRacks } from './item-racks';
import { Menus } from './menus';
import { PlayerSettings } from './player-settings';
import { SandboxView } from './sandbox';
import { GameAudio } from './audio';
import { BENCH_SIZE, SPECIES } from '../../server/data';
import { ITEMS } from '../../server/systems/items';
import pmdManifest from './pmd-manifest.json';
import { eligibleForm } from '../../server/forms';
import type { BallKind, ClientToServer, GameCommand, GameSnapshot, ServerToClient } from '../../server/types';

// The provided PMD manifest does not yet include every portrait (notably
// Lapras/Ditto). Resolve a missing static portrait without affecting animated PMD.
document.addEventListener('error',event=>{
 const img=event.target;
 if(!(img instanceof HTMLImageElement))return;
 const match=img.src.match(/\/portrait\/0*(\d+)\/Normal\.png(?:[?#]|$)/);
 if(!match)return;
 img.src=`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${Number(match[1])}.png`;
},true);

const view: ClientView = { scoutId: 'p0', spectating:false, selectedId: null, dragId: null, dragging: false, dragX: 0, dragY: 0, hoveringHex: null, hoveringBench: null, inventoryItemId:null,selectedBall:null };
const canvas = document.getElementById('battlefield') as HTMLCanvasElement;
const arena = new Arena(canvas, view);
const hud = new Hud();
const opponentItems=new ObservedItemRacks();
const audio = new GameAudio();
const playerSettings = new PlayerSettings(volume => audio.setVolume(volume), fps => arena.setFrameRate(fps));
const pause=document.createElement('div');
pause.id='gamePause';pause.className='game-pause-backdrop hidden';pause.setAttribute('role','dialog');pause.setAttribute('aria-modal','true');pause.setAttribute('aria-labelledby','gamePauseTitle');
pause.innerHTML=`<div class="game-pause-panel"><span class="game-pause-kicker">POKÉTACTICS</span><h2 id="gamePauseTitle">MENU DE PAUSA</h2><button type="button" data-pause="resume">VOLTAR</button><button type="button" data-pause="settings">CONFIGURAÇÕES</button><button type="button" class="game-pause-leave" data-pause="leave">SAIR DA PARTIDA</button></div>`;
document.getElementById('app')!.append(pause);
let settingsFromPause=false;
function showPause(visible:boolean):void {
  pause.classList.toggle('hidden',!visible);
  worker?.postMessage({type:'pause',paused:visible||settingsFromPause} satisfies ClientToServer);
  if(visible)pause.querySelector<HTMLButtonElement>('[data-pause="resume"]')?.focus();
}
playerSettings.setOnClosed(()=>{if(settingsFromPause){settingsFromPause=false;showPause(true);}});
pause.addEventListener('click',event=>{
  const action=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-pause]')?.dataset.pause;
  if(action==='resume'){settingsFromPause=false;showPause(false);}
  else if(action==='settings'){settingsFromPause=true;showPause(false);playerSettings.open();}
  else if(action==='leave'){settingsFromPause=false;showPause(false);closeMatch();}
});
// Count actual drawn frames instead of displaying the selected FPS cap.
const fpsReadout=document.getElementById('gameFpsCounter')!;
let framesDrawn=0,windowStart=performance.now(),smoothedFps=75;
function countDrawnFrame(now:number){
 if(!arena.snapshot)return;
 framesDrawn++;
 const span=now-windowStart;
 if(span>=650){const measured=framesDrawn*1000/span;smoothedFps=smoothedFps*.45+measured*.55;
   fpsReadout.textContent=`FPS: ${Math.round(smoothedFps)}`;framesDrawn=0;windowStart=now;
 }
}
// Count the actual rendered frames through the arena's rendering callback.
arena.onDrawFrame=countDrawnFrame;
const augments = new AugmentView(command=>send(command));
window.addEventListener('resize',placeWorldWidgets);
let worker: Worker | null = null;
const ghost = document.getElementById('dragGhost')!;
const ghostCanvas = document.createElement('canvas');
ghostCanvas.width = 96; ghostCanvas.height = 96;
ghostCanvas.className = 'pokemon-drag-idle';
ghost.append(ghostCanvas);
const ghostContext = ghostCanvas.getContext('2d')!;
type GhostSheet = { file: string; width: number; height: number; durations: number[]; directions: number };
const pmd = pmdManifest as Record<string, Record<string, GhostSheet>>;
let ghostImage: HTMLImageElement | null = null;
let ghostIdle: GhostSheet | null = null;
let ghostStarted = 0;
let ghostWidth = 96;
let ghostHeight = 96;
let state: GameSnapshot | null = null;
let eliminationShown=false;
const eliminationOverlay=document.getElementById('eliminationOverlay')!;
let dragStarted = false;
let pointerStart = { x: 0, y: 0 };
let lastSnapshotSerial=-1;
let lastWorldLayout='';
const errorBoundaries=new Set<string>();
function independently(name:string,callback:()=>void):void {
  try {callback();errorBoundaries.delete(name);}
  catch(error){if(!errorBoundaries.has(name))console.error(`[PokéTactics V22.6] ${name}`,error);errorBoundaries.add(name);}
}
function placeWorldWidgets():void {
  independently('Posicionar itens',()=>{const own=arena.ownerPlacement('p0');arena.placeWorldRack(document.getElementById('itemInventory')!,own.rack.x,own.rack.y);opponentItems.position(arena);});
  independently('Posicionar augments',()=>augments.positionStacks(arena));
}

function send(command: GameCommand): void {
  if (!state || !worker || !pause.classList.contains('hidden') || settingsFromPause)return;
  const spectatorWalk=view.spectating && state.players[0].eliminated && command.kind==='move-trainer';
  if(!spectatorWalk && ((view.scoutId!=='p0' && command.kind!=='augment-choose' && command.kind!=='augment-reroll')
    || state.phase==='finished' || state.players[0].eliminated))return;
  if (command.kind === 'buy') audio.play('buy');
  worker.postMessage({ type: 'command', command } satisfies ClientToServer);
}
function watch(playerId: string): void {
  view.scoutId = playerId;
  worker?.postMessage({ type: 'watch', playerId } satisfies ClientToServer);
}

function launchMatch(mode:'normal'|'sandbox'='normal'): void {
  audio.play('start');
  settingsFromPause=false;pause.classList.add('hidden');
  worker?.terminate();
  view.scoutId = 'p0';view.spectating=false;eliminationShown=false;eliminationOverlay.classList.add('hidden');
  view.selectedId = null;view.inventoryItemId=null;view.selectedBall=null;clearItemDrag();
  state = null; arena.snapshot = null; arena.setActive(true);
  framesDrawn=0;windowStart=performance.now();smoothedFps=75;fpsReadout.textContent='FPS: —';
  lastSnapshotSerial=-1;lastWorldLayout='';hud.reset();errorBoundaries.clear();
  augments.reset();sandbox.reset();opponentItems.reset();
  requestAnimationFrame(placeWorldWidgets);
  worker = new Worker(new URL('../../server/sim.worker.ts', import.meta.url), { type: 'module' });
  const currentWorker = worker;
  currentWorker.addEventListener('message', (event: MessageEvent<ServerToClient>) => {
    if (worker !== currentWorker) return;
    if (event.data.type === 'rejected') return hud.toast(event.data.reason);
    const incoming=event.data.snapshot;
    if(!Number.isFinite(incoming.serial)||incoming.serial<=lastSnapshotSerial)return;
    lastSnapshotSerial=incoming.serial;
    state=incoming;
    const eliminated=incoming.players[0].eliminated && !incoming.sandbox;
    if(eliminated&&!view.spectating&&!eliminationShown){
      eliminationShown=true;
      clearDrag();clearItemDrag();view.selectedId=null;view.inventoryItemId=null;view.selectedBall=null;
      document.getElementById('eliminationPlacement')!.textContent=
        `COLOCAÇÃO: ${incoming.players[0].placement??'—'}º LUGAR`;
      eliminationOverlay.classList.remove('hidden');
      eliminationOverlay.querySelector<HTMLButtonElement>('#eliminationSpectate')?.focus();
    }
    independently('Sandbox',()=>sandbox.render(incoming));
    if(view.selectedId && !state.players.some(p=>p.units.some(u=>u.id===view.selectedId))
      && !state.visibleBattle?.units.some(u=>u.id===view.selectedId||u.sourceId===view.selectedId))view.selectedId=null;
    if(view.inventoryItemId&&!state.players[0].itemInventory?.some(item=>item.id===view.inventoryItemId))view.inventoryItemId=null;
    if(view.selectedBall&&!(state.players[0].consumables?.[view.selectedBall]||0))view.selectedBall=null;
    // Authoritative state first, never gated by a canvas draw or a global 190ms timer.
    independently('HUD',()=>hud.render(incoming,view));
    independently('Relógio',()=>hud.renderClock(incoming));
    independently('Arena',()=>arena.acceptSnapshot(incoming));
    independently('Augments',()=>augments.render(incoming,arena));
    independently('Itens de outros jogadores',()=>opponentItems.render(incoming,arena,view.scoutId));
    const layout=[incoming.phase,incoming.observedId,incoming.visibleBattle?.participants.join(',')].join(':');
    if(lastWorldLayout!==layout){lastWorldLayout=layout;placeWorldWidgets();}
  });
  currentWorker.addEventListener('error', () => hud.toast('Erro ao iniciar a simulação'));
  currentWorker.postMessage({ type: 'connect', mode } satisfies ClientToServer);
}
const menus = new Menus(()=>launchMatch('normal'), () => playerSettings.open(),()=>launchMatch('sandbox'));
const sandbox=new SandboxView(command=>send(command),()=>closeMatch());
function closeMatch():void {
  settingsFromPause=false;pause.classList.add('hidden');playerSettings.close();audio.play('finish');
  worker?.terminate();worker=null;state=null;arena.snapshot=null;arena.setActive(false);
  view.scoutId='p0';view.spectating=false;eliminationShown=false;eliminationOverlay.classList.add('hidden');
  view.selectedId=null;clearDrag();clearItemDrag();view.selectedBall=null;view.inventoryItemId=null;
  augments.reset();sandbox.reset();opponentItems.reset();hud.reset();lastSnapshotSerial=-1;lastWorldLayout='';
  document.getElementById('finalBanner')!.classList.add('hidden');menus.showHome();
}
document.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest('button');
  if (button && button.id !== 'findMatchButton') audio.play('click');
});
placeWorldWidgets();
document.getElementById('finishedHomeButton')!.addEventListener('click', closeMatch);
document.getElementById('eliminationHome')!.addEventListener('click',closeMatch);
document.getElementById('eliminationSpectate')!.addEventListener('click',()=>{
  if(!state||!state.players[0].eliminated)return;
  view.spectating=true;
  eliminationOverlay.classList.add('hidden');
  clearDrag();clearItemDrag();view.selectedId=null;view.inventoryItemId=null;view.selectedBall=null;
  const next=state.players.find(p=>p.id!=='p0'&&!p.eliminated);
  if(next)watch(next.id);
  hud.render(state,view);
  placeWorldWidgets();
});

const inventoryContents = document.getElementById('inventoryContents')!;
inventoryContents.addEventListener('click',event=>{
  if (!state || view.scoutId!=='p0') return;
  const page=(event.target as HTMLElement).closest<HTMLElement>('[data-inventory-page]');
  if(page){hud.changeInventoryPage(page.dataset.inventoryPage==='next'?1:-1);hud.render(state,view);return;}
  // Normal equipment is always dragged. Pokeballs retain keyboard/click support.
  const item=(event.target as HTMLElement).closest<HTMLElement>('[data-inventory-item]');
  const ball=(event.target as HTMLElement).closest<HTMLElement>('[data-inventory-ball]');
  if(item) {view.inventoryItemId=null;return;}
  if(ball) {view.selectedBall=view.selectedBall===ball.dataset.inventoryBall?null:ball.dataset.inventoryBall as BallKind;view.inventoryItemId=null;}
  hud.render(state,view);
});
document.getElementById('unitInspector')!.addEventListener('click',event=>{
  if(!state || view.scoutId!=='p0') return;
  const slot=(event.target as HTMLElement).closest<HTMLElement>('[data-gear-slot]');
  if(!slot) return;
  const unitId=slot.dataset.gearUnit!;
  if(slot.classList.contains('occupied'))send({kind:'unequip-item',unitId,slot:Number(slot.dataset.gearSlot)});
});
// The board rack offers the same point-and-drag behavior as the Pokémon themselves.
let trayDragId:string|null=null;
let trayDragBall:BallKind|null=null;
let trayPointer=-1;
let trayStart={x:0,y:0};
let trayDragging=false;
const itemGhost=document.getElementById('itemDragGhost')!;
function clearItemDrag():void{
  if(trayPointer>=0 && inventoryContents.hasPointerCapture(trayPointer))inventoryContents.releasePointerCapture(trayPointer);
  trayDragId=null;trayDragBall=null;trayPointer=-1;trayDragging=false;
  itemGhost.classList.add('hidden');itemGhost.classList.remove('valid-target');itemGhost.innerHTML='';
}
function validInventoryDrop(unitId:string|null,itemId:string|null,ball:BallKind|null):boolean{
  if(!state||!unitId)return false;
  const player=state.players[0],unit=(state.sandbox?state.players.flatMap(p=>p.units):player.units).find(u=>u.id===unitId);
  if(!unit||(state.phase!=='planning'&&unit.position.area==='board'))return false;
  if(itemId){
    const item=player.itemInventory?.find(i=>i.id===itemId);
    if(item?.kind==='mega-stone')return !!eligibleForm(unit);
    return !!item&&((unit.equipment||[]).length<ITEMS.maxSlots || (item.kind==='component'&&!!unit.equipment?.some(e=>e.kind==='component')));
  }
  if(ball){
    const tiers:Record<BallKind,number>={pokeball:1,greatball:2,ultraball:3,masterball:5};
    if(!player.consumables?.[ball] || SPECIES[unit.family].rarity>tiers[ball])return false;
    return Array.from({length:BENCH_SIZE},(_,index)=>index).some(index=>!player.units.some(u=>u.position.area==='bench'&&u.position.index===index));
  }
  return false;
}
inventoryContents.addEventListener('pointerdown',event=>{
  if(event.button!==0 || view.scoutId!=='p0'||!state)return;
  const item=(event.target as HTMLElement).closest<HTMLElement>('[data-inventory-item]');
  const ball=(event.target as HTMLElement).closest<HTMLElement>('[data-inventory-ball]');
  if(!item&&!ball)return;
  trayDragId=item?.dataset.inventoryItem||null;
  trayDragBall=(ball?.dataset.inventoryBall as typeof trayDragBall)||null;
  trayPointer=event.pointerId;
  trayStart={x:event.clientX,y:event.clientY};
  trayDragging=false;
  // Keep the pointer attached to this stable parent while the item moves over the canvas.
  if(inventoryContents.hasPointerCapture(event.pointerId))inventoryContents.releasePointerCapture(event.pointerId);
  inventoryContents.setPointerCapture(event.pointerId);
  event.preventDefault();
});
document.addEventListener('pointermove',event=>{
  if((!trayDragId&&!trayDragBall)||event.pointerId!==trayPointer)return;
  if(!trayDragging&&Math.hypot(event.clientX-trayStart.x,event.clientY-trayStart.y)>6){
    const item=state?.players[0].itemInventory?.find(i=>i.id===trayDragId);
    if(!item&&!trayDragBall){clearItemDrag();return;}
    const source=trayDragBall ? document.querySelector<HTMLElement>(`[data-inventory-ball="${trayDragBall}"] img`) : document.querySelector<HTMLElement>(`[data-inventory-item="${trayDragId}"] .gear-icon`);
    itemGhost.innerHTML=source?.outerHTML||'';
    itemGhost.classList.remove('hidden');trayDragging=true;view.inventoryItemId=null;view.selectedBall=null;
  }
  if(trayDragging){
    if(event.cancelable)event.preventDefault();
    itemGhost.style.left=`${event.clientX}px`;itemGhost.style.top=`${event.clientY}px`;
    itemGhost.classList.toggle('valid-target',validInventoryDrop(arena.pickOwnUnit(event.clientX,event.clientY),trayDragId,trayDragBall));
  }
});
document.addEventListener('pointerup',event=>{
  if((!trayDragId&&!trayDragBall)||event.pointerId!==trayPointer)return;
  const id=trayDragId,ball=trayDragBall;
  if(trayDragging && view.scoutId==='p0'&&state){
    const target=document.elementFromPoint(event.clientX,event.clientY);
    const slot=target?.closest<HTMLElement>('[data-gear-slot]');
    const rect=canvas.getBoundingClientRect();
    const aboveCanvas=event.clientX>=rect.left&&event.clientX<=rect.right&&event.clientY>=rect.top&&event.clientY<=rect.bottom;
    const overHud=!!target?.closest('#shopFooter,#unitInspector,#itemInventory,.augment-overlay,.arena-augment-stacks');
    const picked=aboveCanvas&&!overHud?(state.sandbox?arena.pickUnit(event.clientX,event.clientY):null):null;
    const unitId=aboveCanvas&&!overHud?(picked?.sourceId||arena.pickOwnUnit(event.clientX,event.clientY)):null;
    if(slot && id && validInventoryDrop(slot.dataset.gearUnit||null,id,null))
      send({kind:'equip-item',itemId:id,unitId:slot.dataset.gearUnit!,ontoSlot:Number(slot.dataset.gearSlot)});
    else if(unitId && validInventoryDrop(unitId,id,ball)){
      if(ball)send({kind:'use-ball',ball,unitId});
      else if(id&&picked?.ownerId==='p1')send({kind:'sandbox-equip-item',ownerId:'p1',itemId:id,unitId});
      else if(id)send({kind:'equip-item',itemId:id,unitId});
    }
    // An invalid or empty drop does nothing: the authoritative inventory keeps the item.
    view.inventoryItemId=null;view.selectedBall=null;
    hud.render(state,view);
  }
  clearItemDrag();
});
document.addEventListener('pointercancel',event=>{if(event.pointerId===trayPointer)clearItemDrag();});
window.addEventListener('blur',clearItemDrag);
document.addEventListener('visibilitychange',()=>{if(document.hidden)clearItemDrag();});

document.getElementById('shopCards')!.addEventListener('click', event => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-shop]');
  if (target?.dataset.shopOffer) send({ kind: 'buy', slot: Number(target.dataset.shop), offerId: target.dataset.shopOffer });
});
document.getElementById('rerollButton')!.addEventListener('click', () => send({ kind: 'reroll' }));
document.getElementById('buyXpButton')!.addEventListener('click', () => send({ kind: 'buy-xp' }));
document.getElementById('lockButton')!.addEventListener('click', () => send({ kind: 'lock' }));
document.getElementById('rankRows')!.addEventListener('click', event => {
  if (!state || state.sandbox) return;
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-scout]');
  if (!target) return;
  watch(target.dataset.scout || 'p0');
  view.selectedId = null;
  hud.render(state, view);
});
document.getElementById('returnBoard')!.addEventListener('click', () => {
  if (!state) return;
  const returnId=state.players[0].eliminated
    ?state.players.find(p=>p.id!=='p0'&&!p.eliminated)?.id||'p0':'p0';
  watch(returnId); view.selectedId=null; hud.render(state, view);
});

function startDrag(id: string, event: PointerEvent): void {
  if (!state || state.phase === 'finished' || state.players[0].eliminated) return;
  const unit = (state.sandbox?state.players.flatMap(p=>p.units):state.players[0].units).find(u => u.id === id);
  if (!unit || (unit.position.area === 'board' && (state.phase !== 'planning' || view.scoutId !== 'p0'))) return;
  view.selectedId = id;
  view.dragId = id;
  pointerStart = { x: event.clientX, y: event.clientY };
  dragStarted = false;
  updateGhost(event);
  hud.render(state, view);
}

function setDragSprite(family: keyof typeof SPECIES, stage: number): void {
  const species = SPECIES[family];
  const dex = species.pokedexIds[Math.min(stage, species.pokedexIds.length - 1)];
  ghostIdle = pmd[String(dex)]?.Idle || null;
  const scale = arena.dragSpriteScale();
  const size = ghostIdle ? { w: ghostIdle.width * scale, h: ghostIdle.height * scale } : { w: arena.dragSpriteScale() * 48, h: arena.dragSpriteScale() * 48 };
  ghostWidth = Math.ceil(size.w);
  ghostHeight = Math.ceil(size.h);
  ghostCanvas.width = ghostWidth; ghostCanvas.height = ghostHeight;
  ghost.style.width = `${ghostWidth}px`;
  ghost.style.height = `${ghostHeight}px`;
  ghostImage = new Image();
  ghostImage.decoding = 'async';
  const fallbackPath=species.sprites[Math.min(stage, species.sprites.length-1)];
  ghostImage.src=ghostIdle
    ? `${import.meta.env.BASE_URL}sprite/${String(dex).padStart(4, '0')}/${ghostIdle.file}`
    : /^https?:\/\//.test(fallbackPath) ? fallbackPath : `${import.meta.env.BASE_URL}${fallbackPath.replace(/^\.\//, '')}`;
  ghostStarted = performance.now();
}

function drawDraggedIdle(time: number): void {
  if (view.dragging && ghostImage?.complete && ghostImage.naturalWidth) {
    const ctx = ghostContext;
    ctx.clearRect(0, 0, ghostWidth, ghostHeight);
    ctx.imageSmoothingEnabled = false;
    if (ghostIdle) {
      const ticks = ghostIdle.durations.reduce((sum, duration) => sum + duration, 0);
      let tick = ((time - ghostStarted) / 1000 * 60) % ticks;
      let frame = 0;
      while (frame < ghostIdle.durations.length - 1 && tick >= ghostIdle.durations[frame]) tick -= ghostIdle.durations[frame++];
      ctx.drawImage(ghostImage, frame * ghostIdle.width, 0, ghostIdle.width, ghostIdle.height,
        0, 0, ghostWidth, ghostHeight);
    } else {
      ctx.drawImage(ghostImage, 0, 0, ghostWidth, ghostHeight);
    }
  }
  if (view.dragging) requestAnimationFrame(drawDraggedIdle);
}

function updateGhost(event: PointerEvent): void {
  if (!view.dragId || !state) return;
  view.dragX = event.clientX; view.dragY = event.clientY;
  if (!dragStarted && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5) {
    dragStarted = true;
    view.dragging = true;
    const unit = (state.sandbox?state.players.flatMap(p=>p.units):state.players[0].units).find(u => u.id === view.dragId);
    if (unit) setDragSprite(unit.family, unit.stage);
    ghost.classList.remove('hidden');
    requestAnimationFrame(drawDraggedIdle);
    document.querySelector('.shop-row')?.classList.add('drag-selling');
    if(!state.sandbox||state.players[0].units.some(u=>u.id===view.dragId))document.getElementById('sellOverlay')?.classList.remove('hidden');
  }
  if (!dragStarted) return;
  ghost.style.transform = `translate3d(${event.clientX - ghostWidth / 2}px,${event.clientY - ghostHeight + 6}px,0)`;
  view.hoveringBench = arena.pickBench(event.clientX, event.clientY);
  view.hoveringHex = state.phase === 'planning' && view.scoutId === 'p0' ? arena.pickHex(event.clientX, event.clientY) : null;
}

function clearDrag(): void {
  view.dragId = null;
  view.dragging = false;
  ghostImage = null;
  view.hoveringHex = null;
  view.hoveringBench = null;
  dragStarted = false;
  ghost.classList.add('hidden');
  document.querySelector('.shop-row')?.classList.remove('drag-selling');
  document.getElementById('sellOverlay')?.classList.add('hidden');
  document.getElementById('sellOverlay')?.classList.remove('hover');
}

function finishDrag(event: PointerEvent): void {
  if (!view.dragId || !state) return;
  const id = view.dragId;
  const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
  const sell = target?.closest('#sellOverlay');
  if (dragStarted) {
    const enemyOwner=state.sandbox&&state.players[1].units.some(u=>u.id===id);
    if (sell && !enemyOwner) send({ kind: 'sell', unitId: id });
    else if (target === canvas) {
      if(enemyOwner){
        const hex=arena.pickEnemyHex(event.clientX,event.clientY);
        const own=arena.pickHex(event.clientX,event.clientY);
        if(hex)send({kind:'sandbox-move',ownerId:'p1',unitId:id,col:hex.col,row:3-hex.row});
        else if(own)send({kind:'sandbox-transfer',unitId:id,toOwnerId:'p0',position:{area:'board',...own}});
        clearDrag();hud.render(state,view);return;
      }
      if(state.sandbox&&state.phase==='planning'){
        const other=arena.pickEnemyHex(event.clientX,event.clientY);
        if(other){send({kind:'sandbox-transfer',unitId:id,toOwnerId:'p1',position:{area:'board',col:other.col,row:3-other.row}});clearDrag();hud.render(state,view);return;}
      }
      const benchIndex = arena.pickBench(event.clientX, event.clientY);
      if (benchIndex !== null) { const position={area:'bench' as const,index:benchIndex};arena.previewMove(id,position);send({kind:'move',unitId:id,position}); }
      else if (state.phase === 'planning' && view.scoutId === 'p0') {
        const hex = arena.pickHex(event.clientX, event.clientY);
        if (hex) { const position={area:'board' as const,...hex};arena.previewMove(id,position);send({kind:'move',unitId:id,position}); }
      }
    }
  }
  clearDrag();
  hud.render(state, view);
}

let draggingMime:{unitId:string;index:number}|null=null;
canvas.addEventListener('pointerdown', event => {
  const pillar=arena.pickMimePillar(event.clientX,event.clientY);
  if(pillar&&event.button===0){draggingMime=pillar;canvas.style.cursor='grabbing';event.preventDefault();return;}

  if (event.button !== 0) return;
  const id = arena.pickOwnUnit(event.clientX, event.clientY);
  const enemyUnit=state?.sandbox&&state.phase==='planning'?arena.pickUnit(event.clientX,event.clientY):null;
  if (!id&&enemyUnit?.ownerId==='p1'){startDrag(enemyUnit.sourceId,event);return;}
  if (id && view.selectedBall) {
    send({kind:'use-ball',ball:view.selectedBall,unitId:id});
    view.inventoryItemId=null;view.selectedBall=null;
    if(state) hud.render(state,view);
  } else if (id) startDrag(id, event);
  else if (state) {
    const target = arena.pickUnit(event.clientX, event.clientY);
    view.selectedId = target ? target.ownerId === 'p0' ? target.sourceId : target.id : null;
    hud.render(state, view);
  }
});
document.addEventListener('pointermove', event => {
  if(draggingMime){const p=arena.pickEnemyHex(event.clientX,event.clientY);arena.previewPillar(p?{...draggingMime,...p}:null);canvas.style.cursor='grabbing';return;}
  if (view.dragId) {
    updateGhost(event);
    const sell = document.elementFromPoint(event.clientX, event.clientY)?.closest('#sellOverlay');
    document.getElementById('sellOverlay')?.classList.toggle('hover', !!sell);
  }
});
document.addEventListener('pointerup',event=>{
  if(!draggingMime)return;
  const hex=arena.pickEnemyHex(event.clientX,event.clientY);
  if(hex)send({kind:'mime-pillar',unitId:draggingMime.unitId,index:draggingMime.index,...hex});
  draggingMime=null;arena.previewPillar(null);canvas.style.cursor='';
});
document.addEventListener('pointerup', finishDrag);
document.addEventListener('pointercancel',()=>{draggingMime=null;arena.previewPillar(null);canvas.style.cursor='';});
document.addEventListener('pointercancel', clearDrag);

canvas.addEventListener('dblclick', event => {
  if (!state || state.phase !== 'planning') return;
  const index = arena.pickBench(event.clientX, event.clientY);
  if (index === null || view.scoutId !== 'p0') return;
  const unit = state.players[0].units.find(u => u.position.area === 'bench' && u.position.index === index);
  if (!unit) return;
  const deployed = state.players[0].units.filter(u => u.position.area === 'board');
  for (let row = 0; row < 4; row++) for (let col = 0; col < 7; col++) {
    if (!deployed.some(u => u.position.area === 'board' && u.position.col === col && u.position.row === row)) {
      send({ kind: 'move', unitId: unit.id, position: { area: 'board', col, row } });
      return;
    }
  }
});

canvas.addEventListener('contextmenu', event => {
  event.preventDefault();
  if (view.scoutId !== 'p0' && !view.spectating) return;
  // A visit can still move, but cannot claim the eliminated player's coins.
  const coin = view.spectating?null:arena.pickCoin(event.clientX, event.clientY);
  send({ kind: 'move-trainer', ...(coin || arena.trainerDestination(event.clientX, event.clientY)) });
});
canvas.addEventListener('wheel', event => {
  event.preventDefault();
  arena.zoomAt(event.deltaY, event.clientX, event.clientY);
  placeWorldWidgets();
}, { passive: false });
document.addEventListener('keydown', event => {
  if (!state || event.repeat || state.phase === 'finished' || playerSettings.isOpen())return;
  if(event.key==='Escape'){
    if(!pause.classList.contains('hidden')){event.preventDefault();showPause(false);return;}
    if ((event.target as HTMLElement).closest('input,textarea,select,[contenteditable]') || !document.getElementById('eeveeEvolution')!.classList.contains('hidden') || !document.getElementById('settingsScreen')!.classList.contains('hidden') || document.querySelector('dialog[open]') || !!document.querySelector('.augment-overlay:not(.hidden)'))return;
    event.preventDefault();clearDrag();clearItemDrag();showPause(true);return;
  }
  if(!pause.classList.contains('hidden') || (event.target as HTMLElement).closest('input,textarea,select,[contenteditable]'))return;
  if (event.key.toLowerCase() === 'd') send({ kind: 'reroll' });
  if (event.key.toLowerCase() === 'e' && view.selectedId && !view.inventoryItemId && !view.selectedBall) {
    send({ kind: 'sell', unitId: view.selectedId }); view.selectedId = null;
  }
});

// Portal for attack descriptions: never changes inspector height or gets clipped by its scroll viewport.
const abilityFloat=document.createElement('div');
abilityFloat.className='floating-ability-tooltip hidden';abilityFloat.setAttribute('role','tooltip');document.body.append(abilityFloat);
let abilityPinned=false;
function showAbility(button:HTMLElement):void {
  const source=button.parentElement?.querySelector<HTMLElement>('.inspector-ability-tooltip');
  if(!source)return;
  abilityFloat.innerHTML=source.innerHTML;
  abilityFloat.style.width=`${Math.max(0,Math.min(430,window.innerWidth-24))}px`;
  abilityFloat.classList.remove('hidden');
  const rect=button.getBoundingClientRect();
  const bounds=abilityFloat.getBoundingClientRect();
  const left=Math.max(12,Math.min(window.innerWidth-bounds.width-12,rect.right-bounds.width));
  const above=rect.top-bounds.height-10;
  const below=rect.bottom+10;
  const top=Math.max(12,Math.min(window.innerHeight-bounds.height-12,
    above>=12?above:below));
  abilityFloat.style.left=`${left}px`;
  abilityFloat.style.top=`${top}px`;
}
function hideAbility():void {if(!abilityPinned)abilityFloat.classList.add('hidden');}
document.addEventListener('mouseover',e=>{const button=(e.target as HTMLElement).closest<HTMLElement>('.inspector-ability');if(button&&!abilityPinned)showAbility(button);});
document.addEventListener('mouseout',e=>{if((e.target as HTMLElement).closest('.inspector-ability'))hideAbility();});
document.addEventListener('focusin',e=>{const button=(e.target as HTMLElement).closest<HTMLElement>('.inspector-ability');if(button&&!abilityPinned)showAbility(button);});
document.addEventListener('focusout',e=>{if((e.target as HTMLElement).closest('.inspector-ability'))hideAbility();});
document.addEventListener('click',e=>{
 const button=(e.target as HTMLElement).closest<HTMLElement>('.inspector-ability');
 if(button){
   abilityPinned=!abilityPinned;
   abilityFloat.classList.toggle('is-pinned',abilityPinned);
   if(abilityPinned)showAbility(button);
   else abilityFloat.classList.add('hidden');
 } else if(!abilityFloat.contains(e.target as Node)) {
   abilityPinned=false;abilityFloat.classList.remove('is-pinned');abilityFloat.classList.add('hidden');
 }
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){abilityPinned=false;abilityFloat.classList.remove('is-pinned');abilityFloat.classList.add('hidden');}});

/** Rich hover/focus tooltip shared by every inventory component and equipped item.
 * The item description remains authoritative in server/systems/items.ts. */
const itemFloat=document.createElement('div');
itemFloat.className='floating-item-tooltip hidden';itemFloat.setAttribute('role','tooltip');document.body.append(itemFloat);
let hoveredItem:HTMLElement|null=null;
function positionItemTooltip(target:HTMLElement):void {
  const detail=target.dataset.itemTooltip;
  if(!detail)return;
  hoveredItem=target;itemFloat.textContent=detail;itemFloat.classList.remove('hidden');
  const rect=target.getBoundingClientRect(),bounds=itemFloat.getBoundingClientRect();
  itemFloat.style.left=`${Math.max(10,Math.min(window.innerWidth-bounds.width-10,rect.left+rect.width/2-bounds.width/2))}px`;
  itemFloat.style.top=`${Math.max(10,rect.top-bounds.height-9>10?rect.top-bounds.height-9:Math.min(window.innerHeight-bounds.height-10,rect.bottom+9))}px`;
}
function clearItemTooltip():void {hoveredItem=null;itemFloat.classList.add('hidden');}
document.addEventListener('mouseover',event=>{
  const slot=(event.target as HTMLElement).closest<HTMLElement>('[data-item-tooltip]');
  if(slot && hoveredItem!==slot)positionItemTooltip(slot);
});
document.addEventListener('mouseout',event=>{
  const slot=(event.target as HTMLElement).closest<HTMLElement>('[data-item-tooltip]');
  if(slot && hoveredItem===slot && !(event.relatedTarget instanceof Node && slot.contains(event.relatedTarget)))clearItemTooltip();
});
document.addEventListener('focusin',event=>{
  const slot=(event.target as HTMLElement).closest<HTMLElement>('[data-item-tooltip]');
  if(slot)positionItemTooltip(slot);
});
document.addEventListener('focusout',event=>{
  const slot=(event.target as HTMLElement).closest<HTMLElement>('[data-item-tooltip]');
  if(slot && hoveredItem===slot)clearItemTooltip();
});
document.addEventListener('keydown',event=>{if(event.key==='Escape')clearItemTooltip();});
