/**
 * Inverted min-max normalization.
 * Lower value = better → returns 1.0 for the minimum, 0.0 for the maximum.
 */
export function normalize(value: number, min: number, max: number): number {
  if (max === min) return 1;
  return (max - value) / (max - min);
}
