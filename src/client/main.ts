import { Arena, type ClientView } from './arena';
import { Hud } from './hud';
import { Menus } from './menus';
import { SPECIES } from '../../server/data';
import pmdManifest from './pmd-manifest.json';
import type { ClientToServer, GameCommand, GameSnapshot, ServerToClient } from '../../server/types';

const view: ClientView = { scoutId: 'p0', selectedId: null, dragId: null, dragging: false, dragX: 0, dragY: 0, hoveringHex: null, hoveringBench: null };
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
  if (!state || !worker || state.phase === 'finished' || state.players[0].eliminated) return;
  worker.postMessage({ type: 'command', command } satisfies ClientToServer);
}
function watch(playerId: string): void {
  view.scoutId = playerId;
  worker?.postMessage({ type: 'watch', playerId } satisfies ClientToServer);
}

function launchMatch(): void {
  worker?.terminate();
  view.scoutId = 'p0'; view.selectedId = null;
  state = null; arena.snapshot = null;
  lastHudPhase = ''; lastHudGold = -1; lastHudRender = 0;
  worker = new Worker(new URL('../../server/sim.worker.ts', import.meta.url), { type: 'module' });
  const currentWorker = worker;
  currentWorker.addEventListener('message', (event: MessageEvent<ServerToClient>) => {
    if (worker !== currentWorker) return;
    if (event.data.type === 'rejected') return hud.toast(event.data.reason);
    state = event.data.snapshot;
    arena.snapshot = state;
    arena.snapshotReceivedAt = performance.now();
    if (view.selectedId && !state.players.some(p => p.units.some(u => u.id === view.selectedId))
      && !state.visibleBattle?.units.some(u => u.id === view.selectedId || u.sourceId === view.selectedId)) view.selectedId = null;
    const now = performance.now();
    if (now - lastHudRender > 95 || state.phase !== lastHudPhase || state.players[0].gold !== lastHudGold) {
      hud.render(state, view);
      lastHudRender = now; lastHudPhase = state.phase; lastHudGold = state.players[0].gold;
    }
  });
  currentWorker.addEventListener('error', () => hud.toast('Erro ao iniciar a simulação'));
  currentWorker.postMessage({ type: 'connect' } satisfies ClientToServer);
}
const menus = new Menus(launchMatch);
document.getElementById('finishedHomeButton')!.addEventListener('click', () => {
  worker?.terminate(); worker = null; state = null; arena.snapshot = null;
  view.selectedId = null; clearDrag();
  document.getElementById('finalBanner')!.classList.add('hidden');
  menus.showHome();
});

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
  ghostImage.src = ghostIdle
    ? `${import.meta.env.BASE_URL}sprite/${String(dex).padStart(4, '0')}/${ghostIdle.file}`
    : `${import.meta.env.BASE_URL}${species.sprites[Math.min(stage, species.sprites.length - 1)].replace(/^\.\//, '')}`;
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
  requestAnimationFrame(drawDraggedIdle);
}
requestAnimationFrame(drawDraggedIdle);

function updateGhost(event: PointerEvent): void {
  if (!view.dragId || !state) return;
  view.dragX = event.clientX; view.dragY = event.clientY;
  if (!dragStarted && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5) {
    dragStarted = true;
    view.dragging = true;
    const unit = state.players[0].units.find(u => u.id === view.dragId);
    if (unit) setDragSprite(unit.family, unit.stage);
    ghost.classList.remove('hidden');
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
  const coin = arena.pickCoin(event.clientX, event.clientY);
  if (coin) { send({ kind: 'move-trainer', ...coin }); return; }
  const id = arena.pickOwnUnit(event.clientX, event.clientY);
  if (id) startDrag(id, event);
  else if (state) {
    const target = arena.pickUnit(event.clientX, event.clientY);
    view.selectedId = target ? target.ownerId === 'p0' ? target.sourceId : target.id : null;
    if (!target && view.scoutId === 'p0') send({ kind: 'move-trainer', ...arena.trainerDestination(event.clientX, event.clientY) });
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
  if (view.scoutId === 'p0') send({ kind: 'move-trainer', ...arena.trainerDestination(event.clientX, event.clientY) });
});
canvas.addEventListener('wheel', event => {
  event.preventDefault();
  arena.zoomAt(event.deltaY, event.clientX, event.clientY);
}, { passive: false });
document.addEventListener('keydown', event => {
  if (!state || event.repeat || state.phase === 'finished') return;
  if (event.key.toLowerCase() === 'd') send({ kind: 'reroll' });
  if (event.key.toLowerCase() === 'e' && view.selectedId) {
    send({ kind: 'sell', unitId: view.selectedId });
    view.selectedId = null;
  }
  if (event.key === 'Escape') {
    view.selectedId = null; watch('p0'); hud.render(state, view);
  }
});
