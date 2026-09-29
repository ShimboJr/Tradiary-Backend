/**
 * config/mailer.js
 * Brevo Transactional Email API client (new @getbrevo/brevo SDK).
 * Uses HTTPS (port 443) — works on Render free tier and any host.
 * No SMTP involved; outbound port 587/465 restrictions are irrelevant.
 *
 * Required env var:
 *   BREVO_API_KEY — Brevo dashboard → Settings → SMTP & API → API Keys → Create a new API key
 */

const { BrevoClient } = require('@getbrevo/brevo');

let client;

const getMailer = () => {
  if (client) return client;

  client = new BrevoClient({ apiKey: process.env.BREVO_API_KEY });

  console.log('[mailer] ✅  Brevo API client ready.');
  return client;
};

module.exports = { getMailer };
