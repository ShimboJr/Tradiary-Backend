/**
 * config/mailer.js
 * Nodemailer transporter — Brevo (smtp-relay.brevo.com) SMTP.
 * Brevo resolves to IPv4 only, making it compatible with Render's free tier.
 *
 * Required env vars:
 *   SMTP_USER  — your Brevo account login email
 *   SMTP_PASS  — your Brevo SMTP key (Settings → SMTP & API → SMTP Keys)
 *   EMAIL_FROM — display name + sender address, e.g. "Tradiary <noreply@yourdomain.com>"
 */

const nodemailer = require('nodemailer');

let transporter;

const getMailer = () => {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false, // STARTTLS on port 587
    auth: {
      user: process.env.SMTP_USER, // your Brevo account email
      pass: process.env.SMTP_PASS, // your Brevo SMTP key (not account password)
    },
  });

  console.log('[mailer] ✅  Nodemailer transporter ready.');
  return transporter;
};

module.exports = { getMailer };
