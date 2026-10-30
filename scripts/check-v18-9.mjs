/** Independent, offline V18.9 data invariants. Run with: node scripts/check-v18-9.mjs */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
const root=resolve(import.meta.dirname,'..');
const json=file=>JSON.parse(readFileSync(join(root,file),'utf8'));
const sp=json('config/pokemons.json');
const species=sp.species, profiles=json('config/animacoes.json').visualProfiles;
const manifest=json('src/client/pmd-manifest.json');
const forbidden=['raikou','entei','suicune','lugia','ho-oh','celebi'];
const noRemove=new Set(['articuno','zapdos','moltres','mewtwo','mew']);
for(const name of forbidden) {
  assert.ok(!species[name],`deleted species still present: ${name}`);
  assert.ok(!sp.sprites[name],`deleted sprite entry still present: ${name}`);
  assert.ok(!profiles[name],`deleted animation profile still present: ${name}`);
}
for(const name of noRemove)assert.ok(species[name],`surviving legendary missing: ${name}`);
const dex=new Set(Object.values(species).flatMap(s=>s.pokedexIds.map(String)));
for(const id of Object.keys(manifest))assert.ok(dex.has(id),`orphan PMD entry ${id}`);
let stages=0;
for(const [family,entry] of Object.entries(species)) {
  assert.equal(entry.names.length,entry.pokedexIds.length,`${family} stage count`);
  assert.equal(entry.names.length,profiles[family]?.length,`${family} missing visual profile stage`);
  for(const p of profiles[family]) {
    assert.ok(p.actions?.basic && p.actions?.charged,`${family} has no independent action profiles`);
    assert.ok(p.shadow && p.launch,`${family} missing anatomy`);
  }
  stages+=entry.names.length;
}
assert.equal(Object.keys(species).length,35);
assert.equal(stages,65);
assert.equal(profiles.diglett[0].shadow.mode,'embedded');
assert.equal(profiles.diglett[1].shadow.mode,'embedded');
assert.ok(profiles.magikarp[0].actions.basic.lunge>0);
assert.ok(profiles.magikarp[0].actions.charged.hop>0);
assert.ok(profiles.magikarp[1].named.Rumble.sway>0);
assert.ok(Object.keys(manifest).length<=stages);
const sources=[];
const visit=path=>{for(const ent of readdirSync(path,{withFileTypes:true})){
  const full=join(path,ent.name);
  if(ent.isDirectory())visit(full);
  else if(/\.(json|ts|astro)$/.test(ent.name))sources.push(full);
}};
for(const dir of ['src','server','config'])visit(join(root,dir));
for(const path of sources) {
  const raw=readFileSync(path,'utf8').toLowerCase();
  for(const name of forbidden)assert.ok(!raw.includes(name),`${name} reference remains in ${path}`);
}
console.log(`PASS V18.9: ${Object.keys(species).length} families, ${stages} stages; removed 6 legendary families, 0 orphan profiles/manifest refs; ${sources.length} files scanned.`);
