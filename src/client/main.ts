import { Arena, type ClientView } from './arena';
import { Hud } from './hud';
import { Menus } from './menus';
import { RENDER_SETTINGS, SPECIES } from '../../server/data';
import pmdManifest from './pmd-manifest.json';
import type { ClientToServer, GameCommand, GameSnapshot, ServerToClient } from '../../server/types';

const view: ClientView = { scoutId: 'p0', selectedId: null, dragId: null, dragging: false, dragX: 0, dragY: 0, hoveringHex: null, hoveringBench: null, inventoryItemId:null,selectedBall:null };
const canvas = document.getElementById('battlefield') as HTMLCanvasElement;
const arena = new Arena(canvas, view);
const hud = new Hud();
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
let dragStarted = false;
let pointerStart = { x: 0, y: 0 };
let lastHudRender = 0;
let lastHudPhase = '';
let lastHudGold = -1;

function send(command: GameCommand): void {
  if (!state || !worker || view.scoutId!=='p0' || state.phase === 'finished' || state.players[0].eliminated) return;
  worker.postMessage({ type: 'command', command } satisfies ClientToServer);
}
function watch(playerId: string): void {
  view.scoutId = playerId;
  worker?.postMessage({ type: 'watch', playerId } satisfies ClientToServer);
}

function launchMatch(): void {
  worker?.terminate();
  view.scoutId = 'p0'; view.selectedId = null;view.inventoryItemId=null;view.selectedBall=null;clearItemDrag();
  state = null; arena.snapshot = null; arena.setActive(true);
  lastHudPhase = ''; lastHudGold = -1; lastHudRender = 0;
  worker = new Worker(new URL('../../server/sim.worker.ts', import.meta.url), { type: 'module' });
  const currentWorker = worker;
  currentWorker.addEventListener('message', (event: MessageEvent<ServerToClient>) => {
    if (worker !== currentWorker) return;
    if (event.data.type === 'rejected') return hud.toast(event.data.reason);
    if (!arena.acceptSnapshot(event.data.snapshot)) return;
    state = event.data.snapshot;
    if (view.selectedId && !state.players.some(p => p.units.some(u => u.id === view.selectedId))
      && !state.visibleBattle?.units.some(u => u.id === view.selectedId || u.sourceId === view.selectedId)) view.selectedId = null;
    const now = performance.now();
    hud.renderClock(state);
    if (now - lastHudRender > RENDER_SETTINGS.hudRefreshMs || state.phase !== lastHudPhase || state.players[0].gold !== lastHudGold) {
      hud.render(state, view);
      lastHudRender = now; lastHudPhase = state.phase; lastHudGold = state.players[0].gold;
    }
  });
  currentWorker.addEventListener('error', () => hud.toast('Erro ao iniciar a simulação'));
  currentWorker.postMessage({ type: 'connect' } satisfies ClientToServer);
}
const menus = new Menus(launchMatch);
document.getElementById('finishedHomeButton')!.addEventListener('click', () => {
  worker?.terminate(); worker = null; state = null; arena.snapshot = null; arena.setActive(false);
  view.selectedId = null; clearDrag();
  document.getElementById('finalBanner')!.classList.add('hidden');
  menus.showHome();
});

document.getElementById('inventoryContents')!.addEventListener('click',event=>{
  if(suppressTrayClick){suppressTrayClick=false;return;}
  if (!state || view.scoutId!=='p0') return;
  const page=(event.target as HTMLElement).closest<HTMLElement>('[data-inventory-page]');
  if(page){hud.changeInventoryPage(page.dataset.inventoryPage==='next'?1:-1);hud.render(state,view);return;}
  const item=(event.target as HTMLElement).closest<HTMLElement>('[data-inventory-item]');
  const ball=(event.target as HTMLElement).closest<HTMLElement>('[data-inventory-ball]');
  if(item) { view.inventoryItemId=item.dataset.inventoryItem||null;view.selectedBall=null; }
  if(ball) { view.selectedBall=ball.dataset.inventoryBall as typeof view.selectedBall;view.inventoryItemId=null; }
  hud.render(state,view);
});
document.getElementById('unitInspector')!.addEventListener('click',event=>{
  if(!state || view.scoutId!=='p0') return;
  const slot=(event.target as HTMLElement).closest<HTMLElement>('[data-gear-slot]');
  if(!slot) return;
  const unitId=slot.dataset.gearUnit!;
  if(view.inventoryItemId) {
    send({kind:'equip-item',itemId:view.inventoryItemId,unitId,ontoSlot:Number(slot.dataset.gearSlot)});
    view.inventoryItemId=null;
  } else send({kind:'unequip-item',unitId,slot:Number(slot.dataset.gearSlot)});
});
// The board rack offers the same point-and-drag behavior as the Pokémon themselves.
let trayDragId:string|null=null;
let trayPointer=-1;
let trayStart={x:0,y:0};
let trayDragging=false;
let suppressTrayClick=false;
const itemGhost=document.getElementById('itemDragGhost')!;
function clearItemDrag():void{
  trayDragId=null;trayPointer=-1;trayDragging=false;
  itemGhost.classList.add('hidden');itemGhost.classList.remove('valid-target');itemGhost.innerHTML='';
}
document.getElementById('inventoryContents')!.addEventListener('pointerdown',event=>{
  if(event.button!==0 || view.scoutId!=='p0'||!state)return;
  const item=(event.target as HTMLElement).closest<HTMLElement>('[data-inventory-item]');
  if(!item)return;
  trayDragId=item.dataset.inventoryItem||null;
  trayPointer=event.pointerId;
  trayStart={x:event.clientX,y:event.clientY};
  trayDragging=false;
});
document.addEventListener('pointermove',event=>{
  if(!trayDragId||event.pointerId!==trayPointer)return;
  if(!trayDragging&&Math.hypot(event.clientX-trayStart.x,event.clientY-trayStart.y)>6){
    const item=state?.players[0].itemInventory?.find(i=>i.id===trayDragId);
    if(!item){clearItemDrag();return;}
    const source=document.querySelector<HTMLElement>(`[data-inventory-item="${trayDragId}"] .gear-icon`);
    itemGhost.innerHTML=source?.outerHTML||'';
    itemGhost.classList.remove('hidden');trayDragging=true;
  }
  if(trayDragging){
    itemGhost.style.left=`${event.clientX}px`;itemGhost.style.top=`${event.clientY}px`;
    itemGhost.classList.toggle('valid-target',!!arena.pickOwnUnit(event.clientX,event.clientY));
  }
});
document.addEventListener('pointerup',event=>{
  if(!trayDragId||event.pointerId!==trayPointer)return;
  const id=trayDragId;
  if(trayDragging){
    // Suppress only the synthesized click generated at the rack after a drag.
    // Canvas drops must not suppress the user's *next* independent rack click.
    suppressTrayClick=!!(document.elementFromPoint(event.clientX,event.clientY) as HTMLElement|null)
      ?.closest('#inventoryContents');
    // Browsers may omit the post-drag click; prevent stale suppression.
    window.setTimeout(()=>{suppressTrayClick=false;},0);
    if(view.scoutId==='p0'&&state){
      const target=document.elementFromPoint(event.clientX,event.clientY);
      const unitId=(target===canvas)?arena.pickOwnUnit(event.clientX,event.clientY):null;
      const slot=target?.closest<HTMLElement>('[data-gear-slot]');
      if(unitId)send({kind:'equip-item',itemId:id,unitId});
      else if(slot)send({kind:'equip-item',itemId:id,unitId:slot.dataset.gearUnit!,ontoSlot:Number(slot.dataset.gearSlot)});
      view.inventoryItemId=null;
      hud.render(state,view);
    }
  }
  clearItemDrag();
});
document.addEventListener('pointercancel',clearItemDrag);

document.getElementById('shopCards')!.addEventListener('click', event => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-shop]');
  if (target) send({ kind: 'buy', slot: Number(target.dataset.shop) });
});
document.getElementById('rerollButton')!.addEventListener('click', () => send({ kind: 'reroll' }));
document.getElementById('lockButton')!.addEventListener('click', () => send({ kind: 'lock' }));
document.getElementById('eeveeBranches')!.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLElement>('[data-eevee-branch]');
  if (button) send({ kind:'choose-eevee', branch:button.dataset.eeveeBranch as keyof typeof SPECIES });
});

document.getElementById('rankRows')!.addEventListener('click', event => {
  if (!state) return;
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-scout]');
  if (!target) return;
  watch(target.dataset.scout || 'p0');
  view.selectedId = null;
  hud.render(state, view);
});
document.getElementById('returnBoard')!.addEventListener('click', () => {
  if (!state) return;
  watch('p0'); hud.render(state, view);
});

function startDrag(id: string, event: PointerEvent): void {
  if (!state || state.phase === 'finished') return;
  const unit = state.players[0].units.find(u => u.id === id);
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
    const unit = state.players[0].units.find(u => u.id === view.dragId);
    if (unit) setDragSprite(unit.family, unit.stage);
    ghost.classList.remove('hidden');
    requestAnimationFrame(drawDraggedIdle);
    document.querySelector('.shop-row')?.classList.add('drag-selling');
    document.getElementById('sellOverlay')?.classList.remove('hidden');
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
    if (sell) send({ kind: 'sell', unitId: id });
    else if (target === canvas) {
      const benchIndex = arena.pickBench(event.clientX, event.clientY);
      if (benchIndex !== null) send({ kind: 'move', unitId: id, position: { area: 'bench', index: benchIndex } });
      else if (state.phase === 'planning' && view.scoutId === 'p0') {
        const hex = arena.pickHex(event.clientX, event.clientY);
        if (hex) send({ kind: 'move', unitId: id, position: { area: 'board', ...hex } });
      }
    }
  }
  clearDrag();
  hud.render(state, view);
}

canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  const id = arena.pickOwnUnit(event.clientX, event.clientY);
  if (id && (view.inventoryItemId || view.selectedBall)) {
    if(view.inventoryItemId) send({kind:'equip-item',itemId:view.inventoryItemId,unitId:id});
    else if(view.selectedBall) send({kind:'use-ball',ball:view.selectedBall,unitId:id});
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
  if (view.dragId) {
    updateGhost(event);
    const sell = document.elementFromPoint(event.clientX, event.clientY)?.closest('#sellOverlay');
    document.getElementById('sellOverlay')?.classList.toggle('hover', !!sell);
  }
});
document.addEventListener('pointerup', finishDrag);
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
  if (view.scoutId !== 'p0') return;
  // A moeda continua sendo coletada por colisão: o botão direito só define o destino.
  const coin = arena.pickCoin(event.clientX, event.clientY);
  send({ kind: 'move-trainer', ...(coin || arena.trainerDestination(event.clientX, event.clientY)) });
});
canvas.addEventListener('wheel', event => {
  event.preventDefault();
  arena.zoomAt(event.deltaY, event.clientX, event.clientY);
}, { passive: false });
document.addEventListener('keydown', event => {
  if (!state || event.repeat || state.phase === 'finished') return;
  if (event.key.toLowerCase() === 'd') send({ kind: 'reroll' });
  if (event.key.toLowerCase() === 'e' && view.selectedId && !view.inventoryItemId && !view.selectedBall) {
    send({ kind: 'sell', unitId: view.selectedId });
    view.selectedId = null;
  }
  if (event.key === 'Escape') {
    view.selectedId = null; view.inventoryItemId=null;view.selectedBall=null;watch('p0'); hud.render(state, view);
  }
});
