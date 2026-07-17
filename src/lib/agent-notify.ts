/**
 * Agent email helper — sends directly via Brevo from frontend agent routes.
 * Sends to ALL parties: customer, agent, admin/super-admin.
 */

import { prisma } from '@/lib/db';

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const SENDER_EMAIL  = process.env.BREVO_SENDER_EMAIL ?? 'support@faremind.ai';
const SENDER_NAME   = 'FAREMIND';
const SUPER_ADMIN_EMAIL = 'mparihar@gmail.com';

async function sendBrevo(to: string, subject: string, html: string, text: string): Promise<boolean> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.warn(`[agent-notify] BREVO_API_KEY not set — skipping email to ${to}`);
    return false;
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
      console.error(`[agent-notify] Brevo ${res.status}: ${body}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[agent-notify] Send failed to ${to}:`, err);
    return false;
  }
}

async function getAdminEmails(): Promise<string[]> {
  const emails = new Set<string>();
  emails.add(SUPER_ADMIN_EMAIL);
  try {
    const recipients = await prisma.notificationRecipient.findMany({
      where: { isActive: true },
    });
    for (const r of recipients) {
      emails.add(r.email.toLowerCase());
    }
  } catch {}
  return Array.from(emails);
}

function wrapHtml(title: string, body: string): string {
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
      <span style="font-size:15px;font-weight:800;"><span style="color:#0f172a;">FARE</span><span style="color:#009CA6;">MIND</span></span>
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

export interface AgentNotifyParams {
  event: string;
  bookingRef: string;
  pnr?: string;
  customerName: string;
  customerEmail?: string;
  route: string;
  agentName: string;
  agentEmail: string;
  subject: string;          // For customer
  adminSubject: string;     // For admin/agent
  bodyHtml: string;         // Email body HTML (will be wrapped)
  adminBodyHtml?: string;   // Different body for admin (optional)
  bodyText: string;         // Plain text fallback
}

/**
 * Send notification to ALL parties: customer, agent, admin/super-admin.
 * Fire-and-forget — does not throw.
 */
export async function agentNotifyAll(params: AgentNotifyParams): Promise<void> {
  const { customerEmail, agentEmail, subject, adminSubject, bodyHtml, adminBodyHtml, bodyText, bookingRef } = params;

  const customerHtml = wrapHtml(params.event, bodyHtml);
  const adminHtml = wrapHtml(`[Agent] ${params.event}`, adminBodyHtml || bodyHtml);

  const promises: Promise<void>[] = [];

  // 1. Customer email
  if (customerEmail) {
    promises.push(
      sendBrevo(customerEmail, subject, customerHtml, bodyText).then(ok => {
        // Log to email_logs
        prisma.emailLog.create({
          data: { recipient: customerEmail, recipientName: params.customerName, subject, template: params.event, status: ok ? 'SENT' : 'FAILED', provider: 'Brevo', bookingRef },
        }).catch(() => {});
      })
    );
  }

  // 2. Agent email
  if (agentEmail && agentEmail !== customerEmail) {
    promises.push(
      sendBrevo(agentEmail, adminSubject, adminHtml, bodyText).then(ok => {
        prisma.emailLog.create({
          data: { recipient: agentEmail, recipientName: params.agentName, subject: adminSubject, template: `[Agent] ${params.event}`, status: ok ? 'SENT' : 'FAILED', provider: 'Brevo', bookingRef },
        }).catch(() => {});
      })
    );
  }

  // 3. Admin/super-admin emails
  const adminEmails = await getAdminEmails();
  for (const adminEmail of adminEmails) {
    if (adminEmail === agentEmail || adminEmail === customerEmail) continue; // avoid duplicate
    promises.push(
      sendBrevo(adminEmail, adminSubject, adminHtml, bodyText).then(ok => {
        prisma.emailLog.create({
          data: { recipient: adminEmail, recipientName: 'Admin', subject: adminSubject, template: `[Admin] ${params.event}`, status: ok ? 'SENT' : 'FAILED', provider: 'Brevo', bookingRef },
        }).catch(() => {});
      })
    );
  }

  await Promise.allSettled(promises);
}
