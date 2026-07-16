const mongoose = require('mongoose');

/**
 * AutomationRecipe — a seeded, board-agnostic automation template (Phase 2, F6.1).
 *
 * Recipes are the catalogue behind the "Use recipe" flow: a one-click clone
 * produces a *disabled*, pre-filled `Automation` on a chosen board that the user
 * reviews, binds to that board's columns/groups, and enables (F6.3
 * `createFromRecipe`). Because a recipe can't know a specific board's column
 * `_id`s, its column references are stored as the stable column **key** slug
 * (e.g. `stage`, `move_in_date`, `owner` — see Board.columnSchema.key) and the
 * clone resolver maps key → that board's column id. Status option references
 * (e.g. STATUS_BECAME `toValue`) are stored as the option id/label and resolved
 * against the target column's options.
 *
 * Versioning policy (pre-flight DECIDED: snapshot-at-clone, no auto-migration):
 * a clone copies the recipe's shape at clone time. Editing the recipe later does
 * NOT migrate already-cloned automations.
 */
const recipeConditionSchema = new mongoose.Schema(
  {
    type: { type: String, required: true },
    value: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false }
);

const recipeActionSchema = new mongoose.Schema(
  {
    type: { type: String, required: true },
    // Per-type config mirroring Automation.actionSchema.config (Mixed) — the F5
    // `actionTypes` registry owns validation. Column references inside are stored
    // as column keys and resolved on clone.
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

const automationRecipeSchema = new mongoose.Schema(
  {
    // Stable upsert key for the idempotent seed (F6.2). Unique + indexed.
    slug: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      default: '',
    },
    // Reuses the Automation triggerType vocabulary (all nine F4 triggers).
    triggerType: {
      type: String,
      enum: [
        'SCHEDULE',
        'ITEM_CREATED',
        'GROUP_CREATED',
        'COLUMN_VALUE_CHANGED',
        'STATUS_BECAME',
        'DATE_ARRIVED',
        'PERSON_ASSIGNED',
        'FORM_SUBMITTED',
        'WEBHOOK_RECEIVED',
      ],
      required: true,
    },
    // Trigger config in recipe form: column references are column KEYS (resolved
    // to ids on clone), not board-specific ObjectIds.
    triggerConfig: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    conditions: {
      type: [recipeConditionSchema],
      default: [],
    },
    actions: {
      type: [recipeActionSchema],
      default: [],
    },
    // Region targeting (F6.2 / Thoma stakeholder check). `null` (or empty) means
    // the recipe applies to every workspace; an array restricts it to those
    // workspace regions (see Organisation.region: Edmonton / Saskatoon / Regina /
    // Montreal). Stored as a plain array so the catalogue can filter client-side.
    region: {
      type: [String],
      default: null,
    },
    // Lucide icon name rendered on the recipe card.
    iconName: {
      type: String,
      default: 'Zap',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AutomationRecipe', automationRecipeSchema);
