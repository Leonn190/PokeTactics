import { Arena, type ClientView } from './arena';
import { Hud } from './hud';
import { SPECIES } from '../../server/data';
import type { ClientToServer, GameCommand, GameSnapshot, ServerToClient } from '../../server/types';

const view: ClientView = { scoutId: 'p0', selectedId: null, dragId: null, dragX: 0, dragY: 0, hoveringHex: null, hoveringBench: null };
const canvas = document.getElementById('battlefield') as HTMLCanvasElement;
const arena = new Arena(canvas, view);
const hud = new Hud();
const worker = new Worker(new URL('../../server/sim.worker.ts', import.meta.url), { type: 'module' });
const ghost = document.getElementById('dragGhost')!;
let state: GameSnapshot | null = null;
let dragStarted = false;
let pointerStart = { x: 0, y: 0 };
let lastHudRender = 0;
let lastHudPhase = '';
let lastHudGold = -1;

function send(command: GameCommand): void {
  if (!state || state.phase === 'finished' || state.players[0].eliminated) return;
  worker.postMessage({ type: 'command', command } satisfies ClientToServer);
}
function watch(playerId: string): void {
  view.scoutId = playerId;
  worker.postMessage({ type: 'watch', playerId } satisfies ClientToServer);
}

worker.addEventListener('message', (event: MessageEvent<ServerToClient>) => {
  if (event.data.type === 'rejected') return hud.toast(event.data.reason);
  state = event.data.snapshot;
  arena.snapshot = state;
  if (view.selectedId && !state.players.some(p => p.units.some(u => u.id === view.selectedId))
    && !state.visibleBattle?.units.some(u => u.id === view.selectedId || u.sourceId === view.selectedId)) view.selectedId = null;
  const now = performance.now();
  if (now - lastHudRender > 95 || state.phase !== lastHudPhase || state.players[0].gold !== lastHudGold) {
    hud.render(state, view);
    lastHudRender = now; lastHudPhase = state.phase; lastHudGold = state.players[0].gold;
  }
});
worker.addEventListener('error', () => hud.toast('Erro ao iniciar a simulação'));
worker.postMessage({ type: 'connect' } satisfies ClientToServer);

document.getElementById('shopCards')!.addEventListener('click', event => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-shop]');
  if (target) send({ kind: 'buy', slot: Number(target.dataset.shop) });
});
document.getElementById('rerollButton')!.addEventListener('click', () => send({ kind: 'reroll' }));
document.getElementById('lockButton')!.addEventListener('click', () => send({ kind: 'lock' }));

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

function updateGhost(event: PointerEvent): void {
  if (!view.dragId || !state) return;
  view.dragX = event.clientX; view.dragY = event.clientY;
  if (!dragStarted && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5) {
    dragStarted = true;
    const unit = state.players[0].units.find(u => u.id === view.dragId);
    if (unit) {
      const species = SPECIES[unit.family];
      const dex = species.pokedexIds[Math.min(unit.stage, species.pokedexIds.length - 1)];
      ghost.innerHTML = `<img class="pokemon-drag-portrait" src="${import.meta.env.BASE_URL}portrait/${String(dex).padStart(4, '0')}/Normal.png" alt="" draggable="false" />`;
    }
    ghost.classList.remove('hidden');
    document.querySelector('.shop-row')?.classList.add('drag-selling');
    document.getElementById('sellOverlay')?.classList.remove('hidden');
  }
  if (!dragStarted) return;
  ghost.style.transform = `translate3d(${event.clientX - 26}px,${event.clientY - 26}px,0)`;
  view.hoveringBench = arena.pickBench(event.clientX, event.clientY);
  view.hoveringHex = state.phase === 'planning' && view.scoutId === 'p0' ? arena.pickHex(event.clientX, event.clientY) : null;
}

function clearDrag(): void {
  view.dragId = null;
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
  if (coin) { send({ kind: 'collect', dropId: coin }); return; }
  const id = arena.pickOwnUnit(event.clientX, event.clientY);
  if (id) startDrag(id, event);
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
  arena.moveTrainer(event.clientX, event.clientY);
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
