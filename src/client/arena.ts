import { getStageData, gridXY, SPECIES, RENDER_SETTINGS, ITEM_RACK_WORLD, RULES, ATTACKS, physicalSize, collisionRadius } from '../../server/data';
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
import { bonusStats } from '../../server/systems/items';
import { itemSprite } from './item-sprites';
import { renderTrainerAvatar } from './scene/trainer-renderer';
import { renderFloatingNumber } from './vfx/floating-numbers';
import { drawCastingGlints } from './vfx/casting-glints';
import { renderCombatEffects } from './render/effects';
import { SpriteBoundsCache } from './render/sprite-bounds';
import { drawContactShadow } from './render/shadows';
import { visualProfile, cosmeticMotion } from './animation/visual-profiles';
import { markerAt, frameAt, impactFraction, type PmdSheet, type PmdEntry } from './animation/pmd-metadata';
import type { BodyPoints } from './render/projectile-origin';
import { tierFor } from '../../server/systems/synergies/registry';
import { randomIndex } from '../../server/systems/synergies/positioning';
import type { CombatUnit, Family, GameSnapshot, Pokemon, UnitPosition } from '../../server/types';
import { trainerSpot } from '../../server/combat/trainer-position';
import pmdManifest from './pmd-manifest.json';

export interface ClientView {
  scoutId: string;
  inventoryItemId?: string | null;
  selectedBall?: import('../../server/types').BallKind | null;
  selectedId: string | null;
  dragId: string | null;
  dragging: boolean;
  dragX: number;
  dragY: number;
  hoveringHex: { col: number; row: number } | null;
  hoveringBench: number | null;
}

type Marker = { id: string; ownerId: string; sourceId: string; x: number; y: number; family: Family; stage: number; own: boolean; level: number; hp: number; maxHp: number; energy: number; required: number; flash: number; bench?: boolean; moving?: boolean; facingX?: number; facingY?: number; animation?: CombatUnit['animation']; spinTime?: number; spinDuration?: number; jumpHeight?: number; knockUpTime?: number; knockUpDuration?: number; poison?: CombatUnit['poison']; barrier?: CombatUnit['barrier']; barriers?: CombatUnit['barriers']; buffs?: CombatUnit['buffs']; defenseShreds?: CombatUnit['defenseShreds']; guardUntil?: number; dig?: CombatUnit['dig']; ghost?: CombatUnit['ghost']; fear?: CombatUnit['fear']; psychicImbuement?: CombatUnit['psychicImbuement']; refractionUntil?: number; leap?: CombatUnit['leap']; attackSpeedDebuffUntil?: number; synergy?: CombatUnit['synergy']; orbitFlames?: CombatUnit['orbitFlames']; equipment?: CombatUnit['equipment']; babyFlee?: boolean; statuses?: CombatUnit['statuses']; lullaby?: CombatUnit['lullaby']; starWard?: CombatUnit['starWard']; stunUntil?: number; itemBurn?: CombatUnit['itemBurn'] };
const PMD = pmdManifest as Record<string, PmdEntry>;
const PI2 = Math.PI * 2;
const BENCH_Y = 4.38;
const ARENA_HALF = 4.25;
const QUAD_OFFSET = 4.35;
const benchXY = (index: number, enemy = false, offset = 0) => ({ x: offset + (index - 4.5) * (ARENA_HALF * 2 / 10), y: enemy ? -BENCH_Y : BENCH_Y });

export class Arena {
  onDrawFrame?: (timestamp:number)=>void;
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
  setFrameRate(limit: number): void { this.frameScheduler.setLimit(limit); }
  private visualClock = new SnapshotClock();
  private effectTimeline = new EffectTimeline();
  private visualEvents = new VisualEventManager();
  private orientation = new OrientationController();
  private profiler = new PerformanceProfiler();
  private renderLead = 0;
  private spriteBounds = new SpriteBoundsCache();
  private warmedSpecies = new Set<number>();
  private planningCache: { key: string; scout: string; markers: Marker[] } | null = null;
  private pillarPreview:{unitId:string;index:number;col:number;row:number}|null=null;
  previewPillar(value:{unitId:string;index:number;col:number;row:number}|null):void{this.pillarPreview=value;}
  private pendingMove=new Map<string,{position:UnitPosition; serial:number}>();
  previewMove(id:string,position:UnitPosition):void{
    this.pendingMove.set(id,{position,serial:this.snapshot?.serial||0});
    this.planningCache=null;
  }
  private unitEventLookup = new Map<string, NonNullable<GameSnapshot['visualEvents']>[number]>();
  private orientationIds = new Set<string>();
  private enemyIntroOrder = new Map<string, number>();
  private renderMarkers: Marker[] = [];
  private itemImageCache=new Map<string,HTMLImageElement>();
  private animationTicks = new WeakMap<PmdSheet, number>();
  private spriteParts = new Map<string, BodyPoints>();
  private grassCanvas: HTMLCanvasElement | null = null;
  private grassKey = '';
  private lastFrame = 0;
  private frame = 0;
  private active = false;
  private frameErrorReported=false;
  private renderScale = Math.min(window.devicePixelRatio || 1, RENDER_SETTINGS.maxPixelRatio);
  private frameCost = 0;
  private frameIntervals = 0;
  private sampleCount = 0;
  snapshot: GameSnapshot | null = null;

  /** Reject stale messages; the render clock is independent of Worker message cadence. */
  acceptSnapshot(snapshot: GameSnapshot, arrivedAt = performance.now()): boolean {
    if (!this.visualClock.accept(snapshot.serial, arrivedAt)) return false;
    this.snapshot = snapshot;
    // Optimistic relocation ends as soon as the worker confirms or rejects it.
    let previewExpired=false;
    for(const [id,pending] of this.pendingMove){
      const unit=snapshot.players[0]?.units.find(u=>u.id===id);
      if (!unit || (unit.position.area === pending.position.area && (unit.position.area === 'bench'
        ? pending.position.area === 'bench' && unit.position.index === pending.position.index
        : pending.position.area === 'board' && unit.position.col === pending.position.col && unit.position.row === pending.position.row))
        || snapshot.serial > pending.serial + 2)
        {this.pendingMove.delete(id);previewExpired=true;}
    }
    if(snapshot.phase!=='planning'||previewExpired)this.planningCache=null;
    // Build stable lookup once per snapshot rather than allocating it at display frequency.
    this.unitEventLookup.clear();
    for (const event of snapshot.visualEvents) {
      if (event.kind !== 'trainer-damage') this.unitEventLookup.set(`${event.ownerId}:${event.unitId}`, event);
    }
    this.effectTimeline.sync(snapshot.visibleBattle?.id || '', snapshot.visibleBattle?.effects || []);
    this.visualEvents.sync(snapshot.visualEvents, arrivedAt);
    const orientationIds = this.orientationIds;
    orientationIds.clear();
    for (const player of snapshot.players) for (const unit of player.units) orientationIds.add(unit.id);
    for (const unit of snapshot.visibleBattle?.units || []) orientationIds.add(unit.id);
    for (const event of snapshot.visualEvents) {
      orientationIds.add(event.unitId);
      for (const source of event.sources || []) if (source.id) orientationIds.add(source.id);
    }
    this.orientation.prune(orientationIds);
    this.enemyIntroOrder.clear();
    if (snapshot.phase === 'combat' && snapshot.visibleBattle && !snapshot.visibleBattle.resolved && snapshot.visibleBattle.introElapsed < 1.5) {
      let enemyIndex = 0;
      for (const unit of snapshot.visibleBattle.units) {
        if (unit.playerId !== this.view.scoutId) this.enemyIntroOrder.set(unit.id, enemyIndex++);
      }
    }
    if (snapshot.visibleBattle) {
      this.unitInterpolator.sync(snapshot.visibleBattle.id, snapshot.visibleBattle.units, arrivedAt);
      // Download Rotate during the 1.5s arrival, before the first orientation turn.
      for (const unit of snapshot.visibleBattle.units) {
        const dex = SPECIES[unit.family].pokedexIds[Math.min(unit.stage, SPECIES[unit.family].pokedexIds.length - 1)];
        const anims = PMD[String(dex)];
        if (anims && !this.warmedSpecies.has(dex)) this.warmAnimationSheets(dex, anims, unit.family, unit.stage);
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
    this.frameErrorReported=false;
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
      try {this.draw(time);this.frameErrorReported=false;}
      catch(error){if(!this.frameErrorReported)console.error('[Arena V22.6] Falha ao desenhar o quadro',error);this.frameErrorReported=true;}
      finally {this.scheduleFrame();}
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

  worldScale():number{return this.cellScale/70;}
  /** Both augments and inventory use the same slot-based layout: all sidebars
   * stay outside the hex boundaries, including 14-column quad battles. */
  ownerPlacement(id:string):{rack:{x:number;y:number};augments:{x:number;y:number};side:'left'|'right'} {
    const battle=this.snapshot?.visibleBattle;
    const active=!!battle && this.snapshot?.phase!=='planning' && !battle.resolved;
    const ids=active?battle!.participants:[this.view.scoutId];
    const slot=ids.indexOf(id);
    if(slot<0)return {rack:{x:ITEM_RACK_WORLD.x,y:ITEM_RACK_WORLD.y},augments:{x:-5.05,y:1.25},side:'left'};
    if(ids.length>2){
      const left=slot<2,upper=slot===1||slot===2;
      return {rack:{x:left?-9.65:9.65,y:upper?-2.55:2.55},
        augments:{x:left?-9.65:9.65,y:upper?-1.35:1.35},side:left?'left':'right'};
    }
    const upper=ids.length===2 && id!==this.view.scoutId;
    return {rack:{x:-6.45,y:upper?-3.12:3.45},
      augments:{x:-5.15,y:upper?-1.45:1.45},side:'left'};
  }
  /** An HTML item tray uses the exact same world-to-screen projection as sprites. */
  placeWorldRack(node:HTMLElement,x:number=ITEM_RACK_WORLD.x,y:number=ITEM_RACK_WORLD.y):void {
    const point=this.toScreen(x,y), rect=this.canvas.getBoundingClientRect(), app=document.getElementById('app')!.getBoundingClientRect();
    node.style.left=`${rect.left-app.left+point.x}px`;
    node.style.top=`${rect.top-app.top+point.y}px`;
    node.style.setProperty('--rack-world-scale',String(this.worldScale()*RENDER_SETTINGS.itemWorldScale));
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
    this.zoom = Math.max(.63, Math.min(1.56, this.zoom + (delta > 0 ? -.09 : .09)));
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
  pickEnemyHex(clientX:number,clientY:number):{col:number;row:number}|null {
    if(this.snapshot?.phase!=='planning'||this.view.scoutId!=='p0')return null;
    const world=this.pointerWorld(clientX,clientY);
    let pick:{col:number;row:number}|null=null,best=.47;
    for(let row=0;row<4;row++)for(let col=0;col<7;col++){
      const p=gridXY(col,row),d=Math.hypot(p.x-world.x,p.y-world.y);
      if(d<best){pick={col,row};best=d;}
    }
    return pick;
  }
  pickMimePillar(clientX:number,clientY:number):{unitId:string;index:number}|null {
    if(this.snapshot?.phase!=='planning'||this.view.scoutId!=='p0')return null;
    const world=this.pointerWorld(clientX,clientY);
    for(const mime of this.snapshot.players[0].units){
      if(!['mr-mime','mime-jr'].includes(mime.family)||mime.position.area!=='board')continue;
      const marks=mime.mimePillars||[{col:2,row:1},{col:4,row:2}];
      for(let index=0;index<marks.length;index++){
        const p=gridXY(marks[index].col,marks[index].row);
        if(Math.hypot(p.x-world.x,p.y-world.y)<.37)return {unitId:mime.id,index};
      }
    }
    return null;
  }
  private drawMimePillars(time:number):void {
    if(this.snapshot?.phase!=='planning'||this.view.scoutId!=='p0')return;
    const ctx=this.context;
    for(const mime of this.snapshot.players[0].units){
      if(!['mr-mime','mime-jr'].includes(mime.family)||mime.position.area!=='board')continue;
      for(const [index,mark] of (mime.mimePillars||[{col:2,row:1},{col:4,row:2}]).entries()){
        const shown=this.pillarPreview?.unitId===mime.id&&this.pillarPreview.index===index?this.pillarPreview:mark;
        const p=gridXY(shown.col,shown.row),at=this.toScreen(p.x,p.y),r=this.cellScale*.33;
        ctx.save();ctx.globalAlpha=.64+.12*Math.sin(time*3+index);ctx.strokeStyle='#d0a4ff';ctx.fillStyle='#a577db55';
        ctx.shadowColor='#aa6dff';ctx.shadowBlur=15;ctx.lineWidth=2;
        ctx.beginPath();ctx.moveTo(at.x,at.y-r*.8);ctx.lineTo(at.x+r*.65,at.y-r*.3);ctx.lineTo(at.x+r*.65,at.y+r*.8);ctx.lineTo(at.x-r*.65,at.y+r*.8);ctx.lineTo(at.x-r*.65,at.y-r*.3);ctx.closePath();ctx.fill();ctx.stroke();
        ctx.fillStyle='#fff';ctx.font=`${Math.max(12,r*.65)}px sans-serif`;ctx.textAlign='center';ctx.fillText(String(index+1),at.x,at.y+r*.25);ctx.restore();
      }
    }
  }
  private drawObstacles(battle:NonNullable<GameSnapshot['visibleBattle']>,time:number):void {
    const ctx=this.context,flip=battle.participants.length===2&&battle.playerB===this.view.scoutId;
    for(const obs of battle.obstacles||[]){
      if(obs.until<=battle.elapsed)continue;
      const p=this.toScreen(obs.x,flip?-obs.y:obs.y),r=this.cellScale;
      const enter=Math.min(1,Math.max(0,(battle.elapsed-obs.createdAt)/.22));
      const exit=Math.min(1,Math.max(0,(obs.until-battle.elapsed)/.2));
      ctx.save();ctx.globalAlpha=Math.max(0,Math.min(enter,exit));ctx.strokeStyle='#dfa7ff';ctx.fillStyle='#8e49bacc';ctx.shadowColor='#a96aff';ctx.shadowBlur=r*.18;
      ctx.lineWidth=Math.max(2,r*.045);
      if(obs.kind==='pillar'){
        const h=r*.95*enter,w=r*.46;
        ctx.beginPath();ctx.moveTo(p.x-w,p.y-r*.12);ctx.lineTo(p.x-w,p.y-r*.12-h);ctx.lineTo(p.x+w,p.y-r*.12-h);ctx.lineTo(p.x+w,p.y-r*.12);ctx.closePath();ctx.fill();ctx.stroke();
        ctx.fillStyle='#d8b4ff88';ctx.fillRect(p.x-w,p.y-r*.12-h,r*.19,h);
      }else {
        const a=this.toScreen(obs.ax,flip?-obs.ay:obs.ay),b=this.toScreen(obs.bx,flip?-obs.by:obs.by);
        ctx.beginPath();ctx.moveTo(a.x,a.y-r*.50*enter);ctx.lineTo(b.x,b.y-r*.50*enter);ctx.lineTo(b.x,b.y);ctx.lineTo(a.x,a.y);ctx.closePath();ctx.fill();ctx.stroke();
      }
      ctx.restore();
    }
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

  private warmAnimationSheets(dex: number, anims: PmdEntry, family: Family, stage: number): void {
    if (this.warmedSpecies.has(dex)) return;
    this.warmedSpecies.add(dex);
    const moves=getStageData(family,stage);
    const extras=family==='magikarp' && stage===1?['RearUp','Rumble']
      :family==='staryu'?['Twirl']
      :family==='machop'?['Kick']
      :family==='gastly'?['Lick','MultiStrike','Strike']
      :[];
    for (const action of new Set([...RENDER_SETTINGS.idleSpritePreload,'Rotate',
      moves.basic.animation,moves.chargedAnimation,...extras])) {
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
      this.warmAnimationSheets(id, anims, unit.family, unit.stage);
      const statusTime=this.snapshot?.visibleBattle?.elapsed||0;
      const status=unit.statuses;
      const asleep=!!status?.sleeping&&status.sleeping.until>statusTime;
      const paralyzed=(!!status?.paralyzed&&status.paralyzed.until>statusTime)||!!unit.stunUntil&&unit.stunUntil>statusTime;
      const frozen=!!status?.frozen&&status.frozen.until>statusTime;
      const action = unit.bench || asleep ? 'Sleep' : paralyzed ? 'Hurt' : frozen ? 'Idle' : this.snapshot?.phase === 'planning' ? 'Idle'
        : unit.animation?.name || (unit.moving ? (anims.Hover ? 'Hover' : 'Walk') : 'Idle');
      const battle = this.snapshot?.visibleBattle;
      const flipped = this.snapshot?.phase !== 'planning' && battle?.participants.length === 2 && battle.playerB === this.view.scoutId;
      const facing = this.direction(unit.facingX || 0, flipped ? -(unit.facingY || 0) : (unit.facingY || 0));
      const desired = this.snapshot?.phase === 'planning' || this.snapshot?.phase === 'result' || this.snapshot?.phase === 'finished' || unit.bench ? 0 : facing;
      const orientation = this.orientation.get(unit.id, desired, time, !unit.bench && (action === 'Idle' || action === 'Walk' || action === 'Hover'));
      const turning = !!orientation.rotate && (action === 'Idle' || action === 'Walk' || action === 'Hover') && !!anims.Rotate;
      // PMD species can omit special sheets. Fallback only to names in this real manifest.
      const fallbacks = action === 'Walk' ? ['Hover','Walk','Idle']
        : action === 'Shoot' ? ['Attack','Idle']
        : action === 'SpAttack' ? ['Charge','Shoot','Attack','Idle']
        : action === 'Shock' ? ['Charge','Shoot','Attack','Idle']
        : action === 'Hop' ? ['Hop','Attack','Idle']
        : ['Charge','Attack','Shoot','Idle'];
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
        const elapsedTicks = frozen ? 0 : paralyzed ? Math.min(totalTicks-.001,totalTicks*.55) : active && selectedAction !== 'Withdraw'
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
        const sizeScale = this.cellScale / 48 * (unit.bench ? .95 : 1.13) * physicalSize(unit.family,unit.stage);
        const rowMarker=markerAt(animation,'shadow',row,frame);
        // PMD sheets are frame-centered; the white Shadow marker is the true ground
        // reference. Never center on changing visible pixels (arms, tails, leaps).
        const anchorX=rowMarker?.ground?.[0]??animation.width/2;
        const anchorY=rowMarker?.ground?.[1]??animation.height*.80;
        const drawX=Math.round(x-anchorX*sizeScale);
        const drawY=Math.round(y-anchorY*sizeScale);
        const body=markerAt(animation,'body',row,frame);
        if(body && !unit.bench) {
          const toPt=(p?:number[])=>p?{x:drawX+p[0]*sizeScale,y:drawY+p[1]*sizeScale}:undefined;
          this.spriteParts.set(unit.id,{body:toPt(body.body),head:toPt(body.head),
            leftHand:toPt(body.leftHand),rightHand:toPt(body.rightHand)});
        }
        const bounds=this.spriteBounds.get(sprite,`${url}:${frame}:${row}`,frame*animation.width,row*animation.height,animation.width,animation.height);
        ctx.save();ctx.imageSmoothingEnabled=false;
        ctx.drawImage(sprite,frame*animation.width,row*animation.height,
          animation.width,animation.height,drawX,drawY,animation.width*sizeScale,animation.height*sizeScale);
        ctx.restore();
        return drawY+bounds.top*sizeScale;
      }
      // Nunca renderizar sprites PNG estáticos quando uma animação PMD ainda carrega.
      return y - this.cellScale * .85;
    }
    // Lendários ainda não receberam sheets PMD; continuam como PNGs, sem figuras coloridas.
    const path = SPECIES[unit.family].sprites[Math.min(unit.stage, SPECIES[unit.family].sprites.length - 1)];
    // Missing PMD sheets remain ordinary sprite PNGs; try the canonical PokeAPI image if a local asset is absent.
    const localUrl = /^https?:\/\//.test(path) ? path : `${import.meta.env.BASE_URL}${path.replace(/^\.\//, '')}`;
    const primary = this.image(localUrl);
    const staticSprite = primary.complete && !primary.naturalWidth && /^\.\/sprites\/\d+\.png$/.test(path)
      ? this.image(`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`)
      : primary;
    if (staticSprite.complete && staticSprite.naturalWidth) {
      const size = this.cellScale * (unit.bench ? .67 : 1.03) * physicalSize(unit.family,unit.stage);
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
      const radius = scale * .60; // exact tiling from gridXY (1.04 horizontal, .91 vertical spacing)
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

  private drawTerrain(time:number):void {
    const battle=this.snapshot?.visibleBattle,tiles=battle?.terrain;
    if(!tiles || this.snapshot?.phase==='planning')return;
    const flip=battle!.participants.length===2&&battle!.playerB===this.view.scoutId;
    const ctx=this.context,r=this.cellScale*.54;
    for(const tile of Object.values(tiles)){
      const point=gridXY(tile.col,tile.row),screen=this.toScreen(point.x,flip?-point.y:point.y);
      const fade=Math.min(1,Math.max(0,(tile.until-battle!.elapsed)/.44));
      const pulse=.94+.06*Math.sin(time*2.4+tile.col*.83+tile.row);
      const strength=tile.intensity;
      ctx.save();ctx.globalAlpha=fade*pulse;
      const radius=r*(.94+.025*Math.sin(time*1.6+tile.col+tile.row));
      const path=()=>{ctx.beginPath();for(let v=0;v<6;v++){
        const a=v*PI2/6+Math.PI/6;
        const x=screen.x+Math.cos(a)*radius,y=screen.y+Math.sin(a)*radius;
        if(v===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
      }ctx.closePath();};
      path();
      const pool=ctx.createRadialGradient(screen.x-radius*.22,screen.y-radius*.22,0,screen.x,screen.y,radius);
      pool.addColorStop(0,strength===1?'#c58af87a':strength===2?'#b45aea9c':'#b047d8b8');
      pool.addColorStop(.72,strength===1?'#944dc74b':strength===2?'#8033b17c':'#7225b2a0');
      pool.addColorStop(1,'#4c1b7b26');ctx.fillStyle=pool;ctx.fill();
      ctx.strokeStyle=strength===1?'#d9a8ee65':strength===2?'#d8a3ff96':'#eba6ffbb';
      ctx.lineWidth=Math.max(1,this.cellScale*.028);ctx.stroke();ctx.clip();
      // Fixed, deterministic ripples: no per-frame particle objects and no visual noise.
      ctx.lineWidth=Math.max(.7,this.cellScale*.014);ctx.strokeStyle='#e4b4ff78';
      for(let i=0;i<2+strength;i++){
        const a=i*2.39+tile.row*1.17+tile.col*2.03;
        const dist=radius*(.16+.13*i);
        const x=screen.x+Math.cos(a)*dist,y=screen.y+Math.sin(a)*dist*.72;
        ctx.beginPath();ctx.ellipse(x,y,radius*(.10+.025*strength),radius*.042,Math.sin(a),0,PI2);ctx.stroke();
      }
      for(let i=0;i<strength+1;i++){
        const a=time*(i%2?.38:-.29)+i*2.51+tile.col*1.71+tile.row*.33;
        const x=screen.x+Math.cos(a)*radius*.50,y=screen.y+Math.sin(a)*radius*.34;
        const bubbleRadius=Math.max(1,this.cellScale*(.024+.012*(i%2)));
        ctx.fillStyle='#ddb7ff88';ctx.beginPath();ctx.arc(x,y,bubbleRadius,0,PI2);ctx.fill();
        ctx.strokeStyle='#f8daff99';ctx.lineWidth=Math.max(.8,this.cellScale*.012);ctx.stroke();
      }
      ctx.restore();
    }
  }
  private drawVines(time:number):void {
    const battle=this.snapshot?.visibleBattle;
    if(!battle||battle.resolved||this.snapshot?.phase!=='combat')return;
    const flipped=battle.participants.length===2&&battle.playerB===this.view.scoutId;
    const ctx=this.context;
    for(const source of battle.units){
      if(!source.vine||source.hp<=0)continue;
      const target=battle.units.find(unit=>unit.id===source.vine?.targetId&&unit.hp>0);
      if(!target)continue;
      const a=this.toScreen(source.x,flipped?-source.y:source.y);
      const b=this.toScreen(target.x,flipped?-target.y:target.y);
      const dx=b.x-a.x,dy=b.y-a.y,dist=Math.hypot(dx,dy)||1;
      const nx=-dy/dist,ny=dx/dist;
      const sway=Math.sin(time*2.5+source.x)*this.cellScale*.085;
      const midX=(a.x+b.x)*.5+nx*sway,midY=(a.y+b.y)*.5+ny*sway-this.cellScale*.22;
      const fade=Math.min(1,Math.max(0,(battle.elapsed-source.vine.attachedAt)/.25));
      ctx.save();ctx.globalAlpha=fade;ctx.lineCap='round';ctx.lineJoin='round';
      ctx.shadowColor='#48bc5c';ctx.shadowBlur=this.cellScale*.1;
      ctx.lineWidth=Math.max(3,this.cellScale*.075);ctx.strokeStyle='#236d37';
      ctx.beginPath();ctx.moveTo(a.x,a.y-this.cellScale*.23);ctx.quadraticCurveTo(midX,midY,b.x,b.y-this.cellScale*.24);ctx.stroke();
      ctx.shadowBlur=0;ctx.lineWidth=Math.max(1.2,this.cellScale*.026);ctx.strokeStyle='#a0e36b';ctx.stroke();
      // Leaves are placed at the same fractional positions, so the rope costs no particles.
      for(const f of [.29,.58,.82]){
        const x=(1-f)*(1-f)*a.x+2*(1-f)*f*midX+f*f*b.x;
        const y=(1-f)*(1-f)*(a.y-this.cellScale*.23)+2*(1-f)*f*midY+f*f*(b.y-this.cellScale*.24);
        const side=Math.sin(time*2+f*15)>0?1:-1;
        ctx.fillStyle=f>.5?'#72bb57':'#4a9645';ctx.beginPath();
        ctx.ellipse(x+nx*side*this.cellScale*.065,y+ny*side*this.cellScale*.065,
          this.cellScale*.09,this.cellScale*.04,Math.atan2(dy,dx)+side*.7,0,Math.PI*2);ctx.fill();
      }
      ctx.restore();
    }
  }
  private drawAbsorptions(time:number):void {
    const battle=this.snapshot?.visibleBattle;
    if(!battle||battle.resolved||this.snapshot?.phase!=='combat')return;
    const ctx=this.context,flip=battle.participants.length===2&&battle.playerB===this.view.scoutId;
    for(const absorber of battle.units){
      if(!absorber.absorb||absorber.hp<=0)continue;
      const victim=battle.units.find(u=>u.id===absorber.absorb?.targetId&&u.hp>0);
      if(!victim)continue;
      const from=this.toScreen(absorber.x,flip?-absorber.y:absorber.y);
      const to=this.toScreen(victim.x,flip?-victim.y:victim.y);
      const radius=this.cellScale*(.28+.045*Math.sin(time*7));
      ctx.save();
      ctx.strokeStyle='#6ccd91a8';ctx.lineWidth=Math.max(2,this.cellScale*.09);
      ctx.setLineDash([this.cellScale*.10,this.cellScale*.12]);ctx.lineDashOffset=-time*24;
      ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.quadraticCurveTo((from.x+to.x)/2,(from.y+to.y)/2-this.cellScale*.4,to.x,to.y);ctx.stroke();
      ctx.setLineDash([]);ctx.fillStyle='#2c9b62aa';ctx.strokeStyle='#b2ef9c';ctx.lineWidth=2;
      ctx.beginPath();ctx.ellipse(to.x,to.y+radius*.20,radius*1.5,radius,0,0,Math.PI*2);ctx.fill();ctx.stroke();
      ctx.fillStyle='#bded9ed0';
      for(let i=0;i<3;i++){const phase=time*3+i*2.1;
        ctx.beginPath();ctx.arc(to.x+Math.cos(phase)*radius,to.y+Math.sin(phase)*radius*.8,radius*.13,0,Math.PI*2);ctx.fill();}
      ctx.restore();
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
    const watched = snapshot.players.find(p => p.id === this.view.scoutId) || snapshot.players[0];
    const planningKey=snapshot.phase==='planning' ? JSON.stringify([watched.units.map(u=>[
      u.id,u.family,u.stage,u.level,u.position,u.equipment]),snapshot.sandbox?snapshot.players[1]?.units.map(u=>[u.id,u.family,u.stage,u.position,u.equipment]):null]) : '';
    if(snapshot.phase==='planning' && this.planningCache?.key===planningKey && this.planningCache.scout===this.view.scoutId)return this.planningCache.markers;
    const benchUnits = (units: Pokemon[], ownerId: string, own: boolean, enemy: boolean, offset: number): Marker[] => units.filter(u => u.position.area === 'bench').map(u => {
      const p = benchXY((u.position as Extract<UnitPosition, { area: 'bench' }>).index, enemy, offset);
      return { id: u.id, sourceId: u.id, ownerId, x: p.x, y: p.y, family: u.family, stage: u.stage, level: u.level,
        own, hp: 1, maxHp: 1, energy: 0, required: getStageData(u.family, u.stage).energy, equipment:u.equipment||[], flash: 0, bench: true } as Marker;
    });
    const liveUnits=watched.units.map(u=>this.pendingMove.has(u.id)?{...u,position:this.pendingMove.get(u.id)!.position}:u);
    const bench = benchUnits(liveUnits, watched.id, true, false, 0);
    const foeId = snapshot.sandbox?'p1':snapshot.visibleBattle?.participants.find(id => id !== this.view.scoutId) || null;
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
    const convert = (units: Pokemon[], own: boolean,ownerId:string): Marker[] => units.filter(u => u.position.area === 'board').map(u => {
      const pos = u.position as Extract<UnitPosition, { area: 'board' }>;
      const row = own ? 4 + pos.row : 3 - pos.row;
      const p = gridXY(pos.col, row);
      return { id: u.id, sourceId: u.id, ownerId, x: p.x, y: p.y, family: u.family, stage: u.stage,
        level: u.level, own, equipment:u.equipment||[],hp: 1, maxHp: 1, energy: 0, required: getStageData(u.family, u.stage).energy, flash: 0 };
    });
    // Nunca vazar a formação do próximo rival durante a preparação.
    const prepared = [...convert(liveUnits, true,watched.id), ...bench,
      ...(snapshot.sandbox && foePlayer ? convert(foePlayer.units,false,foePlayer.id) : [])];
    this.planningCache = { key: planningKey, scout: this.view.scoutId, markers: prepared };
    return prepared;
  }

  pickCoin(clientX: number, clientY: number): { x: number; y: number } | null {
    if (!this.snapshot || this.view.scoutId !== 'p0') return null;
    const world = this.pointerWorld(clientX, clientY);
    const drop = [...this.snapshot.collectibleGold,...this.snapshot.collectibleLoot].find(d => !d.claimed && Math.hypot(world.x - d.x, world.y - d.y) < .38);
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

  private drawLoot(time: number): void {
    if (!this.snapshot || this.view.scoutId !== 'p0') return;
    const ctx=this.context;
    const palettes={
      gray:{body:'#9daeba',bright:'#f7ffff',glow:'#ccedff',dark:'#596c7a'},
      blue:{body:'#318ade',bright:'#d5f5ff',glow:'#52c5ff',dark:'#153876'},
      yellow:{body:'#f9b72f',bright:'#fff8c2',glow:'#ffdd58',dark:'#b7711a'}
    };
    for(const loot of this.snapshot.collectibleLoot){
      if(loot.claimed)continue;
      const p=this.toScreen(loot.x,loot.y);
      const pal=palettes[loot.color];
      const beat=time*2.5+loot.x*3+loot.y;
      const hover=Math.sin(beat)*2.1;
      const y=p.y-12+hover;
      const radius=11.8+Math.sin(beat)*.55;
      ctx.save();
      ctx.globalAlpha=.27;
      const halo=ctx.createRadialGradient(p.x,y,1,p.x,y,30);
      halo.addColorStop(0,pal.glow);halo.addColorStop(1,'#00000000');
      ctx.fillStyle=halo;ctx.beginPath();ctx.arc(p.x,y,30,0,PI2);ctx.fill();
      ctx.globalAlpha=.18;ctx.fillStyle='#142428';ctx.beginPath();ctx.ellipse(p.x,p.y+7,14,4,0,0,PI2);ctx.fill();
      ctx.globalAlpha=1;ctx.shadowColor=pal.glow;ctx.shadowBlur=18+Math.sin(beat)*4;
      const fill=ctx.createRadialGradient(p.x-4,y-5,1,p.x+3,y+4,radius*1.3);
      fill.addColorStop(0,pal.bright);fill.addColorStop(.4,pal.body);fill.addColorStop(1,pal.dark);
      ctx.fillStyle=fill;ctx.beginPath();ctx.arc(p.x,y,radius,0,PI2);ctx.fill();
      ctx.lineWidth=1.6;ctx.strokeStyle=pal.bright;ctx.stroke();
      ctx.shadowBlur=0;ctx.font='900 15px Inter, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.lineWidth=3;ctx.strokeStyle='#203042b8';ctx.strokeText('?',p.x,y+1.4);
      ctx.fillStyle='#fffef4';ctx.fillText('?',p.x,y+1.4);
      for(let i=0;i<3;i++){
        const a=time*(i%2?-1:1)*1.5+i*PI2/3+loot.x;
        const r=radius+5+(i%2)*4;
        const x=p.x+Math.cos(a)*r, sy=y+Math.sin(a)*r*.76;
        ctx.globalAlpha=.42+.42*Math.sin(time*4+i)**2;
        ctx.fillStyle=pal.bright;
        ctx.beginPath();ctx.moveTo(x,sy-3.2);ctx.lineTo(x+1.4,sy);ctx.lineTo(x,sy+3.2);ctx.lineTo(x-1.4,sy);ctx.closePath();ctx.fill();
      }
      ctx.restore();
    }
  }

  private drawSacredTile(time:number):void {
    if(!this.snapshot)return;
    const snapshot=this.snapshot,watched=snapshot.players.find(p=>p.id===this.view.scoutId);
    if(!watched)return;
    const count=new Set(watched.units.filter(u=>u.position.area==='board'&&getStageData(u.family,u.stage).elements.includes('dragon')).map(u=>`${u.family}:${u.stage}`)).size;
    if(!tierFor('dragon',count))return;
    const salt=[...watched.id].reduce((n,c)=>n+c.charCodeAt(0),0);
    const fixed=snapshot.visibleBattle?.sacredTiles?.[watched.id];
    const index=fixed?fixed.row*7+fixed.col:randomIndex(snapshot.round,28,salt);
    const col=index%7,row=Math.floor(index/7);
    const battle=snapshot.visibleBattle;
    const quad=battle&&battle.participants.length>2;
    const slot=quad?battle.participants.indexOf(watched.id):0;
    const worldRow=quad&&(slot===1||slot===2)?3-row:row+4;
    const offset=quad?(slot<2?-QUAD_OFFSET:QUAD_OFFSET):0;
    const p=gridXY(col,worldRow),point=this.toScreen(p.x+offset,p.y);
    const ctx=this.context,r=this.cellScale*.46;
    ctx.save();ctx.translate(point.x,point.y);
    ctx.globalAlpha=.53+.14*Math.sin(time*2.4);
    ctx.fillStyle='#b78ad12b';ctx.strokeStyle='#d8b2fa';ctx.shadowColor='#ab6ff0';ctx.shadowBlur=11;ctx.lineWidth=2;
    ctx.beginPath();for(let i=0;i<6;i++){const a=i*Math.PI/3+Math.PI/6;
      if(!i)ctx.moveTo(Math.cos(a)*r,Math.sin(a)*r*.65);else ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r*.65);
    }ctx.closePath();ctx.fill();ctx.stroke();
    ctx.font=`900 ${Math.max(12,r*.62)}px Inter`;ctx.textAlign='center';ctx.fillStyle='#e7cafa';ctx.fillText('✦',0,5);
    ctx.restore();
  }

  private drawCapacityOnGround():void {
    if(this.snapshot?.phase!=='planning')return;
    const player=this.snapshot.players.find(p=>p.id===this.view.scoutId);
    if(!player)return;
    const count=player.units.filter(u=>u.position.area==='board').length;
    const pos=this.toScreen(-2.55,2.9),ctx=this.context;
    ctx.save();ctx.font=`900 ${Math.max(17,this.cellScale*.39)}px 'Barlow Condensed',sans-serif`;
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.globalAlpha=.57;ctx.fillStyle='#103d2e';ctx.strokeStyle='#c9f6bf';ctx.lineWidth=1.7;
    ctx.strokeText(`${count} / ${player.level}`,pos.x,pos.y);
    ctx.fillText(`${count} / ${player.level}`,pos.x,pos.y);ctx.restore();
  }

  private drawEquipmentIcons(unit:Marker,x:number,y:number):void {
    const gear=unit.equipment||[];if(!gear.length)return;
    const scale=Math.max(13,Math.min(20,this.cellScale*.27));
    const total=Math.min(2,gear.length),ctx=this.context;
    for(let i=0;i<total;i++){
      const raw=itemSprite(gear[i]);if(!raw)continue;
      const url=`${import.meta.env.BASE_URL}${raw.replace(/^\//,'')}`;
      let img=this.itemImageCache.get(url);
      if(!img){img=new Image();img.src=url;this.itemImageCache.set(url,img);}
      const left=x+(i-(total-1)/2)*scale*1.07-scale/2;
      ctx.fillStyle='#173029e5';ctx.strokeStyle='#e4cca4';ctx.lineWidth=1;
      ctx.beginPath();ctx.roundRect(left-1,y-1,scale+2,scale+2,3);ctx.fill();ctx.stroke();
      if(img.complete&&img.naturalWidth)ctx.drawImage(img,left,y,scale,scale);
    }
  }

  private drawUnit(unit: Marker, time: number): void {
    const ctx = this.context;
    const p = this.toScreen(unit.x, unit.y);
    const radius = this.cellScale * (unit.bench ? .19 : collisionRadius(unit.family,unit.stage));
    const ghost=unit.ghost;
    if(ghost && ghost.phase!=='appear') {
      const fade=ghost.phase==='fade'?1-.58*ghost.time/ghost.duration:.37;
      ctx.save();ctx.globalAlpha=fade;ctx.shadowColor='#a46eff';ctx.shadowBlur=18;
      this.drawPokemonSprite(p.x,p.y-3-Math.sin(time*8)*2,unit,time);
      ctx.restore();return;
    }
    // The PMD sprite itself already contains the ground under Diglett/Dugtrio.
    // Shadow markers are metadata, never an additional soil decal.
    const dex=SPECIES[unit.family].pokedexIds[Math.min(unit.stage,SPECIES[unit.family].pokedexIds.length-1)];
    const sheetSet=PMD[String(dex)];
    const action=unit.animation?.name || (unit.moving?'Walk':'Idle');
    const sheet=sheetSet?.[action] || sheetSet?.Idle;
    const currentFrame=sheet&&unit.animation?.duration
      ? frameAt(sheet,unit.animation.elapsed/unit.animation.duration) : 0;
    const row=sheet?.directions===1?0:this.direction(unit.facingX||0,unit.facingY||0);
    const marker=sheet?markerAt(sheet,'shadow',row,currentFrame):null;
    const shade=marker?.size??sheet?.shadowSize;
    const liftForShadow=(unit.jumpHeight||0)+(unit.knockUpTime?.3:0);
    drawContactShadow(ctx,p.x,p.y,radius,visualProfile(unit.family,unit.stage).shadow,liftForShadow,shade);
    const battle=this.snapshot?.visibleBattle;
    if(battle&&this.snapshot?.phase!=='planning'&&unit.synergy){
      const elements=getStageData(unit.family,unit.stage).elements;
      const tones:Record<string,string>={fire:'#ff9b5c',steel:'#c5e1e7',fighting:'#d98c63',psychic:'#f1b0f5',rock:'#cabb91',water:'#75d6ff',grass:'#8cec9c',electric:'#ffe580',flying:'#cde9ff',fairy:'#ffaaff',normal:'#d8ded0',ghost:'#bfa7ff',dark:'#8f85bd',bug:'#c9ef75',dragon:'#aba8ff',ground:'#d9ab81',poison:'#b777f2',ice:'#c7faff'};
      const active=elements.filter(type=>tierFor(type,battle.traitsByPlayer[unit.ownerId]?.[type]||0));
      active.slice(0,2).forEach((type,i)=>{
        ctx.save();ctx.globalAlpha=.26+.09*Math.sin(time*2.5+i*2);
        ctx.strokeStyle=tones[type];ctx.lineWidth=1.5;ctx.shadowColor=tones[type];ctx.shadowBlur=8;
        ctx.beginPath();ctx.ellipse(p.x,p.y-3,radius*(1.22+i*.2),radius*(.44+i*.13),0,0,PI2);ctx.stroke();ctx.restore();
      });
    }
    if ((this.view.selectedId === unit.id || this.view.selectedId === unit.sourceId)) {
      ctx.beginPath(); ctx.ellipse(p.x, p.y + 3, radius * 1.7, radius * .5, 0, 0, PI2);
      ctx.strokeStyle = '#eed18d'; ctx.lineWidth = 3; ctx.stroke();
    }
    if (unit.flash > 0) {
      ctx.fillStyle = '#fff4d454'; ctx.beginPath(); ctx.arc(p.x, p.y - 2, radius * 1.7, 0, PI2); ctx.fill();
    }
    // With ground markers, Hop art already describes vertical body travel.
    // Do not stack the physics jump on top of the sprite's built-in jump.
    const bakedHop=unit.animation?.name==='Hop' && !!PMD[String(dex)]?.Hop?.shadowMarkers;
    const lift = (bakedHop?0:(unit.jumpHeight || 0)) +
      (unit.knockUpTime ? .55 * Math.sin(Math.PI * (1 - Math.min(1, unit.knockUpTime / (unit.knockUpDuration || .35)))) : 0);
    if(ghost?.phase==='appear'){ctx.save();ctx.globalAlpha=.38+.62*ghost.time/ghost.duration;ctx.shadowColor='#c99dff';ctx.shadowBlur=16;}
    const motion = cosmeticMotion({family:unit.family,stage:unit.stage,animation:unit.animation||null,
      facingX:unit.facingX||0,facingY:unit.facingY||0,leap:unit.leap||null,jumpHeight:unit.jumpHeight||0},
      this.cellScale,unit.animation?.name==='Hop'&&!!PMD[String(dex)]?.Hop);
    const spriteX = p.x + motion.dx, spriteY = p.y - lift * this.cellScale + motion.dy;
    ctx.save();
    if (motion.scale !== 1) { ctx.translate(spriteX,spriteY);ctx.scale(motion.scale,motion.scale);ctx.translate(-spriteX,-spriteY); }
    const spriteTop = this.drawPokemonSprite(spriteX,spriteY,unit,time) - this.cellScale*(motion.scale-1)*.6;
    ctx.restore();
    if(battle&&this.snapshot?.phase!=='planning'){
      const now=battle.elapsed,st=unit.statuses;
      const statusActive=(key:keyof NonNullable<typeof st>)=>!!st?.[key]&&st[key]!.until>now;
      const centerY=p.y-this.cellScale*.49;
      if(statusActive('burning')||!!unit.itemBurn&&unit.itemBurn.until>now){
        ctx.save();ctx.fillStyle='#ff6a3ca3';ctx.globalAlpha=.45;
        for(let i=0;i<6;i++){const a=(i*2.4+time*2.3),xx=p.x+Math.cos(a)*radius*.75,yy=centerY+Math.sin(a)*radius*.65;
          ctx.beginPath();ctx.ellipse(xx,yy,2.8,6+Math.sin(time*5+i)*2,Math.sin(a),0,PI2);ctx.fill();}ctx.restore();
      }
      if(statusActive('poisoned')||!!unit.poison&&unit.poison.time>0){
        ctx.save();ctx.fillStyle='#ad6ae0b0';for(let i=0;i<6;i++){
          const a=i*2.4+time*.9,phase=(time*.28+i*.21)%1;
          ctx.beginPath();ctx.arc(p.x+Math.sin(a)*radius*.6,centerY+radius*.6-phase*radius*1.5,2+phase*2,0,PI2);ctx.fill();}ctx.restore();
      }
      if(statusActive('frozen')){
        ctx.save();ctx.fillStyle='#80d4ff42';ctx.strokeStyle='#9beaffaa';ctx.lineWidth=2;
        ctx.beginPath();ctx.moveTo(p.x-radius,centerY+radius);ctx.lineTo(p.x-radius*.94,centerY-radius*.9);ctx.lineTo(p.x+radius*.8,centerY-radius*.95);ctx.lineTo(p.x+radius,centerY+radius);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
      }else if(statusActive('sleeping')){
        ctx.save();ctx.fillStyle='#c8ddff';ctx.font=`${Math.max(10,this.cellScale*.2)}px sans-serif`;
        for(let i=0;i<3;i++){const shift=(time*.35+i/3)%1;ctx.globalAlpha=1-shift;ctx.fillText('Z',p.x+radius*.43+shift*radius*.7,centerY-radius*.4-shift*radius*1.5);}ctx.restore();
      }else if(statusActive('paralyzed')||!!unit.stunUntil&&unit.stunUntil>now){
        ctx.save();ctx.fillStyle='#ffdb6b';ctx.font=`${Math.max(9,radius*.65)}px sans-serif`;ctx.textAlign='center';
        for(let i=0;i<3;i++){const a=time*3+i*2.094;ctx.fillText('✦',p.x+Math.cos(a)*radius*.7,centerY-radius+Math.sin(a)*radius*.3);}ctx.restore();
      }
      if(unit.starWard){ctx.save();ctx.strokeStyle='#ffd2f5';ctx.shadowColor='#f79bd9';ctx.shadowBlur=10;ctx.lineWidth=3;
        ctx.beginPath();ctx.ellipse(p.x,centerY,radius*1.45,radius*1.8,0,0,PI2);ctx.stroke();ctx.restore();}
    }
    // Persistent, snapshot-owned orbitals: world-space particles that follow the
    // interpolated body and continue rotating between simulation snapshots.
    if (unit.orbitFlames?.length) {
      const flipped=this.snapshot?.visibleBattle?.participants.length===2 && this.snapshot.visibleBattle.playerB===this.view.scoutId;
      const ability=ATTACKS.moves[getStageData(unit.family,unit.stage).move];
      const orbit=ability.orbitRadius??.69;
      const speed=ability.rotationSpeed??3.5;
      const distance=orbit*(1+(collisionRadius(unit.family,unit.stage)-.295)*.45)*this.cellScale;
      for(const flame of unit.orbitFlames) {
        const a=flame.angle+this.renderLead*speed;
        const fx=p.x+Math.cos(a)*distance;
        const fy=p.y+(flipped?-1:1)*Math.sin(a)*distance*.72-this.cellScale*.28;
        const full=flame.maxImpacts||Math.max(1,flame.impactsLeft);
        const wear=Math.max(.38,Math.min(1,flame.impactsLeft/full));
        const radius=this.cellScale*(ability.orbRadius??.14)*wear;
        ctx.save();ctx.globalCompositeOperation='lighter';
        const glow=ctx.createRadialGradient(fx,fy,1,fx,fy,radius*2.6);
        glow.addColorStop(0,'#fff6c5ef');glow.addColorStop(.28,'#ffb24db6');glow.addColorStop(1,'#ff6c1900');
        ctx.fillStyle=glow;ctx.beginPath();ctx.arc(fx,fy,radius*2.6,0,PI2);ctx.fill();
        ctx.fillStyle='#ffdf8d';ctx.beginPath();ctx.arc(fx,fy,radius*.65,0,PI2);ctx.fill();
        for(let j=0;j<3;j++){
          const spark=(time*1.9+j*2.1+a),spread=radius*(.7+j*.34);
          ctx.fillStyle=j===1?'#ffd765a0':'#ff783b8c';
          ctx.beginPath();ctx.arc(fx-Math.cos(spark)*spread,fy-Math.sin(spark)*spread,Math.max(1,radius*(.25-j*.05)),0,PI2);ctx.fill();
        }
        ctx.restore();
      }
    }
    const activeSheet=sheetSet?.[unit.animation?.name||''];
    drawCastingGlints(ctx,spriteX,spriteY,unit,this.cellScale,time,
      activeSheet?impactFraction(activeSheet):.5);
    // A jewel glows while Refração Estelar is active. Drawn on the unit, not in a HUD.
    const starSeconds = (unit.refractionUntil || 0) - (battle?.elapsed || 0);
    if (starSeconds > 0 && unit.family === 'staryu') {
      const remaining = Math.min(1,starSeconds/3);
      ctx.save();ctx.globalAlpha=.48+.25*Math.sin(time*8);ctx.fillStyle='#d5f9ff';
      ctx.shadowColor='#79e9ff';ctx.shadowBlur=10+4*Math.sin(time*9);
      ctx.beginPath();ctx.arc(spriteX,spriteY-this.cellScale*.50,3.2+1.2*Math.sin(time*8),0,PI2);ctx.fill();
      ctx.globalAlpha=.83;ctx.strokeStyle='#90f5ff';ctx.lineWidth=2;
      ctx.beginPath();ctx.arc(spriteX,spriteY-this.cellScale*.52,radius*.9,-Math.PI/2,-Math.PI/2+remaining*PI2);ctx.stroke();ctx.restore();
    }
    if(ghost?.phase==='appear')ctx.restore();
    if (unit.bench) return;
    const barWidth = Math.max(35, radius * 2.35);
    const bx = p.x - barWidth / 2;
    const baseY = spriteTop - (this.snapshot?.phase === 'planning' ? 7 : 10);
    this.drawEquipmentIcons(unit,p.x,baseY-Math.max(15,this.cellScale*.29));
    if (this.snapshot?.phase !== 'planning') {
      ctx.fillStyle = '#101f20d9'; ctx.fillRect(bx - 1, baseY - 1, barWidth + 2, 7);
      const scale=Math.max(1,unit.maxHp);
      const green=Math.max(0,Math.min(1,unit.hp/scale));
      const shield = (unit.barrier?.hp || 0) + (unit.barriers || []).reduce((total,b) => total+b.hp,0);
      const white=Math.max(0,Math.min(1-green,shield/scale));
      const participants=this.snapshot?.visibleBattle?.participants||[];
      const rivalIndex=participants.filter(id=>id!==this.view.scoutId).indexOf(unit.ownerId);
      const teamColor=unit.own?'#74e6a9':(['#ff766a','#f4df70','#ffa34b'][Math.max(0,rivalIndex)]||'#ff947d');
      ctx.fillStyle = teamColor; ctx.fillRect(bx, baseY, barWidth*green, 5);
      if (white>0) {ctx.fillStyle='#f1f9ff';ctx.fillRect(bx+barWidth*green,baseY,barWidth*white,5);}
      if (shield>Math.max(0,scale-unit.hp)) {
        ctx.fillStyle='#f1f9ff';ctx.fillRect(bx,baseY-2,barWidth,1);
      }
      ctx.fillStyle='#06121bcf';
      for (let hp=150;hp<scale;hp+=150) ctx.fillRect(bx+barWidth*hp/scale-.65,baseY,1.3,5);
      if (unit.psychicImbuement && unit.psychicImbuement.until > (this.snapshot?.visibleBattle?.elapsed || 0)) {
        const life = unit.psychicImbuement.until - (this.snapshot?.visibleBattle?.elapsed || 0);
        ctx.save();ctx.globalAlpha=.28+.12*Math.sin(time*7);ctx.strokeStyle='#e99fe8';ctx.lineWidth=2;
        ctx.beginPath();ctx.ellipse(p.x,p.y-this.cellScale*.28,radius*1.33,radius*1.8,0,0,PI2);ctx.stroke();
        for(let i=0;i<4;i++) {const angle=i*PI2/4+time*1.7;ctx.fillStyle='#eea7ed';ctx.beginPath();ctx.arc(p.x+Math.cos(angle)*radius*1.3,p.y-this.cellScale*.35+Math.sin(angle)*radius*.9,2.2,0,PI2);ctx.fill();}
        ctx.restore();
      }
      if (unit.poison || (unit.synergy?.poisoned && unit.synergy.poisoned.until>(this.snapshot?.visibleBattle?.elapsed||0))) {
        ctx.fillStyle = '#b76de4'; ctx.beginPath(); ctx.arc(bx + barWidth + 4, baseY + 2, 3.1, 0, PI2); ctx.fill();
      }
      if(unit.synergy?.chilled && unit.synergy.chilled.until>(this.snapshot?.visibleBattle?.elapsed||0)){ctx.fillStyle='#b3f1ff';ctx.fillRect(bx+barWidth+2,baseY-6,4,4);}
      ctx.fillStyle = '#132a31c9'; ctx.fillRect(bx, baseY + 7, barWidth, 3);
      ctx.fillStyle = '#80ccfa'; ctx.fillRect(bx, baseY + 7, barWidth * Math.min(1, unit.energy / unit.required), 3);
      if(unit.babyFlee){ctx.fillStyle='#ffe9bd';ctx.font=`800 ${Math.max(9,this.cellScale*.12)}px sans-serif`;ctx.textAlign='center';ctx.fillText('FUGINDO',p.x,baseY-4);}

      const statuses = [
        ...(unit.buffs || []).map(b => `${b.stat.toUpperCase()}↑ ${Math.ceil(b.until-(this.snapshot?.visibleBattle?.elapsed || 0))}s`),
        ...(unit.defenseShreds || []).map(b => `DEF↓ ${Math.ceil(b.until-(this.snapshot?.visibleBattle?.elapsed || 0))}s`),
        ...((unit.guardUntil || 0) > (this.snapshot?.visibleBattle?.elapsed || 0) ? [`GUARDA ${Math.ceil(unit.guardUntil!-(this.snapshot?.visibleBattle?.elapsed || 0))}s`] : []),
        ...(unit.barriers?.length ? ['BARREIRA'] : []),
        ...(unit.psychicImbuement ? ['PSÍQUICO'] : []),
        ...((unit.attackSpeedDebuffUntil || 0) > (this.snapshot?.visibleBattle?.elapsed || 0) ? ['LENTIDÃO -15%'] : [])
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
    const lerp = 1 - Math.exp(-Math.max(0,dt)*17);
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
      const eased=progress*progress*(3-2*progress);
      const x = from.x + (to.x - from.x) * eased;
      const y = from.y - 20 + (to.y - from.y + 20) * eased - Math.sin(progress * Math.PI) * this.cellScale * .8;
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
      const current=watched.units.find(u=>u.id===event.unitId);
      const pos = positionOf(this.pendingMove.get(event.unitId)?.position || current?.position || event.pokemon.position);
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
      const elapsed=this.visualEvents.age(event,now),arrival=1.03,flight=Math.min(1,Math.max(0,elapsed/arrival));
      const origin=this.toScreen(0,0),ctx=this.context;
      // Present one impact corresponding to the authoritative HP change already resolved by the engine.
      ctx.save();
      if(elapsed<arrival){
        const bend=Math.sin(flight*Math.PI)*this.cellScale*.58;
        const x=origin.x+(p.x-origin.x)*flight;
        const y=origin.y+(p.y-origin.y)*flight-bend;
        ctx.fillStyle='#fff5cc';ctx.strokeStyle='#ff9b73';ctx.shadowColor='#ff7440';ctx.shadowBlur=15;
        ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y-this.cellScale*.48,Math.max(3,this.cellScale*.075),0,PI2);ctx.fill();ctx.stroke();
      }else{
        const blast=Math.min(1,(elapsed-arrival)/.48);
        ctx.globalAlpha=1-blast;ctx.strokeStyle='#ffcb89';ctx.fillStyle='#ffad3f2b';ctx.shadowColor='#ff8b4b';ctx.shadowBlur=20;
        ctx.lineWidth=3*(1-blast)+1;ctx.beginPath();ctx.arc(p.x,p.y-this.cellScale*.48,this.cellScale*(.18+.56*blast),0,PI2);ctx.fill();ctx.stroke();
        renderFloatingNumber(ctx,p.x,p.y-this.cellScale*.65,event.value,Math.min(1,blast),'trainer');
      }
      ctx.restore();
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
    this.drawTerrain(this.frame);
    this.drawSacredTile(this.frame);
    this.drawMimePillars(this.frame);
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
    this.drawCapacityOnGround();
    this.spriteParts.clear();
    const markers = this.markers();
    const battle = this.snapshot?.visibleBattle;
    const intro = this.snapshot?.phase === 'combat' && battle && !battle.resolved && battle.introElapsed < 1.5;
    const enemyIntroOrder = this.enemyIntroOrder;
    const visualEvents = this.unitEventLookup;
    const drawMarkers = this.renderMarkers;
    drawMarkers.length = 0;
    for (const marker of markers) {
      if (this.view.dragging && marker.sourceId === this.view.dragId) continue;
      if (intro && !marker.bench && marker.ownerId !== this.view.scoutId) {
        const enemyIndex = enemyIntroOrder?.get(marker.id) ?? -1;
        if (battle!.introElapsed + this.renderLead < .77 + (enemyIndex % 7) * .06 + Math.floor(enemyIndex / 7) * .13) continue;
      }
      const animation = visualEvents.get(`${marker.ownerId}:${marker.sourceId}`);
      const age = animation ? this.visualEvents.age(animation, timestamp) : 99;
      if (animation?.kind === 'summon' && age < .75 || animation?.kind === 'evolve' && age < 1.12) continue;
      drawMarkers.push(marker);
    }
    drawMarkers.sort((a, b) => a.y - b.y);
    this.drawVines(this.frame);
    for (const marker of drawMarkers) this.drawUnit(marker, this.frame);
    this.drawAbsorptions(this.frame);
    if(battle&&this.snapshot?.phase!=='planning')this.drawObstacles(battle,this.frame);
    this.drawUnitVisuals(timestamp);
    if (intro) this.drawArrival(battle!);
    this.drawCoins();
    this.drawLoot(this.frame);
    if (this.snapshot?.phase !== 'planning' && this.snapshot?.visibleBattle && this.snapshot.observedId === this.view.scoutId) {
      renderCombatEffects(this.context, this.snapshot.visibleBattle.effects,
        this.snapshot.visibleBattle.participants.length === 2 && this.snapshot.visibleBattle.playerB === this.view.scoutId,
        (x, y) => this.toScreen(x, y), this.cellScale, this.frame,
        fx => this.effectTimeline.time(fx, this.renderLead),
        fx => fx.sourceId?this.spriteParts.get(fx.sourceId):undefined);
    }
    if (battle && this.snapshot?.phase !== 'planning') this.drawBattleTrainers(dt, this.frame, battle);
    else this.drawTrainers(dt, this.frame);
    if (battle && this.snapshot?.phase !== 'planning') this.drawTrainerDamage(timestamp, battle);
    // Adaptive backing resolution: changes only after sustained heavy frames.
    // Canvas UI dimensions, Pokémon positions and art assets remain unchanged.
    const renderMs = performance.now() - frameStarted;
    this.profiler.frame(timestamp, renderMs, markers.length, battle?.effects.length || 0, this.renderScale);
    this.onDrawFrame?.(timestamp);
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
