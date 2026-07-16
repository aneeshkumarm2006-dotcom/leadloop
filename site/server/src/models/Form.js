const mongoose = require('mongoose');

/**
 * Form — a public, brandable intake form mapped to a board's columns
 * (Phase 4, F13.1).
 *
 * Each form publishes to `/f/:slug`. A submission runs through the SAME
 * `lead.intake` pipeline as an inbound webhook (F7): the
 * `formSubmissionService` maps each field's value onto the bound board column,
 * creates a task via `createTaskWithColumnValues`, and emits `form.submitted`
 * (F4 `FORM_SUBMITTED` trigger) + `lead.intake` (F9 intake policy).
 *
 * `fieldMap` binds each rendered form field to a target board column:
 *   - `formFieldId` : stable per-field id used to key the submitted payload.
 *   - `type`        : the FORM input type (text|email|phone|number|dropdown…)
 *                     — coercion only; the board column's own validator is the
 *                     real gate when the task is created.
 *   - `columnId`    : the board column the value lands in (string id, parity
 *                     with the F12 filter shape / columnValues keys).
 *   - `options`     : choices for a dropdown-typed field.
 *
 * Indexes: `{ slug: 1 }` unique, `{ boardId: 1 }`.
 */

const formFieldSchema = new mongoose.Schema(
  {
    formFieldId: { type: String, required: true },
    label: { type: String, default: '' },
    type: { type: String, default: 'text' },
    required: { type: Boolean, default: false },
    // Target board column (string id — see CalendarView for the same parity
    // choice with columnValues keys + the shared filter shape).
    columnId: { type: String, default: null },
    options: { type: [String], default: [] },
  },
  { _id: false }
);

const formSchema = new mongoose.Schema(
  {
    boardId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Board',
      required: true,
    },
    // Public URL handle. Generated in pre('validate') from the name + a short
    // random suffix; the unique index is the hard guarantee.
    slug: { type: String, unique: true },
    name: { type: String, required: true, trim: true },
    fieldMap: { type: [formFieldSchema], default: [] },
    welcomeMessage: { type: String, default: '' },
    postSubmitRedirectUrl: { type: String, default: '' },
    captchaEnabled: { type: Boolean, default: false },
    enabled: { type: Boolean, default: true },
    // Phase 2.3 — lead-source auto-fill. `sourceTag` (e.g. "Website Form") is
    // stamped onto `sourceColumnId` on every submission so the Marketing/ROI
    // report can attribute these leads. Both optional.
    sourceTag: { type: String, default: '' },
    sourceColumnId: { type: String, default: null },
    // Branding for the public form (Phase 1.7). All optional; empty values fall
    // back to the default app styling. `accentColor` is a hex string used for
    // the submit button / accents; `headline` overrides the form name heading.
    branding: {
      type: new mongoose.Schema(
        {
          logoUrl: { type: String, default: '' },
          coverUrl: { type: String, default: '' },
          accentColor: { type: String, default: '' },
          headline: { type: String, default: '' },
        },
        { _id: false }
      ),
      default: () => ({}),
    },
  },
  { timestamps: true }
);

formSchema.index({ boardId: 1 });

/** Lowercase, hyphenate, strip non-url-safe chars; cap length. */
const slugify = (value) =>
  String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

/**
 * Generate `slug` on first validate from the name + a short base36 suffix so
 * two forms named the same don't collide. Preserved across updates (renaming a
 * form keeps its public URL stable).
 */
formSchema.pre('validate', function generateSlug() {
  if (this.slug) return;
  const base = slugify(this.name) || 'form';
  const suffix = Math.random().toString(36).slice(2, 8);
  this.slug = `${base}-${suffix}`;
});

module.exports = mongoose.model('Form', formSchema);
module.exports.slugify = slugify;
