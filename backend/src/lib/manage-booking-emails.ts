/**
 * Post-Booking Management — Email Notification Templates
 *
 * Uses the same Brevo pattern as existing email.ts.
 * Does NOT modify or import from the existing email.ts.
 */

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const SENDER_EMAIL  = process.env.BREVO_SENDER_EMAIL ?? 'noreply@faremind.com';
const SENDER_NAME   = 'FareMind';

async function sendEmail(to: { email: string; name: string }, subject: string, html: string, text: string, attachment?: { name: string; content: string }): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.warn(`[manage-booking-email] BREVO_API_KEY not set — skipping email to ${to.email}`);
    return;
  }

  try {
    const payload: any = {
      sender: { name: SENDER_NAME, email: SENDER_EMAIL },
      to: [to],
      subject,
      htmlContent: html,
      textContent: text,
    };
    if (attachment) {
      payload.attachment = [attachment];
    }

    const res = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[manage-booking-email] Brevo error ${res.status}:`, body);
    }
  } catch (err) {
    console.error('[manage-booking-email] Send failed:', err);
  }
}

// ═══════════════════════════════════════════════
// Email Wrapper
// ═══════════════════════════════════════════════

function wrap(title: string, bodyHtml: string): string {
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
  ${bodyHtml}
</td></tr>
<tr><td style="padding:16px 32px;border-top:1px solid #f1f5f9;background:#fafafa;">
  <p style="margin:0;color:#94a3b8;font-size:11px;text-align:center;">
    &copy; ${year} FareMind &middot; Need help? <a href="mailto:support@faremind.com" style="color:#1abc9c;text-decoration:none;">support@faremind.com</a>
  </p>
</td></tr>
</table></td></tr></table></body></html>`;
}

// ═══════════════════════════════════════════════
// Templates
// ═══════════════════════════════════════════════

export async function sendCancellationEmail(data: {
  email: string;
  name: string;
  bookingRef: string;
  route: string;
  originalAmount: string;
  penaltyAmount: string;
  refundAmount: string;
  refundMethod: string;
}) {
  const html = wrap('Booking Cancelled', `
    <h2 style="margin:0 0 8px;color:#0f172a;font-size:20px;font-weight:800;">Booking Cancelled</h2>
    <p style="margin:0 0 24px;color:#64748b;font-size:14px;line-height:1.6;">
      Your booking <strong style="color:#0f172a">${data.bookingRef}</strong> for <strong>${data.route}</strong> has been cancelled.
    </p>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:24px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
        <tr><td style="padding:6px 0;color:#64748b;">Original Fare</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#0f172a;">${data.originalAmount}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">Cancellation Fee</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#ef4444;">${data.penaltyAmount}</td></tr>
        <tr style="border-top:1px solid #e2e8f0;"><td style="padding:10px 0 0;color:#0f172a;font-weight:700;">Estimated Refund</td><td style="padding:10px 0 0;text-align:right;font-weight:900;font-size:18px;color:#1abc9c;">${data.refundAmount}</td></tr>
      </table>
    </div>
    <p style="margin:0;color:#64748b;font-size:13px;">
      Refund via: <strong style="color:#0f172a">${data.refundMethod}</strong><br>
      Processing time: 5–10 business days
    </p>
  `);

  await sendEmail(
    { email: data.email, name: data.name },
    `Booking ${data.bookingRef} Cancelled — FareMind`,
    `Your booking ${data.bookingRef} for ${data.route} has been cancelled. Refund: ${data.refundAmount}`,
    html
  );
}

export async function sendFlightChangedEmail(data: {
  email: string;
  name: string;
  bookingRef: string;
  oldRoute: string;
  newRoute: string;
  fareDifference: string;
  newTotal: string;
}) {
  const html = wrap('Flight Changed', `
    <h2 style="margin:0 0 8px;color:#0f172a;font-size:20px;font-weight:800;">Flight Changed</h2>
    <p style="margin:0 0 24px;color:#64748b;font-size:14px;line-height:1.6;">
      Your booking <strong style="color:#0f172a">${data.bookingRef}</strong> has been updated.
    </p>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:24px;">
      <p style="margin:0 0 8px;color:#94a3b8;font-size:11px;text-transform:uppercase;font-weight:700;">Previous</p>
      <p style="margin:0 0 16px;color:#64748b;font-size:14px;text-decoration:line-through;">${data.oldRoute}</p>
      <p style="margin:0 0 8px;color:#1abc9c;font-size:11px;text-transform:uppercase;font-weight:700;">Updated</p>
      <p style="margin:0;color:#0f172a;font-size:14px;font-weight:700;">${data.newRoute}</p>
    </div>
    <p style="margin:0;color:#64748b;font-size:13px;">
      Fare difference: <strong style="color:#0f172a">${data.fareDifference}</strong> · New total: <strong style="color:#1abc9c">${data.newTotal}</strong>
    </p>
  `);

  await sendEmail(
    { email: data.email, name: data.name },
    `Flight Updated — ${data.bookingRef} — FareMind`,
    `Your booking ${data.bookingRef} has been changed. New route: ${data.newRoute}. Fare difference: ${data.fareDifference}.`,
    html
  );
}

export async function sendRefundStatusEmail(data: {
  email: string;
  name: string;
  bookingRef: string;
  refundAmount: string;
  status: 'initiated' | 'completed';
}) {
  const isComplete = data.status === 'completed';
  const html = wrap(isComplete ? 'Refund Completed' : 'Refund Initiated', `
    <h2 style="margin:0 0 8px;color:#0f172a;font-size:20px;font-weight:800;">
      ${isComplete ? '✅ Refund Completed' : '⏳ Refund Initiated'}
    </h2>
    <p style="margin:0 0 24px;color:#64748b;font-size:14px;line-height:1.6;">
      ${isComplete
        ? `Your refund of <strong style="color:#1abc9c">${data.refundAmount}</strong> for booking <strong>${data.bookingRef}</strong> has been processed.`
        : `A refund of <strong style="color:#1abc9c">${data.refundAmount}</strong> for booking <strong>${data.bookingRef}</strong> has been initiated.`}
    </p>
    ${!isComplete ? '<p style="margin:0;color:#64748b;font-size:13px;">Expected processing time: 5–10 business days.</p>' : ''}
  `);

  await sendEmail(
    { email: data.email, name: data.name },
    `${isComplete ? 'Refund Completed' : 'Refund Initiated'} — ${data.bookingRef} — FareMind`,
    `${isComplete ? 'Refund completed' : 'Refund initiated'}: ${data.refundAmount} for booking ${data.bookingRef}.`,
    html
  );
}

export async function sendAdminCancellationEmail(data: {
  bookingRef: string;
  customerName: string;
  customerEmail: string;
  route: string;
  originalAmount: string;
  penaltyAmount: string;
  refundAmount: string;
  refundMethod: string;
  pnrs: string;
  cancellationId: string;
}) {
  const adminEmail = process.env.ADMIN_EMAIL ?? 'mparihar@gmail.com';
  const html = wrap('[Admin] Booking Cancelled', `
    <h2 style="margin:0 0 8px;color:#0f172a;font-size:20px;font-weight:800;">Booking Cancelled</h2>
    <p style="margin:0 0 24px;color:#64748b;font-size:14px;line-height:1.6;">
      A booking has been cancelled and is pending refund processing.
    </p>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:24px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
        <tr><td style="padding:4px 0;color:#64748b;width:160px;">Booking Reference</td><td style="padding:4px 0;font-weight:700;color:#0f172a;">${data.bookingRef}</td></tr>
        <tr><td style="padding:4px 0;color:#64748b;">Customer</td><td style="padding:4px 0;color:#0f172a;">${data.customerName} &lt;${data.customerEmail}&gt;</td></tr>
        <tr><td style="padding:4px 0;color:#64748b;">Route</td><td style="padding:4px 0;color:#0f172a;">${data.route}</td></tr>
        <tr><td style="padding:4px 0;color:#64748b;">PNR(s)</td><td style="padding:4px 0;font-family:monospace;color:#0f172a;">${data.pnrs}</td></tr>
        <tr><td style="padding:4px 0;color:#64748b;">Original Fare</td><td style="padding:4px 0;font-weight:700;color:#0f172a;">${data.originalAmount}</td></tr>
        <tr><td style="padding:4px 0;color:#64748b;">Penalty / Fees</td><td style="padding:4px 0;font-weight:700;color:#ef4444;">${data.penaltyAmount}</td></tr>
        <tr style="border-top:1px solid #e2e8f0;"><td style="padding:10px 0 0;font-weight:700;color:#0f172a;">Refund Amount</td><td style="padding:10px 0 0;font-weight:900;font-size:16px;color:#1abc9c;">${data.refundAmount}</td></tr>
        <tr><td style="padding:4px 0;color:#64748b;">Refund Method</td><td style="padding:4px 0;color:#0f172a;">${data.refundMethod}</td></tr>
        <tr><td style="padding:4px 0;color:#64748b;">Cancellation ID</td><td style="padding:4px 0;font-family:monospace;font-size:11px;color:#64748b;">${data.cancellationId}</td></tr>
        <tr><td style="padding:4px 0;color:#64748b;">Timestamp</td><td style="padding:4px 0;color:#0f172a;">${new Date().toISOString()}</td></tr>
      </table>
    </div>
    <p style="margin:0;color:#64748b;font-size:12px;">Please verify refund processing in the admin console and Duffel dashboard.</p>
  `);

  await sendEmail(
    { email: adminEmail, name: 'FareMind Admin' },
    `[Admin] Booking ${data.bookingRef} Cancelled — Refund ${data.refundAmount}`,
    `Booking ${data.bookingRef} (${data.customerName}) cancelled. Refund: ${data.refundAmount} via ${data.refundMethod}.`,
    html
  );
}

export async function sendSeatChangedEmail(data: {
  email: string;
  name: string;
  bookingRef: string;
  segment: string;
  oldSeat: string;
  newSeat: string;
}) {
  const html = wrap('Seat Updated', `
    <h2 style="margin:0 0 8px;color:#0f172a;font-size:20px;font-weight:800;">Seat Updated</h2>
    <p style="margin:0 0 24px;color:#64748b;font-size:14px;line-height:1.6;">
      Your seat for booking <strong style="color:#0f172a">${data.bookingRef}</strong> on <strong>${data.segment}</strong> has been changed.
    </p>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px;">
      <p style="margin:0;color:#64748b;font-size:14px;">
        <span style="text-decoration:line-through;">${data.oldSeat}</span> → <strong style="color:#1abc9c;font-size:16px;">${data.newSeat}</strong>
      </p>
    </div>
  `);

  await sendEmail(
    { email: data.email, name: data.name },
    `Seat Changed — ${data.bookingRef} — FareMind`,
    `Your seat for booking ${data.bookingRef} has been changed from ${data.oldSeat} to ${data.newSeat}.`,
    html
  );
}

export async function sendItineraryEmail(data: {
  email: string;
  name: string;
  bookingRef: string;
  pnr: string;
  route: string;
  status: string;
  pdfBase64: string;
}) {
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;color:#0f172a;line-height:1.6;font-size:14px;">
      <p style="margin-bottom:16px;">Dear ${data.name},</p>
      
      <p style="margin-bottom:16px;">Thank you for booking with FareMind.</p>
      
      <p style="margin-bottom:24px;">Please find attached your full itinerary for your confirmed flight booking.</p>
      
      <div style="margin-bottom:24px;">
        <p style="margin:0;">Booking Reference: ${data.bookingRef}</p>
        <p style="margin:0;">Airline PNR: ${data.pnr}</p>
        <p style="margin:0;">Route: ${data.route}</p>
        <p style="margin:0;">Status: ${data.status}</p>
      </div>
      
      <p style="margin-bottom:16px;">Please review the attached itinerary for flight details, passenger information, baggage, seat status, fare rules, and important travel guidelines.</p>
      
      <p style="margin-bottom:24px;">Seat assignments, boarding passes, terminal, and gate information may be updated by the airline closer to departure. We recommend checking in online 24 hours before your flight.</p>
      
      <p style="margin:0;">Thank you,</p>
      <p style="margin:0;">FareMind Travel Support</p>
      <p style="margin:0;"><a href="mailto:support@faremind.ai" style="color:#1abc9c;text-decoration:none;">support@faremind.ai</a></p>
    </div>
  `;

  await sendEmail(
    { email: data.email, name: data.name },
    `Your FareMind Itinerary — Booking Reference ${data.bookingRef}`,
    html,
    `Please find attached your full itinerary for your confirmed flight booking ${data.bookingRef}.`,
    { name: `FareMind-Itinerary-${data.bookingRef}.html`, content: data.pdfBase64 }
  );
}
