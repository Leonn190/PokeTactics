/** Lê AnimData.xml reais do checkout original; jamais baixa spritesheets. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
const reference = process.argv.find(a => a.startsWith('--repo='))?.slice(7);
const destination = join(root, 'src/client/pmd-manifest.json');
const manifest = JSON.parse(readFileSync(destination, 'utf8'));
const ids = [10, 11, 12, 13, 14, 15, 109, 110, 143];
function source(path) {
  if (existsSync(join(root, path))) return readFileSync(join(root, path), 'utf8');
  if (reference) return execFileSync('git', ['show', `HEAD:${path}`], { cwd: reference, encoding: 'utf8' });
  throw new Error(`${path} não existe. Execute no checkout com sprites ou use --repo=<checkout original>.`);
}
function existsInRepo(path) {
  if (existsSync(join(root, path))) return true;
  return reference && !!execFileSync('git', ['ls-tree', '--name-only', 'HEAD', path], { cwd: reference, encoding: 'utf8' }).trim();
}
const field = (block, tag) => new RegExp(`<${tag}>([^<]+)</${tag}>`).exec(block)?.[1];
for (const id of ids) {
  const folder = `public/sprite/${String(id).padStart(4, '0')}`;
  const xml = source(`${folder}/AnimData.xml`);
  const raw = Object.fromEntries([...xml.matchAll(/<Anim>([\s\S]*?)<\/Anim>/g)].map(([, block]) => [field(block, 'Name'), {
    copy: field(block, 'CopyOf'), width: Number(field(block, 'FrameWidth')),
    height: Number(field(block, 'FrameHeight')), hitFrame: Number(field(block, 'HitFrame')),
    durations: [...block.matchAll(/<Duration>(\d+)<\/Duration>/g)].map(m => Number(m[1]))
  }]));
  const resolveAnim = (name, visiting = new Set()) => {
    if (visiting.has(name)) throw new Error(`CopyOf circular: ${id}/${name}`);
    const entry = raw[name];
    if (!entry) throw new Error(`CopyOf inválido: ${id}/${name}`);
    if (!entry.copy) return { ...entry, fileName: name };
    return resolveAnim(entry.copy, new Set([...visiting, name]));
  };
  const animations = {};
  for (const name of Object.keys(raw)) {
    const a = resolveAnim(name);
    if (!a.width || !a.height || !a.durations.length) continue;
    const file = `${a.fileName}-Anim.png`;
    if (!existsInRepo(`${folder}/${file}`)) continue;
    animations[name] = { file, width: a.width, height: a.height, durations: a.durations,
      directions: name === 'Sleep' ? 1 : 8, ...(a.hitFrame ? { hitFrame: a.hitFrame } : {}) };
  }
  if (!animations.Idle || !animations.Attack) throw new Error(`Animações básicas ausentes para ${id}`);
  manifest[String(id)] = animations;
  console.log(`${id}: ${Object.keys(animations).join(', ')}`);
}
writeFileSync(destination, JSON.stringify(manifest, null, 2) + '\n');
