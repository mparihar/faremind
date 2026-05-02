/**
 * Backend utility functions (server-side only).
 * No client-side dependencies (clsx, etc.).
 */

export function formatPrice(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function getAirlineLogo(code: string): string {
  return `https://images.kiwi.com/airlines/64/${code}.png`;
}

export function generateId(): string {
  return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

export function calculateValueScore(
  price: number,
  duration: number,
  stops: number,
  refundable: boolean
): number {
  const priceScore = Math.max(0, 100 - (price / 20));
  const durationScore = Math.max(0, 100 - (duration / 10));
  const stopScore = (2 - Math.min(stops, 2)) * 20;
  const refundScore = refundable ? 10 : 0;

  return Math.round(
    priceScore * 0.45 +
    durationScore * 0.30 +
    stopScore * 0.15 +
    refundScore * 0.10
  );
}
