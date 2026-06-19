import { prisma } from '@/lib/db';

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const SENDER_EMAIL  = process.env.BREVO_SENDER_EMAIL ?? 'noreply@faremind.com';
const SENDER_NAME   = 'FAREMIND Admin';

// ── Email logging ────────────────────────────────────────────────────────────
// Logs every outbound email to the email_logs table for the admin Email History page.

async function logEmail(opts: {
  recipient: string;
  recipientName: string;
  subject: string;
  template: string;
  status: 'SENT' | 'FAILED';
  bookingRef?: string | null;
  errorMessage?: string | null;
}): Promise<void> {
  try {
    await prisma.emailLog.create({
      data: {
        recipient: opts.recipient,
        recipientName: opts.recipientName,
        subject: opts.subject,
        template: opts.template,
        status: opts.status,
        provider: 'Brevo',
        bookingRef: opts.bookingRef ?? null,
        errorMessage: opts.errorMessage ?? null,
      },
    });
  } catch (e) {
    console.error('[email-log] Failed to log email:', e instanceof Error ? e.message : e);
  }
}

export async function sendAdminOtp(toEmail: string, toName: string, otp: string): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;

  if (!apiKey) {
    console.warn(`[email] BREVO_API_KEY not set — OTP for ${toEmail}: ${otp}`);
    return;
  }

  const payload = {
    sender:      { name: SENDER_NAME, email: SENDER_EMAIL },
    to:          [{ email: toEmail, name: toName }],
    subject:     `${otp} — Your FAREMIND Admin OTP`,
    htmlContent: buildOtpHtml(toName, otp),
    textContent: `Your FAREMIND Admin OTP is: ${otp}\n\nValid for 5 minutes. Do not share it.`,
  };

  const res = await fetch(BREVO_API_URL, {
    method:  'POST',
    headers: {
      'api-key':     apiKey,
      'Content-Type': 'application/json',
      'accept':       'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[email] Brevo error ${res.status}:`, body);
    await logEmail({ recipient: toEmail, recipientName: toName, subject: `${otp} — Your FAREMIND Admin OTP`, template: 'OTP Verification', status: 'FAILED', errorMessage: `HTTP ${res.status}: ${body.slice(0, 200)}` });
    throw new Error(`Failed to send email: ${res.status}`);
  }

  await logEmail({ recipient: toEmail, recipientName: toName, subject: `${otp} — Your FAREMIND Admin OTP`, template: 'OTP Verification', status: 'SENT' });
}

function buildOtpHtml(name: string, otp: string): string {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#1e293b;border-radius:16px;border:1px solid #334155;overflow:hidden;">
        <tr><td style="padding:28px 32px;border-bottom:1px solid #334155;">
          <table cellpadding="0" cellspacing="0"><tr>
            <td style="width:36px;height:36px;background:rgba(26,188,156,0.15);border-radius:10px;border:1px solid rgba(26,188,156,0.3);text-align:center;line-height:36px;">
              <span style="color:#1abc9c;font-size:18px;font-weight:900;">F</span>
            </td>
            <td style="padding-left:12px;">
              <span style="color:#fff;font-size:15px;font-weight:800;"><span style="color:#FFFFFF;">FARE</span><span style="color:#009CA6;">MIND</span></span>
              <span style="display:block;color:#64748b;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;">Admin Console</span>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 8px;color:#94a3b8;font-size:13px;">Hi ${name},</p>
          <p style="margin:0 0 28px;color:#e2e8f0;font-size:15px;line-height:1.6;">
            Use the code below to complete your sign-in to the FAREMIND Admin Console.
            This code expires in <strong style="color:#fff;">5 minutes</strong>.
          </p>
          <div style="background:#0f172a;border:1px solid #334155;border-radius:12px;padding:28px;text-align:center;margin-bottom:28px;">
            <span style="font-family:'Courier New',monospace;font-size:40px;font-weight:900;letter-spacing:.3em;color:#1abc9c;">${otp}</span>
          </div>
          <p style="margin:0 0 6px;color:#64748b;font-size:12px;text-align:center;">
            Never share this code. FAREMIND will never ask for it by phone or chat.
          </p>
          <p style="margin:0;color:#475569;font-size:12px;text-align:center;">
            If you did not attempt to sign in, please ignore this email.
          </p>
        </td></tr>
        <tr><td style="padding:16px 32px;border-top:1px solid #334155;background:#0f172a;">
          <p style="margin:0;color:#334155;font-size:11px;text-align:center;">
            &copy; ${year} FAREMIND &middot; Restricted Access
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function sendSupportRoleGrantedEmail(toEmail: string, toName: string): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.warn(`[email] BREVO_API_KEY not set — Role granted for ${toEmail}`);
    return;
  }

  const payload = {
    sender:      { name: SENDER_NAME, email: SENDER_EMAIL },
    to:          [{ email: toEmail, name: toName }],
    subject:     `Welcome to the FAREMIND Support Team`,
    htmlContent: buildSupportRoleHtml(toName),
    textContent: `Hi ${toName}, you have been granted Support privileges on the FAREMIND Admin Console.`,
  };

  const res = await fetch(BREVO_API_URL, {
    method:  'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json', 'accept': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[email] Brevo error ${res.status}:`, body);
    await logEmail({ recipient: toEmail, recipientName: toName, subject: 'Welcome to the FAREMIND Support Team', template: 'Support Role Granted', status: 'FAILED', errorMessage: `HTTP ${res.status}` });
  } else {
    await logEmail({ recipient: toEmail, recipientName: toName, subject: 'Welcome to the FAREMIND Support Team', template: 'Support Role Granted', status: 'SENT' });
  }
}

export async function sendTicketAssignedEmail(toEmail: string, toName: string, ticketId: string, subject: string): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.warn(`[email] BREVO_API_KEY not set — Ticket assigned for ${toEmail}`);
    return;
  }

  const payload = {
    sender:      { name: SENDER_NAME, email: SENDER_EMAIL },
    to:          [{ email: toEmail, name: toName }],
    subject:     `New Ticket Assigned: ${ticketId}`,
    htmlContent: buildTicketAssignedHtml(toName, ticketId, subject),
    textContent: `Hi ${toName}, ticket ${ticketId} (${subject}) has been assigned to you.`,
  };

  const res = await fetch(BREVO_API_URL, {
    method:  'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json', 'accept': 'application/json' },
    body: JSON.stringify(payload),
  });

  const emailSubject = `New Ticket Assigned: ${ticketId}`;
  if (!res.ok) {
    const body = await res.text();
    console.error(`[email] Brevo error ${res.status}:`, body);
    await logEmail({ recipient: toEmail, recipientName: toName, subject: emailSubject, template: 'Ticket Assigned', status: 'FAILED', errorMessage: `HTTP ${res.status}` });
  } else {
    await logEmail({ recipient: toEmail, recipientName: toName, subject: emailSubject, template: 'Ticket Assigned', status: 'SENT' });
  }
}

function buildSupportRoleHtml(name: string): string {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#1e293b;border-radius:16px;border:1px solid #334155;overflow:hidden;">
        <tr><td style="padding:32px;">
          <h2 style="color:#1abc9c;margin:0 0 16px;">Welcome to Support!</h2>
          <p style="margin:0 0 16px;color:#e2e8f0;font-size:15px;line-height:1.6;">
            Hi ${name},<br><br>
            An administrator has granted you <strong>Support</strong> privileges on the FAREMIND Admin Console.
            You now have access to the Support Queue, where you can view and respond to customer tickets.
          </p>
        </td></tr>
        <tr><td style="padding:16px 32px;border-top:1px solid #334155;background:#0f172a;">
          <p style="margin:0;color:#334155;font-size:11px;text-align:center;">&copy; ${year} FAREMIND</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildTicketAssignedHtml(name: string, ticketId: string, subject: string): string {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#1e293b;border-radius:16px;border:1px solid #334155;overflow:hidden;">
        <tr><td style="padding:32px;">
          <h2 style="color:#3b82f6;margin:0 0 16px;">New Ticket Assigned</h2>
          <p style="margin:0 0 16px;color:#e2e8f0;font-size:15px;line-height:1.6;">
            Hi ${name},<br><br>
            A new ticket has been assigned to you by an administrator.
          </p>
          <div style="background:#0f172a;border:1px solid #334155;border-radius:12px;padding:20px;margin-bottom:20px;">
            <p style="margin:0 0 8px;color:#1abc9c;font-weight:bold;">${ticketId}</p>
            <p style="margin:0;color:#fff;font-size:16px;">${subject}</p>
          </div>
          <p style="margin:0;color:#94a3b8;font-size:14px;">Please check the Support Queue to respond.</p>
        </td></tr>
        <tr><td style="padding:16px 32px;border-top:1px solid #334155;background:#0f172a;">
          <p style="margin:0;color:#334155;font-size:11px;text-align:center;">&copy; ${year} FAREMIND</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function sendFailedBookingAssignedEmail(toEmail: string, toName: string, bookingRef: string, customer: string): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.warn(`[email] BREVO_API_KEY not set — Failed Booking assigned for ${toEmail}`);
    return;
  }

  const payload = {
    sender:      { name: SENDER_NAME, email: SENDER_EMAIL },
    to:          [{ email: toEmail, name: toName }],
    subject:     `Failed Booking Resolution Assigned: ${bookingRef}`,
    htmlContent: buildFailedBookingAssignedHtml(toName, bookingRef, customer),
    textContent: `Hi ${toName}, a failed booking resolution (${bookingRef} for ${customer}) has been assigned to you.`,
  };

  const res = await fetch(BREVO_API_URL, {
    method:  'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json', 'accept': 'application/json' },
    body: JSON.stringify(payload),
  });

  const emailSubject = `Failed Booking Resolution Assigned: ${bookingRef}`;
  if (!res.ok) {
    const body = await res.text();
    console.error(`[email] Brevo error ${res.status}:`, body);
    await logEmail({ recipient: toEmail, recipientName: toName, subject: emailSubject, template: 'Failed Booking Assigned', status: 'FAILED', bookingRef, errorMessage: `HTTP ${res.status}` });
  } else {
    await logEmail({ recipient: toEmail, recipientName: toName, subject: emailSubject, template: 'Failed Booking Assigned', status: 'SENT', bookingRef });
  }
}

export async function sendFailedBookingResolvedEmail(toEmails: {email: string, name: string}[], bookingRef: string, resolvedBy: string): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.warn(`[email] BREVO_API_KEY not set — Failed Booking resolved`);
    return;
  }
  
  if (toEmails.length === 0) return;

  const payload = {
    sender:      { name: SENDER_NAME, email: SENDER_EMAIL },
    to:          toEmails,
    subject:     `Failed Booking RESOLVED: ${bookingRef}`,
    htmlContent: buildFailedBookingResolvedHtml(bookingRef, resolvedBy),
    textContent: `Failed booking ${bookingRef} has been marked as RESOLVED by ${resolvedBy}. Please review and close.`,
  };

  const res = await fetch(BREVO_API_URL, {
    method:  'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json', 'accept': 'application/json' },
    body: JSON.stringify(payload),
  });

  const emailSubject = `Failed Booking RESOLVED: ${bookingRef}`;
  if (!res.ok) {
    const body = await res.text();
    console.error(`[email] Brevo error ${res.status}:`, body);
    for (const r of toEmails) {
      await logEmail({ recipient: r.email, recipientName: r.name, subject: emailSubject, template: 'Failed Booking Resolved', status: 'FAILED', bookingRef, errorMessage: `HTTP ${res.status}` });
    }
  } else {
    for (const r of toEmails) {
      await logEmail({ recipient: r.email, recipientName: r.name, subject: emailSubject, template: 'Failed Booking Resolved', status: 'SENT', bookingRef });
    }
  }
}

function buildFailedBookingAssignedHtml(name: string, bookingRef: string, customer: string): string {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#1e293b;border-radius:16px;border:1px solid #334155;overflow:hidden;">
        <tr><td style="padding:32px;">
          <h2 style="color:#f59e0b;margin:0 0 16px;">Failed Booking Assigned</h2>
          <p style="margin:0 0 16px;color:#e2e8f0;font-size:15px;line-height:1.6;">
            Hi ${name},<br><br>
            A failed booking resolution has been assigned to you.
          </p>
          <div style="background:#0f172a;border:1px solid #334155;border-radius:12px;padding:20px;margin-bottom:20px;">
            <p style="margin:0 0 8px;color:#f59e0b;font-weight:bold;">${bookingRef || 'Unknown Ref'}</p>
            <p style="margin:0;color:#fff;font-size:16px;">Customer: ${customer}</p>
          </div>
          <p style="margin:0;color:#94a3b8;font-size:14px;">Please check the Failed Bookings queue to investigate and resolve.</p>
        </td></tr>
        <tr><td style="padding:16px 32px;border-top:1px solid #334155;background:#0f172a;">
          <p style="margin:0;color:#334155;font-size:11px;text-align:center;">&copy; ${year} FAREMIND</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildFailedBookingResolvedHtml(bookingRef: string, resolvedBy: string): string {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#1e293b;border-radius:16px;border:1px solid #334155;overflow:hidden;">
        <tr><td style="padding:32px;">
          <h2 style="color:#10b981;margin:0 0 16px;">Failed Booking Resolved</h2>
          <p style="margin:0 0 16px;color:#e2e8f0;font-size:15px;line-height:1.6;">
            A failed booking has been investigated and marked as <strong>RESOLVED</strong> by ${resolvedBy}.
          </p>
          <div style="background:#0f172a;border:1px solid #334155;border-radius:12px;padding:20px;margin-bottom:20px;">
            <p style="margin:0;color:#1abc9c;font-weight:bold;">${bookingRef || 'Unknown Ref'}</p>
          </div>
          <p style="margin:0;color:#94a3b8;font-size:14px;">Please review the resolution notes and change the status to CLOSED.</p>
        </td></tr>
        <tr><td style="padding:16px 32px;border-top:1px solid #334155;background:#0f172a;">
          <p style="margin:0;color:#334155;font-size:11px;text-align:center;">&copy; ${year} FAREMIND</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
