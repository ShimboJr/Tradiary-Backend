/**
 * utils/email.js
 * Email sending helpers using Brevo Transactional Email API (HTTPS).
 * Drop-in replacement — same exported functions as before.
 */

const { Brevo } = require('@getbrevo/brevo');
const { getMailer } = require('../config/mailer');

const FROM_EMAIL = process.env.EMAIL_FROM_ADDRESS || 'noreply@tradiary.app';
const FROM_NAME  = process.env.EMAIL_FROM_NAME    || 'Tradiary';

// ─── Brand icon ───────────────────────────────────────────────────────────────
// Strategy: use a hosted <img> URL so all email clients (including Gmail Web,
// which blocks data: URIs) can load it. CLIENT_ORIGIN must be the deployed
// frontend URL (e.g. https://tradiary.app) — already required for CORS.
//
// In development (CLIENT_ORIGIN = http://localhost:…) we fall back to a
// pure-CSS coloured "T" square — no broken image placeholder ever appears.

const _siteOrigin = (process.env.CLIENT_ORIGIN || '').split(',')[0].trim().replace(/\/$/, '');
const _useHosted   = _siteOrigin.startsWith('https://');

// CSS-only fallback: works in every email client, needs no image loading
const _CSS_ICON = `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;display:inline-table;">` +
  `<tr><td width="34" height="34" bgcolor="#5B6CFF" style="border-radius:8px;text-align:center;vertical-align:middle;` +
  `font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:900;color:#ffffff;line-height:34px;">T</td></tr></table>`;

const ICON_HTML = _useHosted
  ? `<img src="${_siteOrigin}/icon-192.png" width="34" height="34" alt="Tradiary" ` +
    `style="display:block;border:0;outline:none;text-decoration:none;" />`
  : _CSS_ICON;

// ─── Base HTML template ────────────────────────────────────────────────────────

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
          <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
            <tr>
              <td style="vertical-align:middle;padding-right:10px;">
                ${ICON_HTML}
              </td>
              <!-- Wordmark: "Tra" white, "diary" cyan — matching the brand spec -->
              <td style="vertical-align:middle;font-size:20px;font-weight:700;letter-spacing:-0.5px;font-family:Inter,Arial,sans-serif;">
                <span style="color:#E6EBF5;">Tra</span><span style="color:#22D3EE;">diary</span>
              </td>
            </tr>
          </table>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px;">
          ${body}
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:20px 32px;border-top:1px solid #1e2a38;font-size:12px;color:#4a5568;">
          © ${new Date().getFullYear()} Tradiary · Free professional trading journal<br/>
          <span style="color:#5B6CFF;">tradairy.vercel.app</span>
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

// ─── Safe text helper ─────────────────────────────────────────────────────────
// Escape every user-controlled value before it enters an HTML template string.
// This covers both classic HTML injection AND Handlebars/Mustache template
// injection (e.g. "{{8-2}}" becomes "{{8-2}}" which no engine evaluates).
// Rule: call esc() on ANY value that originates from user input — name, email,
// URLs stored by the user — before interpolating it into a template.

// HTML entities cover injection into markup; { and } are additionally encoded
// to break Handlebars/Mustache expressions (e.g. {{8-2}}) before Brevo's
// template engine sees the htmlContent string. Email clients decode &#x7B; /
// &#x7D; back to { / } for display, so the user sees the literal text they entered.
const ESC_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
  '{': '&#x7B;',
  '}': '&#x7D;',
};
const esc = (str) => String(str).replace(/[&<>"'{}]/g, (c) => ESC_MAP[c]);

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

const sendVerificationEmail = (to, name, verifyUrl) => {
  const safeName    = esc(name);
  const safeEmail   = esc(to);
  const safeUrl     = esc(verifyUrl);
  return sendEmail({
    to,
    subject: 'Verify your Tradiary email address',
    html: template(
      h('Confirm your email') +
      p(`Hi ${safeName}, thanks for joining Tradiary! Click the button below to verify your email address. The link expires in <strong>24 hours</strong>.`) +
      btn(safeUrl, 'Verify email address') +
      note(`If you didn't create a Tradiary account (${safeEmail}), you can safely ignore this email.`)
    ),
  });
};

const sendPasswordResetEmail = (to, name, resetUrl) => {
  const safeName  = esc(name);
  const safeUrl   = esc(resetUrl);
  return sendEmail({
    to,
    subject: 'Reset your Tradiary password',
    html: template(
      h('Reset your password') +
      p(`Hi ${safeName}, we received a request to reset the password for your Tradiary account. Click the button below — the link expires in <strong>1 hour</strong>.`) +
      btn(safeUrl, 'Reset password') +
      note(`If you didn't request a password reset, you can safely ignore this email. Your password won't change.`)
    ),
  });
};

const sendPasswordChangedEmail = (to, name) => {
  const safeName  = esc(name);
  const safeEmail = esc(to);
  const resetOrigin = esc(process.env.CLIENT_ORIGIN || 'http://localhost:5173');
  return sendEmail({
    to,
    subject: 'Your Tradiary password has been changed',
    html: template(
      h('Password changed successfully') +
      p(`Hi ${safeName}, this is a confirmation that the password for your Tradiary account (<strong>${safeEmail}</strong>) was just changed.`) +
      p(`If you made this change, no further action is needed.`) +
      note(`If you did not change your password, your account may be compromised. Please <a href="${resetOrigin}/forgot-password" style="color:#2a6ef5;">reset your password immediately</a> or contact support.`)
    ),
  });
};

module.exports = { sendEmail, sendVerificationEmail, sendPasswordResetEmail, sendPasswordChangedEmail };
