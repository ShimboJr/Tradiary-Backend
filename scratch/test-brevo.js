/**
 * scratch/test-brevo.js
 * Quick standalone Brevo API email test.
 * Run with: node scratch/test-brevo.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { BrevoClient } = require('@getbrevo/brevo');

const apiKey  = process.env.BREVO_API_KEY;
const toEmail = process.env.EMAIL_FROM_ADDRESS || 'noreply@tradiary.app';

console.log('─── Brevo API Test ─────────────────────────────────');
console.log(`BREVO_API_KEY    : "${apiKey ? apiKey.slice(0, 16) + '...' : '(not set)'}"`);
console.log(`EMAIL_FROM_NAME  : "${process.env.EMAIL_FROM_NAME || '(not set)'}"`);
console.log(`EMAIL_FROM_ADDR  : "${process.env.EMAIL_FROM_ADDRESS || '(not set)'}"`);
console.log(`Sending test to  : "${toEmail}"`);
console.log('────────────────────────────────────────────────────\n');

if (!apiKey || apiKey === 'YOUR_BREVO_API_KEY_HERE') {
  console.error('❌  BREVO_API_KEY not set in .env — add your real API key first.');
  process.exit(1);
}

(async () => {
  try {
    const client = new BrevoClient({ apiKey });

    console.log('🔄  Sending via Brevo API...');
    const result = await client.transactionalEmails.sendTransacEmail({
      sender:      { name: process.env.EMAIL_FROM_NAME || 'Tradiary Test', email: process.env.EMAIL_FROM_ADDRESS || 'noreply@tradiary.app' },
      to:          [{ email: toEmail }],
      subject:     'Tradiary — Brevo API test',
      textContent: 'If you can read this, Brevo API is working correctly!',
    });

    console.log('✅  Email sent! Message ID:', result.body?.messageId || 'ok');
  } catch (err) {
    console.error('❌  Brevo API Error:', err.message);
    if (err.response?.text) {
      try { console.error('    Details:', JSON.parse(err.response.text)); }
      catch { console.error('    Details:', err.response.text); }
    }
  }
})();
