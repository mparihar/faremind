export function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0.5; // No variation → neutral (not perfect)
  return (max - value) / (max - min);
}
