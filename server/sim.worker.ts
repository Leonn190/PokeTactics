/** Authoritative in-browser server. A future WebSocket transport can use the same protocol and engine. */
import { GameEngine } from './engine';
import type { ClientToServer, ServerToClient } from './types';

const game = new GameEngine();
const send = (message: ServerToClient) => self.postMessage(message);
let last = performance.now();
let nextSnapshot = 0;

self.addEventListener('message', (event: MessageEvent<ClientToServer>) => {
  if (event.data.type === 'command') {
    const reason = game.command(event.data.command);
    if (reason) send({ type: 'rejected', reason });
  }
  send({ type: 'snapshot', snapshot: game.snapshot() });
});

setInterval(() => {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  game.tick(dt);
  if (now >= nextSnapshot) {
    send({ type: 'snapshot', snapshot: game.snapshot() });
    nextSnapshot = now + 100;
  }
}, 50);
