/** Cached arena floor: the field, its stone surround and its organic grass share a world projection. */
function grain(seed: number): number {
  let n = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  n ^= n >>> 16;
  n = Math.imul(n, 2246822519) >>> 0;
  return (n >>> 0) / 4294967295;
}

export function paintArenaBackground(
  ctx: CanvasRenderingContext2D, w: number, h: number,
  quad: boolean, arenaHalf: number, quadOffset: number,
  toScreen: (x: number, y: number) => { x: number; y: number }
): void {
  // A low-contrast backdrop lets the board read as one raised island, rather than a green rectangle.
  const backdrop = ctx.createRadialGradient(w * .5, h * .43, h * .05, w * .5, h * .5, Math.max(w, h) * .78);
  backdrop.addColorStop(0, '#294d40');
  backdrop.addColorStop(.52, '#16352f');
  backdrop.addColorStop(1, '#081d20');
  ctx.fillStyle = backdrop;
  ctx.fillRect(0, 0, w, h);

  const a = toScreen(-arenaHalf - (quad ? quadOffset : 0), -3.95);
  const b = toScreen(arenaHalf + (quad ? quadOffset : 0), 3.95);
  const left = a.x, top = a.y, fieldW = b.x - left, fieldH = b.y - top;
  const edge = Math.max(8, Math.min(20, fieldH * .036));

  // The terraces beneath the grass use the same palette as the wooden bench and item shelf.
  ctx.save();
  ctx.shadowColor = '#04140fd6';
  ctx.shadowBlur = edge * 1.65;
  ctx.shadowOffsetY = edge * .65;
  ctx.fillStyle = '#0a211d';
  ctx.beginPath();
  ctx.roundRect(left - edge - 5, top - edge - 7, fieldW + 2 * edge + 10, fieldH + 2 * edge + 14, 19);
  ctx.fill();
  ctx.restore();

  const rim = ctx.createLinearGradient(left, top - edge, left, top + fieldH + edge);
  rim.addColorStop(0, '#a48e61');
  rim.addColorStop(.13, '#766b4b');
  rim.addColorStop(.51, '#485747');
  rim.addColorStop(.88, '#756847');
  rim.addColorStop(1, '#322c25');
  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.roundRect(left - edge, top - edge, fieldW + edge * 2, fieldH + edge * 2, 16);
  ctx.fill();

  ctx.strokeStyle = '#dbce9a66';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.roundRect(left - edge + 4, top - edge + 4, fieldW + edge * 2 - 8, fieldH + edge * 2 - 8, 12);
  ctx.stroke();

  // Small stone seams give the frame scale without outlining every battle hex.
  ctx.strokeStyle = '#213c35a6';
  ctx.lineWidth = 1;
  const joints = Math.max(10, Math.round(fieldW / 62));
  for (let i = 1; i < joints; i++) {
    const x = left + fieldW * i / joints;
    ctx.beginPath();
    ctx.moveTo(x, top - edge + 3);
    ctx.lineTo(x + 3, top - 3);
    ctx.moveTo(x - 2, top + fieldH + 3);
    ctx.lineTo(x + 2, top + fieldH + edge - 4);
    ctx.stroke();
  }

  const grass = ctx.createLinearGradient(left, top, left + fieldW * .17, top + fieldH);
  grass.addColorStop(0, '#326b44');
  grass.addColorStop(.24, '#3f8752');
  grass.addColorStop(.55, '#438a50');
  grass.addColorStop(.78, '#4a9254');
  grass.addColorStop(1, '#2f6943');
  ctx.fillStyle = grass;
  ctx.beginPath();
  ctx.roundRect(left, top, fieldW, fieldH, 7);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(left + 1, top + 1, fieldW - 2, fieldH - 2, 6);
  ctx.clip();

  // Broad, irregular lawn patches are muted; detail becomes visible when the player zooms in.
  for (let i = 0; i < (quad ? 130 : 88); i++) {
    const x = left + grain(i * 29 + 13) * fieldW;
    const y = top + grain(i * 41 + 73) * fieldH;
    const rx = fieldW * (.022 + grain(i * 53 + 7) * .055);
    const ry = fieldH * (.018 + grain(i * 67 + 11) * .047);
    ctx.fillStyle = i % 3 === 0 ? '#a6c8790b' : i % 3 === 1 ? '#153f2e12' : '#d4e99c09';
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, grain(i * 83 + 3) * .5, 0, Math.PI * 2);
    ctx.fill();
  }

  // A gentle opposing-half tint distinguishes teams without painting a conspicuous red stripe.
  ctx.fillStyle = '#a05f4b0b';
  ctx.fillRect(left, top, fieldW, fieldH * .5);
  ctx.fillStyle = '#d0e89e07';
  ctx.fillRect(left, top + fieldH * .5, fieldW, fieldH * .5);

  const tuftScale = Math.max(1.4, Math.min(4.8, fieldH / 150));
  const tuftCount = quad ? 1750 : 1080;
  for (let i = 0; i < tuftCount; i++) {
    const x = left + grain(i * 193 + 27) * fieldW;
    const y = top + grain(i * 379 + 97) * fieldH;
    const height = tuftScale * (.48 + grain(i * 79 + 5) * 1.1);
    const sway = (grain(i * 131 + 59) - .5) * tuftScale * 1.35;
    ctx.strokeStyle = i % 5 === 0 ? '#163c2b4d' : i % 3 === 0 ? '#acd58b40' : '#82b86b30';
    ctx.lineWidth = i % 7 === 0 ? 1.15 : .75;
    ctx.beginPath();
    ctx.moveTo(x - sway * .3, y + height * .35);
    ctx.quadraticCurveTo(x - sway * .15, y - height * .25, x + sway, y - height);
    if (i % 4 === 0) {
      ctx.moveTo(x, y + height * .2);
      ctx.lineTo(x - sway - tuftScale * .32, y - height * .58);
    }
    ctx.stroke();
  }

  // Tiny wildflowers on the border, never in the play area where silhouettes must stay clear.
  for (let i = 0; i < (quad ? 52 : 32); i++) {
    const x = left + grain(i * 167 + 9) * fieldW;
    const nearTop = i % 2 === 0;
    const y = nearTop ? top + 5 + grain(i * 61 + 2) * 14 : top + fieldH - 5 - grain(i * 61 + 2) * 14;
    ctx.fillStyle = i % 4 === 0 ? '#e7dcad65' : '#b3d9a668';
    ctx.beginPath();
    ctx.arc(x, y, .7 + grain(i * 23 + 1) * 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Recessed inner lip and a fine, unobtrusive halfway line.
  ctx.strokeStyle = '#d9efad73';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(left + 3, top + 3, fieldW - 6, fieldH - 6, 5);
  ctx.stroke();
  ctx.strokeStyle = '#183e2c85';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(left + 6, top + fieldH / 2 + 2);
  ctx.lineTo(left + fieldW - 6, top + fieldH / 2 + 2);
  ctx.stroke();
  ctx.strokeStyle = '#cce4aa68';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(left + 6, top + fieldH / 2);
  ctx.lineTo(left + fieldW - 6, top + fieldH / 2);
  ctx.stroke();

  if (quad) {
    // Two complete seven-column boards share a seam rather than overlapping frames.
    const middle = toScreen(0, 0);
    ctx.strokeStyle = '#263e32';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(middle.x, top + 4);
    ctx.lineTo(middle.x, top + fieldH - 4);
    ctx.stroke();
    ctx.strokeStyle = '#c9ba845e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(middle.x, top + 5);
    ctx.lineTo(middle.x, top + fieldH - 5);
    ctx.stroke();
  }
}
