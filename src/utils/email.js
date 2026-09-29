/**
 * utils/email.js
 * Email sending helpers using Brevo Transactional Email API (HTTPS).
 * Drop-in replacement — same exported functions as before.
 */

const { Brevo } = require('@getbrevo/brevo');
const { getMailer } = require('../config/mailer');

const FROM_EMAIL = process.env.EMAIL_FROM_ADDRESS || 'noreply@tradiary.app';
const FROM_NAME = process.env.EMAIL_FROM_NAME || 'Tradiary';

// ─── Base HTML template ───────────────────────────────────────────────────────

const template = (body) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Tradiary</title>
</head>
<body style="margin:0;padding:0;background:#0d1117;font-family:Inter,system-ui,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d1117;padding:40px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#131920;border-radius:12px;border:1px solid #1e2a38;overflow:hidden;">
        <!-- Header -->
        <tr><td style="background:#1a2332;padding:24px 32px;border-bottom:1px solid #1e2a38;">
          <span style="display:inline-flex;align-items:center;gap:10px;font-size:20px;font-weight:700;color:#fff;letter-spacing:-0.5px;">
            <img src="https://tradiary.vercel.app/favicon.svg" width="28" height="28" alt="Tradiary" style="display:inline-block;vertical-align:middle;border-radius:6px;" />
            Tradiary
          </span>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px;">
          ${body}
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:20px 32px;border-top:1px solid #1e2a38;font-size:12px;color:#4a5568;">
          © ${new Date().getFullYear()} Tradiary · Free professional trading journal<br/>
          <span style="color:#2a6ef5;">tradairy.vercel.app</span>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

const btn = (url, label) =>
  `<a href="${url}" style="display:inline-block;margin-top:24px;padding:12px 28px;background:#2a6ef5;color:#fff;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;">${label}</a>`;

const p = (text) =>
  `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#c9d3e0;">${text}</p>`;

const h = (text) =>
  `<h2 style="margin:0 0 20px;font-size:20px;font-weight:700;color:#fff;">${text}</h2>`;

const note = (text) =>
  `<p style="margin:16px 0 0;font-size:12px;color:#4a5568;">${text}</p>`;

// ─── Generic send ─────────────────────────────────────────────────────────────

const sendEmail = async ({ to, subject, html, text }) => {
  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev && !process.env.BREVO_API_KEY) {
    // Dev fallback: log to console when no API key is configured
    console.log(`\n[email] ✉️  DEV — Would send to: ${to}`);
    console.log(`[email] Subject: ${subject}`);
    console.log(`[email] Body (text): ${text || html.replace(/<[^>]*>/g, '').trim().slice(0, 300)}\n`);
    return { messageId: 'dev-console' };
  }

  const brevoClient = getMailer();

  const result = await brevoClient.transactionalEmails.sendTransacEmail({
    sender: { name: FROM_NAME, email: FROM_EMAIL },
    to: [{ email: to }],
    subject,
    htmlContent: html,
    textContent: text || html.replace(/<[^>]*>/g, '').trim(),
  });

  console.log(`[email] Sent via Brevo API: ${result.body?.messageId || 'ok'}`);
  return result;
};

// ─── Email templates ──────────────────────────────────────────────────────────

const sendVerificationEmail = (to, name, verifyUrl) =>
  sendEmail({
    to,
    subject: 'Verify your Tradiary email address',
    html: template(
      h('Confirm your email') +
      p(`Hi ${name}, thanks for joining Tradiary! Click the button below to verify your email address. The link expires in <strong>24 hours</strong>.`) +
      btn(verifyUrl, 'Verify email address') +
      note(`If you didn't create a Tradiary account, you can safely ignore this email.`)
    ),
  });

const sendPasswordResetEmail = (to, name, resetUrl) =>
  sendEmail({
    to,
    subject: 'Reset your Tradiary password',
    html: template(
      h('Reset your password') +
      p(`Hi ${name}, we received a request to reset the password for your Tradiary account. Click the button below — the link expires in <strong>1 hour</strong>.`) +
      btn(resetUrl, 'Reset password') +
      note(`If you didn't request a password reset, you can safely ignore this email. Your password won't change.`)
    ),
  });

module.exports = { sendEmail, sendVerificationEmail, sendPasswordResetEmail };
