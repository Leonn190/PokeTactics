/** Prebuild-derived markers from colored PMD Offsets.png / Shadow.png.
 * Each indexed entry corresponds to a direction row and animation frame. */
export type PmdMarker={ground?:number[];size?:number;body?:number[];head?:number[];
  leftHand?:number[];rightHand?:number[]};
export type PmdSheet={file:string;width:number;height:number;durations:number[];directions:number;
  hitFrame?:number;returnFrame?:number;rushFrame?:number;aliasOf?:string;shadowSize?:number;
  shadowMarkers?:(number[]|null)[][];bodyMarkers?:(number[]|null)[][]};
export type PmdEntry=Record<string,PmdSheet>;
export function markerAt(sheet:PmdSheet,kind:'shadow'|'body',row:number,frame:number):PmdMarker | null {
  const rows=kind==='shadow'?sheet.shadowMarkers:sheet.bodyMarkers;
  const packed=rows?.[Math.max(0,Math.min(rows.length-1,row))]?.[Math.max(0,frame)];
  if(!packed)return null;
  const point=(i:number):number[]|undefined=>packed[i]>=0&&packed[i+1]>=0?[packed[i],packed[i+1]]:undefined;
  if(kind==='shadow')return {ground:point(0),size:packed[2]>=0?packed[2]:undefined};
  return {body:point(0),head:point(2),leftHand:point(4),rightHand:point(6)};
}
export function frameAt(sheet:PmdSheet,t:number):number {
  const total=sheet.durations.reduce((a,b)=>a+b,0)||1;
  let ticks=Math.min(total-.001,Math.max(0,t)*total);
  let i=0;for(;i<sheet.durations.length-1&&ticks>=sheet.durations[i];i++)ticks-=sheet.durations[i];
  return i;
}
export function impactFraction(sheet:PmdSheet):number {
  if(sheet.hitFrame===undefined)return .5;
  const count=sheet.durations.length;
  const index=Math.max(0,Math.min(count-1,sheet.hitFrame));
  const total=sheet.durations.reduce((a,b)=>a+b,0);
  return total?sheet.durations.slice(0,index).reduce((a,b)=>a+b,0)/total:.5;
}
export function sameAnimation(a:PmdSheet|undefined,b:PmdSheet|undefined):boolean {
  return !!a&&!!b&&a.file===b.file;
}
