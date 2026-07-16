const AutomationRecipe = require('../models/AutomationRecipe');
const Automation = require('../models/Automation');
const { getActionType, validateActionConfig } = require('../utils/actionTypes');
const { CHANNEL_LABELS } = require('../seeds/automationRecipes');
const {
  loadBoardContext,
  populateAutomation,
  sanitizeTriggerConfig,
} = require('./automationController');

const DORMANT_TRIGGERS = ['FORM_SUBMITTED', 'WEBHOOK_RECEIVED'];

// ---------------------------------------------------------------------------
// Pure clone-resolution helpers (no DB) — exported for unit tests (F6.6).
// ---------------------------------------------------------------------------

const asId = (v) => (v == null ? '' : v.toString());

/**
 * Resolve a recipe column reference (a board column **key** slug, or an id from
 * an override) to the target board's column id. Returns `{ id, col, provided,
 * resolved }`.
 */
const resolveColumnRef = (board, ref) => {
  if (ref == null || ref === '') {
    return { id: '', col: null, provided: false, resolved: false };
  }
  const s = asId(ref);
  const cols = Array.isArray(board && board.columns) ? board.columns : [];
  let col = cols.find((c) => asId(c._id) === s);
  if (!col) col = cols.find((c) => c.key === s);
  if (col) return { id: asId(col._id), col, provided: true, resolved: true };
  return { id: '', col: null, provided: true, resolved: false };
};

/**
 * Resolve a recipe status-option reference (option id or label, case-insensitive)
 * against a status column's options. Returns `{ value, provided, resolved }`.
 */
const resolveOptionRef = (col, ref) => {
  if (ref == null || ref === '') {
    return { value: '', provided: false, resolved: false };
  }
  const opts = col && col.settings && Array.isArray(col.settings.options)
    ? col.settings.options
    : [];
  const s = asId(ref).toLowerCase();
  const match = opts.find(
    (o) => asId(o.id).toLowerCase() === s || asId(o.label).toLowerCase() === s
  );
  if (match) return { value: asId(match.id), provided: true, resolved: true };
  return { value: asId(ref), provided: true, resolved: false };
};

/**
 * Resolve a recipe's `triggerConfig` (column keys → ids, option labels → ids)
 * against the target board. Returns `{ triggerConfig, ok }` where `ok` is false
 * when a required binding can't be satisfied yet. Re-runs the F4 sanitizer for
 * fully-resolved task triggers so the persisted shape matches a hand-built one.
 */
const resolveTriggerConfig = (triggerType, rawCfg, board) => {
  const cfg = rawCfg && typeof rawCfg === 'object' ? rawCfg : {};

  switch (triggerType) {
    case 'COLUMN_VALUE_CHANGED': {
      const r = resolveColumnRef(board, cfg.columnId);
      const out = r.resolved ? { columnId: r.id } : {};
      // columnId is optional ("any column"); only a provided-but-unresolved ref
      // is a problem.
      return { triggerConfig: out, ok: !(r.provided && !r.resolved) };
    }
    case 'STATUS_BECAME': {
      const rc = resolveColumnRef(board, cfg.columnId);
      const isStatus = !!(rc.col && rc.col.type === 'status');
      const toOpt = isStatus
        ? resolveOptionRef(rc.col, cfg.toValue)
        : { value: '', provided: cfg.toValue != null, resolved: false };
      const fromOpt =
        isStatus && cfg.fromValue != null && cfg.fromValue !== ''
          ? resolveOptionRef(rc.col, cfg.fromValue)
          : null;
      const out = {};
      if (rc.resolved && isStatus) out.columnId = rc.id;
      if (toOpt.resolved) out.toValue = toOpt.value;
      if (fromOpt && fromOpt.resolved) out.fromValue = fromOpt.value;
      const ok =
        rc.resolved && isStatus && toOpt.resolved && (!fromOpt || fromOpt.resolved);
      return { triggerConfig: out, ok };
    }
    case 'DATE_ARRIVED': {
      const rc = resolveColumnRef(board, cfg.columnId);
      const isDate = !!(rc.col && rc.col.type === 'date');
      const out = {
        offsetDays: Number.isInteger(Number(cfg.offsetDays)) ? Number(cfg.offsetDays) : 0,
        comparison: ['before', 'on', 'after'].includes(cfg.comparison) ? cfg.comparison : 'on',
      };
      if (rc.resolved && isDate) out.columnId = rc.id;
      return { triggerConfig: out, ok: rc.resolved && isDate };
    }
    case 'PERSON_ASSIGNED': {
      const rc = resolveColumnRef(board, cfg.columnId);
      const isPerson = !!(rc.col && rc.col.type === 'person');
      const out = {};
      if (rc.resolved && isPerson) out.columnId = rc.id;
      return { triggerConfig: out, ok: rc.resolved && isPerson };
    }
    case 'FORM_SUBMITTED': {
      const out = {};
      if (cfg.formId) out.formId = asId(cfg.formId);
      return { triggerConfig: out, ok: true };
    }
    case 'WEBHOOK_RECEIVED': {
      const out = {};
      if (cfg.endpointId) out.endpointId = asId(cfg.endpointId);
      return { triggerConfig: out, ok: true };
    }
    default:
      // SCHEDULE / ITEM_CREATED / GROUP_CREATED carry no triggerConfig.
      return { triggerConfig: {}, ok: true };
  }
};

// Action config fields that hold a column reference, keyed by action type.
const ACTION_COLUMN_REF_FIELDS = {
  SET_COLUMN_VALUE: ['columnId'],
  CREATE_CALENDAR_EVENT: ['startsAtColumnRef'],
  NOTIFY_PERSON: ['userIdOrColumnRef'],
  SEND_EMAIL: ['to'],
  SEND_SMS: ['to'],
  SEND_WHATSAPP: ['to'],
};

/**
 * Resolve one recipe action's config against the board and assess completeness.
 * Returns `{ action: { type, config }, ok, channel }`:
 *   - column-ref fields are mapped key → board column id (unresolved → left
 *     empty so the editor prompts the user)
 *   - `ok` is the F5 registry's `validate` verdict on the resolved config
 *   - `channel` is the un-shipped phase the action needs (e.g. 'F8'), or null
 */
const resolveAction = (rawAction, board) => {
  const type = rawAction.type;
  const config = { ...(rawAction.config || {}) };

  for (const field of ACTION_COLUMN_REF_FIELDS[type] || []) {
    const ref = config[field];
    if (ref == null || ref === '') continue;
    const r = resolveColumnRef(board, ref);
    // Only rewrite when it resolved to a real column. NOTIFY_PERSON/SEND_* `to`
    // may legitimately be a raw user id (from an override) — leave those as-is.
    if (r.resolved) config[field] = r.id;
    else if (ACTION_COLUMN_REF_FIELDS[type][0] === field && type === 'SET_COLUMN_VALUE') {
      config[field] = '';
    }
  }

  const entry = getActionType(type);
  const channel = entry && entry.disabled ? entry.requires || null : null;

  const result = validateActionConfig(type, config, { board });
  // Use the normalised config when it validates; keep the best-effort resolved
  // config otherwise so the user can finish it in the chain editor.
  const finalConfig = result.ok ? result.config : config;
  return { action: { type, config: finalConfig }, ok: result.ok, channel };
};

/**
 * Build a disabled Automation document from a recipe, resolved against a target
 * board. Pure (no DB) so it's unit-testable. Returns `{ doc, validation,
 * warnings }`. The doc is always `enabled: false`; `validation` is 'incomplete'
 * when any binding is unsatisfied or any action needs an un-shipped channel.
 */
const buildAutomationFromRecipe = (recipe, board, { userId, overrides } = {}) => {
  const warnings = [];
  let complete = true;

  const tr = resolveTriggerConfig(recipe.triggerType, recipe.triggerConfig, board);
  let triggerConfig = tr.triggerConfig;
  if (!tr.ok) {
    complete = false;
    warnings.push('Finish binding the trigger to a column on this board.');
  } else {
    // Re-validate the resolved shape through the canonical F4 sanitizer; if it
    // still rejects, treat as incomplete rather than persisting a bad config.
    const sanitized = sanitizeTriggerConfig(recipe.triggerType, triggerConfig, board);
    if (sanitized.error) {
      complete = false;
      warnings.push('Finish binding the trigger to a column on this board.');
    } else {
      triggerConfig = sanitized.config;
    }
  }

  const actions = [];
  (recipe.actions || []).forEach((rawAction, i) => {
    const { action, ok, channel } = resolveAction(rawAction, board);
    actions.push(action);
    if (channel) {
      complete = false;
      warnings.push(
        `Action ${i + 1} (${action.type}) requires ${CHANNEL_LABELS[channel] || channel} setup.`
      );
    } else if (!ok) {
      complete = false;
      warnings.push(`Action ${i + 1} (${action.type}) needs configuration on this board.`);
    }
  });

  // Only board-agnostic GROUP_NAME_MATCHES conditions survive a clone; id-based
  // conditions reference board-specific groups/statuses and are dropped for the
  // user to re-add. (The seed catalogue carries none.)
  const conditions = [];
  for (const c of recipe.conditions || []) {
    if (c.type === 'GROUP_NAME_MATCHES' && c.value) {
      conditions.push({ type: c.type, value: String(c.value) });
    } else {
      complete = false;
      warnings.push('Re-add the condition on this board.');
    }
  }

  const name =
    overrides && typeof overrides.name === 'string' && overrides.name.trim()
      ? overrides.name.trim()
      : recipe.name;

  const validation = complete ? 'complete' : 'incomplete';
  const doc = {
    name,
    board: board._id,
    organisation: board.organisation,
    enabled: false, // always — the user reviews + enables (AC2)
    triggerType: recipe.triggerType,
    triggerConfig,
    conditions,
    actions,
    validation,
    createdBy: userId,
    nextRunAt: null,
  };
  return { doc, validation, warnings };
};

/**
 * Static per-recipe requirement summary for the catalogue card: the channels it
 * needs connected and whether its trigger is dormant (no emitter yet).
 */
const summariseRecipeRequirements = (recipe) => {
  const phases = new Set();
  for (const a of recipe.actions || []) {
    const entry = getActionType(a.type);
    if (entry && entry.disabled && entry.requires) phases.add(entry.requires);
  }
  const requiresSetup = [...phases].map((p) => ({
    phase: p,
    label: CHANNEL_LABELS[p] || p,
  }));
  return {
    requiresSetup,
    triggerDormant: DORMANT_TRIGGERS.includes(recipe.triggerType),
  };
};

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * GET /api/automations/recipes — list the recipe catalogue (authenticated).
 * Optional `?region=Edmonton` returns region-agnostic recipes plus those tagged
 * for that region. Each recipe carries a `requiresSetup` / `triggerDormant`
 * summary for the card chip.
 */
const listRecipes = async (req, res) => {
  try {
    const { region } = req.query;
    const recipes = await AutomationRecipe.find().sort({ createdAt: 1 }).lean();
    const filtered = region
      ? recipes.filter(
          (r) => !r.region || r.region.length === 0 || r.region.includes(region)
        )
      : recipes;
    const payload = filtered.map((r) => ({
      ...r,
      ...summariseRecipeRequirements(r),
    }));
    return res.json({ recipes: payload });
  } catch (err) {
    console.error('listRecipes error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * POST /api/automations/from-recipe/:slug — clone a recipe into a new, disabled
 * Automation on `boardId` (admin). Body `{ boardId, overrides? }`. Returns the
 * populated automation plus `validation` + human `warnings` so the UI can tell
 * the user what still needs binding/connecting.
 */
const createFromRecipe = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { slug } = req.params;
    const { boardId, overrides } = req.body || {};

    if (!boardId) {
      return res.status(400).json({ error: 'boardId is required' });
    }

    const ctx = await loadBoardContext(boardId, userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    if (!ctx.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const recipe = await AutomationRecipe.findOne({ slug }).lean();
    if (!recipe) return res.status(404).json({ error: 'Recipe not found' });

    const { doc, validation, warnings } = buildAutomationFromRecipe(recipe, ctx.board, {
      userId,
      overrides,
    });

    const automation = await Automation.create(doc);
    const populated = await populateAutomation(Automation.findById(automation._id));
    return res.status(201).json({ automation: populated, validation, warnings });
  } catch (err) {
    console.error('createFromRecipe error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  listRecipes,
  createFromRecipe,
  // Pure helpers exported for unit tests (F6.6).
  buildAutomationFromRecipe,
  summariseRecipeRequirements,
  resolveTriggerConfig,
  resolveAction,
  resolveColumnRef,
  resolveOptionRef,
};
