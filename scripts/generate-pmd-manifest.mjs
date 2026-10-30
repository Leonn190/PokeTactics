/** V18.9: process only local PMD assets; do not download, alter, or recode artist sheets.
 * Run from the ORIGINAL repository checkout before the Astro build.
 * Shadow and Offsets PNGs contain positioning markers, NOT display textures.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';
const root = resolve(import.meta.dirname, '..');
const reference = process.argv.find(a => a.startsWith('--repo='))?.slice(7);
const skipMissing = process.argv.includes('--skip-missing');
const target = join(root, 'src/client/pmd-manifest.json');
const old = JSON.parse(readFileSync(target, 'utf8'));
const pokemon = JSON.parse(readFileSync(join(root, 'config/pokemons.json'), 'utf8'));
const ids = [...new Set(Object.values(pokemon.species).flatMap(species => species.pokedexIds))];
const permitted = new Set(ids.map(String));
// Old manifests must not restore deleted species (or obsolete stages).
const output = Object.fromEntries(Object.entries(old).filter(([id]) => permitted.has(id)));
function has(path) {
  if (existsSync(join(root, path))) return true;
  if (!reference) return false;
  try { return !!execFileSync('git', ['ls-tree', '--name-only', 'HEAD', '--', path], { cwd: reference, encoding: 'utf8' }).trim(); }
  catch { return false; }
}
function read(path) {
  if (existsSync(join(root, path))) return readFileSync(join(root, path));
  if (!reference) throw Error(`Arquivo não encontrado: ${path}`);
  return execFileSync('git', ['show', `HEAD:${path}`], { cwd: reference });
}
const field = (block, tag) => new RegExp(`<${tag}>([^<]+)</${tag}>`).exec(block)?.[1];
function png(path) {
  // Decode only common 8-bit PMD PNG modes (RGBA/RGB/palette/gray). Fail closed.
  const b = read(path);
  if (b.subarray(0,8).toString('hex') !== '89504e470d0a1a0a') return null;
  let width=0,height=0,depth=0,mode=0,palette=null,alpha=null,interlace=0;
  const idats=[];
  for(let at=8;at<b.length;) {
    const len=b.readUInt32BE(at), tag=b.toString('ascii',at+4,at+8), part=b.subarray(at+8,at+8+len); at+=len+12;
    if(tag==='IHDR'){width=part.readUInt32BE(0);height=part.readUInt32BE(4);depth=part[8];mode=part[9];interlace=part[12];}
    if(tag==='PLTE')palette=part;
    if(tag==='tRNS')alpha=part;
    if(tag==='IDAT')idats.push(part);
    if(tag==='IEND')break;
  }
  const channels=({0:1,2:3,3:1,4:2,6:4})[mode];
  if(!channels || depth!==8 || interlace!==0 || !width || !height || width*height>30_000_000) return null;
  const stride=width*channels, decoded=inflateSync(Buffer.concat(idats)), rgb=new Uint8Array(width*height*4);
  let p=0,above=new Uint8Array(stride);
  for(let y=0;y<height;y++) {
    const filter=decoded[p++],line=new Uint8Array(stride);
    for(let i=0;i<stride;i++) {
      const a=i>=channels?line[i-channels]:0,c=above[i],ul=i>=channels?above[i-channels]:0;
      let predictor=0;
      if(filter===1)predictor=a;
      else if(filter===2)predictor=c;
      else if(filter===3)predictor=(a+c)>>1;
      else if(filter===4){const t=a+c-ul,da=Math.abs(t-a),dc=Math.abs(t-c),du=Math.abs(t-ul);predictor=da<=dc&&da<=du?a:dc<=du?c:ul;}
      else if(filter!==0) return null;
      line[i]=(decoded[p++]+predictor)&255;
    }
    for(let x=0;x<width;x++) {
      const i=x*channels, j=(y*width+x)*4;
      if(mode===3){const k=line[i];rgb[j]=palette?.[k*3]??0;rgb[j+1]=palette?.[k*3+1]??0;rgb[j+2]=palette?.[k*3+2]??0;rgb[j+3]=alpha?.[k]??255;}
      else if(mode===0||mode===4){rgb[j]=rgb[j+1]=rgb[j+2]=line[i];rgb[j+3]=mode===4?line[i+1]:255;}
      else {rgb[j]=line[i];rgb[j+1]=line[i+1];rgb[j+2]=line[i+2];rgb[j+3]=mode===6?line[i+3]:255;}
    }
    above=line;
  }
  return {width,height,rgba:rgb};
}
function markers(file,fw,fh,dirs,frames,kind) {
  if(!has(file))return undefined;
  try {
    const im=png(file);if(!im || im.width<fw*frames || im.height<fh*dirs) return undefined;
    const arr=[];
    for(let d=0;d<dirs;d++) {
      const row=[];
      for(let f=0;f<frames;f++) {
        const points={};
        for(let y=0;y<fh;y++)for(let x=0;x<fw;x++) {
          const off=((d*fh+y)*im.width+f*fw+x)*4;
          const r=im.rgba[off],g=im.rgba[off+1],b=im.rgba[off+2],a=im.rgba[off+3];
          if(a<100)continue;
          if(kind==='shadow') {
            if(r>210 && g>210 && b>210) points.ground=[x,y];
            else if(b>180 && r<150 && g<150) points.size=3;
            else if(r>180 && g<150 && b<150) points.size=Math.max(points.size??0,2);
            else if(g>180 && r<150 && b<150) points.size=Math.max(points.size??0,1);
          } else {
            if(g>180 && r<150 && b<150)points.body=[x,y];
            else if(r>180 && g<150 && b<150)points.leftHand=[x,y];
            else if(b>180 && r<150 && g<150)points.rightHand=[x,y];
            else if(r<65 && g<65 && b<65)points.head=[x,y];
            // Combined marker colors intentionally fall back to frame/body anchor.
          }
        }
        if(kind==='shadow') {
          const ground=points.ground||[-1,-1];
          row.push(Object.keys(points).length?[...ground,points.size??-1]:null);
        } else {
          const coord=name=>points[name]||[-1,-1];
          row.push(Object.keys(points).length?[...coord('body'),...coord('head'),...coord('leftHand'),...coord('rightHand')]:null);
        }
      }
      arr.push(row);
    }
    return arr;
  } catch(e) { console.warn(`PMD metadata skipped (${file}): ${e.message}`); return undefined; }
}
let generated=0, unavailable=0;
for(const id of ids) {
  const folder=`public/sprite/${String(id).padStart(4,'0')}`;
  if(!has(`${folder}/AnimData.xml`)) {unavailable++;if(!skipMissing)throw Error(`${folder}/AnimData.xml missing`);continue;}
  const xml=read(`${folder}/AnimData.xml`).toString('utf8');
  const shadowSize=Number(field(xml,'ShadowSize')||1);
  const raw=Object.fromEntries([...xml.matchAll(/<Anim>([\s\S]*?)<\/Anim>/g)].map(([,block])=>[
    field(block,'Name'),{copy:field(block,'CopyOf'), width:Number(field(block,'FrameWidth')),
      height:Number(field(block,'FrameHeight')),hitFrame:field(block,'HitFrame'),
      rushFrame:field(block,'RushFrame'),returnFrame:field(block,'ReturnFrame'),
      durations:[...block.matchAll(/<Duration>(\d+)<\/Duration>/g)].map(m=>Number(m[1]))}
  ]));
  function resolveName(name,seen=new Set()) {
    if(seen.has(name)||!raw[name])throw Error(`Invalid PMD alias: ${id}/${name}`);
    if(!raw[name].copy)return { ...raw[name],source:name };
    return resolveName(raw[name].copy,new Set([...seen,name]));
  }
  const animations={};
  for(const name of Object.keys(raw)) {
    const a=resolveName(name);
    if(!a.width||!a.height||!a.durations.length)continue;
    const file=`${a.source}-Anim.png`;
    if(!has(`${folder}/${file}`))continue;
    const pngHeader=read(`${folder}/${file}`);
    const rows=pngHeader.subarray(0,8).toString('hex')==='89504e470d0a1a0a' && pngHeader.length>=24
      ? Math.floor(pngHeader.readUInt32BE(20)/a.height) : 8;
    const dirs=rows===1?1:8;
    const shadow=markers(`${folder}/${a.source}-Shadow.png`,a.width,a.height,dirs,a.durations.length,'shadow');
    const offsets=markers(`${folder}/${a.source}-Offsets.png`,a.width,a.height,dirs,a.durations.length,'offset');
    animations[name]={file,width:a.width,height:a.height,durations:a.durations,directions:dirs,
      ...(a.source!==name?{aliasOf:a.source}:{}),
      ...(a.hitFrame!==undefined?{hitFrame:Number(a.hitFrame)}:{}),
      ...(a.rushFrame!==undefined?{rushFrame:Number(a.rushFrame)}:{}),
      ...(a.returnFrame!==undefined?{returnFrame:Number(a.returnFrame)}:{}),
      ...(Number.isFinite(shadowSize)?{shadowSize}:{}),
      ...(shadow?{shadowMarkers:shadow}:{}),...(offsets?{bodyMarkers:offsets}:{})};
  }
  if(!animations.Idle) {console.warn(`PMD ${id}: missing Idle, retaining prior entry`);continue;}
  output[String(id)]=animations;generated++;
}
writeFileSync(target,JSON.stringify(output)+'\n');
console.log(`V18.9 PMD: ${generated} generated, ${unavailable} missing assets, ${Object.keys(output).length} manifest entries`);
