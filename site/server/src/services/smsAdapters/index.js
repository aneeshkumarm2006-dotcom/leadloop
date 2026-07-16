/**
 * smsAdapters/index.js — SMS provider adapter registry (Phase 3, F10.2).
 *
 * One key per provider, each exposing `send(...)`. Today only Twilio ships;
 * Plivo/Vonage drop in by adding a sibling adapter and a line here. `smsService`
 * resolves the adapter through `getAdapter()` so the rest of the code is
 * provider-agnostic.
 */

const twilio = require('./twilio');

const adapters = { twilio };

const getAdapter = (name = 'twilio') => adapters[name] || null;

module.exports = { getAdapter, adapters };
