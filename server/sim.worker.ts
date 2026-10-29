/** Authoritative in-browser server. Fixed-step simulation stays independent from paint FPS. */
import { GameEngine } from './engine';
import { RENDER_SETTINGS } from './data';
import type { ClientToServer, ServerToClient } from './types';

const game = new GameEngine();
let watchedPlayer = 'p0';
const send = (message: ServerToClient) => self.postMessage(message);
const stepMs = RENDER_SETTINGS.simulationTickMs;
let previousTime = performance.now();
let accumulatedMs = 0;
let nextSnapshot = 0;

self.addEventListener('message', (event: MessageEvent<ClientToServer>) => {
  if (event.data.type === 'watch') {
    const playerId = event.data.playerId;
    if (game.players.some(player => player.id === playerId)) watchedPlayer = playerId;
  }
  if (event.data.type === 'command') {
    const reason = game.command(event.data.command);
    if (reason) send({ type: 'rejected', reason });
  }
  send({ type: 'snapshot', snapshot: game.snapshot(watchedPlayer) });
  nextSnapshot = performance.now() + RENDER_SETTINGS.snapshotIntervalMs;
});

// Regular logical steps: drawing speed cannot change attacks, movement or damage.
// Bound catch-up after a suspended tab to avoid a burst of ticks on resume.
setInterval(() => {
  const now = performance.now();
  const elapsedMs = Math.max(0, Math.min(250, now - previousTime));
  previousTime = now;
  accumulatedMs += elapsedMs;
  let steps = 0;
  while (accumulatedMs >= stepMs && steps < 5) {
    game.tick(stepMs / 1000, watchedPlayer === 'p0');
    accumulatedMs -= stepMs;
    steps++;
  }
  if (steps === 5) accumulatedMs = Math.min(accumulatedMs, stepMs);
  if (now >= nextSnapshot) {
    send({ type: 'snapshot', snapshot: game.snapshot(watchedPlayer) });
    nextSnapshot = now + RENDER_SETTINGS.snapshotIntervalMs;
  }
}, Math.max(10, Math.floor(stepMs / 2)));
