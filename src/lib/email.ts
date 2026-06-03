const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const SENDER_EMAIL  = process.env.BREVO_SENDER_EMAIL ?? 'noreply@faremind.com';
const SENDER_NAME   = 'FAREMIND Admin';

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
    throw new Error(`Failed to send email: ${res.status}`);
  }
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
