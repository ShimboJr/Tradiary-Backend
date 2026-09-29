const { BrevoClient } = require('@getbrevo/brevo');
const client = new BrevoClient({ apiKey: 'test' });
const te = client.transactionalEmails;
// Get all enumerable + prototype methods
const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(te));
console.log('transactionalEmails prototype methods:', proto);
