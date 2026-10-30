/** Optional cleanup of DEX-exclusive artwork when run in the original checkout.
 * DRY RUN by default. Never touch shared effects, type icons, animations or textures.
 * Usage: node scripts/prune-v18-9-assets.mjs [--apply]
 */
import { lstatSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
const root=resolve(import.meta.dirname,'..');
const apply=process.argv.includes('--apply');
const removed=[243,244,245,249,250,251];
const allow=[];
for(const dex of removed){
 const id=String(dex).padStart(4,'0');
 allow.push(`public/sprites/${dex}.png`,`public/sprites/${id}.png`,
   `public/portrait/${id}`,`public/sprite/${id}`);
}
let found=0;
for(const relative of allow){
 const path=join(root,relative);
 if(!existsSync(path))continue;
 const stat=lstatSync(path);
 if(stat.isSymbolicLink()){console.warn(`SKIP symlink ${relative}`);continue;}
 const real=realpathSync(path),publicDir=join(root,'public')+sep;
 if(!real.startsWith(publicDir))throw Error(`Unsafe path: ${relative}`);
 found++;console.log(`${apply?'REMOVE':'WOULD REMOVE'}: ${relative}`);
 if(apply)rmSync(path,{recursive:stat.isDirectory(),force:false});
}
console.log(`${found} DEX-exclusive paths ${apply?'removed':'found (dry run)'}; preserved Pokémon and shared art untouched.`);
