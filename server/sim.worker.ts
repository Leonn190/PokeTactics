/** Authoritative in-browser server. A future WebSocket transport can use the same protocol and engine. */
import { GameEngine } from './engine';
import { RENDER_SETTINGS } from './data';
import type { ClientToServer, ServerToClient } from './types';

const game = new GameEngine();
let watchedPlayer = 'p0';
const send = (message: ServerToClient) => self.postMessage(message);
let last = performance.now();
let nextSnapshot = 0;

self.addEventListener('message', (event: MessageEvent<ClientToServer>) => {
  if (event.data.type === 'watch') {
    const playerId = event.data.playerId;
    if (game.players.some(p => p.id === playerId)) watchedPlayer = playerId;
  }
  if (event.data.type === 'command') {
    const reason = game.command(event.data.command);
    if (reason) send({ type: 'rejected', reason });
  }
  send({ type: 'snapshot', snapshot: game.snapshot(watchedPlayer) });
  nextSnapshot = performance.now() + RENDER_SETTINGS.snapshotIntervalMs;
});

setInterval(() => {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  game.tick(dt);
  if (now >= nextSnapshot) {
    send({ type: 'snapshot', snapshot: game.snapshot(watchedPlayer) });
    nextSnapshot = now + RENDER_SETTINGS.snapshotIntervalMs;
  }
}, RENDER_SETTINGS.simulationTickMs);
