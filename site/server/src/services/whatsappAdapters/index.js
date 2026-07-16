/**
 * whatsappAdapters/index.js — WhatsApp provider adapter registry (Phase 3,
 * F11.2).
 *
 * One key per provider, each exposing `send(...)`. Today only Twilio ships; the
 * Meta Cloud API (`whatsappAdapters/meta.js`) is planned and drops in by adding
 * a sibling adapter and a line here. `whatsappService` resolves the adapter
 * through `getAdapter()` so the rest of the code is provider-agnostic. Mirrors
 * `smsAdapters/index.js` (F10.2).
 */

const twilio = require('./twilio');

const adapters = { twilio };

const getAdapter = (name = 'twilio') => adapters[name] || null;

module.exports = { getAdapter, adapters };
