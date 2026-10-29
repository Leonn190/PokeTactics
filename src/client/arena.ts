import { getStageData, gridXY, SPECIES, RENDER_SETTINGS, RULES } from '../../server/data';
import { FrameScheduler } from './performance/frame-scheduler';
import { PerformanceProfiler } from './performance/profiler';
import { SnapshotClock } from './animation/snapshot-clock';
import { EffectTimeline } from './animation/effect-timeline';
import { SpriteManager } from './animation/sprite-manager';
import { UnitInterpolator } from './animation/unit-interpolator';
import { VisualEventManager } from './animation/visual-event-manager';
import { OrientationController } from './animation/orientation';
import { drawUnitVisualEvent } from './animation/unit-visuals';
import { paintArenaBackground } from './scene/background';
import { drawCoin } from './scene/coin-renderer';
import { renderTrainerAvatar } from './scene/trainer-renderer';
import { renderFloatingNumber } from './vfx/floating-numbers';
import { renderCombatEffects } from './render/effects';
import { SpriteBoundsCache } from './render/sprite-bounds';
import { drawContactShadow } from './render/shadows';
import type { CombatUnit, Family, GameSnapshot, Pokemon, UnitPosition } from '../../server/types';
import { trainerSpot } from '../../server/combat/trainer-position';
import pmdManifest from './pmd-manifest.json';

export interface ClientView {
  scoutId: string;
  selectedId: string | null;
  dragId: string | null;
  dragging: boolean;
  dragX: number;
  dragY: number;
  hoveringHex: { col: number; row: number } | null;
  hoveringBench: number | null;
}

type Marker = { id: string; ownerId: string; sourceId: string; x: number; y: number; family: Family; stage: number; own: boolean; level: number; hp: number; maxHp: number; energy: number; required: number; flash: number; bench?: boolean; moving?: boolean; facingX?: number; facingY?: number; animation?: CombatUnit['animation']; spinTime?: number; spinDuration?: number; jumpHeight?: number; knockUpTime?: number; knockUpDuration?: number; poison?: CombatUnit['poison']; barrier?: CombatUnit['barrier']; barriers?: CombatUnit['barriers']; buffs?: CombatUnit['buffs']; defenseShreds?: CombatUnit['defenseShreds']; guardUntil?: number };
type PmdSheet = { file: string; width: number; height: number; durations: number[]; directions: number; hitFrame?: number };
type PmdEntry = Record<string, PmdSheet>;
const PMD = pmdManifest as Record<string, PmdEntry>;
const PI2 = Math.PI * 2;
const BENCH_Y = 4.38;
const ARENA_HALF = 4.25;
const QUAD_OFFSET = 4.35;
const benchXY = (index: number, enemy = false, offset = 0) => ({ x: offset + (index - 4.5) * (ARENA_HALF * 2 / 10), y: enemy ? -BENCH_Y : BENCH_Y });

export class Arena {
  private context: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private pixelRatio = 1;
  private zoom = 1;
  private cameraOffset = { x: 0, y: 0 };
  private trainer = { x: -4.75, y: 3.57 };
  private unitInterpolator = new UnitInterpolator();
  private rafHandle: number | null = null;
  private spriteManager = new SpriteManager();
  private frameScheduler = new FrameScheduler(RENDER_SETTINGS.maxFrameRate);
  private visualClock = new SnapshotClock();
  private effectTimeline = new EffectTimeline();
  private visualEvents = new VisualEventManager();
  private orientation = new OrientationController();
  private profiler = new PerformanceProfiler();
  private renderLead = 0;
  private spriteBounds = new SpriteBoundsCache();
  private warmedSpecies = new Set<number>();
  private planningCache: { serial: number; scout: string; markers: Marker[] } | null = null;
  private unitEventLookup = new Map<string, NonNullable<GameSnapshot['visualEvents']>[number]>();
  private animationTicks = new WeakMap<PmdSheet, number>();
  private grassCanvas: HTMLCanvasElement | null = null;
  private grassKey = '';
  private lastFrame = 0;
  private frame = 0;
  private active = false;
  private renderScale = Math.min(window.devicePixelRatio || 1, RENDER_SETTINGS.maxPixelRatio);
  private frameCost = 0;
  private frameIntervals = 0;
  private sampleCount = 0;
  snapshot: GameSnapshot | null = null;

  /** Reject stale messages; the render clock is independent of Worker message cadence. */
  acceptSnapshot(snapshot: GameSnapshot, arrivedAt = performance.now()): boolean {
    if (!this.visualClock.accept(snapshot.serial, arrivedAt)) return false;
    this.snapshot = snapshot;
    // Build stable lookup once per snapshot rather than allocating it at display frequency.
    this.unitEventLookup.clear();
    for (const event of snapshot.visualEvents) {
      if (event.kind !== 'trainer-damage') this.unitEventLookup.set(`${event.ownerId}:${event.unitId}`, event);
    }
    this.effectTimeline.sync(snapshot.visibleBattle?.id || '', snapshot.visibleBattle?.effects || []);
    this.visualEvents.sync(snapshot.visualEvents, arrivedAt);
    const orientationIds = new Set<string>();
    for (const player of snapshot.players) for (const unit of player.units) orientationIds.add(unit.id);
    for (const unit of snapshot.visibleBattle?.units || []) orientationIds.add(unit.id);
    for (const event of snapshot.visualEvents) {
      orientationIds.add(event.unitId);
      for (const source of event.sources || []) if (source.id) orientationIds.add(source.id);
    }
    this.orientation.prune(orientationIds);
    if (snapshot.visibleBattle) {
      this.unitInterpolator.sync(snapshot.visibleBattle.id, snapshot.visibleBattle.units, arrivedAt);
      // Download Rotate during the 1.5s arrival, before the first orientation turn.
      for (const unit of snapshot.visibleBattle.units) {
        const dex = SPECIES[unit.family].pokedexIds[Math.min(unit.stage, SPECIES[unit.family].pokedexIds.length - 1)];
        const anims = PMD[String(dex)];
        if (anims && !this.warmedSpecies.has(dex)) this.warmAnimationSheets(dex, anims);
      }
    }
    else this.unitInterpolator.reset();
    this.profiler.snapshot();
    return true;
  }
  view: ClientView;

  constructor(private canvas: HTMLCanvasElement, view: ClientView) {
    this.context = canvas.getContext('2d', { alpha: false })!;
    this.view = view;
    window.addEventListener('resize', () => this.resize());
    this.resize();
    document.addEventListener('visibilitychange', () => {
      this.frameScheduler.reset();
      this.lastFrame = 0;
      if (document.hidden && this.rafHandle !== null) {
        cancelAnimationFrame(this.rafHandle);
        this.rafHandle = null;
      } else if (!document.hidden) this.scheduleFrame();
    });
  }

  setActive(active: boolean): void {
    this.active = active;
    this.lastFrame = 0;
    this.frameScheduler.reset();
    this.visualClock.reset();
    this.effectTimeline.reset();
    this.visualEvents.reset();
    this.orientation.reset();
    this.unitInterpolator.reset();
    this.planningCache = null;
    this.unitEventLookup.clear();
    if (active) this.scheduleFrame();
    else if (this.rafHandle !== null) { cancelAnimationFrame(this.rafHandle); this.rafHandle = null; }
  }

  private scheduleFrame(): void {
    if (this.rafHandle !== null || !this.active || document.hidden) return;
    this.rafHandle = requestAnimationFrame(time => {
      this.rafHandle = null;
      this.draw(time);
      this.scheduleFrame();
    });
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    // A dense canvas on a Retina screen easily becomes the rendering bottleneck.
    this.pixelRatio = this.renderScale;
    this.width = rect.width;
    this.height = rect.height;
    const pixelWidth = Math.round(rect.width * this.pixelRatio);
    const pixelHeight = Math.round(rect.height * this.pixelRatio);
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
      this.grassKey = '';
    }
  }

  private get origin() { return { x: this.width / 2 - (this.width > 1200 ? 23 : 0) + this.cameraOffset.x, y: (this.height - 104) / 2 + this.cameraOffset.y }; }
  private get quadActive() { return this.snapshot?.phase !== 'planning' && (this.snapshot?.visibleBattle?.participants.length || 0) > 2; }
  private get cellScale() {
    const normal = Math.min(this.width < 1000 ? 61 : 70, Math.max(30, (this.height - 310) / 9.4));
    // A arena quádrupla tem 14 colunas reais; ajustamos a câmera para caber as duas arenas.
    return Math.min(normal, this.quadActive ? Math.max(21, (this.width - 550) / 18) : normal) * this.zoom;
  }

  // Mesmo fator aplicado ao Pokémon que aparece fisicamente sobre a arena.
  dragSpriteScale(): number { return this.cellScale / 48 * 1.13; }

  toScreen(x: number, y: number): { x: number; y: number } {
    const o = this.origin;
    return { x: o.x + x * this.cellScale, y: o.y + y * this.cellScale };
  }
  fromScreen(x: number, y: number): { x: number; y: number } {
    const o = this.origin;
    return { x: (x - o.x) / this.cellScale, y: (y - o.y) / this.cellScale };
  }
  pointerWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return this.fromScreen(clientX - rect.left, clientY - rect.top);
  }
  zoomAt(delta: number, clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const pointerX = clientX - rect.left, pointerY = clientY - rect.top;
    const focalPoint = this.fromScreen(pointerX, pointerY);
    this.zoom = Math.max(.72, Math.min(1.38, this.zoom + (delta > 0 ? -.09 : .09)));
    const projected = this.toScreen(focalPoint.x, focalPoint.y);
    this.cameraOffset.x += pointerX - projected.x;
    this.cameraOffset.y += pointerY - projected.y;
  }
  trainerDestination(clientX: number, clientY: number): { x: number; y: number } {
    const dest = this.pointerWorld(clientX, clientY);
    return { x: Math.max(-10, Math.min(10, dest.x)), y: Math.max(-4.5, Math.min(4.65, dest.y)) };
  }
  pickHex(clientX: number, clientY: number): { col: number; row: number } | null {
    const world = this.pointerWorld(clientX, clientY);
    let closest: { col: number; row: number } | null = null;
    let best = .52;
    for (let row = 4; row < 8; row++) for (let col = 0; col < 7; col++) {
      const p = gridXY(col, row);
      const d = Math.hypot(p.x - world.x, p.y - world.y);
      if (d < best) { closest = { col, row: row - 4 }; best = d; }
    }
    return closest;
  }
  pickBench(clientX: number, clientY: number): number | null {
    if (this.view.scoutId !== 'p0') return null;
    const world = this.pointerWorld(clientX, clientY);
    const slot = this.quadActive ? this.snapshot?.visibleBattle?.participants.indexOf('p0') ?? -1 : 0;
    if (slot < 0) return null;
    const upper = this.quadActive && (slot === 1 || slot === 2);
    const offset = this.quadActive ? (slot < 2 ? -QUAD_OFFSET : QUAD_OFFSET) : 0;
    if (Math.abs(world.y - (upper ? -BENCH_Y : BENCH_Y)) > .4) return null;
    for (let index = 0; index < 10; index++) {
      if (Math.abs(world.x - benchXY(index, upper, offset).x) < .42) return index;
    }
    return null;
  }
  pickOwnUnit(clientX: number, clientY: number): string | null {
    if (!this.snapshot || this.view.scoutId !== 'p0' || this.snapshot.players[0].eliminated || this.snapshot.phase === 'finished') return null;
    const player = this.snapshot.players[0];
    const world = this.pointerWorld(clientX, clientY);
    const benchSlot = this.pickBench(clientX, clientY);
    if (benchSlot !== null) {
      return player.units.find(u => u.position.area === 'bench' && u.position.index === benchSlot)?.id || null;
    }
    if (this.snapshot.phase !== 'planning' || this.view.scoutId !== 'p0') return null;
    for (const unit of player.units) {
      if (unit.position.area !== 'board') continue;
      const p = gridXY(unit.position.col, unit.position.row + 4);
      if (Math.hypot(p.x - world.x, p.y - world.y) < .44) return unit.id;
    }
    return null;
  }

  pickUnit(clientX: number, clientY: number): { id: string; ownerId: string; sourceId: string } | null {
    const pointer = this.pointerWorld(clientX, clientY);
    const markers = this.markers().filter(u => !u.bench);
    const hit = [...markers].reverse().find(unit => Math.hypot(unit.x - pointer.x, unit.y - pointer.y) < .49);
    return hit ? { id: hit.id, ownerId: hit.ownerId, sourceId: hit.sourceId } : null;
  }

  private image(url: string): HTMLImageElement {
    return this.spriteManager.get(url);
  }

  private warmAnimationSheets(dex: number, anims: PmdEntry): void {
    if (this.warmedSpecies.has(dex)) return;
    this.warmedSpecies.add(dex);
    for (const action of [...RENDER_SETTINGS.idleSpritePreload, 'Rotate']) {
      if (anims[action]) this.image(`${import.meta.env.BASE_URL}sprite/${String(dex).padStart(4, '0')}/${anims[action].file}`);
    }
  }

  private direction(x: number, y: number): number {
    // PMD: 0 frente, 2 direita, 4 costas, 6 esquerda; diagonais intermediárias.
    return (Math.round(Math.atan2(x, y) / (Math.PI / 4)) + 8) % 8;
  }

  /** Retorna o topo VISÍVEL do sprite para posicionar nível/vida/energia. */
  private drawPokemonSprite(x: number, y: number, unit: Marker, time: number): number {
    const ctx = this.context;
    const id = SPECIES[unit.family].pokedexIds[Math.min(unit.stage, SPECIES[unit.family].pokedexIds.length - 1)];
    const anims = PMD[String(id)];
    if (anims) {
      this.warmAnimationSheets(id, anims);
      const action = unit.bench ? 'Sleep' : this.snapshot?.phase === 'planning' ? 'Idle'
        : unit.animation?.name || (unit.moving ? (anims.Hover ? 'Hover' : 'Walk') : 'Idle');
      const battle = this.snapshot?.visibleBattle;
      const flipped = this.snapshot?.phase !== 'planning' && battle?.participants.length === 2 && battle.playerB === this.view.scoutId;
      const facing = this.direction(unit.facingX || 0, flipped ? -(unit.facingY || 0) : (unit.facingY || 0));
      const desired = this.snapshot?.phase === 'planning' || this.snapshot?.phase === 'result' || this.snapshot?.phase === 'finished' || unit.bench ? 0 : facing;
      const orientation = this.orientation.get(unit.id, desired, time, !unit.bench && (action === 'Idle' || action === 'Walk' || action === 'Hover'));
      const turning = !!orientation.rotate && (action === 'Idle' || action === 'Walk' || action === 'Hover') && !!anims.Rotate;
      // PMD species can omit special sheets. Fallback only to names in this real manifest.
      const fallbacks = action === 'Shoot' ? ['Attack', 'Idle']
        : action === 'SpAttack' ? ['Shoot', 'Attack', 'Idle']
        : action === 'Walk' ? ['Walk', 'Attack', 'Idle']
        : action === 'Strike' ? ['Attack', 'Idle'] : ['Idle'];
      let selectedAction = turning ? 'Rotate' : anims[action] ? action : fallbacks.find(name=>anims[name]) || 'Idle';
      let animation = anims[selectedAction];
      let url = `${import.meta.env.BASE_URL}sprite/${String(id).padStart(4, '0')}/${animation.file}`;
      let sprite = this.image(url);
      if ((!sprite.complete || !sprite.naturalWidth) && selectedAction !== 'Idle') {
        selectedAction = 'Idle'; animation = anims.Idle;
        url = `${import.meta.env.BASE_URL}sprite/${String(id).padStart(4, '0')}/${animation.file}`;
        sprite = this.image(url);
      }
      if (sprite.complete && sprite.naturalWidth) {
        const durations = animation.durations;
        let totalTicks = this.animationTicks.get(animation);
        if (totalTicks === undefined) {
          totalTicks = durations.reduce((sum, n) => sum + n, 0);
          this.animationTicks.set(animation, totalTicks);
        }
        const active = unit.animation && !unit.bench && this.snapshot?.phase !== 'planning' && selectedAction === unit.animation.name;
        const extrapolation = this.renderLead;
        const elapsedTicks = active && selectedAction !== 'Withdraw'
          ? Math.min(totalTicks - .001, ((unit.animation!.elapsed + extrapolation) / unit.animation!.duration) * totalTicks)
          : (time * 60 + ((unit.id.charCodeAt(unit.id.length - 1) || 0) % 13) * 2) % totalTicks;
        let tick = elapsedTicks, frame = 0;
        while (frame < durations.length - 1 && tick >= durations[frame]) tick -= durations[frame++];
        // Withdraw and other ability-specific animations take precedence over orientation.
        const spinning = selectedAction === 'Withdraw' && !!unit.spinTime;
        const dir = spinning ? Math.floor(((unit.spinDuration || 2) - (unit.spinTime || 0)) / .095) % 8
          : orientation.direction;
        if (selectedAction === 'Rotate' && orientation.rotate) frame = Math.min(durations.length - 1, orientation.rotate.frame);
        const row = animation.directions === 1 ? 0
          : (selectedAction === 'Rotate' && orientation.rotate ? orientation.rotate.row : dir) % animation.directions;
        // Tamanho baseado em pixels dos próprios sprites; sem formas geométricas.
        const sizeScale = this.cellScale / 48 * (unit.bench ? .95 : 1.13);
        const bounds = this.spriteBounds.get(sprite, `${url}:${frame}:${row}`, frame * animation.width, row * animation.height, animation.width, animation.height);
        const drawX = Math.round(x - ((bounds.left + bounds.right) / 2) * sizeScale);
        const drawY = Math.round(y - bounds.bottom * sizeScale);
        ctx.save(); ctx.imageSmoothingEnabled = false;
        ctx.drawImage(sprite, frame * animation.width, row * animation.height,
          animation.width, animation.height, drawX, drawY, animation.width * sizeScale, animation.height * sizeScale);
        ctx.restore();
        return y - (bounds.bottom - bounds.top) * sizeScale;
      }
      // Nunca renderizar sprites PNG estáticos quando uma animação PMD ainda carrega.
      return y - this.cellScale * .85;
    }
    // Lendários ainda não receberam sheets PMD; continuam como PNGs, sem figuras coloridas.
    const path = SPECIES[unit.family].sprites[Math.min(unit.stage, SPECIES[unit.family].sprites.length - 1)];
    const staticSprite = this.image(`${import.meta.env.BASE_URL}${path.replace(/^\.\//, '')}`);
    if (staticSprite.complete && staticSprite.naturalWidth) {
      const size = this.cellScale * (unit.bench ? .67 : 1.03);
      ctx.save(); ctx.imageSmoothingEnabled = false;
      ctx.drawImage(staticSprite, x - size / 2, y - size, size, size); ctx.restore();
      return y - size;
    }
    return y - this.cellScale * .85;
  }

  private paintBackground(ctx: CanvasRenderingContext2D): void {
    paintArenaBackground(ctx, this.width, this.height, this.quadActive,
      ARENA_HALF, QUAD_OFFSET, (x, y) => this.toScreen(x, y));
  }

  private background(): void {
    const origin = this.origin;
    const key = [this.width, this.height, this.pixelRatio, this.cellScale,
      origin.x, origin.y, this.quadActive].join(':');
    if (!this.grassCanvas || key !== this.grassKey) {
      this.grassCanvas ||= document.createElement('canvas');
      this.grassCanvas.width = this.canvas.width;
      this.grassCanvas.height = this.canvas.height;
      const ctx = this.grassCanvas.getContext('2d')!;
      ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
      this.paintBackground(ctx);
      this.grassKey = key;
    }
    // Textura, gramado e suas centenas de fibras só são recalculados quando a câmera muda.
    this.context.drawImage(this.grassCanvas, 0, 0, this.width, this.height);
  }

  private hexGrid(time: number): void {
    if (!this.view.dragId || this.snapshot?.phase !== 'planning' || this.view.scoutId !== 'p0') return;
    const ctx = this.context;
    const scale = this.cellScale;
    const isEditable = this.snapshot?.phase === 'planning' && this.view.scoutId === 'p0';
    for (let row = 0; row < 8; row++) for (let col = 0; col < 7; col++) {
      const p = gridXY(col, row), screen = this.toScreen(p.x, p.y);
      const own = row >= 4;
      const selected = isEditable && own && this.view.dragId && this.view.hoveringHex?.col === col && this.view.hoveringHex?.row === row - 4;
      const radius = scale * .56;
      ctx.beginPath();
      for (let vertex = 0; vertex < 6; vertex++) {
        const angle = vertex * PI2 / 6 + Math.PI / 6;
        const x = screen.x + radius * Math.cos(angle), y = screen.y + radius * Math.sin(angle);
        if (!vertex) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = selected ? '#89e7ac58' : own ? (col + row) % 2 ? '#254e4b6d' : '#2c595261' : (col + row) % 2 ? '#4a30395a' : '#563b4254';
      ctx.strokeStyle = selected ? '#d8ffc4' : own ? '#6aa19143' : '#c4898740';
      ctx.lineWidth = selected ? 2.6 : 1;
      ctx.fill(); ctx.stroke();
    }
  }

  private drawBench(enemy = false, offset = 0, interactive = false): void {
    const ctx = this.context;
    const left = this.toScreen(offset - ARENA_HALF, (enemy ? -BENCH_Y : BENCH_Y) - .41);
    const right = this.toScreen(offset + ARENA_HALF, (enemy ? -BENCH_Y : BENCH_Y) + .41);
    const field = ctx.createLinearGradient(0, left.y, 0, right.y);
    field.addColorStop(0, '#38764c'); field.addColorStop(.6, '#2b6446'); field.addColorStop(1, '#1b4c3b');
    ctx.fillStyle = field; ctx.strokeStyle = '#a1cf9f88'; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.roundRect(left.x, left.y, right.x - left.x, right.y - left.y, 8); ctx.fill(); ctx.stroke();
    for (let index = 0; index < 10; index++) {
      const { x, y } = benchXY(index, enemy, offset), p = this.toScreen(x, y);
      const radiusX = this.cellScale * .405, radiusY = this.cellScale * .32;
      const selected = interactive && this.view.hoveringBench === index && !!this.view.dragId;
      ctx.beginPath(); ctx.roundRect(p.x - radiusX, p.y - radiusY, radiusX * 2, radiusY * 2, 5);
      ctx.fillStyle = selected ? '#bceca872' : index % 2 ? '#285c4257' : '#3e81524a';
      ctx.strokeStyle = selected ? '#fff0ba' : '#a1dca03a'; ctx.lineWidth = selected ? 2 : 1;
      ctx.fill(); ctx.stroke();
    }
  }

  private markers(): Marker[] {
    const snapshot = this.snapshot;
    if (!snapshot) return [];
    if (snapshot.phase === 'planning' && this.planningCache?.serial === snapshot.serial && this.planningCache.scout === this.view.scoutId) {
      return this.planningCache.markers;
    }
    const watched = snapshot.players.find(p => p.id === this.view.scoutId) || snapshot.players[0];
    const benchUnits = (units: Pokemon[], ownerId: string, own: boolean, enemy: boolean, offset: number): Marker[] => units.filter(u => u.position.area === 'bench').map(u => {
      const p = benchXY((u.position as Extract<UnitPosition, { area: 'bench' }>).index, enemy, offset);
      return { id: u.id, sourceId: u.id, ownerId, x: p.x, y: p.y, family: u.family, stage: u.stage, level: u.level,
        own, hp: 1, maxHp: 1, energy: 0, required: getStageData(u.family, u.stage).energy, flash: 0, bench: true } as Marker;
    });
    const bench = benchUnits(watched.units, watched.id, true, false, 0);
    const foeId = snapshot.visibleBattle?.participants.find(id => id !== this.view.scoutId) || null;
    const foePlayer = snapshot.players.find(p => p.id === foeId);
    const enemyBenchUnits = foePlayer ? foePlayer.units.filter(u => u.position.area === 'bench') : foeId ? snapshot.visibleBattle?.benches[foeId] || [] : [];
    const foeBench = benchUnits(enemyBenchUnits, foeId || '', false, true, 0);
    if (snapshot.phase !== 'planning' && snapshot.visibleBattle && snapshot.observedId === this.view.scoutId) {
      const observedOnTop = snapshot.visibleBattle.participants.length === 2 && snapshot.visibleBattle.playerB === this.view.scoutId;
      const poseTime = performance.now();
      const battleMarkers = snapshot.visibleBattle.units.filter(u => u.hp > 0).map(u => {
        const pose = this.unitInterpolator.position(u.id, poseTime) || u;
        return { ...u, ownerId: u.playerId, x: pose.x, y: observedOnTop ? -pose.y : pose.y,
          own: u.playerId === this.view.scoutId, required: u.energyNeeded };
      });
      if (this.quadActive) {
        const quadBenches = snapshot.visibleBattle.participants.flatMap((id, slot) => {
          const player = snapshot.players.find(p => p.id === id);
          const units = player?.units || snapshot.visibleBattle!.benches[id] || [];
          const enemy = slot === 1 || slot === 2;
          return benchUnits(units, id, id === this.view.scoutId, enemy, slot < 2 ? -QUAD_OFFSET : QUAD_OFFSET);
        });
        return [...battleMarkers, ...quadBenches];
      }
      return [...battleMarkers, ...bench, ...foeBench];
    }
    const friendly = watched;
    const convert = (units: Pokemon[], own: boolean): Marker[] => units.filter(u => u.position.area === 'board').map(u => {
      const pos = u.position as Extract<UnitPosition, { area: 'board' }>;
      const row = own ? 4 + pos.row : 3 - pos.row;
      const p = gridXY(pos.col, row);
      return { id: u.id, sourceId: u.id, ownerId: friendly.id, x: p.x, y: p.y, family: u.family, stage: u.stage,
        level: u.level, own, hp: 1, maxHp: 1, energy: 0, required: getStageData(u.family, u.stage).energy, flash: 0 };
    });
    // Nunca vazar a formação do próximo rival durante a preparação.
    const prepared = [...convert(friendly.units, true), ...bench];
    this.planningCache = { serial: snapshot.serial, scout: this.view.scoutId, markers: prepared };
    return prepared;
  }

  pickCoin(clientX: number, clientY: number): { x: number; y: number } | null {
    if (!this.snapshot || this.view.scoutId !== 'p0') return null;
    const world = this.pointerWorld(clientX, clientY);
    const drop = this.snapshot.collectibleGold.find(d => !d.claimed && Math.hypot(world.x - d.x, world.y - d.y) < .38);
    return drop ? { x: drop.x, y: drop.y } : null;
  }

  private drawCoins(): void {
    if (!this.snapshot || this.view.scoutId !== 'p0') return;
    for (const coin of this.snapshot.collectibleGold) {
      if (coin.claimed) continue;
      const p = this.toScreen(coin.x, coin.y);
      drawCoin(this.context, p.x, p.y);
    }
  }

  private drawUnit(unit: Marker, time: number): void {
    const ctx = this.context;
    const p = this.toScreen(unit.x, unit.y);
    const radius = this.cellScale * (unit.bench ? .19 : .29) * (1 + unit.stage * .18);
    // Sombra encostada nos pés; nenhum bob/flutuação artificial.
    drawContactShadow(ctx, p.x, p.y, radius);
    if ((this.view.selectedId === unit.id || this.view.selectedId === unit.sourceId)) {
      ctx.beginPath(); ctx.ellipse(p.x, p.y + 3, radius * 1.7, radius * .5, 0, 0, PI2);
      ctx.strokeStyle = '#eed18d'; ctx.lineWidth = 3; ctx.stroke();
    }
    if (unit.flash > 0) {
      ctx.fillStyle = '#fff4d454'; ctx.beginPath(); ctx.arc(p.x, p.y - 2, radius * 1.7, 0, PI2); ctx.fill();
    }
    const lift = (unit.jumpHeight || 0) + (unit.knockUpTime ? .55 * Math.sin(Math.PI * (1 - Math.min(1, unit.knockUpTime / (unit.knockUpDuration || .35)))) : 0);
    const spriteTop = this.drawPokemonSprite(p.x, p.y - lift * this.cellScale, unit, time);
    if (unit.bench) return;
    const barWidth = Math.max(35, radius * 2.35);
    const bx = p.x - barWidth / 2;
    const baseY = spriteTop - (this.snapshot?.phase === 'planning' ? 7 : 10);
    if (this.snapshot?.phase !== 'planning') {
      ctx.fillStyle = '#101f20d9'; ctx.fillRect(bx - 1, baseY - 1, barWidth + 2, 7);
      ctx.fillStyle = unit.own ? '#74e6a9' : '#ff947d'; ctx.fillRect(bx, baseY, barWidth * Math.max(0, unit.hp / unit.maxHp), 5);
      const shield = (unit.barrier?.hp || 0) + (unit.barriers || []).reduce((total,b) => total+b.hp,0);
      if (shield > 0) { ctx.fillStyle = '#d5b3ff'; ctx.fillRect(bx, baseY - 3, barWidth * Math.min(1, shield/unit.maxHp), 2); }
      if (unit.poison) {
        ctx.fillStyle = '#b76de4'; ctx.beginPath(); ctx.arc(bx + barWidth + 4, baseY + 2, 3.1, 0, PI2); ctx.fill();
      }
      ctx.fillStyle = '#132a31c9'; ctx.fillRect(bx, baseY + 7, barWidth, 3);
      ctx.fillStyle = '#80ccfa'; ctx.fillRect(bx, baseY + 7, barWidth * Math.min(1, unit.energy / unit.required), 3);
      const statuses = [
        ...(unit.buffs || []).map(b => `${b.stat.toUpperCase()}↑ ${Math.ceil(b.until-(this.snapshot?.visibleBattle?.elapsed || 0))}s`),
        ...(unit.defenseShreds || []).map(b => `DEF↓ ${Math.ceil(b.until-(this.snapshot?.visibleBattle?.elapsed || 0))}s`),
        ...((unit.guardUntil || 0) > (this.snapshot?.visibleBattle?.elapsed || 0) ? [`GUARDA ${Math.ceil(unit.guardUntil!-(this.snapshot?.visibleBattle?.elapsed || 0))}s`] : []),
        ...(unit.barriers?.length ? ['BARREIRA'] : [])
      ];
      if (statuses.length) {
        const label = statuses.slice(0,2).join(' · ');
        ctx.font = '800 9px Inter'; ctx.textAlign = 'center'; ctx.strokeStyle = '#062021'; ctx.lineWidth = 3;
        ctx.strokeText(label,p.x,baseY-23); ctx.fillStyle = '#e5deba';ctx.fillText(label,p.x,baseY-23);
      }
    }
    // O nível acompanha a cabeça do Pokémon e não a posição fixa da célula.
    ctx.fillStyle = '#f7e5ac'; ctx.font = `800 ${Math.max(9, this.cellScale * .155)}px 'Barlow Condensed'`;
    ctx.textAlign = 'center'; ctx.strokeStyle = '#091c1b'; ctx.lineWidth = 3;
    const labelY = baseY - (this.snapshot?.phase === 'planning' ? 1 : 4);
    ctx.strokeText(`${unit.level}`, p.x, labelY); ctx.fillText(`${unit.level}`, p.x, labelY);
  }

  private drawTrainerAvatar(playerId: string, x: number, y: number, time: number, label: string): void {
    renderTrainerAvatar(this.context, this.toScreen(x, y), playerId, time, label, this.zoom);
  }

  private drawTrainers(dt: number, time: number): void {
    this.updateTrainer(dt);
    if (!this.snapshot) return;
    const watched = this.view.scoutId;
    const battle = this.snapshot.visibleBattle;
    const foe = this.snapshot.phase === 'planning' ? watched : battle && battle.participants.includes(watched)
      ? battle.participants.find(p => p !== watched) || watched
      : watched;
    const name = (id: string) => this.snapshot?.players.find(p => p.id === id)?.name || id;
    const wander = (i: number) => ({ x: Math.sin(time * .55 + i * 1.4) * .13, y: Math.cos(time * .45 + i) * .08 });
    const a = wander(Number(watched.slice(1))), b = wander(Number(foe.slice(1)));
    if (watched === 'p0') this.drawTrainerAvatar(watched, this.trainer.x, this.trainer.y, time, name(watched));
    else {
      this.drawTrainerAvatar(watched, -4.74 + a.x, 3.44 + a.y, time, name(watched));
      // O treinador do usuário visita fisicamente a arena que está observando.
      this.drawTrainerAvatar('p0', this.trainer.x + 1.5, this.trainer.y, time, 'VOCÊ · VISITA');
    }
    if (foe !== watched && !foe.startsWith('bot:')) this.drawTrainerAvatar(foe, 4.86 + b.x, -3.44 + b.y, time, name(foe));
  }

  private updateTrainer(dt: number): void {
    if (!this.snapshot) return;
    const { x, y } = this.snapshot.trainer;
    const lerp = Math.min(1, dt * 19);
    this.trainer.x += (x - this.trainer.x) * lerp;
    this.trainer.y += (y - this.trainer.y) * lerp;
  }

  private renderPokeball(x: number, y: number, radius: number): void {
    const ctx = this.context;
    ctx.save(); ctx.shadowColor = '#fff0cf'; ctx.shadowBlur = 10;
    ctx.fillStyle = '#f1f3ed'; ctx.beginPath(); ctx.arc(x, y, radius, 0, PI2); ctx.fill();
    ctx.fillStyle = '#e85e57'; ctx.beginPath(); ctx.arc(x, y, radius, Math.PI, PI2); ctx.fill();
    ctx.strokeStyle = '#20383f'; ctx.lineWidth = Math.max(1.5, radius * .17);
    ctx.beginPath(); ctx.moveTo(x - radius, y); ctx.lineTo(x + radius, y); ctx.stroke();
    ctx.fillStyle = '#f8f4d8'; ctx.beginPath(); ctx.arc(x, y, radius * .23, 0, PI2); ctx.fill();
    ctx.strokeStyle = '#20383f'; ctx.beginPath(); ctx.arc(x, y, radius * .23, 0, PI2); ctx.stroke();
    ctx.restore();
  }

  private drawArrival(battle: NonNullable<GameSnapshot['visibleBattle']>): void {
    if (battle.introElapsed >= 1.51) return;
    const flip = battle.participants.length === 2 && battle.playerB === this.view.scoutId;
    const opponentUnits = battle.units.filter(u => u.playerId !== this.view.scoutId);
    opponentUnits.forEach((unit, i) => {
      const slot = battle.participants.indexOf(unit.playerId);
      const trainer = trainerSpot(slot, battle.participants.length > 2);
      const from = this.toScreen(trainer.x, flip ? -trainer.y : trainer.y);
      const to = this.toScreen(unit.x, flip ? -unit.y : unit.y);
      const start = .12 + (i % 7) * .06 + Math.floor(i / 7) * .13, duration = .65;
      const progress = (battle.introElapsed - start) / duration;
      if (progress < 0 || progress >= 1) return;
      const x = from.x + (to.x - from.x) * progress;
      const y = from.y - 20 + (to.y - from.y + 20) * progress - Math.sin(progress * Math.PI) * this.cellScale * .8;
      this.renderPokeball(x, y, Math.max(5, 9 * this.zoom));
    });
  }

  private drawUnitVisuals(now: number): void {
    if (!this.snapshot) return;
    const watched = this.snapshot.players.find(p => p.id === this.view.scoutId);
    if (!watched) return;
    const positionOf = (position: UnitPosition) => position.area === 'bench'
      ? benchXY(position.index) : gridXY(position.col, position.row + 4);
    for (const event of this.snapshot.visualEvents) {
      if (event.ownerId !== watched.id || event.kind === 'trainer-damage' || !event.pokemon) continue;
      const pos = positionOf(event.pokemon.position);
      const dest = this.toScreen(pos.x, pos.y);
      const age = this.visualEvents.age(event, now);
      drawUnitVisualEvent(this.context, event, age, dest, this.toScreen(this.trainer.x, this.trainer.y),
        position => { const q = positionOf(position); return this.toScreen(q.x, q.y); },
        this.cellScale, (x, y, pokemon, opacity, scale) => {
          if (opacity <= 0) return;
          const marker: Marker = { id: pokemon.id, sourceId: pokemon.id, ownerId: event.ownerId,
            x, y, family: pokemon.family, stage: pokemon.stage, level: pokemon.level, own: true,
            hp: 1, maxHp: 1, energy: 0, required: getStageData(pokemon.family, pokemon.stage).energy,
            flash: 0, bench: pokemon.position.area === 'bench' };
          this.context.save(); this.context.globalAlpha = opacity;
          this.context.translate(x, y); this.context.scale(scale, scale);
          this.drawPokemonSprite(0, 0, marker, this.frame);
          this.context.restore();
        }, (x, y, radius) => this.renderPokeball(x, y, radius));
    }
  }

  private drawTrainerDamage(now: number, battle: NonNullable<GameSnapshot['visibleBattle']>): void {
    const flip = battle.participants.length === 2 && battle.playerB === this.view.scoutId;
    for (const event of this.snapshot?.visualEvents || []) {
      if (event.kind !== 'trainer-damage' || event.battleId !== battle.id || !event.value) continue;
      const slot = battle.participants.indexOf(event.ownerId);
      if (slot < 0) continue;
      const spot = trainerSpot(slot, battle.participants.length > 2);
      const actual = event.ownerId === 'p0' && this.view.scoutId === 'p0'
        ? this.trainer : { x: spot.x, y: flip ? -spot.y : spot.y };
      const p = this.toScreen(actual.x, actual.y);
      renderFloatingNumber(this.context, p.x, p.y - this.cellScale * .65,
        event.value, Math.min(1, this.visualEvents.age(event, now) / 1.25), 'trainer');
    }
  }

  private drawBattleTrainers(dt: number, time: number, battle: NonNullable<GameSnapshot['visibleBattle']>): void {
    this.updateTrainer(dt);
    const flip = battle.participants.length === 2 && battle.playerB === this.view.scoutId;
    battle.participants.forEach((id, slot) => {
      const pos = trainerSpot(slot, battle.participants.length > 2);
      const label = this.snapshot?.players.find(p => p.id === id)?.name || id.replace('bot:', 'BOT ');
      const walking = id === 'p0' && this.view.scoutId === 'p0';
      this.drawTrainerAvatar(id, walking ? this.trainer.x : pos.x, walking ? this.trainer.y : (flip ? -pos.y : pos.y), time, label);
    });
    if (this.view.scoutId !== 'p0') this.drawTrainerAvatar('p0', this.trainer.x, this.trainer.y, time, 'VOCÊ · VISITA');
  }

  private draw(timestamp: number): void {
    // The scheduler only schedules frames while a visible game is active.
    if (!this.active || document.hidden) { this.lastFrame = 0; this.frameScheduler.reset(); return; }
    const dt = this.frameScheduler.nextFrame(timestamp);
    if (dt === null) return;
    const frameStarted = performance.now();
    const lastInterval = this.lastFrame ? timestamp - this.lastFrame : 1000 / 60;
    this.renderLead = this.visualClock.leadSeconds(timestamp, this.snapshot?.accelerated ? RULES.combatAcceleration : 1);
    const ctx = this.context;
    this.lastFrame = timestamp;
    this.frame += dt;
    ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    this.background();
    this.hexGrid(this.frame);
    if (this.quadActive) {
      const participants = this.snapshot!.visibleBattle!.participants;
      this.drawBench(false, -QUAD_OFFSET, participants[0] === 'p0');
      this.drawBench(true, -QUAD_OFFSET, false);
      this.drawBench(true, QUAD_OFFSET, false);
      this.drawBench(false, QUAD_OFFSET, participants[3] === 'p0');
    } else {
      this.drawBench(false, 0, this.view.scoutId === 'p0');
      if (this.snapshot?.phase !== 'planning' && this.snapshot?.visibleBattle && this.snapshot.observedId === this.view.scoutId) this.drawBench(true);
    }
    const markers = this.markers();
    const battle = this.snapshot?.visibleBattle;
    const intro = this.snapshot?.phase === 'combat' && battle && !battle.resolved && battle.introElapsed < 1.5;
    const enemyIntroOrder = intro ? new Map(battle!.units.filter(u => u.playerId !== this.view.scoutId).map((u,i) => [u.id, i])) : null;
    const visualEvents = this.unitEventLookup;
    markers.filter(marker => {
      if (this.view.dragging && marker.ownerId === 'p0' && marker.sourceId === this.view.dragId) return false;
      if (intro && !marker.bench && marker.ownerId !== this.view.scoutId) {
        const enemyIndex = enemyIntroOrder?.get(marker.id) ?? -1;
        if (battle!.introElapsed < .77 + (enemyIndex % 7) * .06 + Math.floor(enemyIndex / 7) * .13) return false;
      }
      const animation = visualEvents.get(`${marker.ownerId}:${marker.sourceId}`);
      const age = animation ? this.visualEvents.age(animation, timestamp) : 99;
      return !(animation?.kind === 'summon' && age < .75)
        && !(animation?.kind === 'evolve' && age < 1.12);
    }).sort((a, b) => a.y - b.y).forEach(marker => this.drawUnit(marker, this.frame));
    this.drawUnitVisuals(timestamp);
    if (intro) this.drawArrival(battle!);
    this.drawCoins();
    if (this.snapshot?.phase !== 'planning' && this.snapshot?.visibleBattle && this.snapshot.observedId === this.view.scoutId) {
      renderCombatEffects(this.context, this.snapshot.visibleBattle.effects,
        this.snapshot.visibleBattle.participants.length === 2 && this.snapshot.visibleBattle.playerB === this.view.scoutId,
        (x, y) => this.toScreen(x, y), this.cellScale, this.frame,
        fx => this.effectTimeline.time(fx, this.renderLead));
    }
    if (battle && this.snapshot?.phase !== 'planning') this.drawBattleTrainers(dt, this.frame, battle);
    else this.drawTrainers(dt, this.frame);
    if (battle && this.snapshot?.phase !== 'planning') this.drawTrainerDamage(timestamp, battle);
    // Adaptive backing resolution: changes only after sustained heavy frames.
    // Canvas UI dimensions, Pokémon positions and art assets remain unchanged.
    const renderMs = performance.now() - frameStarted;
    this.profiler.frame(timestamp, renderMs, markers.length, battle?.effects.length || 0, this.renderScale);
    this.frameCost += renderMs;
    this.frameIntervals += lastInterval;
    if (++this.sampleCount >= RENDER_SETTINGS.qualityCheckFrames) {
      const average = this.frameCost / this.sampleCount;
      const avgInterval = this.frameIntervals / this.sampleCount;
      const deviceMax = Math.min(window.devicePixelRatio || 1, RENDER_SETTINGS.maxPixelRatio);
      if (average > RENDER_SETTINGS.slowFrameMs && this.renderScale > RENDER_SETTINGS.minPixelRatio) {
        this.renderScale = Math.max(RENDER_SETTINGS.minPixelRatio, this.renderScale - .15);
        this.resize();
      } else if (average < RENDER_SETTINGS.fastFrameMs && avgInterval < 19 && this.renderScale < deviceMax) {
        this.renderScale = Math.min(deviceMax, this.renderScale + .1);
        this.resize();
      }
      this.frameCost = 0; this.frameIntervals = 0; this.sampleCount = 0;
    }
  }
}
