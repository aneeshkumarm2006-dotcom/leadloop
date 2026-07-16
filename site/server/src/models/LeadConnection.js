const mongoose = require('mongoose');
const crypto = require('crypto');

/**
 * LeadConnection — a per-board API key that lets an external website form post
 * leads straight onto a board (Phase 4b, F14).
 *
 * It is the "bring your own form" sibling of the hosted F13 `Form` and the F7
 * inbound `WebhookEndpoint`. The difference is the onboarding: a webhook needs a
 * hand-authored `{ columnId: jsonPath }` mapping before it works, and a Form
 * needs a field map bound in the builder. A LeadConnection needs neither — the
 * FIRST authenticated POST self-defines the board's columns from the shape of
 * its JSON body (see `schemaInference.js` + `leadIngestService.js`):
 *
 *   1. first call  → infer a column per payload key, provision the missing
 *                    columns on the board, persist the resolved `fieldMap`, and
 *                    flip `schemaLocked` true;
 *   2. later calls → map each known key onto its column and create a task via the
 *                    shared `createTaskWithColumnValues` primitive, emitting the
 *                    same `item.created` / `form.submitted` / `lead.intake`
 *                    events as a Form so automations + the F9 intake policy fire.
 *
 * ─── Key handling ──────────────────────────────────────────────────────────
 * The plaintext key is shown to the admin exactly ONCE (on create / rotate) and
 * never stored. We keep only `tokenHash` (sha256, unique-indexed so ingest is a
 * single indexed lookup) plus `tokenLast4` + `keyId` for display. This mirrors
 * how Stripe/GitHub surface secrets: reveal once, store the hash.
 */

const ingestFieldSchema = new mongoose.Schema(
  {
    // The key as it arrives in the external form's JSON body (e.g. `full_name`).
    sourceKey: { type: String, required: true },
    // The board column slug (`Board.columns[].key`) the value lands in.
    columnKey: { type: String, required: true },
    // Human label shown in the docs UI (derived from sourceKey on inference).
    label: { type: String, default: '' },
    // The inferred column type — one of columnTypes.js (text|email|phone|…).
    type: { type: String, default: 'text' },
  },
  { _id: false }
);

const leadConnectionSchema = new mongoose.Schema(
  {
    boardId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Board',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },

    // Public, non-secret handle for the key — safe to list/log. Used only for
    // display ("Key kf3a…"); auth resolves by `tokenHash`, never this.
    keyId: { type: String, index: true },
    // sha256(plaintext key). Unique + sparse so ingest resolves in one indexed
    // lookup and a not-yet-generated row can't collide on null.
    tokenHash: { type: String, default: null },
    // Last 4 chars of the plaintext key, for a "•••• a1b2" display hint.
    tokenLast4: { type: String, default: '' },

    // Flips true once the first submission has defined the schema ("initial
    // provisioning done" — NOT "frozen"; see `evolveSchema`). While false, the
    // next submission provisions columns; while true, the fieldMap is used.
    schemaLocked: { type: Boolean, default: false },
    // Resolved source-key → column mapping (written on provisioning, appended
    // to whenever the schema evolves).
    fieldMap: { type: [ingestFieldSchema], default: [] },
    // When true (default) the schema EVOLVES: unseen fields in later
    // submissions auto-create columns. When false, unseen fields only produce
    // `unmapped_key` warnings — a freeze valve against typo'd form fields
    // spawning junk columns.
    evolveSchema: { type: Boolean, default: true },

    // Marketing attribution: when true, provisioning also adds a `Source` column
    // and every lead is stamped with `sourceTag` so these are attributable.
    attributeSource: { type: Boolean, default: true },
    sourceTag: { type: String, default: '' },

    enabled: { type: Boolean, default: true, index: true },

    // Lightweight stats surfaced in the docs UI ("12 leads, last 2m ago").
    submissionCount: { type: Number, default: 0 },
    lastSubmissionAt: { type: Date, default: null },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// One indexed lookup on ingest; sparse so rows mid-creation (hash null) are exempt.
leadConnectionSchema.index({ tokenHash: 1 }, { unique: true, sparse: true });

/** sha256 of a plaintext key → the value stored/looked-up as `tokenHash`. */
const hashKey = (plaintext) =>
  crypto.createHash('sha256').update(String(plaintext)).digest('hex');

/**
 * Mint a fresh plaintext key + the derived stored fields. Returned once to the
 * admin; only the derived fields are persisted.
 *
 * Format: `lk_` + 32 url-safe bytes. The `lk_` prefix makes the key greppable
 * in the caller's own logs and unmistakable as a "lead key".
 *
 * @returns {{ apiKey, keyId, tokenHash, tokenLast4 }}
 */
const generateApiKey = () => {
  const secret = crypto.randomBytes(24).toString('hex'); // 48 hex chars
  const apiKey = `lk_${secret}`;
  return {
    apiKey,
    keyId: crypto.randomBytes(6).toString('hex'),
    tokenHash: hashKey(apiKey),
    tokenLast4: apiKey.slice(-4),
  };
};

// Ensure a display `keyId` exists even for rows created without a key yet.
leadConnectionSchema.pre('validate', function ensureKeyId() {
  if (!this.keyId) this.keyId = crypto.randomBytes(6).toString('hex');
});

const LeadConnection = mongoose.model('LeadConnection', leadConnectionSchema);
LeadConnection.hashKey = hashKey;
LeadConnection.generateApiKey = generateApiKey;

module.exports = LeadConnection;
