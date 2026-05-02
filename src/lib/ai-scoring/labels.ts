import type { AiLabel } from './types';

const PRICE_TOLERANCE_PCT  = 0.01; // within 1% → same cheapest
const DURATION_TOLERANCE_MIN = 5;  // within 5 min → same fastest

interface LabelInput {
  id:              string;
  price:           number;
  durationMinutes: number;
  finalScore:      number;
}

export function assignLabels(options: LabelInput[]): Map<string, AiLabel[]> {
  const result = new Map<string, AiLabel[]>(options.map(o => [o.id, []]));
  if (!options.length) return result;

  const minPrice    = Math.min(...options.map(o => o.price));
  const minDuration = Math.min(...options.map(o => o.durationMinutes));
  const maxScore    = Math.max(...options.map(o => o.finalScore));

  for (const o of options) {
    const labels = result.get(o.id)!;
    if (o.price <= minPrice * (1 + PRICE_TOLERANCE_PCT))           labels.push('Best Price');
    if (o.durationMinutes <= minDuration + DURATION_TOLERANCE_MIN) labels.push('Fastest');
    if (o.finalScore === maxScore && maxScore > 0)                  labels.push('✨ AI Pick');
  }

  return result;
}
