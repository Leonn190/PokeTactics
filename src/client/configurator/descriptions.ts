import { documentOf, originalValue, setValue, valueOf, type PathPart } from './state';

type Entry={path:PathPart[];old:number;now:number;used:boolean};
function collect(old:any,current:any,prefix:PathPart[],items:Entry[]):void{
 if(typeof old==='number' && typeof current==='number'){
  items.push({path:prefix,old,now:current,used:false});return;
 }
 if(old && typeof old==='object' && current && typeof current==='object')
  for(const [key,value] of Object.entries(old))collect(value,current[key], [...prefix,Array.isArray(old)?Number(key):key],items);
}
const nearly=(a:number,b:number)=>Math.abs(a-b)<.00001;
function valueText(value:number,percent:boolean,old:number):string{
 const format=(n:number)=>Number(n.toFixed(3)).toLocaleString('pt-BR',{maximumFractionDigits:3});
 if(percent)return format(value*100);
 return format(value);
}
/** Maps existing numerals to *real* parameter paths; unchanged prose stays intact. */
export function liveDescription(file:'augments.json'|'itens.json',path:PathPart[]):string{
 const old=originalValue(file,path),cur=valueOf(file,path);
 if(!old || !cur)return '';
 if(JSON.stringify(old)===JSON.stringify(cur))return String(old.description||'');
 const values:Entry[]=[];
 collect(file==='augments.json'?old.params:old,file==='augments.json'?cur.params:cur,[],values);
 const text=String(old.description||'');
 if(file==='augments.json'){
  // Grammar for the singular/trailing synergy cases is explicitly data-driven.
  const params=cur.params as Record<string,any>;
  if(cur.id==='G04'||cur.id==='P08')return `Suas ${params.top} maiores sinergias ativas recebem +${params.bonus} de contagem cada.`;
  if(cur.id==='P04')return `Suas ${params.top} maiores sinergias recebem +${params.bonus} de contagem cada.`;
  if(cur.id==='S07')return `Receba ${params.components} componentes aleatórios de itens.`;
  if(cur.id==='P07')return `Receba ${params.components} componentes aleatórios e ${params.ultraball} Ultra Balls.`;
 }
 const rendered=text.replace(/(?<![\p{L}\d])(-?\d+(?:[,.]\d+)?)(\s*%)?/gu,(token,numeric:string,pct:string)=>{
  const literal=Number(numeric.replace(',','.'));
  const matching=values.filter(v=>!v.used && (nearly(v.old,literal)|| nearly(v.old*100,literal) && Math.abs(v.old)<=1));
  if(!matching.length)return token;
  // If defaults overlap, assign the one actually changed before consuming an unchanged value.
  matching.sort((a,b)=>Number(a.old===a.now)-Number(b.old===b.now));
  const picked=matching[0];picked.used=true;
  if(picked.old===picked.now)return token;
  const scaled=!!pct || (!nearly(picked.old,literal) && nearly(picked.old*100,literal));
  return valueText(picked.now,scaled,picked.old)+(pct||'');
 });
 return rendered;
}
/** Commit readable descriptions into the ZIP, so in-game cards and tooltips reflect the edited values. */
export function synchronizeDescriptions():void {
 const augments=documentOf('augments.json').augments as Array<{description:string}>;
 for(let i=0;i<augments.length;i++)setValue('augments.json',['augments',i,'description'],liveDescription('augments.json',['augments',i]));
 const recipes=documentOf('itens.json').recipes as Record<string,{description:string}>;
 for(const key of Object.keys(recipes))setValue('itens.json',['recipes',key,'description'],liveDescription('itens.json',['recipes',key]));
}
