/** Source-of-truth snapshots. Unmodified files are exported byte-for-byte. */
const rawModules = import.meta.glob('../../../config/*.json', { eager:true, query:'?raw', import:'default' }) as Record<string,string>;
export type PathPart=string|number;
export type SourceFile=string;
const originalRaw:Record<string,string>={};
for(const [source,text] of Object.entries(rawModules)) originalRaw[source.split('/').at(-1)!]=text;
const readJSON=(text:string):any=>JSON.parse(text);
const clone=<T>(obj:T):T=>structuredClone(obj);
const original:Record<string,any>=Object.fromEntries(Object.entries(originalRaw).map(([name,text])=>[name,readJSON(text)]));
let active:Record<string,any>=clone(original);
const at=(root:any,path:PathPart[])=>path.reduce((v,k)=>v?.[k],root);
export const filenames=()=>Object.keys(active).sort((a,b)=>a.localeCompare(b,'pt-BR'));
export const documentOf=(name:string):any=>active[name];
export const originalOf=(name:string):any=>original[name];
export const valueOf=(file:string,path:PathPart[]):any=>at(active[file],path);
export const originalValue=(file:string,path:PathPart[]):any=>at(original[file],path);
export function setValue(file:string,path:PathPart[],value:unknown):void {
 if(!(file in active)||!path.length)throw Error('Caminho inválido');
 const container=at(active[file],path.slice(0,-1));
 if(container==null || !(path.at(-1)! in container))throw Error('Campo inexistente');
 container[path.at(-1)!]=value;
}
export function setSeveral(file:string,entries:Array<{path:PathPart[];value:unknown}>):void {for(const entry of entries)setValue(file,entry.path,entry.value);}
export function changedFiles():string[]{return filenames().filter(file=>JSON.stringify(original[file])!==JSON.stringify(active[file]));}
export type Change={file:string;path:PathPart[];before:unknown;after:unknown};
export function modifications():Change[]{
 const changes:Change[]=[];
 const inspect=(file:string,a:any,b:any,path:PathPart[])=>{
  if(Object.is(a,b))return;
  if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b)){
   changes.push({file,path,before:a,after:b});return;
  }
  for(const key of Object.keys(b))inspect(file,a[key],b[key],path.concat(Array.isArray(b)?Number(key):key));
 };
 for(const file of filenames())inspect(file,original[file],active[file],[]);
 return changes;
}
export function restore(file?:string):void {
 if(file){active[file]=clone(original[file]);return;}
 active=clone(original);
}
export function restorePrefix(file:string,prefix:PathPart[]):void {
 if(!prefix.length){restore(file);return;}
 setValue(file,prefix,clone(originalValue(file,prefix)));
}
export function outputJSON(file:string):string {
 return changedFiles().includes(file) ? JSON.stringify(active[file],null,2)+'\n' : originalRaw[file];
}
export function validate():string[]{
 const errors:string[]=[];
 const visit=(file:string,obj:any,path:PathPart[])=>{
  if(typeof obj==='number'){
   const prev=originalValue(file,path);
   if(!Number.isFinite(obj))errors.push(`${file}: ${path.join('.')} não é finito`);
   else if(Number.isInteger(prev)&&!Number.isInteger(obj))errors.push(`${file}: ${path.join('.')} exige número inteiro`);
   else if(prev>=0 && obj<0)errors.push(`${file}: ${path.join('.')} não permite negativo`);
  }else if(obj&&typeof obj==='object')for(const [key,value] of Object.entries(obj))visit(file,value,[...path,Array.isArray(obj)?Number(key):key]);
 };
 for(const file of filenames())visit(file,active[file],[]);
 const odds=active['regras_gerais.json']?.shopOddsByLevel;
 if(odds)for(const [level,weights] of Object.entries(odds)){
  const values=Object.values(weights as Record<string,number>);
  if(values.some(v=>typeof v!=='number'||v<0||v>100)||Math.abs(values.reduce((x,y)=>x+y,0)-100)>.001)
   errors.push(`Loja: probabilidades do nível ${level} precisam somar 100%`);
 }
 const sizes=active['pokemons.json']?.species||{};
 for(const [key,species] of Object.entries(sizes)){
  const s=species as {physicalSizes?:number[];evolutionCopies?:number[]};
  if(s.physicalSizes?.some(n=>!Number.isFinite(n)||n<.5||n>1.8))errors.push(`${key}: tamanho físico fora de 0,5–1,8`);
  if(s.evolutionCopies?.some(n=>!Number.isInteger(n)||n<2||n>15))errors.push(`${key}: cópias para evolução fora de 2–15`);
 }
 return errors;
}
