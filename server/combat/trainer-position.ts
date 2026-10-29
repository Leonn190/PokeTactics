/** Posições compartilhadas com os avatares do canvas. */
export function trainerSpot(slot: number, quad: boolean): { x: number; y: number } {
  if (!quad) return slot === 0 ? { x: -4.78, y: 3.52 } : { x: 4.82, y: -3.52 };
  return [
    { x: -9.12, y: 3.53 }, { x: -9.12, y: -3.53 },
    { x: 9.12, y: -3.53 }, { x: 9.12, y: 3.53 }
  ][slot] || { x: 0, y: 0 };
}

