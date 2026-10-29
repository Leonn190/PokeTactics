/** Static battlefield layer, cached by Arena when zoom/camera/viewport are unchanged. */
export function paintArenaBackground(ctx: CanvasRenderingContext2D, w: number, h: number,
  quad: boolean, arenaHalf: number, quadOffset: number,
  toScreen: (x: number, y: number) => { x: number; y: number }): void {
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, '#102b29'); gradient.addColorStop(.5, '#183c2d'); gradient.addColorStop(1, '#0a231e');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h);
    const bounds = [toScreen(-arenaHalf - (quad ? quadOffset : 0), -3.95), toScreen(arenaHalf + (quad ? quadOffset : 0), 3.95)];
    const left = bounds[0].x, top = bounds[0].y, fieldW = bounds[1].x - left, fieldH = bounds[1].y - top;
    ctx.save(); ctx.shadowColor = '#030e0db0'; ctx.shadowBlur = 30;
    ctx.fillStyle = '#0d3029'; ctx.beginPath(); ctx.roundRect(left - 9, top - 9, fieldW + 18, fieldH + 18, 19); ctx.fill(); ctx.restore();
    const field = ctx.createLinearGradient(left, top, left, top + fieldH);
    field.addColorStop(0, '#2c7045'); field.addColorStop(.45, '#397b49'); field.addColorStop(.55, '#3e844d'); field.addColorStop(1, '#2b6b43');
    ctx.fillStyle = field; ctx.beginPath(); ctx.roundRect(left, top, fieldW, fieldH, 12); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.roundRect(left, top, fieldW, fieldH, 12); ctx.clip();
    // Faixas de grama cortada, fibras e iluminação sutil sem grade permanente.
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = i % 2 ? '#0e40251a' : '#a6eb7c0c';
      ctx.fillRect(left, top + fieldH * i / 12, fieldW, fieldH / 12);
    }
    ctx.fillStyle = '#d85f4911'; ctx.fillRect(left, top, fieldW, fieldH / 2);
    ctx.fillStyle = '#b6e87a09'; ctx.fillRect(left, top + fieldH / 2, fieldW, fieldH / 2);
    for (let i = 0; i < (quad ? 670 : 420); i++) {
      const x = left + ((i * 173 + 43) % 997) / 997 * fieldW;
      const y = top + ((i * 379 + 97) % 991) / 991 * fieldH;
      ctx.strokeStyle = i % 3 ? '#c1eaa01e' : '#174d2c24'; ctx.lineWidth = .7;
      ctx.beginPath(); ctx.moveTo(x, y + 2); ctx.lineTo(x + (i % 3) - 1, y - 2); ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = '#d3f0b46d'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(left + 4, top + 4, fieldW - 8, fieldH - 8, 10); ctx.stroke();
    const middle = toScreen(0, 0);
    ctx.strokeStyle = '#e5f5c67a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(left + 5, middle.y); ctx.lineTo(left + fieldW - 5, middle.y); ctx.stroke();
    if (quad) {
      // Junção das DUAS arenas completas: seam central longitudinal de 14x8.
      ctx.strokeStyle = '#def4c0ab'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(middle.x, top + 4); ctx.lineTo(middle.x, top + fieldH - 4); ctx.stroke();
      ctx.strokeStyle = '#194c3299'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(middle.x + 5, top + 5); ctx.lineTo(middle.x + 5, top + fieldH - 5); ctx.stroke();
    }
}
