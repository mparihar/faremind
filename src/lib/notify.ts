/**
 * Fire-and-forget email notifications via Brevo.
 *
 * Sends emails DIRECTLY via the Brevo transactional API — does NOT
 * depend on the Python notification micro-service.  If the Brevo key
 * is missing the call is silently skipped (logged).
 */

import { generateItineraryHtmlFromBooking } from '@/lib/fare-utils';

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const SENDER_EMAIL  = process.env.BREVO_SENDER_EMAIL ?? 'support@faremind.ai';
const SENDER_NAME   = 'FareMind';
const ADMIN_EMAIL   = process.env.ADMIN_EMAIL ?? process.env.SUPPORT_EMAIL ?? 'gayatri.parihar@gmail.com';

export type NotifyEventType =
  | 'BOOKING_CONFIRMED'
  | 'BOOKING_PENDING'
  | 'BOOKING_FAILED'
  | 'BOOKING_CANCELLED'
  | 'BOOKING_UPDATED'
  | 'DATE_CHANGE_SUBMITTED'
  | 'DATE_CHANGE_APPROVED'
  | 'DATE_CHANGE_REJECTED'
  | 'PAYMENT_SUCCESS'
  | 'PAYMENT_FAILED'
  | 'PRICE_DROP_ALERT'
  | 'PRICE_DROP_REFUND'
  | 'CHECKIN_REMINDER'
  | 'UPCOMING_TRIP'
  | 'SUPPORT_MANUAL';

interface NotifyPayload {
  event_type: NotifyEventType;
  booking_id?: string;
  customer_email?: string;
  data: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════
// Brevo email sender (same pattern as manage-booking-emails)
// ═══════════════════════════════════════════════════════════

async function sendBrevo(to: string, subject: string, html: string, text: string): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.warn(`[notify] BREVO_API_KEY not set — skipping email to ${to}`);
    return;
  }
  try {
    const res = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: SENDER_NAME, email: SENDER_EMAIL },
        to: [{ email: to }],
        subject,
        htmlContent: html,
        textContent: text,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[notify] Brevo ${res.status}: ${body}`);
    }
  } catch (err) {
    console.error(`[notify] Send failed to ${to}:`, err);
  }
}

// ═══════════════════════════════════════════════════════════
// HTML wrapper (FareMind branding)
// ═══════════════════════════════════════════════════════════

function wrap(title: string, body: string): string {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;"><tr><td align="center">
<table width="100%" style="max-width:560px;background:#fff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;">
<tr><td style="padding:24px 32px;border-bottom:1px solid #f1f5f9;">
  <table cellpadding="0" cellspacing="0"><tr>
    <td style="width:36px;height:36px;background:rgba(26,188,156,0.12);border-radius:10px;border:1px solid rgba(26,188,156,0.25);text-align:center;line-height:36px;">
      <span style="color:#1abc9c;font-size:18px;font-weight:900;">F</span>
    </td>
    <td style="padding-left:12px;">
      <span style="color:#0f172a;font-size:15px;font-weight:800;">FareMind</span>
      <span style="display:block;color:#94a3b8;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;">${title}</span>
    </td>
  </tr></table>
</td></tr>
<tr><td style="padding:32px;">
  ${body}
</td></tr>
<tr><td style="padding:16px 32px;border-top:1px solid #f1f5f9;background:#fafafa;">
  <p style="margin:0;color:#94a3b8;font-size:11px;text-align:center;">
    &copy; ${year} FareMind &middot; Need help? <a href="mailto:support@faremind.ai" style="color:#1abc9c;text-decoration:none;">support@faremind.ai</a>
  </p>
</td></tr>
</table></td></tr></table></body></html>`;
}

// ═══════════════════════════════════════════════════════════
// Event → Email mapping
// ═══════════════════════════════════════════════════════════

interface EmailSpec { subject: string; html: string; text: string; }

function buildCustomerEmail(eventType: string, d: Record<string, unknown>): EmailSpec | null {
  const ref = String(d.booking_reference ?? d.pnr ?? '');
  const route = String(d.route ?? `${d.origin ?? ''} – ${d.destination ?? ''}`);
  const name = String(d.customer_name ?? 'Traveler');
  const amount = String(d.total_amount ?? '');

  switch (eventType) {
    case 'BOOKING_CONFIRMED': {
      // If full booking data is provided, embed the complete itinerary
      const fullBookingData = d.full_booking_data as Record<string, unknown> | undefined;
      if (fullBookingData) {
        const itineraryHtml = generateItineraryHtmlFromBooking(fullBookingData);
        return {
          subject: `Your FareMind flight is confirmed – ${ref}`,
          html: itineraryHtml,
          text: `Hi ${name}, your flight ${ref} (${route}) is confirmed. Total: ${amount}. View your full itinerary at ${process.env.NEXT_PUBLIC_APP_URL || 'https://faremind.ai'}/manage-booking`,
        };
      }
      // Fallback: simple summary
      return {
        subject: `Your FareMind flight is confirmed – ${ref}`,
        html: wrap('Booking Confirmed', `
          <h2 style="margin:0 0 8px;color:#0f172a;font-size:20px;font-weight:800;">Booking Confirmed ✈️</h2>
          <p style="margin:0 0 24px;color:#64748b;font-size:14px;line-height:1.6;">
            Hi ${name}, your flight has been booked successfully!
          </p>
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;margin-bottom:24px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
              <tr><td style="padding:6px 0;color:#64748b;">Booking Ref</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#0f172a;">${ref}</td></tr>
              <tr><td style="padding:6px 0;color:#64748b;">Route</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#0f172a;">${route}</td></tr>
              ${amount ? `<tr><td style="padding:6px 0;color:#64748b;">Total Charged</td><td style="padding:6px 0;text-align:right;font-weight:900;font-size:18px;color:#1abc9c;">${amount}</td></tr>` : ''}
            </table>
          </div>
          <p style="margin:0;color:#64748b;font-size:13px;">
            You can view and manage your booking anytime at <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://faremind.ai'}/manage-booking" style="color:#1abc9c;text-decoration:none;">Manage Booking</a>.
          </p>
        `),
        text: `Hi ${name}, your flight ${ref} (${route}) is confirmed. Total: ${amount}.`,
      };
    }

    case 'BOOKING_PENDING':
      return {
        subject: `Your booking is being processed – ${ref}`,
        html: wrap('Booking Processing', `
          <h2 style="margin:0 0 8px;color:#0f172a;font-size:20px;font-weight:800;">Booking Being Processed</h2>
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;">Hi ${name}, your booking <strong>${ref}</strong> for <strong>${route}</strong> is being confirmed with the airline. We'll email you once it's ready.</p>
        `),
        text: `Hi ${name}, your booking ${ref} for ${route} is being processed. We'll email you shortly.`,
      };

    case 'BOOKING_CANCELLED':
      return {
        subject: `Booking ${ref} has been cancelled`,
        html: wrap('Booking Cancelled', `
          <h2 style="margin:0 0 8px;color:#0f172a;font-size:20px;font-weight:800;">Booking Cancelled</h2>
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;">Hi ${name}, your booking <strong>${ref}</strong> for <strong>${route}</strong> has been cancelled.</p>
          <p style="margin:0;color:#64748b;font-size:13px;">Any eligible refund will be processed within 5–10 business days.</p>
        `),
        text: `Hi ${name}, your booking ${ref} for ${route} has been cancelled. Any eligible refund will be processed within 5-10 business days.`,
      };

    case 'BOOKING_UPDATED':
    case 'DATE_CHANGE_SUBMITTED':
    case 'DATE_CHANGE_APPROVED':
    case 'DATE_CHANGE_REJECTED': {
      const updateType = String(d.update_type ?? eventType.replace(/_/g, ' ').toLowerCase());
      const details = String(d.update_details ?? '');
      return {
        subject: `Your booking has been updated – ${ref}`,
        html: wrap('Booking Updated', `
          <h2 style="margin:0 0 8px;color:#0f172a;font-size:20px;font-weight:800;">Booking Updated</h2>
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;">Hi ${name}, your booking <strong>${ref}</strong> has been updated.</p>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:16px;">
            <p style="margin:0 0 4px;color:#94a3b8;font-size:11px;text-transform:uppercase;font-weight:700;">Update</p>
            <p style="margin:0;color:#0f172a;font-size:14px;font-weight:600;">${updateType}</p>
            ${details ? `<p style="margin:4px 0 0;color:#64748b;font-size:13px;">${details}</p>` : ''}
          </div>
        `),
        text: `Hi ${name}, booking ${ref} updated: ${updateType}. ${details}`,
      };
    }

    case 'PAYMENT_SUCCESS':
      return {
        subject: `Payment confirmed – ${ref}`,
        html: wrap('Payment Confirmed', `
          <h2 style="margin:0 0 8px;color:#0f172a;font-size:20px;font-weight:800;">Payment Confirmed ✅</h2>
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;">Hi ${name}, we've received your payment of <strong style="color:#1abc9c">${amount}</strong> for booking <strong>${ref}</strong>.</p>
        `),
        text: `Hi ${name}, payment of ${amount} confirmed for booking ${ref}.`,
      };

    case 'PAYMENT_FAILED':
      return {
        subject: `Payment issue with your FareMind booking`,
        html: wrap('Payment Issue', `
          <h2 style="margin:0 0 8px;color:#ef4444;font-size:20px;font-weight:800;">Payment Issue</h2>
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;">Hi ${name}, we couldn't process your payment for booking <strong>${ref}</strong>. Please try again or use a different payment method.</p>
        `),
        text: `Hi ${name}, payment failed for booking ${ref}. Please try again.`,
      };

    case 'PRICE_DROP_ALERT':
      return {
        subject: `Price drop found for your tracked flight – ${route}`,
        html: wrap('Price Drop Alert', `
          <h2 style="margin:0 0 8px;color:#0f172a;font-size:20px;font-weight:800;">Price Drop Alert 📉</h2>
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;">Great news, ${name}! The price for <strong>${route}</strong> has dropped.</p>
          <p style="margin:0;color:#64748b;font-size:13px;">New price: <strong style="color:#1abc9c">${String(d.new_price ?? d.current_price ?? '')}</strong> (was ${String(d.old_price ?? d.original_price ?? '')})</p>
        `),
        text: `Price drop for ${route}: now ${String(d.new_price ?? d.current_price ?? '')}.`,
      };

    case 'PRICE_DROP_REFUND':
      return {
        subject: `Price drop refund for booking ${ref}`,
        html: wrap('Price Drop Refund', `
          <h2 style="margin:0 0 8px;color:#0f172a;font-size:20px;font-weight:800;">Price Drop Refund 🎉</h2>
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;">Hi ${name}, your booking <strong>${ref}</strong> qualifies for a price drop refund of <strong style="color:#1abc9c">${String(d.refund_amount ?? d.savings ?? '')}</strong>.</p>
        `),
        text: `Hi ${name}, price drop refund of ${String(d.refund_amount ?? d.savings ?? '')} for booking ${ref}.`,
      };

    case 'CHECKIN_REMINDER':
      return {
        subject: `Check-in opening soon for your flight to ${d.destination}`,
        html: wrap('Check-in Reminder', `
          <h2 style="margin:0 0 8px;color:#0f172a;font-size:20px;font-weight:800;">Time to Check In! ✈️</h2>
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;">Hi ${name}, check-in is opening soon for your flight from <strong>${d.origin}</strong> to <strong>${d.destination}</strong>.</p>
          <p style="margin:0;color:#64748b;font-size:13px;">Check in early to get the best seat selection.</p>
        `),
        text: `Hi ${name}, check-in is opening soon for ${d.origin} to ${d.destination}.`,
      };

    case 'UPCOMING_TRIP':
      return {
        subject: `Your trip to ${d.destination} is in 3 days`,
        html: wrap('Trip Reminder', `
          <h2 style="margin:0 0 8px;color:#0f172a;font-size:20px;font-weight:800;">Your Trip is Almost Here! 🌍</h2>
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;">Hi ${name}, your trip from <strong>${d.origin}</strong> to <strong>${d.destination}</strong> departs in 3 days.</p>
          <p style="margin:0;color:#64748b;font-size:13px;">Make sure your documents and bags are ready.</p>
        `),
        text: `Hi ${name}, your trip from ${d.origin} to ${d.destination} is in 3 days!`,
      };

    default:
      return null;
  }
}

function buildSupportEmail(eventType: string, d: Record<string, unknown>): EmailSpec | null {
  const ref = String(d.booking_reference ?? d.pnr ?? '');
  const name = String(d.customer_name ?? 'Unknown');
  const email = String(d.customer_email ?? '');
  const route = String(d.route ?? `${d.origin ?? ''} – ${d.destination ?? ''}`);
  const amount = String(d.total_amount ?? '');
  const ts = new Date().toISOString();

  switch (eventType) {
    case 'BOOKING_CONFIRMED': {
      // If full booking data is provided, embed the same itinerary as customer
      const fullBookingData = d.full_booking_data as Record<string, unknown> | undefined;
      if (fullBookingData) {
        const itineraryHtml = generateItineraryHtmlFromBooking(fullBookingData);
        return {
          subject: `[FareMind] New Booking Confirmed – ${ref}`,
          html: itineraryHtml,
          text: `New booking: ${ref} by ${name} (${email}), ${route}, ${amount}. Time: ${ts}`,
        };
      }
      // Fallback
      return {
        subject: `[FareMind] New Booking Confirmed – ${ref}`,
        html: wrap('[Admin] Booking Confirmed', `
          <h2 style="margin:0 0 8px;color:#0f172a;font-size:20px;font-weight:800;">New Booking Confirmed</h2>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
              <tr><td style="padding:4px 0;color:#64748b;width:140px;">Reference</td><td style="padding:4px 0;font-weight:700;color:#0f172a;">${ref}</td></tr>
              <tr><td style="padding:4px 0;color:#64748b;">Customer</td><td style="padding:4px 0;color:#0f172a;">${name} &lt;${email}&gt;</td></tr>
              <tr><td style="padding:4px 0;color:#64748b;">Route</td><td style="padding:4px 0;color:#0f172a;">${route}</td></tr>
              ${amount ? `<tr><td style="padding:4px 0;color:#64748b;">Amount</td><td style="padding:4px 0;font-weight:700;color:#1abc9c;">${amount}</td></tr>` : ''}
              <tr><td style="padding:4px 0;color:#64748b;">Timestamp</td><td style="padding:4px 0;color:#0f172a;">${ts}</td></tr>
            </table>
          </div>
        `),
        text: `New booking: ${ref} by ${name} (${email}), ${route}, ${amount}. Time: ${ts}`,
      };
    }

    case 'BOOKING_PENDING':
      return {
        subject: `[URGENT] Provider Confirmation Pending – ${ref}`,
        html: wrap('[Admin] Pending', `
          <h2 style="margin:0 0 8px;color:#f59e0b;font-size:20px;font-weight:800;">⏳ Booking Pending</h2>
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;">Booking <strong>${ref}</strong> by ${name} (${email}) for ${route} is awaiting provider confirmation.</p>
        `),
        text: `PENDING: ${ref} by ${name} for ${route}`,
      };

    case 'BOOKING_FAILED':
      return {
        subject: `[ACTION] Booking Failed – ${ref}`,
        html: wrap('[Admin] Failed', `
          <h2 style="margin:0 0 8px;color:#ef4444;font-size:20px;font-weight:800;">❌ Booking Failed</h2>
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;">Booking <strong>${ref}</strong> for ${name} (${email}) on ${route} has failed. Please investigate.</p>
          ${d.error ? `<p style="margin:0;color:#ef4444;font-size:12px;font-family:monospace;">Error: ${String(d.error)}</p>` : ''}
        `),
        text: `FAILED: ${ref} by ${name} for ${route}. ${d.error ? `Error: ${String(d.error)}` : ''}`,
      };

    case 'BOOKING_CANCELLED':
      return {
        subject: `[FareMind] Booking Cancelled – ${ref}`,
        html: wrap('[Admin] Cancelled', `
          <h2 style="margin:0 0 8px;color:#ef4444;font-size:20px;font-weight:800;">Booking Cancelled</h2>
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;">Booking <strong>${ref}</strong> by ${name} (${email}) for ${route} has been cancelled.</p>
        `),
        text: `CANCELLED: ${ref} by ${name} for ${route}`,
      };

    case 'BOOKING_UPDATED':
    case 'DATE_CHANGE_SUBMITTED':
    case 'DATE_CHANGE_APPROVED':
    case 'DATE_CHANGE_REJECTED':
      return {
        subject: `[FareMind] Booking Updated – ${ref}`,
        html: wrap('[Admin] Updated', `
          <h2 style="margin:0 0 8px;color:#0f172a;font-size:20px;font-weight:800;">Booking Updated</h2>
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;">Booking <strong>${ref}</strong> by ${name} (${email}) updated: ${String(d.update_type ?? eventType)}</p>
          ${d.update_details ? `<p style="margin:0;color:#64748b;font-size:13px;">${String(d.update_details)}</p>` : ''}
        `),
        text: `UPDATED: ${ref} by ${name}. ${String(d.update_type ?? eventType)} ${String(d.update_details ?? '')}`,
      };

    case 'PAYMENT_FAILED':
      return {
        subject: `[ALERT] Payment Failed – ${email}`,
        html: wrap('[Admin] Payment Failed', `
          <h2 style="margin:0 0 8px;color:#ef4444;font-size:20px;font-weight:800;">Payment Failed</h2>
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;">Payment failed for ${name} (${email}), booking <strong>${ref}</strong>.</p>
        `),
        text: `PAYMENT FAILED: ${ref} by ${name} (${email})`,
      };

    case 'PRICE_DROP_REFUND':
      return {
        subject: `[FareMind] Price Drop Refund Triggered – ${ref}`,
        html: wrap('[Admin] Price Drop Refund', `
          <h2 style="margin:0 0 8px;color:#0f172a;font-size:20px;font-weight:800;">Price Drop Refund</h2>
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;">Booking <strong>${ref}</strong> by ${name} qualifies for a refund of <strong style="color:#1abc9c;">${String(d.refund_amount ?? d.savings ?? '')}</strong>.</p>
        `),
        text: `PRICE DROP REFUND: ${ref} by ${name}, refund ${String(d.refund_amount ?? d.savings ?? '')}`,
      };

    default:
      return null;
  }
}

// Mapping: which events send to customer, support, or both
const CUSTOMER_EVENTS = new Set<string>([
  'BOOKING_CONFIRMED', 'BOOKING_PENDING', 'BOOKING_CANCELLED', 'BOOKING_UPDATED',
  'DATE_CHANGE_SUBMITTED', 'DATE_CHANGE_APPROVED', 'DATE_CHANGE_REJECTED',
  'PAYMENT_SUCCESS', 'PAYMENT_FAILED',
  'PRICE_DROP_ALERT', 'PRICE_DROP_REFUND',
  'CHECKIN_REMINDER', 'UPCOMING_TRIP',
]);

const SUPPORT_EVENTS = new Set<string>([
  'BOOKING_CONFIRMED', 'BOOKING_PENDING', 'BOOKING_FAILED', 'BOOKING_CANCELLED',
  'BOOKING_UPDATED', 'DATE_CHANGE_SUBMITTED', 'DATE_CHANGE_APPROVED', 'DATE_CHANGE_REJECTED',
  'PAYMENT_FAILED', 'PRICE_DROP_REFUND', 'SUPPORT_MANUAL',
]);

// ═══════════════════════════════════════════════════════════
// Public API — same signature as before, all callers work
// ═══════════════════════════════════════════════════════════

export async function fireNotification(payload: NotifyPayload): Promise<void> {
  try {
    const { event_type, customer_email, data } = payload;

    // Customer email
    if (CUSTOMER_EVENTS.has(event_type) && customer_email) {
      const spec = buildCustomerEmail(event_type, data);
      if (spec) {
        sendBrevo(customer_email, spec.subject, spec.html, spec.text).catch(() => {});
      }
    }

    // Support/admin email
    if (SUPPORT_EVENTS.has(event_type)) {
      const spec = buildSupportEmail(event_type, data);
      if (spec) {
        sendBrevo(ADMIN_EMAIL, spec.subject, spec.html, spec.text).catch(() => {});
      }
    }
  } catch (err) {
    console.error(`[notify] ${payload.event_type} failed:`, err);
  }
}
