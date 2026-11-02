/** V25.6: runtime smoke checks for ability cards across the entire Pokédex.
 * Run with: npx tsx scripts/check-v25-6-tooltips.ts */
import assert from 'node:assert/strict';
import { ATTACKS, SPECIES } from '../server/data';
import { MEGA } from '../server/forms';
import { abilityScaling } from '../server/damage-preview';
import { abilityCard } from '../src/client/damage-labels';
import type { Family } from '../server/types';

function currentScaling(html: string): string {
  return html.split('<div class="ability-evolution">', 1)[0];
}

function displayedRow(html: string, label: string): string {
  const markup = currentScaling(html);
  const prefix = `<div class="ability-scaling-label">${label}</div><div class="ability-scaling-values">`;
  const start = markup.indexOf(prefix);
  assert.notEqual(start, -1, `Missing scaling row: ${label}`);
  return markup.slice(start + prefix.length).split('</div>', 1)[0];
}

const flameJet = ATTACKS.moves['flame-jet'];
assert.equal(abilityScaling(flameJet, 0, 'magby').find(row => row.label === 'Duração do jato')?.flat, flameJet.babyDuration);
assert.match(displayedRow(abilityCard('magby', 0, ''), 'Duração do jato'), />2s</);
assert.match(displayedRow(abilityCard('magmar', 0, ''), 'Duração do jato'), />3s</);

const gas = ATTACKS.moves['gas-cloud'];
const rows = abilityScaling(gas, 0, 'koffing');
assert.equal(rows.find(row => row.label === 'Bônus por segundo protegido')?.flat, gas.gasTimeRatio);
assert.ok(rows.some(row => row.label === 'Barreira'));
assert.match(displayedRow(abilityCard('koffing', 0, ''), 'Bônus por segundo protegido'), /22/);

let checked = 0;
for (const family of Object.keys(SPECIES) as Family[]) {
  for (let stage = 0; stage < SPECIES[family].names.length; stage++) {
    const html = abilityCard(family, stage, 'Verificação de habilidade');
    assert.ok(html.includes('ability-scaling') || html.includes('ability-utility-note'), `${family} stage ${stage} without ability details`);
    checked++;
  }
}
for (const form of MEGA.forms) {
  const html = abilityCard(form.family as Family, form.stage, 'Verificação de Mega', form.id);
  assert.ok(html.includes('ability-card-name'), `Mega ${form.id} without ability details`);
  checked++;
}
for (const mode of ['melee', 'ranged'] as const) {
  assert.ok(abilityCard('mewtwo', 0, '', undefined, mode).includes('ability-mode'));
  checked++;
}
console.log(`V25.6: ${checked} variantes de habilidade conferidas; Magby e Nuvem de Gás corretos.`);
