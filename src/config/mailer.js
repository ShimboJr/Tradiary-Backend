/**
 * config/mailer.js
 * Nodemailer transporter — configure once, export for use in utils/email.js.
 */

const nodemailer = require('nodemailer');

let transporter;

const getMailer = () => {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  console.log('[mailer] ✅  Nodemailer transporter ready.');
  return transporter;
};

module.exports = { getMailer };
