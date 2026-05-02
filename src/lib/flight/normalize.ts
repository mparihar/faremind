export function normalize(value: number, min: number, max: number): number {
  if (max === min) return 1;
  return (max - value) / (max - min);
}
