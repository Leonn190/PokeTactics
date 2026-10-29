import type { DamagePreview } from '../../server/damage-preview';
export const damageHtml = (preview: DamagePreview): string =>
  `<span class="damage-value damage-${preview.kind}" title="Valor antes da defesa, resistência de tipo e escudos">${preview.value.toLocaleString('pt-BR')}</span>`;
export const damageRows = (values: DamagePreview[]): string =>
  values.map(item => `<span class="damage-row"><span>${item.label}:</span> ${damageHtml(item)}</span>`).join('');
