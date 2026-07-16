/* ============================================================
   Shared: render a REAL automation as a plain-language sentence,
   and map a design recipe / sentence-builder selection into a
   valid board-scoped Automation create payload.
   ============================================================ */
import { L } from './premiumData';

export const TRIGGER_PHRASE = {
  SCHEDULE: { en: 'on a schedule', fr: 'selon un horaire' },
  ITEM_CREATED: { en: 'a new lead is created', fr: 'un prospect est créé' },
  GROUP_CREATED: { en: 'a new group is created', fr: 'un groupe est créé' },
  COLUMN_VALUE_CHANGED: { en: 'a field changes', fr: 'un champ change' },
  STATUS_BECAME: { en: 'a lead’s status changes', fr: 'le statut d’un prospect change' },
  CHECKBOX_CHECKED: { en: 'a checkbox is checked', fr: 'une case est cochée' },
  NUMBER_CROSSED: { en: 'a number crosses a threshold', fr: 'un nombre franchit un seuil' },
  ITEM_MOVED_TO_GROUP: { en: 'a lead changes group', fr: 'un prospect change de groupe' },
  UPDATE_POSTED: { en: 'an update is posted', fr: 'une mise à jour est publiée' },
  DATE_ARRIVED: { en: 'a date arrives', fr: 'une date arrive' },
  PERSON_ASSIGNED: { en: 'a person is assigned', fr: 'une personne est assignée' },
  FORM_SUBMITTED: { en: 'a form is submitted', fr: 'un formulaire est soumis' },
  WEBHOOK_RECEIVED: { en: 'a webhook is received', fr: 'un webhook est reçu' },
};
export const ACTION_PHRASE = {
  CREATE_TASK: { en: 'create a task', fr: 'créer une tâche' },
  CREATE_SUBITEM: { en: 'create a subitem', fr: 'créer un sous-élément' },
  SET_COLUMN_VALUE: { en: 'set a field', fr: 'définir un champ' },
  CLEAR_COLUMN: { en: 'clear a field', fr: 'vider un champ' },
  MOVE_TO_GROUP: { en: 'move it to a group', fr: 'le déplacer vers un groupe' },
  DUPLICATE_ITEM: { en: 'duplicate it', fr: 'le dupliquer' },
  DELETE_ITEM: { en: 'delete it', fr: 'le supprimer' },
  NOTIFY_PERSON: { en: 'notify someone', fr: 'aviser quelqu’un' },
  SEND_EMAIL: { en: 'send an email', fr: 'envoyer un courriel' },
  ENROLL_IN_SEQUENCE: { en: 'start an email sequence', fr: 'lancer une séquence courriel' },
  SEND_SMS: { en: 'send an SMS', fr: 'envoyer un SMS' },
  SEND_WHATSAPP: { en: 'send a WhatsApp', fr: 'envoyer un WhatsApp' },
  CREATE_CALENDAR_EVENT: { en: 'add a calendar event', fr: 'ajouter un événement' },
  POST_WEBHOOK: { en: 'post a webhook', fr: 'envoyer un webhook' },
  ASSIGN_LEAD_AGENT: { en: 'assign an agent', fr: 'assigner un agent' },
};

export function AutomationSentence({ a, lang, chipClass = 'vchip' }) {
  const trig = TRIGGER_PHRASE[a.triggerType] || { en: a.triggerType, fr: a.triggerType };
  const acts = (a.actionTypes || []).map((tp) => ACTION_PHRASE[tp] || { en: tp, fr: tp });
  const isSched = a.triggerType === 'SCHEDULE';
  return (
    <>
      {!isSched && <span className="sb-fixed">{L({ en: 'When ', fr: 'Quand ' }, lang)}</span>}
      <span className={chipClass}>{L(trig, lang)}</span>
      {acts.length > 0 && <span>{L({ en: ', ', fr: ', ' }, lang)}</span>}
      {acts.map((ac, i) => <span key={i}>{i > 0 ? L({ en: ' and ', fr: ' et ' }, lang) : ''}<span className={chipClass}>{L(ac, lang)}</span></span>)}
      {acts.length === 0 && <span style={{ color: 'var(--muted)' }}> · {L({ en: 'no actions yet', fr: 'aucune action' }, lang)}</span>}
      .
    </>
  );
}

// ---- design selection → valid board-scoped Automation payload ----
const findCol = (board, type) => (board?.columns || []).find((c) => c && c.type === type);

/**
 * Map one design action ({key, val}) to a real, validated action config on the
 * given board. Falls back to NOTIFY_PERSON(currentUser) when a richer action
 * can't be resolved (e.g. no phone column for SMS), so the result always saves.
 */
export function mapAction(actionKey, val, board, currentUserId) {
  const msg = typeof val === 'string' && val.trim() ? val.trim() : null;
  const notify = (m) => ({ type: 'NOTIFY_PERSON', config: { userIdOrColumnRef: currentUserId, message: m || 'A lead needs your attention 👀' } });

  if (actionKey === 'sms') {
    const phone = findCol(board, 'phone');
    if (phone) return { type: 'SEND_SMS', config: { to: String(phone._id), template: msg || 'Hi! Just checking in on your home search 🙂' } };
    return notify(msg);
  }
  if (actionKey === 'email') {
    const email = findCol(board, 'email');
    if (email) return { type: 'SEND_EMAIL', config: { to: String(email._id), subject: 'Following up', body: msg || 'Hi {{Name}}, just following up on your home search.' } };
    return notify(msg);
  }
  if (actionKey === 'notify' || actionKey === 'assign') {
    const person = findCol(board, 'person');
    const ref = person ? String(person._id) : currentUserId;
    return { type: 'NOTIFY_PERSON', config: { userIdOrColumnRef: ref, message: msg || 'A lead needs your attention 👀' } };
  }
  return notify(msg);
}

/**
 * Map a design trigger ({key, val}) to a real backend trigger + triggerConfig.
 * - status  → STATUS_BECAME on the board's status column (val matched to an option)
 * - form    → FORM_SUBMITTED
 * - new/noreply/visit/other → ITEM_CREATED (the universally-valid baseline;
 *   "no reply in N days" / "visit booked" have no native trigger yet, so a new
 *   lead is the safe stand-in and the full intent stays in the name).
 */
const findStatusTrigger = (board, label) => {
  const col = (board?.columns || []).find((c) => c && c.type === 'status');
  if (!col) return null;
  const opts = (col.settings && col.settings.options) || [];
  const match = opts.find((o) => String(o.label || '').toLowerCase() === String(label || '').toLowerCase());
  if (!match) return null;
  return { columnId: String(col._id), toValue: String(match.id ?? match._id ?? match.value ?? '') };
};

export function buildTrigger(trigger, board) {
  const key = trigger && trigger.key;
  if (key === 'status') {
    const cfg = findStatusTrigger(board, trigger.val);
    if (cfg && cfg.toValue) return { triggerType: 'STATUS_BECAME', triggerConfig: cfg };
  } else if (key === 'form') {
    return { triggerType: 'FORM_SUBMITTED', triggerConfig: {} };
  }
  return { triggerType: 'ITEM_CREATED', triggerConfig: {} };
}

/**
 * Build a valid create payload. The trigger is mapped to its real backend type
 * where we can resolve it (status / form), else ITEM_CREATED. The full sentence
 * is preserved in `name` and trigger/conditions can be refined in the board editor.
 */
export function buildPayload({ name, trigger, actions, board, currentUserId }) {
  const acts = (actions && actions.length ? actions : [{ key: 'notify', val: null }])
    .filter((a) => a && a.key)
    .map((a) => mapAction(a.key, a.val, board, currentUserId));
  const { triggerType, triggerConfig } = buildTrigger(trigger, board);
  return {
    name: (name || 'New automation').slice(0, 120),
    triggerType,
    triggerConfig,
    actions: acts.length ? acts : [mapAction('notify', null, board, currentUserId)],
    enabled: true,
  };
}

/** Derive a single design action from a recipe + its filled blanks. */
export function recipeToAction(vals) {
  const ch = vals && vals.channel;
  if (ch === 'an SMS') return { key: 'sms', val: null };
  if (ch === 'an email') return { key: 'email', val: null };
  return { key: 'notify', val: null };
}

/** Derive the design trigger for a recipe (the few that aren't "new lead"). */
export function recipeToTrigger(recipe, vals) {
  if (!recipe) return { key: 'new' };
  if (recipe.id === 'r9' || recipe.id === 'r12') return { key: 'status', val: vals && vals.status };
  if (recipe.id === 'r6') return { key: 'form' };
  return { key: 'new' };
}
