/** Canonical PMD repository layout: base /NNNN, alternate /NNNN/variant. */
import { SPECIES } from '../../../server/data';
import { alternativeForm } from '../../../server/forms';
import type { Family } from '../../../server/types';

export function pmdSource(family: Family, stage: number, formId?: string): { key: string; folder: string; dex: number } {
  const ids = SPECIES[family].pokedexIds;
  const dex = ids[Math.min(Math.max(0, stage), ids.length - 1)];
  const variant = alternativeForm(family, stage, formId)?.pmdVariant;
  return {
    key: variant ? `${dex}/${variant}` : String(dex),
    folder: `${String(dex).padStart(4, '0')}${variant ? `/${variant}` : ''}`,
    dex
  };
}
