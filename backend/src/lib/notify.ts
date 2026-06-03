/**
 * Fire-and-forget email notifications via Brevo.
 *
 * Backend (Fastify) equivalent of src/lib/notify.ts on the Next.js side.
 * Sends emails DIRECTLY via the Brevo transactional API — does NOT
 * depend on the Python notification micro-service.
 */
import { prisma } from './db';

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const SENDER_EMAIL  = process.env.BREVO_SENDER_EMAIL ?? 'support@faremind.ai';
const SENDER_NAME   = 'FAREMIND';
const SUPER_ADMIN_EMAIL = 'mparihar@gmail.com';

export type NotifyEventType =
  | 'BOOKING_CONFIRMED'
  | 'BOOKING_PENDING'
  | 'BOOKING_FAILED'
  | 'BOOKING_CANCELLED'
  | 'BOOKING_UPDATED'
  | 'PASSENGER_INFO_UPDATED'
  | 'DATE_CHANGE_SUBMITTED'
  | 'DATE_CHANGE_APPROVED'
  | 'DATE_CHANGE_REJECTED'
  | 'FLIGHT_CHANGE_CONFIRMED'
  | 'SEAT_SELECTION_UPDATED'
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
// Brevo email sender
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
// HTML wrapper (FAREMIND branding)
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
      <span style="font-size:15px;font-weight:800;"><span style="color:#FFFFFF;">FARE</span><span style="color:#009CA6;">MIND</span></span>
      <span style="display:block;color:#94a3b8;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;">${title}</span>
    </td>
  </tr></table>
</td></tr>
<tr><td style="padding:32px;">
  ${body}
</td></tr>
<tr><td style="padding:16px 32px;border-top:1px solid #f1f5f9;background:#fafafa;">
  <p style="margin:0;color:#94a3b8;font-size:11px;text-align:center;">
    &copy; ${year} FAREMIND &middot; Need help? <a href="mailto:support@faremind.ai" style="color:#1abc9c;text-decoration:none;">support@faremind.ai</a>
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
    case 'BOOKING_CONFIRMED':
      return {
        subject: `Your FAREMIND flight is confirmed – ${ref}`,
        html: wrap('Booking Confirmed', `
          <h2 style="margin:0 0 8px;color:#0f172a;font-size:20px;font-weight:800;">Booking Confirmed ✈️</h2>
          <p style="margin:0 0 24px;color:#64748b;font-size:14px;line-height:1.6;">
            Hi ${name}, your flight has been booked successfully!
          </p>
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;margin-bottom:24px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
              <tr><td style="padding:6px 0;color:#64748b;">FAREMIND Booking Reference</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#0f172a;">${String(d.booking_reference || ref)}</td></tr>
              ${(d.airline_pnr || d.pnr) ? `<tr><td style="padding:6px 0;color:#64748b;">Airline PNR</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#1abc9c;">${String(d.airline_pnr || d.pnr)}</td></tr>` : ''}
              <tr><td style="padding:6px 0;color:#64748b;">Route</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#0f172a;">${route}</td></tr>
              ${amount ? `<tr><td style="padding:6px 0;color:#64748b;">Total Charged</td><td style="padding:6px 0;text-align:right;font-weight:900;font-size:18px;color:#1abc9c;">${amount}</td></tr>` : ''}
            </table>
          </div>
          <p style="margin:0;color:#64748b;font-size:13px;">
            You can view and manage your booking anytime at <a href="${process.env.APP_URL || 'https://faremind.ai'}/manage-booking" style="color:#1abc9c;text-decoration:none;">Manage Booking</a>.
          </p>
        `),
        text: `Hi ${name}, your flight ${ref} (${route}) is confirmed. Total: ${amount}.`,
      };

    case 'BOOKING_PENDING':
      return {
        subject: `Your booking is being processed – ${ref}`,
        html: wrap('Booking Processing', `
          <h2 style="margin:0 0 8px;color:#0f172a;font-size:20px;font-weight:800;">Booking Being Processed</h2>
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;">Hi ${name}, your booking <strong>${ref}</strong> for <strong>${route}</strong> is being confirmed with the airline.</p>
        `),
        text: `Hi ${name}, your booking ${ref} for ${route} is being processed.`,
      };

    case 'BOOKING_CANCELLED': {
      const cancelDate = new Date().toLocaleDateString();
      const refundAmt = String(d.refund_amount ?? 'Non-refundable');
      const refundStat = String(d.refund_status ?? (refundAmt !== 'Non-refundable' && refundAmt !== '$0.00' && refundAmt !== '' ? 'Pending' : 'Not Applicable'));
      const fbr = String(d.booking_reference ?? ref);
      
      const refundHtml = refundAmt !== 'Non-refundable' && refundAmt !== '$0.00' && refundAmt !== '' ? `<li style="margin-bottom:4px;">Refund Amount: ${refundAmt}</li>` : '';
      const refundText = refundAmt !== 'Non-refundable' && refundAmt !== '$0.00' && refundAmt !== '' ? `* Refund Amount: ${refundAmt}` : '';

      return {
        subject: `Booking Cancellation Confirmed – ${fbr}`,
        html: wrap('Booking Cancelled', `
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;">Hello ${name},</p>
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;">Your booking cancellation request has been successfully processed for booking <strong>${fbr}</strong>.</p>
          
          <h3 style="margin:0 0 8px;color:#0f172a;font-size:16px;font-weight:700;">Booking Information</h3>
          <ul style="margin:0 0 16px;color:#64748b;font-size:14px;padding-left:20px;">
            <li style="margin-bottom:4px;">Booking Status: Cancelled</li>
            <li style="margin-bottom:4px;">Cancellation Date: ${cancelDate}</li>
            ${refundHtml}
            <li style="margin-bottom:4px;">Refund Status: ${refundStat}</li>
          </ul>

          <h3 style="margin:0 0 8px;color:#0f172a;font-size:16px;font-weight:700;"><span style="color:#0f172a;">FARE</span><span style="color:#009CA6;">MIND</span> Booking Reference</h3>
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;">${fbr}</p>

          <p style="margin:0 0 16px;color:#64748b;font-size:14px;line-height:1.6;">Any applicable refunds will be processed according to the airline, supplier, and fare rules associated with your booking.</p>
          
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;line-height:1.6;">If you did not request this cancellation, please contact FAREMIND Support immediately.</p>
          
          <p style="margin:0;color:#64748b;font-size:14px;">Thank you for choosing FAREMIND.</p>
          <p style="margin:16px 0 4px;color:#0f172a;font-size:14px;font-weight:600;">FAREMIND Team</p>
          <p style="margin:0;color:#1abc9c;font-size:12px;font-weight:600;">Free Your Mind</p>
        `),
        text: `Hello ${name},\n\nYour booking cancellation request has been successfully processed for booking ${fbr}.\n\nBooking Information\n\n* Booking Status: Cancelled\n* Cancellation Date: ${cancelDate}\n${refundText}\n* Refund Status: ${refundStat}\n\nFAREMIND Booking Reference\n${fbr}\n\nAny applicable refunds will be processed according to the airline, supplier, and fare rules associated with your booking.\n\nIf you did not request this cancellation, please contact FAREMIND Support immediately.\n\nThank you for choosing FAREMIND.\n\nFAREMIND Team\nFree Your Mind`,
      };
    }

    case 'PASSENGER_INFO_UPDATED': {
      const paxName = String(d.passenger_name ?? '');
      const fields = Array.isArray(d.updated_fields) ? d.updated_fields : [];
      
      const fieldLabels: Record<string, string> = {
        email: 'Email Address',
        phone: 'Phone Number',
        nationality: 'Nationality',
        passportNumber: 'Passport Number',
        passportExpiry: 'Passport Expiry Date',
        passportCountry: 'Passport Issuing Country'
      };
      
      const updatedListHtml = fields.map(f => `<li style="margin-bottom:4px;">${fieldLabels[f] || f}</li>`).join('');
      const updatedListText = fields.map(f => `* ${fieldLabels[f] || f}`).join('\n');

      return {
        subject: `Your passenger information has been updated – ${ref}`,
        html: wrap('Passenger Updated', `
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;">Hello ${name},</p>
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;">Your passenger information has been successfully updated for booking <strong>${ref}</strong>.</p>
          
          <h3 style="margin:0 0 8px;color:#0f172a;font-size:16px;font-weight:700;">Passenger</h3>
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;">${paxName}</p>

          <h3 style="margin:0 0 8px;color:#0f172a;font-size:16px;font-weight:700;">Updated Information</h3>
          <ul style="margin:0 0 16px;color:#64748b;font-size:14px;padding-left:20px;">
            ${updatedListHtml}
          </ul>

          <h3 style="margin:0 0 8px;color:#0f172a;font-size:16px;font-weight:700;">Booking Reference</h3>
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;">${ref}</p>

          <p style="margin:0 0 16px;color:#64748b;font-size:14px;line-height:1.6;">The updated information has been saved and applied to your booking. If any of these changes require airline or provider confirmation, the latest status will be reflected in your Manage Booking section.</p>
          
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;line-height:1.6;">If you did not request this update, please contact FAREMIND Support immediately.</p>
          
          <p style="margin:0;color:#64748b;font-size:14px;">Thank you for choosing FAREMIND.</p>
          <p style="margin:16px 0 4px;color:#0f172a;font-size:14px;font-weight:600;">FAREMIND Team</p>
          <p style="margin:0;color:#1abc9c;font-size:12px;font-weight:600;">Free Your Mind</p>
        `),
        text: `Hello ${name},\n\nYour passenger information has been successfully updated for booking ${ref}.\n\nPassenger\n${paxName}\n\nUpdated Information\n${updatedListText}\n\nBooking Reference\n${ref}\n\nThe updated information has been saved and applied to your booking. If any of these changes require airline or provider confirmation, the latest status will be reflected in your Manage Booking section.\n\nIf you did not request this update, please contact FAREMIND Support immediately.\n\nThank you for choosing FAREMIND.\n\nFAREMIND Team\nFree Your Mind`,
      };
    }

    case 'FLIGHT_CHANGE_CONFIRMED': {
      const paxName = String(d.passenger_name ?? '');
      const oldFlight = String(d.old_flight_number ?? '');
      const newFlight = String(d.new_flight_number ?? '');
      const oldDep = String(d.old_departure ?? '');
      const newDep = String(d.new_departure ?? '');
      const oldArr = String(d.old_arrival ?? '');
      const newArr = String(d.new_arrival ?? '');
      const fareDiff = String(d.fare_difference ?? '');
      
      const fareDiffHtml = fareDiff && fareDiff !== '0.00' ? `<li style="margin-bottom:4px;">Fare Difference: ${fareDiff}</li>` : '';
      const fareDiffText = fareDiff && fareDiff !== '0.00' ? `* Fare Difference: ${fareDiff}` : '';

      return {
        subject: `Your flight booking has been successfully updated – ${ref}`,
        html: wrap('Flight Change Confirmed', `
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;">Hello ${name},</p>
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;">Your flight booking has been successfully updated for booking <strong>${ref}</strong>.</p>
          
          <h3 style="margin:0 0 8px;color:#0f172a;font-size:16px;font-weight:700;">Passenger</h3>
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;">${paxName}</p>

          <h3 style="margin:0 0 8px;color:#0f172a;font-size:16px;font-weight:700;">Updated Information</h3>
          <ul style="margin:0 0 16px;color:#64748b;font-size:14px;padding-left:20px;">
            <li style="margin-bottom:4px;">Flight: ${oldFlight} &rarr; ${newFlight}</li>
            <li style="margin-bottom:4px;">Departure: ${oldDep} &rarr; ${newDep}</li>
            <li style="margin-bottom:4px;">Arrival: ${oldArr} &rarr; ${newArr}</li>
            ${fareDiffHtml}
          </ul>
          
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;line-height:1.6;">Only the changes listed above were updated as part of your request.</p>

          <h3 style="margin:0 0 8px;color:#0f172a;font-size:16px;font-weight:700;"><span style="color:#0f172a;">FARE</span><span style="color:#009CA6;">MIND</span> Booking Reference</h3>
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;">${ref}</p>

          <p style="margin:0 0 16px;color:#64748b;font-size:14px;line-height:1.6;">Please review your updated itinerary in the Manage Booking section.</p>
          
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;line-height:1.6;">If you did not request this change, please contact FAREMIND Support immediately.</p>
          
          <p style="margin:0;color:#64748b;font-size:14px;">Thank you for choosing FAREMIND.</p>
          <p style="margin:16px 0 4px;color:#0f172a;font-size:14px;font-weight:600;">FAREMIND Team</p>
          <p style="margin:0;color:#1abc9c;font-size:12px;font-weight:600;">Free Your Mind</p>
        `),
        text: `Hello ${name},\n\nYour flight booking has been successfully updated for booking ${ref}.\n\nPassenger\n${paxName}\n\nUpdated Information\n\n* Flight: ${oldFlight} -> ${newFlight}\n* Departure: ${oldDep} -> ${newDep}\n* Arrival: ${oldArr} -> ${newArr}\n${fareDiffText}\n\nOnly the changes listed above were updated as part of your request.\n\nFAREMIND Booking Reference\n${ref}\n\nPlease review your updated itinerary in the Manage Booking section.\n\nIf you did not request this change, please contact FAREMIND Support immediately.\n\nThank you for choosing FAREMIND.\n\nFAREMIND Team\nFree Your Mind`,
      };
    }

    case 'SEAT_SELECTION_UPDATED': {
      const paxName = String(d.passenger_name ?? '');
      const fbr = String(d.booking_reference ?? ref);
      
      let listHtml = '';
      let listText = '';
      
      const seats = d.seats as Array<{label: string, old: string, new: string}>;
      if (Array.isArray(seats) && seats.length > 0) {
        for (const s of seats) {
          listHtml += `<li style="margin-bottom:4px;">${s.label}: ${s.old || 'None'} &rarr; ${s.new}</li>`;
          listText += `* ${s.label}: ${s.old || 'None'} -> ${s.new}\n`;
        }
      } else {
        const oldSeat = String(d.old_seat ?? 'None');
        const newSeat = String(d.new_seat ?? '');
        listHtml += `<li style="margin-bottom:4px;">Seat: ${oldSeat} &rarr; ${newSeat}</li>`;
        listText += `* Seat: ${oldSeat} -> ${newSeat}\n`;
      }

      return {
        subject: `Your seat selection has been successfully updated – ${fbr}`,
        html: wrap('Seat Selection Updated', `
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;">Hello ${name},</p>
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;">Your seat selection has been successfully updated for booking <strong>${fbr}</strong>.</p>
          
          <h3 style="margin:0 0 8px;color:#0f172a;font-size:16px;font-weight:700;">Passenger</h3>
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;">${paxName}</p>

          <h3 style="margin:0 0 8px;color:#0f172a;font-size:16px;font-weight:700;">Updated Information</h3>
          <ul style="margin:0 0 16px;color:#64748b;font-size:14px;padding-left:20px;">
            ${listHtml}
          </ul>
          
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;line-height:1.6;">Only the changes listed above were updated as part of your request.</p>

          <h3 style="margin:0 0 8px;color:#0f172a;font-size:16px;font-weight:700;"><span style="color:#0f172a;">FARE</span><span style="color:#009CA6;">MIND</span> Booking Reference</h3>
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;">${fbr}</p>

          <p style="margin:0 0 16px;color:#64748b;font-size:14px;line-height:1.6;">The updated seat assignment has been saved to your booking.</p>
          
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;line-height:1.6;">If you did not request this change, please contact FAREMIND Support immediately.</p>
          
          <p style="margin:0;color:#64748b;font-size:14px;">Thank you for choosing FAREMIND.</p>
          <p style="margin:16px 0 4px;color:#0f172a;font-size:14px;font-weight:600;">FAREMIND Team</p>
          <p style="margin:0;color:#1abc9c;font-size:12px;font-weight:600;">Free Your Mind</p>
        `),
        text: `Hello ${name},\n\nYour seat selection has been successfully updated for booking ${fbr}.\n\nPassenger\n${paxName}\n\nUpdated Information\n\n${listText}\nOnly the changes listed above were updated as part of your request.\n\nFAREMIND Booking Reference\n${fbr}\n\nThe updated seat assignment has been saved to your booking.\n\nIf you did not request this change, please contact FAREMIND Support immediately.\n\nThank you for choosing FAREMIND.\n\nFAREMIND Team\nFree Your Mind`,
      };
    }

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
          <div style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 60%,#0f3460 100%);border-radius:12px;padding:32px 36px;text-align:center;position:relative;overflow:hidden;margin-bottom:24px;">
            <div style="display:inline-flex;align-items:center;gap:6px;background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.25);border-radius:20px;padding:4px 12px;margin-bottom:12px;">
              <div style="width:6px;height:6px;border-radius:50%;background:#10b981;"></div>
              <span style="font-size:11px;font-weight:700;color:#10b981;letter-spacing:0.5px;">Payment Confirmed</span>
            </div>
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:3px;font-weight:700;margin-bottom:8px;"><span style="color:#ffffff;">FARE</span><span style="color:#009CA6;">MIND</span> <span style="color:#64748b;">BOOKING REFERENCE</span></div>
            <div style="font-family:'Courier New',monospace;font-size:32px;font-weight:900;letter-spacing:8px;color:#fff;">${ref}</div>
            <div style="margin-top:14px;">
              <div style="display:inline-flex;align-items:center;gap:8px;margin:4px 0;">
                <span style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:3px;font-weight:700;">AIRLINE PNR</span>
                <span style="font-family:'Courier New',monospace;font-size:16px;font-weight:900;color:#1abc9c;letter-spacing:3px;">${String(d.airline_pnr || d.pnr || '')}</span>
              </div>
            </div>
          </div>

          <p style="margin:0 0 16px;color:#64748b;font-size:14px;line-height:1.6;">Hello ${name},</p>
          <p style="margin:0 0 24px;color:#64748b;font-size:14px;line-height:1.6;">We have successfully received your payment for booking <strong style="color:#0f172a">${ref}</strong>.</p>
          
          <h3 style="margin:0 0 12px;color:#0f172a;font-size:16px;font-weight:700;">Payment Details</h3>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:24px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
              <tr><td style="padding:6px 0;color:#64748b;">Amount Paid</td><td style="padding:6px 0;text-align:right;font-weight:900;font-size:18px;color:#1abc9c;">${amount}</td></tr>
              <tr><td style="padding:6px 0;color:#64748b;">FAREMIND Booking Reference</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#0f172a;">${ref}</td></tr>
              <tr><td style="padding:6px 0;color:#64748b;">Airline PNR</td><td style="padding:6px 0;text-align:right;font-family:'Courier New',monospace;font-weight:700;color:#1abc9c;letter-spacing:1px;">${String(d.airline_pnr || d.pnr || '')}</td></tr>
              <tr><td style="padding:6px 0;color:#64748b;">Payment Status</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#10b981;">Confirmed</td></tr>
            </table>
          </div>
          
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;line-height:1.6;">Your booking remains active and no further action is required at this time.</p>
          
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;line-height:1.6;">You can view your itinerary, manage your booking, download travel documents, or make eligible changes through your <a href="${process.env.APP_URL || 'https://faremind.ai'}/manage-booking" style="color:#1abc9c;text-decoration:none;">FAREMIND account</a>.</p>
          
          <p style="margin:0 0 24px;color:#64748b;font-size:14px;line-height:1.6;">If you did not authorize this payment, please contact FAREMIND Support immediately.</p>
          
          <p style="margin:0 0 24px;color:#64748b;font-size:14px;line-height:1.6;">Thank you for choosing FAREMIND.</p>
          
          <p style="margin:0;color:#0f172a;font-size:14px;font-weight:600;">FAREMIND</p>
          <p style="margin:4px 0;color:#1abc9c;font-size:12px;font-weight:600;">Your Personal Travel Consultant</p>
          <p style="margin:4px 0 0;font-size:12px;"><a href="mailto:support@faremind.ai" style="color:#1abc9c;text-decoration:none;">support@faremind.ai</a></p>
          <p style="margin:4px 0 0;font-size:12px;"><a href="http://www.faremind.ai" style="color:#1abc9c;text-decoration:none;">www.faremind.ai</a></p>
        `),
        text: `Hello ${name},\n\nWe have successfully received your payment of ${amount} for booking ${ref}.\n\nPayment Details\nAmount Paid: ${amount}\nFAREMIND Booking Reference: ${ref}\nAirline PNR: ${String(d.airline_pnr || d.pnr || '')}\nPayment Status: Confirmed\n\nYour booking remains active and no further action is required at this time.\n\nThank you for choosing FAREMIND.`,
      };

    case 'PAYMENT_FAILED':
      return {
        subject: `Payment issue with your FAREMIND booking`,
        html: wrap('Payment Issue', `
          <h2 style="margin:0 0 8px;color:#ef4444;font-size:20px;font-weight:800;">Payment Issue</h2>
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;">Hi ${name}, we couldn't process your payment for booking <strong>${ref}</strong>.</p>
        `),
        text: `Hi ${name}, payment failed for booking ${ref}.`,
      };

    case 'PRICE_DROP_ALERT':
      return {
        subject: `Price drop found for your tracked flight – ${route}`,
        html: wrap('Price Drop Alert', `
          <h2 style="margin:0 0 8px;color:#0f172a;font-size:20px;font-weight:800;">Price Drop Alert 📉</h2>
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;">Great news, ${name}! The price for <strong>${route}</strong> has dropped.</p>
          <p style="margin:0;color:#64748b;font-size:13px;">New price: <strong style="color:#1abc9c">${String(d.new_price ?? d.current_price ?? '')}</strong></p>
        `),
        text: `Price drop for ${route}: now ${String(d.new_price ?? d.current_price ?? '')}.`,
      };

    case 'PRICE_DROP_REFUND':
      return {
        subject: `Price drop refund for booking ${ref}`,
        html: wrap('Price Drop Refund', `
          <h2 style="margin:0 0 8px;color:#0f172a;font-size:20px;font-weight:800;">Price Drop Refund 🎉</h2>
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;">Hi ${name}, your booking <strong>${ref}</strong> qualifies for a price drop refund of <strong style="color:#1abc9c;">${String(d.refund_amount ?? d.savings ?? '')}</strong>.</p>
        `),
        text: `Hi ${name}, price drop refund of ${String(d.refund_amount ?? d.savings ?? '')} for booking ${ref}.`,
      };

    case 'CHECKIN_REMINDER':
      return {
        subject: `Check-in opening soon for your flight to ${d.destination}`,
        html: wrap('Check-in Reminder', `
          <h2 style="margin:0 0 8px;color:#0f172a;font-size:20px;font-weight:800;">Time to Check In! ✈️</h2>
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;">Hi ${name}, check-in is opening soon for your flight to <strong>${d.destination}</strong>.</p>
        `),
        text: `Hi ${name}, check-in is opening soon for your flight to ${d.destination}.`,
      };

    case 'UPCOMING_TRIP':
      return {
        subject: `Your trip to ${d.destination} is in 3 days`,
        html: wrap('Trip Reminder', `
          <h2 style="margin:0 0 8px;color:#0f172a;font-size:20px;font-weight:800;">Your Trip is Almost Here! 🌍</h2>
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;">Hi ${name}, your trip to <strong>${d.destination}</strong> departs in 3 days.</p>
        `),
        text: `Hi ${name}, your trip to ${d.destination} is in 3 days!`,
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
    case 'BOOKING_CONFIRMED':
      return {
        subject: `[FAREMIND] New Booking Confirmed – ${ref}`,
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
        text: `New booking: ${ref} by ${name} (${email}), ${route}, ${amount}`,
      };

    case 'BOOKING_PENDING':
      return {
        subject: `[URGENT] Provider Confirmation Pending – ${ref}`,
        html: wrap('[Admin] Pending', `<h2 style="margin:0 0 8px;color:#f59e0b;font-size:20px;font-weight:800;">⏳ Booking Pending</h2><p style="margin:0;color:#64748b;font-size:14px;">Booking <strong>${ref}</strong> by ${name} for ${route} is awaiting provider confirmation.</p>`),
        text: `PENDING: ${ref} by ${name} for ${route}`,
      };

    case 'BOOKING_FAILED':
      return {
        subject: `[ACTION] Booking Failed – ${ref}`,
        html: wrap('[Admin] Failed', `<h2 style="margin:0 0 8px;color:#ef4444;font-size:20px;font-weight:800;">❌ Booking Failed</h2><p style="margin:0;color:#64748b;font-size:14px;">Booking <strong>${ref}</strong> for ${name} on ${route} has failed.</p>`),
        text: `FAILED: ${ref} by ${name} for ${route}`,
      };

    case 'BOOKING_CANCELLED':
      return {
        subject: `[FAREMIND] Booking Cancelled – ${ref}`,
        html: wrap('[Admin] Cancelled', `<h2 style="margin:0 0 8px;color:#ef4444;font-size:20px;font-weight:800;">Booking Cancelled</h2><p style="margin:0;color:#64748b;font-size:14px;">Booking <strong>${ref}</strong> by ${name} for ${route} has been cancelled.</p>`),
        text: `CANCELLED: ${ref} by ${name} for ${route}`,
      };

    case 'BOOKING_UPDATED':
    case 'DATE_CHANGE_SUBMITTED':
    case 'DATE_CHANGE_APPROVED':
    case 'DATE_CHANGE_REJECTED':
      return {
        subject: `[FAREMIND] Booking Updated – ${ref}`,
        html: wrap('[Admin] Updated', `<h2 style="margin:0 0 8px;color:#0f172a;font-size:20px;font-weight:800;">Booking Updated</h2><p style="margin:0;color:#64748b;font-size:14px;">Booking <strong>${ref}</strong> by ${name}: ${String(d.update_type ?? eventType)}</p>`),
        text: `UPDATED: ${ref} by ${name}. ${String(d.update_type ?? eventType)}`,
      };

    case 'PASSENGER_INFO_UPDATED':
      return {
        subject: `[FAREMIND] Passenger Updated – ${ref}`,
        html: wrap('[Admin] Passenger Updated', `<h2 style="margin:0 0 8px;color:#0f172a;font-size:20px;font-weight:800;">Passenger Updated</h2><p style="margin:0;color:#64748b;font-size:14px;">Booking <strong>${ref}</strong> passenger ${String(d.passenger_name)} updated fields: ${Array.isArray(d.updated_fields) ? d.updated_fields.join(', ') : ''}</p>`),
        text: `UPDATED PASSENGER: ${ref} passenger ${String(d.passenger_name)}. Fields: ${Array.isArray(d.updated_fields) ? d.updated_fields.join(', ') : ''}`,
      };

    case 'PAYMENT_SUCCESS':
      return {
        subject: `[FAREMIND] Payment Received – ${ref}`,
        html: wrap('[Admin] Payment Success', `<h2 style="margin:0 0 8px;color:#0f172a;font-size:20px;font-weight:800;">Payment Received</h2><p style="margin:0;color:#64748b;font-size:14px;">Payment of <strong style="color:#1abc9c;">${amount}</strong> received from ${name} (${email}) for booking <strong>${ref}</strong>.</p>`),
        text: `PAYMENT SUCCESS: ${ref} by ${name} (${email}), amount: ${amount}`,
      };

    case 'PAYMENT_FAILED':
      return {
        subject: `[ALERT] Payment Failed – ${email}`,
        html: wrap('[Admin] Payment Failed', `<h2 style="margin:0 0 8px;color:#ef4444;font-size:20px;font-weight:800;">Payment Failed</h2><p style="margin:0;color:#64748b;font-size:14px;">Payment failed for ${name} (${email}), booking <strong>${ref}</strong>.</p>`),
        text: `PAYMENT FAILED: ${ref} by ${name} (${email})`,
      };

    case 'FLIGHT_CHANGE_CONFIRMED':
      return {
        subject: `[FAREMIND] Flight Change – ${ref}`,
        html: wrap('[Admin] Flight Changed', `<h2 style="margin:0 0 8px;color:#0f172a;font-size:20px;font-weight:800;">Flight Changed</h2><p style="margin:0;color:#64748b;font-size:14px;">Flight change confirmed for booking <strong>${ref}</strong> by ${name} (${email}). ${String(d.old_flight_number ?? '')} → ${String(d.new_flight_number ?? '')}</p>`),
        text: `FLIGHT CHANGED: ${ref} by ${name}. ${String(d.old_flight_number ?? '')} → ${String(d.new_flight_number ?? '')}`,
      };

    case 'SEAT_SELECTION_UPDATED':
      return {
        subject: `[FAREMIND] Seat Change – ${ref}`,
        html: wrap('[Admin] Seat Updated', `<h2 style="margin:0 0 8px;color:#0f172a;font-size:20px;font-weight:800;">Seat Updated</h2><p style="margin:0;color:#64748b;font-size:14px;">Seat selection updated for booking <strong>${ref}</strong> by ${name} (${email}). Passenger: ${String(d.passenger_name ?? '')}</p>`),
        text: `SEAT CHANGED: ${ref} by ${name}. Passenger: ${String(d.passenger_name ?? '')}`,
      };

    case 'PRICE_DROP_REFUND':
      return {
        subject: `[FAREMIND] Price Drop Refund – ${ref}`,
        html: wrap('[Admin] Price Drop Refund', `<h2 style="margin:0 0 8px;color:#0f172a;font-size:20px;font-weight:800;">Price Drop Refund</h2><p style="margin:0;color:#64748b;font-size:14px;">Booking <strong>${ref}</strong> by ${name}: refund <strong style="color:#1abc9c;">${String(d.refund_amount ?? d.savings ?? '')}</strong></p>`),
        text: `PRICE DROP REFUND: ${ref} by ${name}, ${String(d.refund_amount ?? d.savings ?? '')}`,
      };

    case 'SUPPORT_MANUAL':
      return {
        subject: `[FAREMIND] Support Request – ${ref}`,
        html: wrap('[Admin] Support', `<h2 style="margin:0 0 8px;color:#0f172a;font-size:20px;font-weight:800;">Support Request</h2><p style="margin:0;color:#64748b;font-size:14px;">Manual support request for booking <strong>${ref}</strong> by ${name} (${email}).</p>`),
        text: `SUPPORT: ${ref} by ${name} (${email})`,
      };

    default:
      return null;
  }
}

// Which events send to customer vs support
const CUSTOMER_EVENTS = new Set<string>([
  'BOOKING_CONFIRMED', 'BOOKING_PENDING', 'BOOKING_CANCELLED', 'BOOKING_UPDATED',
  'PASSENGER_INFO_UPDATED',
  'DATE_CHANGE_SUBMITTED', 'DATE_CHANGE_APPROVED', 'DATE_CHANGE_REJECTED',
  'PAYMENT_SUCCESS', 'PAYMENT_FAILED',
  'PRICE_DROP_ALERT', 'PRICE_DROP_REFUND',
  'CHECKIN_REMINDER', 'UPCOMING_TRIP',
]);

const SUPPORT_EVENTS = new Set<string>([
  'BOOKING_CONFIRMED', 'BOOKING_PENDING', 'BOOKING_FAILED', 'BOOKING_CANCELLED',
  'BOOKING_UPDATED', 'PASSENGER_INFO_UPDATED',
  'FLIGHT_CHANGE_CONFIRMED', 'SEAT_SELECTION_UPDATED',
  'DATE_CHANGE_SUBMITTED', 'DATE_CHANGE_APPROVED', 'DATE_CHANGE_REJECTED',
  'PAYMENT_SUCCESS', 'PAYMENT_FAILED',
  'PRICE_DROP_REFUND', 'SUPPORT_MANUAL',
]);

// ═══════════════════════════════════════════════════════════
// Dynamic recipient lookup from DB
// ═══════════════════════════════════════════════════════════

async function getAdminRecipients(eventType: string): Promise<string[]> {
  try {
    const recipients = await prisma.notificationRecipient.findMany({
      where: { isActive: true },
    });

    const emails = new Set<string>();
    // Super admin always gets everything
    emails.add(SUPER_ADMIN_EMAIL);

    for (const r of recipients) {
      // Empty events array = subscribed to ALL events
      if (r.events.length === 0 || r.events.includes(eventType)) {
        emails.add(r.email.toLowerCase());
      }
    }

    return Array.from(emails);
  } catch (err) {
    console.warn('[notify] Failed to query recipients, falling back to super admin:', err);
    return [SUPER_ADMIN_EMAIL];
  }
}

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

    // Support/admin emails — send to ALL configured recipients
    if (SUPPORT_EVENTS.has(event_type)) {
      const spec = buildSupportEmail(event_type, data);
      if (spec) {
        const adminEmails = await getAdminRecipients(event_type);
        for (const adminEmail of adminEmails) {
          sendBrevo(adminEmail, spec.subject, spec.html, spec.text).catch(() => {});
        }
      }
    }
  } catch (err) {
    console.error(`[notify] ${payload.event_type} failed:`, err);
  }
}
