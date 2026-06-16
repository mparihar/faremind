/**
 * AI Manage Booking Utilities
 * Shared helpers for the AI Bot manage-booking flow.
 */

/** Mask a passport number — show only last 2 characters */
export function maskPassport(value: string | null | undefined): string {
  if (!value || value.length < 3) return value ?? '—';
  return value.slice(0, 1) + '•'.repeat(value.length - 3) + value.slice(-2);
}

/** Format a date string for compact display: "15 Jul 2026" */
export function formatBookingDate(date: string | null | undefined): string {
  if (!date) return '—';
  try {
    return new Date(date).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return date;
  }
}

/** Format currency for display */
export function fmtCurrency(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Detect manage-booking intent from a user message */
export function detectManageBookingIntent(
  query: string
): 'cancel' | 'update_passenger' | 'manage' | null {
  const q = query.toLowerCase().trim();

  const cancelPhrases = [
    'cancel my booking',
    'cancel booking',
    'cancel my flight',
    'cancel flight',
    'cancel reservation',
    'cancel my reservation',
    'i want to cancel',
    'need to cancel',
    'cancellation',
    'request cancellation',
    'refund my booking',
    'get a refund',
  ];

  const updatePhrases = [
    'update passenger',
    'update my passport',
    'change passport',
    'update passport number',
    'change phone number',
    'update phone',
    'update email',
    'change email',
    'update nationality',
    'change nationality',
    'update passenger details',
    'edit passenger',
    'modify passenger',
    'update traveler',
    'change traveler',
    'update contact',
    'change contact',
    'update passport expiry',
  ];

  const managePhrases = [
    'manage my booking',
    'manage booking',
    'manage my trip',
    'manage trip',
    'view my booking',
    'my bookings',
    'my trips',
    'booking details',
  ];

  if (cancelPhrases.some((p) => q.includes(p))) return 'cancel';
  if (updatePhrases.some((p) => q.includes(p))) return 'update_passenger';
  if (managePhrases.some((p) => q.includes(p))) return 'manage';

  return null;
}

/** Status badge color mapping */
export function getStatusColor(status: string): {
  bg: string;
  text: string;
  border: string;
  label: string;
} {
  switch (status?.toUpperCase()) {
    case 'CONFIRMED':
    case 'TICKETED':
      return { bg: 'bg-emerald-500/10', text: 'text-emerald-600', border: 'border-emerald-400/30', label: 'Confirmed' };
    case 'CREATED':
      return { bg: 'bg-blue-500/10', text: 'text-blue-600', border: 'border-blue-400/30', label: 'Created' };
    case 'CANCELLED':
      return { bg: 'bg-red-500/10', text: 'text-red-500', border: 'border-red-400/30', label: 'Cancelled' };
    case 'FAILED':
      return { bg: 'bg-red-500/10', text: 'text-red-500', border: 'border-red-400/30', label: 'Failed' };
    case 'COMPLETED':
      return { bg: 'bg-slate-100', text: 'text-slate-500', border: 'border-slate-200', label: 'Completed' };
    default:
      return { bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-200', label: status || 'Unknown' };
  }
}

/** Editable passenger fields with labels */
export const EDITABLE_PASSENGER_FIELDS: { key: string; label: string; placeholder: string; type?: string }[] = [
  { key: 'email', label: 'Email', placeholder: 'john@example.com', type: 'email' },
  { key: 'phone', label: 'Phone', placeholder: '+1 234 567 8900', type: 'tel' },
  { key: 'nationality', label: 'Nationality', placeholder: 'US' },
  { key: 'passportNumber', label: 'Passport Number', placeholder: 'P12345678' },
  { key: 'passportExpiry', label: 'Passport Expiry', placeholder: 'YYYY-MM-DD', type: 'date' },
  { key: 'passportCountry', label: 'Issuing Country', placeholder: 'US' },
];

/** Non-editable identity fields */
export const NON_EDITABLE_FIELDS = [
  'First Name',
  'Middle Name',
  'Last Name',
  'Date of Birth',
  'Gender',
];
