import { displayName, gridXY, SPECIES } from '../../server/data';
import type { CombatEffect, CombatUnit, Family, GameSnapshot, Pokemon, UnitPosition } from '../../server/types';

export interface ClientView {
  scoutId: string;
  selectedId: string | null;
  dragId: string | null;
  dragX: number;
  dragY: number;
  hoveringHex: { col: number; row: number } | null;
}

type Marker = { id: string; x: number; y: number; family: Family; stage: number; own: boolean; level: number; hp: number; maxHp: number; energy: number; required: number; flash: number };
const PI2 = Math.PI * 2;

export class Arena {
  private context: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private pixelRatio = 1;
  private zoom = 1;
  private trainer = { x: -4.75, y: 3.57 };
  private trainerTarget = { x: -4.75, y: 3.57 };
  private visualPositions = new Map<string, { x: number; y: number }>();
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
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.round(rect.width * this.pixelRatio);
    this.canvas.height = Math.round(rect.height * this.pixelRatio);
  }

  private get origin() { return { x: this.width / 2 - (this.width > 1200 ? 23 : 0), y: (this.height - 230) / 2 + 37 }; }
  private get cellScale() { return (this.width < 1000 ? 62 : 70) * this.zoom; }

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
  zoomAt(delta: number): void { this.zoom = Math.max(.72, Math.min(1.38, this.zoom + (delta > 0 ? -.09 : .09))); }
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
  pickOwnUnit(clientX: number, clientY: number): string | null {
    if (!this.snapshot || this.snapshot.phase !== 'planning' || this.view.scoutId !== 'p0') return null;
    const player = this.snapshot.players[0];
    const world = this.pointerWorld(clientX, clientY);
    for (const unit of player.units) {
      if (unit.position.area !== 'board') continue;
      const p = gridXY(unit.position.col, unit.position.row + 4);
      if (Math.hypot(p.x - world.x, p.y - world.y) < .44) return unit.id;
    }
    return null;
  }

  private shape(x: number, y: number, family: Family, radius: number, stage: number, enemy = false): void {
    const ctx = this.context;
    const data = SPECIES[family];
    ctx.save(); ctx.translate(x, y);
    ctx.shadowBlur = radius * 1.3; ctx.shadowColor = enemy ? '#f36c7b' : data.glow;
    ctx.fillStyle = data.color; ctx.strokeStyle = enemy ? '#fc9686' : '#edffea'; ctx.lineWidth = Math.max(1.2, radius / 11);
    ctx.beginPath();
    if (data.shape === 'circle') ctx.arc(0, 0, radius, 0, PI2);
    else if (data.shape === 'square') ctx.roundRect(-radius * .84, -radius * .84, radius * 1.68, radius * 1.68, radius * .16);
    else if (data.shape === 'triangle') { ctx.moveTo(0, -radius * 1.12); ctx.lineTo(radius * 1.06, radius * .88); ctx.lineTo(-radius * 1.06, radius * .88); ctx.closePath(); }
    else { ctx.moveTo(0, -radius * 1.12); ctx.lineTo(radius, -radius * .15); ctx.lineTo(radius * .72, radius * .8); ctx.lineTo(0, radius * 1.17); ctx.lineTo(-radius * .72, radius * .8); ctx.lineTo(-radius, -radius * .15); ctx.closePath(); }
    ctx.fill(); ctx.shadowBlur = 0; ctx.stroke();
    ctx.globalAlpha = .35; ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(-radius * .25, -radius * .3, radius * .26, radius * .14, -.7, 0, PI2); ctx.fill(); ctx.globalAlpha = 1;
    if (stage) {
      ctx.strokeStyle = stage === 1 ? '#ebd4a3' : '#f7cd7c'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, radius + 7, 0, PI2); ctx.stroke();
      if (stage >= 2) { ctx.beginPath(); ctx.arc(0, 0, radius + 11, -Math.PI * .8, Math.PI * .2); ctx.stroke(); }
    }
    ctx.restore();
  }

  private background(time: number): void {
    const ctx = this.context, w = this.width, h = this.height;
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, '#111c26'); gradient.addColorStop(.38, '#18353a'); gradient.addColorStop(.72, '#19363b'); gradient.addColorStop(1, '#0e1a25');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h);
    const center = this.toScreen(0, 0);
    const flare = ctx.createRadialGradient(center.x, center.y, 16, center.x, center.y, Math.min(w, 850) * .75);
    flare.addColorStop(0, '#44716b4c'); flare.addColorStop(.65, '#152d3560'); flare.addColorStop(1, '#08121b00');
    ctx.fillStyle = flare; ctx.fillRect(0, 0, w, h);
    // Ambient flora and motes are entirely procedural. public/ intentionally has no art assets.
    for (let i = 0; i < 68; i++) {
      const nx = ((i * 173 + 43) % 1000) / 1000;
      const ny = ((i * 379 + 97) % 997) / 997;
      const x = nx * w, y = 80 + ny * (h - 90);
      const size = 1 + i % 4;
      const glow = (Math.sin(time * .8 + i * 2.4) + 1) / 2;
      ctx.fillStyle = i % 3 ? `rgba(111,184,155,${.055 + glow * .14})` : `rgba(225,187,119,${.05 + glow * .12})`;
      ctx.beginPath(); ctx.arc(x + Math.sin(time * .4 + i) * 5, y + Math.cos(time * .55 + i) * 5, size * .6, 0, PI2); ctx.fill();
    }
    for (let i = 0; i < 25; i++) {
      const x = ((i * 269 + 71) % 1019) / 1019 * w;
      const y = ((i * 149 + 131) % 991) / 991 * h;
      if (x > w * .23 && x < w * .78 && y > h * .17 && y < h * .78) continue;
      ctx.strokeStyle = 'rgba(93,173,145,.13)'; ctx.lineWidth = 1.2;
      for (let leaf = -1; leaf <= 1; leaf++) {
        ctx.beginPath(); ctx.moveTo(x, y + 12); ctx.quadraticCurveTo(x + leaf * 8 + Math.sin(time + i) * 3, y - 4, x + leaf * 14, y - 10); ctx.stroke();
      }
    }
  }

  private hexGrid(time: number): void {
    const ctx = this.context;
    const scale = this.cellScale;
    const isEditable = this.snapshot?.phase === 'planning' && this.view.scoutId === 'p0';
    for (let row = 0; row < 8; row++) for (let col = 0; col < 7; col++) {
      const p = gridXY(col, row), screen = this.toScreen(p.x, p.y);
      const own = row >= 4;
      const selected = own && this.view.dragId && this.view.hoveringHex?.col === col && this.view.hoveringHex?.row === row - 4;
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
    // Bright dividing path separating the two sides of the fight.
    const left = this.toScreen(-4.05, 0), right = this.toScreen(4.05, 0);
    const glimmer = ctx.createLinearGradient(left.x, 0, right.x, 0);
    glimmer.addColorStop(0, '#c9d8b500'); glimmer.addColorStop(.5, `rgba(202,203,146,${.25 + .08 * Math.sin(time * 2)})`); glimmer.addColorStop(1, '#c9d8b500');
    ctx.beginPath(); ctx.moveTo(left.x, left.y); ctx.lineTo(right.x, right.y); ctx.strokeStyle = glimmer; ctx.lineWidth = 2; ctx.stroke();
    if (isEditable) {
      ctx.font = `600 12px Inter,sans-serif`; ctx.textAlign = 'center';
      ctx.fillStyle = '#92c4ae9a'; ctx.fillText('SUA ARENA', this.origin.x, this.toScreen(0, 4.08).y);
    }
  }

  private markers(): Marker[] {
    const snapshot = this.snapshot;
    if (!snapshot) return [];
    if (snapshot.phase !== 'planning' && snapshot.visibleBattle) {
      return snapshot.visibleBattle.units.filter(u => u.hp > 0).map(u => {
        const smooth = this.visualPositions.get(u.id) || { x: u.x, y: u.y };
        smooth.x += (u.x - smooth.x) * .27;
        smooth.y += (u.y - smooth.y) * .27;
        this.visualPositions.set(u.id, smooth);
        return { ...u, x: smooth.x, y: smooth.y, own: u.playerId === 'p0', required: u.energyNeeded };
      });
    }
    const friendly = snapshot.players.find(p => p.id === this.view.scoutId) || snapshot.players[0];
    const other = snapshot.players.find(p => p.id === (this.view.scoutId === 'p0' ? snapshot.opponentId : 'p0')) || snapshot.players[1];
    const convert = (units: Pokemon[], own: boolean): Marker[] => units.filter(u => u.position.area === 'board').map(u => {
      const pos = u.position as Extract<UnitPosition, { area: 'board' }>;
      const row = own ? 4 + pos.row : 3 - pos.row;
      const p = gridXY(pos.col, row);
      return { id: u.id, x: p.x, y: p.y, family: u.family, stage: u.stage,
        level: u.level, own, hp: 1, maxHp: 1, energy: 0, required: SPECIES[u.family].energy, flash: 0 };
    });
    return [...convert(other.units, false), ...convert(friendly.units, true)];
  }

  private drawUnit(unit: Marker, time: number): void {
    const ctx = this.context;
    const p = this.toScreen(unit.x, unit.y);
    const radius = this.cellScale * .265 * (1 + unit.stage * .1);
    const float = Math.sin(time * 2.6 + unit.x * 2) * 2;
    // Projected contact shadow.
    ctx.fillStyle = '#0008'; ctx.beginPath(); ctx.ellipse(p.x, p.y + radius + 5, radius * 1.17, 7, 0, 0, PI2); ctx.fill();
    if (this.view.selectedId === unit.id && this.snapshot?.phase === 'planning') {
      ctx.beginPath(); ctx.ellipse(p.x, p.y + 10, radius * 1.6, radius * .75, 0, 0, PI2);
      ctx.strokeStyle = '#eed18d'; ctx.lineWidth = 3; ctx.stroke();
    }
    if (unit.flash > 0) {
      ctx.fillStyle = '#fff4d454'; ctx.beginPath(); ctx.arc(p.x, p.y - 2, radius * 1.7, 0, PI2); ctx.fill();
    }
    this.shape(p.x, p.y - 2 + float, unit.family, radius, unit.stage, !unit.own);
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

  private effects(effects: CombatEffect[]): void {
    const ctx = this.context;
    for (const fx of effects) {
      const t = Math.max(0, Math.min(1, fx.time / fx.duration));
      const p = this.toScreen(fx.x + (fx.targetX - fx.x) * t, fx.y + (fx.targetY - fx.y) * t);
      const radius = fx.kind === 'spell' ? 12 : 6;
      ctx.save(); ctx.globalAlpha = Math.max(0, 1 - t);
      ctx.shadowBlur = 24; ctx.shadowColor = SPECIES[fx.family].glow;
      ctx.fillStyle = fx.kind === 'heal' ? '#97f3be' : fx.kind === 'ko' ? '#f1d3a9' : SPECIES[fx.family].glow;
      ctx.beginPath(); ctx.arc(p.x, p.y - 11, radius * (1 + t * .8), 0, PI2); ctx.fill();
      if (fx.value > 1 && fx.kind !== 'heal') {
        ctx.shadowBlur = 0; ctx.font = "700 13px Inter"; ctx.textAlign = 'center'; ctx.fillStyle = '#ffe7be';
        ctx.fillText(String(fx.value), p.x, p.y - 29 - t * 15);
      }
      ctx.restore();
    }
  }

  private drawTrainer(dt: number, time: number): void {
    const dx = this.trainerTarget.x - this.trainer.x, dy = this.trainerTarget.y - this.trainer.y;
    const length = Math.hypot(dx, dy);
    if (length > .015) {
      const distance = Math.min(length, dt * 2.8);
      this.trainer.x += dx / length * distance;
      this.trainer.y += dy / length * distance;
    }
    const p = this.toScreen(this.trainer.x, this.trainer.y);
    const radius = 14 * this.zoom;
    const ctx = this.context;
    ctx.beginPath(); ctx.ellipse(p.x, p.y + radius, radius + 8, 6, 0, 0, PI2); ctx.fillStyle = '#0008'; ctx.fill();
    ctx.beginPath(); ctx.arc(p.x, p.y, radius + 8 + Math.sin(time * 2.8) * 2, 0, PI2);
    ctx.strokeStyle = '#d9c48a60'; ctx.lineWidth = 2; ctx.stroke();
    ctx.shadowColor = '#8cd7d2'; ctx.shadowBlur = 24;
    ctx.beginPath(); ctx.arc(p.x, p.y + Math.sin(time * 3) * 2, radius, 0, PI2);
    ctx.fillStyle = '#d9f4ea'; ctx.fill(); ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.arc(p.x - 3, p.y - 2, 1.8, 0, PI2); ctx.arc(p.x + 3, p.y - 2, 1.8, 0, PI2); ctx.fillStyle = '#233d47'; ctx.fill();
    ctx.textAlign = 'center'; ctx.font = "700 11px 'Barlow Condensed'"; ctx.fillStyle = '#f6df9e'; ctx.fillText('VOCÊ', p.x, p.y - radius - 18);
  }

  private draw(timestamp: number): void {
    const ctx = this.context;
    const dt = Math.min(.05, (timestamp - this.lastFrame) / 1000 || 0);
    this.lastFrame = timestamp; this.frame += dt;
    ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    this.background(this.frame);
    this.hexGrid(this.frame);
    const markers = this.markers();
    markers.sort((a, b) => a.y - b.y).forEach(marker => this.drawUnit(marker, this.frame));
    if (this.snapshot?.phase !== 'planning' && this.snapshot?.visibleBattle) this.effects(this.snapshot.visibleBattle.effects);
    this.drawTrainer(dt, this.frame);
    requestAnimationFrame(time => this.draw(time));
  }
}
