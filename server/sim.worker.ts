/** Authoritative in-browser server. Fixed-step simulation stays independent from paint FPS. */
import { GameEngine } from './engine';
import { RENDER_SETTINGS } from './data';
import type { ClientToServer, ServerToClient } from './types';

let game:GameEngine|null=null;
let paused=false;
let watchedPlayer = 'p0';
const send = (message: ServerToClient) => self.postMessage(message);
const publish = () => {if(game)send({type:'snapshot',snapshot:game.snapshot(watchedPlayer)});};
const rejectUnexpected=(error:unknown)=>{
  console.error('[Worker V23] Falha isolada ao processar estado',error);
  send({type:'rejected',reason:'Erro temporário na simulação; tente novamente.'});
};
const stepMs = RENDER_SETTINGS.simulationTickMs;
let previousTime = performance.now();
let accumulatedMs = 0;
let nextSnapshot = 0;
let tickErrorReported=false;

self.addEventListener('message', (event: MessageEvent<ClientToServer>) => {
  try {
    if (event.data.type === 'connect') {game=new GameEngine(Date.now(),event.data.mode==='sandbox');watchedPlayer='p0';paused=false;accumulatedMs=0;previousTime=performance.now();}
    if(event.data.type==='pause'){paused=event.data.paused;accumulatedMs=0;previousTime=performance.now();}
    if (!game)return;
    if (event.data.type === 'watch') {
      const playerId = event.data.playerId;
      if (game.players.some(player => player.id === playerId)) watchedPlayer = playerId;
    }
    if (event.data.type === 'command') {
      const reason = game.command(event.data.command);
      if (reason) send({ type: 'rejected', reason });
    }
    publish(); // Never wait for the next timed snapshot after a buy/reroll/equipment command.
    nextSnapshot = performance.now() + RENDER_SETTINGS.snapshotIntervalMs;
  }catch(error){rejectUnexpected(error);}
});

// Regular logical steps: drawing speed cannot change attacks, movement or damage.
// Bound catch-up after a suspended tab to avoid a burst of ticks on resume.
setInterval(() => {
  const now = performance.now();
  const elapsedMs = Math.max(0, Math.min(250, now - previousTime));
  previousTime = now;
  if(paused){accumulatedMs=0;return;}
  accumulatedMs += elapsedMs;
  let steps = 0;
  try {
    while (accumulatedMs >= stepMs && steps < 5) {
      game?.tick(stepMs / 1000, watchedPlayer === 'p0');
      accumulatedMs -= stepMs;
      steps++;
    }
    if (steps === 5) accumulatedMs = Math.min(accumulatedMs, stepMs);
    tickErrorReported=false;
  }catch(error){
    // A simulation exception cannot permanently stop delivery of new HUD snapshots.
    accumulatedMs=0;
    if(!tickErrorReported)console.error('[Worker V23] Falha no tick da simulação',error);
    tickErrorReported=true;
  }
  if (now >= nextSnapshot) {
    try {publish();}catch(error){rejectUnexpected(error);}
    nextSnapshot = now + RENDER_SETTINGS.snapshotIntervalMs;
  }
}, Math.max(10, Math.floor(stepMs / 2)));
