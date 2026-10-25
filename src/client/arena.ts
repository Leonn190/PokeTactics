import { displayName, gridXY, SPECIES } from '../../server/data';
import type { CombatEffect, CombatUnit, Family, GameSnapshot, Pokemon, UnitPosition } from '../../server/types';
import pmdManifest from './pmd-manifest.json';

export interface ClientView {
  scoutId: string;
  selectedId: string | null;
  dragId: string | null;
  dragX: number;
  dragY: number;
  hoveringHex: { col: number; row: number } | null;
  hoveringBench: number | null;
}

type Marker = { id: string; x: number; y: number; family: Family; stage: number; own: boolean; level: number; hp: number; maxHp: number; energy: number; required: number; flash: number; bench?: boolean; moving?: boolean; facingX?: number; facingY?: number; animation?: CombatUnit['animation'] };
type PmdSheet = { file: string; width: number; height: number; durations: number[]; directions: number };
type PmdEntry = Record<string, PmdSheet>;
const PMD = pmdManifest as Record<string, PmdEntry>;
const PI2 = Math.PI * 2;
const BENCH_Y = 4.49;
const benchXY = (index: number, enemy = false) => ({ x: -5.17 + index * 1.15, y: enemy ? -BENCH_Y : BENCH_Y });
const TRAINER_COLORS = ['#d9f4ea', '#dd9fd0', '#82c4e5', '#b1b3ff', '#f5bc89', '#c3e7a4', '#a9dfdc', '#eeadab'];

export class Arena {
  private context: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private pixelRatio = 1;
  private zoom = 1;
  private cameraOffset = { x: 0, y: 0 };
  private trainer = { x: -4.75, y: 3.57 };
  private trainerTarget = { x: -4.75, y: 3.57 };
  private visualPositions = new Map<string, { x: number; y: number }>();
  private spriteCache = new Map<string, HTMLImageElement>();
  private lastBattleId = '';
  private lastFrame = 0;
  private frame = 0;
  snapshot: GameSnapshot | null = null;
  view: ClientView;

  constructor(private canvas: HTMLCanvasElement, view: ClientView) {
    this.context = canvas.getContext('2d', { alpha: false })!;
    this.view = view;
    window.addEventListener('resize', () => this.resize());
    this.resize();
    requestAnimationFrame(time => this.draw(time));
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    // A dense canvas on a Retina screen easily becomes the rendering bottleneck.
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.round(rect.width * this.pixelRatio);
    this.canvas.height = Math.round(rect.height * this.pixelRatio);
  }

  private get origin() { return { x: this.width / 2 - (this.width > 1200 ? 23 : 0) + this.cameraOffset.x, y: (this.height - 104) / 2 + this.cameraOffset.y }; }
  private get cellScale() { return Math.min(this.width < 1000 ? 61 : 70, Math.max(35, (this.height - 310) / 9.4)) * this.zoom; }

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
  moveTrainer(clientX: number, clientY: number): void {
    const dest = this.pointerWorld(clientX, clientY);
    this.trainerTarget = { x: Math.max(-6.2, Math.min(6.2, dest.x)), y: Math.max(-4.4, Math.min(4.65, dest.y)) };
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
    if (Math.abs(world.y - BENCH_Y) > .47) return null;
    for (let index = 0; index < 10; index++) {
      if (Math.abs(world.x - benchXY(index).x) < .53) return index;
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

  private image(url: string): HTMLImageElement {
    let sprite = this.spriteCache.get(url);
    if (!sprite) {
      sprite = new Image(); sprite.src = url; this.spriteCache.set(url, sprite);
    }
    return sprite;
  }

  private direction(x: number, y: number): number {
    // PMD: 0 frente, 2 direita, 4 costas, 6 esquerda; diagonais intermediárias.
    return (Math.round(Math.atan2(x, y) / (Math.PI / 4)) + 8) % 8;
  }

  private drawPokemonSprite(x: number, y: number, unit: Marker, time: number): void {
    const ctx = this.context;
    const id = SPECIES[unit.family].pokedexIds[Math.min(unit.stage, SPECIES[unit.family].pokedexIds.length - 1)];
    const anims = PMD[String(id)];
    if (anims) {
      const action = unit.bench ? 'Sleep' : this.snapshot?.phase === 'planning' ? 'Idle'
        : unit.animation?.name || (unit.moving ? 'Walk' : 'Idle');
      const animation = anims[action] || anims.Idle;
      const url = `${import.meta.env.BASE_URL}pmd/${String(id).padStart(4, '0')}/${animation.file}`;
      const sprite = this.image(url);
      if (sprite.complete && sprite.naturalWidth) {
        const durations = animation.durations;
        const totalTicks = durations.reduce((sum, n) => sum + n, 0);
        const active = unit.animation && !unit.bench && this.snapshot?.phase !== 'planning' && action === unit.animation.name;
        const elapsedTicks = active && action !== 'Withdraw'
          ? Math.min(totalTicks - .001, (unit.animation!.elapsed / unit.animation!.duration) * totalTicks)
          : (time * 60 + ((unit.id.charCodeAt(unit.id.length - 1) || 0) % 13) * 2) % totalTicks;
        let tick = elapsedTicks, frame = 0;
        while (frame < durations.length - 1 && tick >= durations[frame]) tick -= durations[frame++];
        const flipped = this.snapshot?.phase !== 'planning' && this.snapshot?.visibleBattle?.participants.length === 2 && this.snapshot.visibleBattle.playerB === this.view.scoutId;
        const dir = action === 'Rotate' || this.snapshot?.phase === 'planning' || unit.bench ? 0
          : this.direction(unit.facingX || 0, flipped ? -(unit.facingY || 0) : (unit.facingY || 0));
        const row = animation.directions === 1 ? 0 : dir % animation.directions;
        // Tamanho baseado em pixels dos próprios sprites; sem formas geométricas.
        const sizeScale = this.cellScale / 48 * (unit.bench ? .83 : 1.13);
        const w = animation.width * sizeScale, h = animation.height * sizeScale;
        ctx.save(); ctx.imageSmoothingEnabled = false;
        ctx.drawImage(sprite, frame * animation.width, row * animation.height,
          animation.width, animation.height, Math.round(x - w / 2), Math.round(y - h * .72), w, h);
        ctx.restore();
        return;
      }
    }
    // Lendários ainda não receberam sheets PMD; continuam como PNGs, sem figuras coloridas.
    const path = SPECIES[unit.family].sprites[Math.min(unit.stage, SPECIES[unit.family].sprites.length - 1)];
    const staticSprite = this.image(`${import.meta.env.BASE_URL}${path.replace(/^\.\//, '')}`);
    if (staticSprite.complete && staticSprite.naturalWidth) {
      const size = this.cellScale * (unit.bench ? .67 : 1.03);
      ctx.save(); ctx.imageSmoothingEnabled = false;
      ctx.drawImage(staticSprite, x - size / 2, y - size * .85, size, size); ctx.restore();
    }
  }

  private background(time: number): void {
    const ctx = this.context, w = this.width, h = this.height;
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, '#1e4834'); gradient.addColorStop(.38, '#316e3a'); gradient.addColorStop(.72, '#285c34'); gradient.addColorStop(1, '#112e24');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h);
    const bounds = [this.toScreen(-4.25, -3.9), this.toScreen(4.25, 3.95)];
    const left = bounds[0].x, top = bounds[0].y, fieldW = bounds[1].x - left, fieldH = bounds[1].y - top;
    ctx.fillStyle = '#112d22'; ctx.fillRect(left - 10, top - 10, fieldW + 20, fieldH + 20);
    const field = ctx.createLinearGradient(left, top, left, top + fieldH);
    field.addColorStop(0, '#356a48'); field.addColorStop(.48, '#397748'); field.addColorStop(.52, '#438752'); field.addColorStop(1, '#336f3c');
    ctx.fillStyle = field; ctx.fillRect(left, top, fieldW, fieldH);
    // O território fica legível mesmo quando as casas estão ocultas.
    ctx.fillStyle = '#ad4f4a12'; ctx.fillRect(left, top, fieldW, fieldH / 2);
    ctx.fillStyle = '#7aff8b09'; ctx.fillRect(left, top + fieldH / 2, fieldW, fieldH / 2);
    // Alternating mowing bands and tiny deterministic grass flecks; no permanent hex outlines.
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = i % 2 ? '#214f3029' : '#b4e6870b';
      ctx.fillRect(left, top + fieldH * i / 10, fieldW, fieldH / 10);
    }
    ctx.save(); ctx.beginPath(); ctx.rect(left, top, fieldW, fieldH); ctx.clip();
    for (let i = 0; i < 480; i++) {
      const x = left + ((i * 173 + 43) % 997) / 997 * fieldW;
      const y = top + ((i * 379 + 97) % 991) / 991 * fieldH;
      ctx.strokeStyle = i % 3 ? '#bee7a61f' : '#183e2638'; ctx.lineWidth = .7;
      ctx.beginPath(); ctx.moveTo(x, y + 2); ctx.lineTo(x + (i % 3) - 1, y - 2); ctx.stroke();
    }
    ctx.restore();
    const quad = this.snapshot?.stageType === 'quad' && this.snapshot.phase !== 'planning' && (this.snapshot.visibleBattle?.participants.length || 0) > 2;
    ctx.strokeStyle = '#e5e2ae60'; ctx.lineWidth = 2;
    ctx.strokeRect(left + 5, top + 5, fieldW - 10, fieldH - 10);
    // Linha central acompanha as coordenadas do tabuleiro, não o centro visual da tela.
    const middle = this.toScreen(0, 0);
    if (quad) {
      const sectors = [
        { x: left, y: top, tint: '#c3a28a16' }, { x: middle.x, y: top, tint: '#acd9ca0f' },
        { x: left, y: middle.y, tint: '#c8d7a017' }, { x: middle.x, y: middle.y, tint: '#b1cfde10' }
      ];
      sectors.forEach(sector => { ctx.fillStyle = sector.tint; ctx.fillRect(sector.x, sector.y, fieldW / 2, fieldH / 2); });
      ctx.strokeStyle = '#dce6afad'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(middle.x, top + 5); ctx.lineTo(middle.x, top + fieldH - 5); ctx.moveTo(left + 5, middle.y); ctx.lineTo(left + fieldW - 5, middle.y); ctx.stroke();
      const battle = this.snapshot?.visibleBattle;
      if (battle) battle.participants.forEach((id, index) => {
        const label = this.snapshot?.players.find(p => p.id === id)?.name || id;
        const sector = sectors[index]; if (!sector) return;
        ctx.textAlign = 'center'; ctx.font = `800 ${Math.max(10, this.cellScale * .19)}px 'Barlow Condensed'`;
        ctx.fillStyle = '#f5ecd2b8'; ctx.fillText(label, sector.x + fieldW / 4, sector.y + (index < 2 ? 25 : fieldH / 2 - 18));
      });
    } else {
      ctx.strokeStyle = '#f6e5b681'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(left + 4, middle.y); ctx.lineTo(left + fieldW - 4, middle.y); ctx.stroke();
      ctx.fillStyle = '#e5eacf9c'; ctx.textAlign = 'center'; ctx.font = `800 ${Math.max(10, this.cellScale * .18)}px 'Barlow Condensed'`;
      ctx.fillText('ADVERSÁRIO', middle.x, top + 20);
      ctx.fillText('SUA EQUIPE', middle.x, top + fieldH - 12);
    }
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
    if (isEditable) {
      ctx.font = `600 12px Inter,sans-serif`; ctx.textAlign = 'center';
      ctx.fillStyle = '#92c4ae9a'; ctx.fillText('SUA ARENA', this.origin.x, this.toScreen(0, 4.08).y);
    }
  }

  private drawBench(enemy = false): void {
    const ctx = this.context;
    const left = this.toScreen(-5.76, (enemy ? -BENCH_Y : BENCH_Y) - .53);
    const right = this.toScreen(5.75, (enemy ? -BENCH_Y : BENCH_Y) + .53);
    const slab = ctx.createLinearGradient(left.x, left.y, left.x, right.y);
    slab.addColorStop(0, '#667877'); slab.addColorStop(.53, '#405753'); slab.addColorStop(1, '#273b3d');
    ctx.fillStyle = slab; ctx.strokeStyle = enemy ? '#be8b85' : '#d1d1a8'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(left.x, left.y, right.x - left.x, right.y - left.y, 9); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#263a3c83'; ctx.lineWidth = 1;
    for (let i = 1; i < 10; i++) { const x = left.x + (right.x - left.x) * i / 10; ctx.beginPath(); ctx.moveTo(x, left.y); ctx.lineTo(x, right.y); ctx.stroke(); }
    for (let index = 0; index < 10; index++) {
      const { x, y } = benchXY(index, enemy), p = this.toScreen(x, y);
      const radiusX = this.cellScale * .51, radiusY = this.cellScale * .39;
      const selected = !enemy && this.view.hoveringBench === index && !!this.view.dragId;
      ctx.beginPath(); ctx.roundRect(p.x - radiusX, p.y - radiusY, radiusX * 2, radiusY * 2, 5);
      ctx.fillStyle = selected ? '#8ebfa5b8' : index % 2 ? '#3a535099' : '#344744ab';
      ctx.strokeStyle = selected ? '#f2d59d' : '#b6c2aa4b'; ctx.lineWidth = selected ? 2 : 1;
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#75939199'; ctx.font = "700 10px 'Barlow Condensed'";
      ctx.textAlign = 'left'; ctx.fillText(String(index + 1), p.x - radiusX + 5, p.y - radiusY + 12);
    }
    ctx.fillStyle = '#edf0d2a8'; ctx.font = `800 11px 'Barlow Condensed'`; ctx.textAlign = 'center';
    ctx.fillText(enemy ? 'BANCO ADVERSÁRIO' : 'SEU BANCO', (left.x + right.x) / 2, enemy ? right.y + 14 : left.y - 8);
  }

  private markers(): Marker[] {
    const snapshot = this.snapshot;
    if (!snapshot) return [];
    const watched = snapshot.players.find(p => p.id === this.view.scoutId) || snapshot.players[0];
    const bench = watched.units.filter(u => u.position.area === 'bench').map(u => {
      const p = benchXY((u.position as Extract<UnitPosition, { area: 'bench' }>).index);
      return { id: u.id, x: p.x, y: p.y, family: u.family, stage: u.stage, level: u.level,
        own: true, hp: 1, maxHp: 1, energy: 0, required: SPECIES[u.family].energy, flash: 0, bench: true } as Marker;
    });
    const foeId = snapshot.visibleBattle?.participants.find(id => id !== this.view.scoutId) || null;
    const foePlayer = snapshot.players.find(p => p.id === foeId);
    const enemyBenchUnits = foePlayer ? foePlayer.units.filter(u => u.position.area === 'bench') : foeId ? snapshot.visibleBattle?.benches[foeId] || [] : [];
    const foeBench = enemyBenchUnits.map(u => {
      const p = benchXY((u.position as Extract<UnitPosition, { area: 'bench' }>).index, true);
      return { id: u.id, x: p.x, y: p.y, family: u.family, stage: u.stage, level: u.level,
        own: false, hp: 1, maxHp: 1, energy: 0, required: SPECIES[u.family].energy, flash: 0, bench: true } as Marker;
    });
    if (snapshot.phase !== 'planning' && snapshot.visibleBattle && snapshot.observedId === this.view.scoutId) {
      if (this.lastBattleId !== snapshot.visibleBattle.id) {
        this.visualPositions.clear(); this.lastBattleId = snapshot.visibleBattle.id;
      }
      const observedOnTop = snapshot.visibleBattle.participants.length === 2 && snapshot.visibleBattle.playerB === this.view.scoutId;
      const battleMarkers = snapshot.visibleBattle.units.filter(u => u.hp > 0).map(u => {
        const smooth = this.visualPositions.get(u.id) || { x: u.x, y: u.y };
        smooth.x += (u.x - smooth.x) * .27;
        smooth.y += (u.y - smooth.y) * .27;
        this.visualPositions.set(u.id, smooth);
        return { ...u, x: smooth.x, y: observedOnTop ? -smooth.y : smooth.y,
          own: u.playerId === this.view.scoutId, required: u.energyNeeded };
      });
      return [...battleMarkers, ...bench, ...foeBench];
    }
    const friendly = watched;
    const convert = (units: Pokemon[], own: boolean): Marker[] => units.filter(u => u.position.area === 'board').map(u => {
      const pos = u.position as Extract<UnitPosition, { area: 'board' }>;
      const row = own ? 4 + pos.row : 3 - pos.row;
      const p = gridXY(pos.col, row);
      return { id: u.id, x: p.x, y: p.y, family: u.family, stage: u.stage,
        level: u.level, own, hp: 1, maxHp: 1, energy: 0, required: SPECIES[u.family].energy, flash: 0 };
    });
    // Nunca vazar a formação do próximo rival durante a preparação.
    return [...convert(friendly.units, true), ...bench];
  }

  pickCoin(clientX: number, clientY: number): string | null {
    const battle = this.snapshot?.visibleBattle;
    if (!battle || (this.snapshot?.phase !== 'combat' && this.snapshot?.phase !== 'result') || this.view.scoutId !== 'p0') return null;
    const world = this.pointerWorld(clientX, clientY);
    const flip = battle.participants.length === 2 && battle.playerB === 'p0';
    return battle.goldDrops.find(d => d.ownerId === 'p0' && !d.claimed && Math.hypot(world.x - d.x, world.y - (flip ? -d.y : d.y)) < .38)?.id || null;
  }

  private drawCoins(): void {
    const battle = this.snapshot?.visibleBattle;
    if (!battle || this.snapshot?.phase === 'planning') return;
    const flip = battle.participants.length === 2 && battle.playerB === this.view.scoutId;
    for (const coin of battle.goldDrops) {
      if (coin.claimed) continue;
      const p = this.toScreen(coin.x, flip ? -coin.y : coin.y);
      const ctx = this.context;
      ctx.save(); ctx.shadowBlur = 16; ctx.shadowColor = '#ffd77d';
      ctx.fillStyle = '#e6b74a'; ctx.strokeStyle = '#fff0a2'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y - 10, 10, 0, PI2); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0; ctx.font = '800 14px Inter'; ctx.fillStyle = '#694b1b'; ctx.textAlign = 'center';
      ctx.fillText('1', p.x, p.y - 5); ctx.restore();
    }
  }

  private drawUnit(unit: Marker, time: number): void {
    const ctx = this.context;
    const p = this.toScreen(unit.x, unit.y);
    const radius = this.cellScale * (unit.bench ? .205 : .265) * (1 + unit.stage * .1);
    // Projected contact shadow.
    ctx.fillStyle = '#0008'; ctx.beginPath(); ctx.ellipse(p.x, p.y + radius + 5, radius * 1.17, 7, 0, 0, PI2); ctx.fill();
    if (this.view.selectedId === unit.id && this.snapshot?.phase === 'planning') {
      ctx.beginPath(); ctx.ellipse(p.x, p.y + 10, radius * 1.6, radius * .75, 0, 0, PI2);
      ctx.strokeStyle = '#eed18d'; ctx.lineWidth = 3; ctx.stroke();
    }
    if (unit.flash > 0) {
      ctx.fillStyle = '#fff4d454'; ctx.beginPath(); ctx.arc(p.x, p.y - 2, radius * 1.7, 0, PI2); ctx.fill();
    }
    this.drawPokemonSprite(p.x, p.y, unit, time);
    if (unit.bench) {
      ctx.font = `700 ${Math.max(9, this.cellScale * .14)}px 'Barlow Condensed'`;
      ctx.textAlign = 'center'; ctx.strokeStyle = '#081923'; ctx.lineWidth = 2.5;
      const name = displayName(unit.family, unit.stage);
      ctx.strokeText(name, p.x, p.y + radius + 13); ctx.fillStyle = '#e7ede8'; ctx.fillText(name, p.x, p.y + radius + 13);
      return;
    }
    const label = displayName(unit.family, unit.stage);
    ctx.font = `700 ${Math.max(10, Math.round(this.cellScale * .155))}px 'Barlow Condensed',sans-serif`;
    ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = '#0a1725';
    ctx.strokeText(label, p.x, p.y + radius + 24); ctx.fillStyle = '#e4f0e9'; ctx.fillText(label, p.x, p.y + radius + 24);
    if (this.snapshot?.phase !== 'planning') {
      const barWidth = Math.max(33, radius * 2.45);
      const bx = p.x - barWidth / 2, by = p.y - radius - 20;
      ctx.fillStyle = '#17232c'; ctx.fillRect(bx, by, barWidth, 5);
      ctx.fillStyle = unit.own ? '#79dfa7' : '#ee8d84'; ctx.fillRect(bx, by, barWidth * Math.max(0, unit.hp / unit.maxHp), 5);
      ctx.fillStyle = '#17232c'; ctx.fillRect(bx, by + 7, barWidth, 3);
      ctx.fillStyle = '#8cc6ed'; ctx.fillRect(bx, by + 7, barWidth * Math.min(1, unit.energy / unit.required), 3);
    }
    ctx.fillStyle = '#bcdad3'; ctx.font = `700 ${Math.max(8, this.cellScale * .13)}px 'Barlow Condensed'`;
    ctx.fillText(`Lv.${unit.level}`, p.x, p.y - radius - (this.snapshot?.phase === 'planning' ? 12 : 24));
  }

  private effects(effects: CombatEffect[], flipY: boolean): void {
    const ctx = this.context;
    for (const fx of effects) {
      const t = Math.max(0, Math.min(1, fx.time / fx.duration));
      const from = this.toScreen(fx.x, flipY ? -fx.y : fx.y);
      const to = this.toScreen(fx.targetX, flipY ? -fx.targetY : fx.targetY);
      if (fx.kind === 'damage') {
        // Flutua apenas sobre o Pokémon atingido. O projétil é desenhado separadamente.
        const p = to;
        const amount = Math.max(1, Math.round(fx.value));
        const size = Math.min(35, 13 + Math.sqrt(amount) * 1.8);
        const color = fx.damageType === 'physical' ? '#ffd1a0' : fx.damageType === 'special' ? '#97d0ff' : '#eab1ff';
        ctx.save(); ctx.globalAlpha = Math.min(1, (1 - t) * 1.55);
        ctx.font = `900 ${size}px 'Barlow Condensed',sans-serif`; ctx.textAlign = 'center'; ctx.lineWidth = 3.5; ctx.strokeStyle = '#122027';
        const posY = p.y - this.cellScale * .4 - 24 - t * 54;
        ctx.strokeText(String(amount), p.x, posY); ctx.fillStyle = color; ctx.fillText(String(amount), p.x, posY);
        ctx.restore(); continue;
      }
      ctx.save();
      if (fx.kind === 'pollen') {
        const fly = Math.min(1, t / .65);
        const x = from.x + (to.x - from.x) * fly;
        const y = from.y + (to.y - from.y) * fly - Math.sin(fly * Math.PI) * this.cellScale * .85;
        if (fly < 1) {
          const r = 8 + 4 * Math.sin(fly * Math.PI);
          ctx.fillStyle = '#efffa5'; ctx.shadowColor = '#baff71'; ctx.shadowBlur = 15;
          ctx.beginPath(); ctx.arc(x, y - 12, r, 0, PI2); ctx.fill();
          for (let i = 0; i < 5; i++) {
            const a = i * PI2 / 5 + fly * 3;
            ctx.fillStyle = i % 2 ? '#fff1a0' : '#a9f596';
            ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * 12, y - 12 + Math.sin(a) * 10, 3.5, 2.2, a, 0, PI2); ctx.fill();
          }
        } else {
          const q = (t - .65) / .35;
          const radius = (fx.value || 1.65) * this.cellScale * q;
          ctx.globalAlpha = (1 - q) * .62;
          ctx.fillStyle = '#b9f5a37b'; ctx.strokeStyle = '#e7ffd0'; ctx.lineWidth = 4 * (1 - q);
          ctx.beginPath(); ctx.arc(to.x, to.y - 12, radius, 0, PI2); ctx.fill(); ctx.stroke();
          for (let i = 0; i < 16; i++) {
            const a = i * 2.39996;
            const r = radius * (.3 + (i % 7) / 10);
            ctx.fillStyle = i % 3 ? '#f2fa9a' : '#99eeb8';
            ctx.beginPath(); ctx.arc(to.x + Math.cos(a) * r, to.y - 12 + Math.sin(a) * r, 2 + i % 3, 0, PI2); ctx.fill();
          }
        }
      } else if (fx.kind === 'water') {
        const radius = (fx.value || 1.7) * this.cellScale;
        ctx.strokeStyle = '#a8edff'; ctx.lineWidth = 3.5; ctx.globalAlpha = .7 * (1 - t);
        for (let ring = 0; ring < 2; ring++) {
          ctx.beginPath(); ctx.ellipse(from.x, from.y - 9, radius * (.48 + t * .55 + ring * .14), radius * (.23 + t * .22 + ring * .08),
            0, ring * Math.PI / 2 + t * 5, ring * Math.PI / 2 + t * 5 + Math.PI * 1.45); ctx.stroke();
        }
        for (let i = 0; i < 12; i++) {
          const a = i * PI2 / 12 + this.frame * 7;
          const r = radius * (.43 + .29 * Math.sin(i * 3 + t * 6));
          ctx.fillStyle = i % 2 ? '#d2ffff' : '#66c8fa';
          ctx.beginPath(); ctx.arc(from.x + Math.cos(a) * r, from.y - 10 + Math.sin(a) * r * .47,
            2.8 + 2 * Math.sin(t * Math.PI), 0, PI2); ctx.fill();
        }
      } else if (fx.kind === 'lightning') {
        const endX = from.x + (to.x - from.x) * Math.min(1, t * 3);
        const endY = from.y + (to.y - from.y) * Math.min(1, t * 3);
        ctx.strokeStyle = '#fff7af'; ctx.lineWidth = 4; ctx.shadowColor = '#f8d53c'; ctx.shadowBlur = 18;
        ctx.globalAlpha = 1 - Math.max(0, t - .5) * 2;
        const dx = endX - from.x, dy = endY - from.y, len = Math.hypot(dx, dy) || 1;
        ctx.beginPath(); ctx.moveTo(from.x, from.y - 13);
        for (let i = 1; i < 9; i++) {
          const f = i / 9, spread = ((i * 17 + fx.id.length * 7) % 7 - 3) * 3;
          ctx.lineTo(from.x + dx * f + (-dy / len) * spread, from.y + dy * f - 13 + (dx / len) * spread);
        }
        ctx.lineTo(endX, endY - 13); ctx.stroke();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
      } else if (fx.kind === 'flame') {
        const x = from.x + (to.x - from.x) * Math.min(1, t * 2.7);
        const y = from.y + (to.y - from.y) * Math.min(1, t * 2.7);
        ctx.globalAlpha = 1 - t; ctx.shadowColor = '#ff681e'; ctx.shadowBlur = 14;
        for (let i = 0; i < 9; i++) {
          const a = i * 2.4 + fx.id.length;
          const r = (7 + 25 * t) * (.4 + i / 11);
          ctx.fillStyle = i % 3 ? '#ff8e33' : '#fff3a8';
          ctx.beginPath(); ctx.arc(x + Math.cos(a) * r, y - 11 + Math.sin(a) * r - t * 16, 3 + (i % 3) * 2, 0, PI2); ctx.fill();
        }
      } else if (fx.kind === 'seed') {
        const x = from.x + (to.x - from.x) * t;
        const y = from.y + (to.y - from.y) * t - 12 - 19 * Math.sin(t * Math.PI);
        ctx.fillStyle = '#d6e790'; ctx.shadowColor = '#74bc5d'; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.ellipse(x, y, 8, 5, Math.atan2(to.y - from.y, to.x - from.x), 0, PI2); ctx.fill();
        ctx.strokeStyle = '#529c58'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x - 6, y); ctx.lineTo(x + 6, y); ctx.stroke();
      } else if (fx.kind === 'heal') {
        ctx.globalAlpha = 1 - t; ctx.strokeStyle = '#8af5b1'; ctx.lineWidth = 2.8;
        ctx.beginPath(); ctx.ellipse(to.x, to.y - 16, 10 + t * 26, 5 + t * 15, 0, 0, PI2); ctx.stroke();
        for (let i = 0; i < 6; i++) {
          const a = i * PI2 / 6 + t * 1.8;
          ctx.fillStyle = '#c5ffd6'; ctx.fillRect(to.x + Math.cos(a) * (8 + t * 26) - 2, to.y - 20 + Math.sin(a) * (6 + t * 16) - 2, 4, 4);
        }
      } else if (fx.kind === 'physical') {
        ctx.globalAlpha = 1 - t; ctx.strokeStyle = '#fff6d5'; ctx.lineWidth = 4.5; ctx.shadowColor = '#ffc078'; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.arc(to.x, to.y - 16, 8 + t * 18, -.95, .9); ctx.stroke();
      } else {
        const x = from.x + (to.x - from.x) * t, y = from.y + (to.y - from.y) * t;
        ctx.globalAlpha = 1 - t; ctx.shadowBlur = 20; ctx.shadowColor = SPECIES[fx.family].glow;
        ctx.fillStyle = fx.kind === 'ko' ? '#f1d3a9' : SPECIES[fx.family].glow;
        ctx.beginPath(); ctx.arc(x, y - 11, (fx.kind === 'spell' ? 12 : 6) * (1 + t * .8), 0, PI2); ctx.fill();
      }
      ctx.restore();
    }
  }

  private drawTrainerAvatar(playerId: string, x: number, y: number, time: number, label: string): void {
    const index = Math.max(0, Math.min(7, Number(playerId.slice(1)) || 0));
    const color = TRAINER_COLORS[index];
    const ctx = this.context;
    const p = this.toScreen(x, y);
    const radius = 14 * this.zoom;
    ctx.save();
    ctx.beginPath(); ctx.ellipse(p.x, p.y + radius, radius + 8, 6, 0, 0, PI2); ctx.fillStyle = '#0008'; ctx.fill();
    ctx.beginPath(); ctx.arc(p.x, p.y, radius + 8 + Math.sin(time * 2.8 + index) * 2, 0, PI2);
    ctx.strokeStyle = `${color}70`; ctx.lineWidth = 2; ctx.stroke();
    ctx.shadowColor = color; ctx.shadowBlur = 16;
    ctx.beginPath(); ctx.arc(p.x, p.y + Math.sin(time * 3 + index) * 2, radius, 0, PI2);
    ctx.fillStyle = color; ctx.fill(); ctx.shadowBlur = 0;
    if (index) {
      // Each CPU owns a recognizable little tactician, not a copy of the player's circle.
      ctx.fillStyle = color; ctx.strokeStyle = '#30444c'; ctx.lineWidth = 2;
      const ear = (index % 3 + 1) * 3;
      ctx.beginPath(); ctx.moveTo(p.x - radius * .75, p.y - radius * .55); ctx.lineTo(p.x - radius * .85, p.y - radius - ear);
      ctx.lineTo(p.x - radius * .15, p.y - radius * .76); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(p.x + radius * .75, p.y - radius * .55); ctx.lineTo(p.x + radius * .85, p.y - radius - ear);
      ctx.lineTo(p.x + radius * .15, p.y - radius * .76); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#263c44'; ctx.fillRect(p.x - 4, p.y + radius * .4, 8, 2);
    }
    ctx.beginPath(); ctx.arc(p.x - 3, p.y - 2, 1.8, 0, PI2); ctx.arc(p.x + 3, p.y - 2, 1.8, 0, PI2); ctx.fillStyle = '#233d47'; ctx.fill();
    ctx.textAlign = 'center'; ctx.font = "700 11px 'Barlow Condensed'";
    ctx.fillStyle = '#f6df9e'; ctx.fillText(label, p.x, p.y - radius - 20);
    ctx.restore();
  }

  private drawTrainers(dt: number, time: number): void {
    const dx = this.trainerTarget.x - this.trainer.x, dy = this.trainerTarget.y - this.trainer.y;
    const length = Math.hypot(dx, dy);
    if (length > .015) {
      const distance = Math.min(length, dt * 2.8);
      this.trainer.x += dx / length * distance;
      this.trainer.y += dy / length * distance;
    }
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

  private draw(timestamp: number): void {
    const ctx = this.context;
    const dt = Math.min(.05, (timestamp - this.lastFrame) / 1000 || 0);
    this.lastFrame = timestamp; this.frame += dt;
    ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    this.background(this.frame);
    this.hexGrid(this.frame);
    this.drawBench();
    if (this.snapshot?.phase !== 'planning' && this.snapshot?.visibleBattle && this.snapshot.observedId === this.view.scoutId) this.drawBench(true);
    const markers = this.markers();
    markers.sort((a, b) => a.y - b.y).forEach(marker => this.drawUnit(marker, this.frame));
    this.drawCoins();
    if (this.snapshot?.phase !== 'planning' && this.snapshot?.visibleBattle && this.snapshot.observedId === this.view.scoutId) {
      this.effects(this.snapshot.visibleBattle.effects, this.snapshot.visibleBattle.participants.length === 2 && this.snapshot.visibleBattle.playerB === this.view.scoutId);
    }
    this.drawTrainers(dt, this.frame);
    requestAnimationFrame(time => this.draw(time));
  }
}
