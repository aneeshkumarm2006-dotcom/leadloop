/* ============================================================
   premiumData.js — sample CRM data + automations recipe/vocab model
   + bilingual helpers (EN / FR-QC), ported from the design bundle.
   Drives the four premium pages until they're wired to live data.
   ============================================================ */

// ---- bilingual helper ----
export const L = (o, lang) => {
  if (o == null) return o;
  if (typeof o === 'string') return o;
  return o[lang] != null ? o[lang] : o.en;
};
export const t = (lang) => (o) => L(o, lang);

export const STR = {
  cancel: { en: 'Cancel', fr: 'Annuler' },
  save: { en: 'Save', fr: 'Enregistrer' },
  done: { en: 'Done', fr: 'Terminé' },
  back: { en: 'Back', fr: 'Retour' },
};

// ---- sample CRM data (boards / members / sources) ----
export const CRM = {
  members: [
    { id: 'u1', name: 'Camille Tremblay', first: 'Camille', initials: 'CT', color: '#4F46E5', role: 'Agent' },
    { id: 'u2', name: 'Léa Bouchard', first: 'Léa', initials: 'LB', color: '#DB2777', role: 'Admin' },
    { id: 'u3', name: 'Mathieu Gagnon', first: 'Mathieu', initials: 'MG', color: '#0D9488', role: 'Agent' },
    { id: 'u4', name: 'Sophie Roy', first: 'Sophie', initials: 'SR', color: '#EA580C', role: 'Member' },
    { id: 'u5', name: 'Olivier Côté', first: 'Olivier', initials: 'OC', color: '#0EA5E9', role: 'Agent' },
    { id: 'u6', name: 'Noémie Lavoie', first: 'Noémie', initials: 'NL', color: '#7C3AED', role: 'Admin' },
    { id: 'u8', name: 'Anaïs Bélanger', first: 'Anaïs', initials: 'AB', color: '#D97706', role: 'Agent' },
  ],
  sources: ['Google Ads', 'Facebook', 'Website Form', 'Referral', 'Centris', 'Walk-in'],
  boards: [
    { id: 'b1', name: 'Plateau Mont-Royal Leads', icon: 'home', color: '#4F46E5' },
    { id: 'b2', name: 'Westmount Luxury Listings', icon: 'diamond', color: '#7C3AED' },
    { id: 'b3', name: 'Griffintown Condos', icon: 'building', color: '#0EA5E9' },
    { id: 'b4', name: 'Laval Family Homes', icon: 'tree', color: '#16A34A' },
    { id: 'b5', name: 'Commercial — Old Port', icon: 'store', color: '#D97706' },
    { id: 'b6', name: 'South Shore Rentals', icon: 'key', color: '#0D9488' },
    { id: 'b8', name: 'Open House Pipeline', icon: 'calendar', color: '#DB2777' },
  ],
};

// split "a … {{v}} …" → [{text}, {blank:'v'}, {text}]
export const splitTpl = (str) => {
  const out = [];
  const re = /\{\{(\w+)\}\}/g;
  let last = 0, m;
  while ((m = re.exec(str))) {
    if (m.index > last) out.push({ text: str.slice(last, m.index) });
    out.push({ blank: m[1] });
    last = m.index + m[0].length;
  }
  if (last < str.length) out.push({ text: str.slice(last) });
  return out;
};

// ---- value vocabularies used by chip popovers ----
export const VOCAB = {
  status: () => ['New Lead', 'Contacted', 'Interested', 'Follow-up', 'Visit Booked', 'Won', 'Lost'],
  board: () => CRM.boards.map((b) => b.name),
  source: () => CRM.sources,
  agent: () => ['the assigned agent', ...CRM.members.map((m) => m.name)],
  duration: () => ['1 hour', '2 hours', '4 hours', '1 day', '2 days', '3 days', '5 days', '1 week'],
  money: () => ['$300K', '$500K', '$700K', '$1M', '$1.5M', '$2M'],
  day: () => ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'every weekday'],
  time: () => ['8:00 AM', '9:00 AM', '12:00 PM', '5:00 PM', '6:00 PM'],
  channel: () => ['an SMS', 'an email', 'a WhatsApp message'],
};
const VOCAB_FR = {
  status: { 'New Lead': 'Nouveau', Contacted: 'Contacté', Interested: 'Intéressé', 'Follow-up': 'Relance', 'Visit Booked': 'Visite réservée', Won: 'Gagné', Lost: 'Perdu' },
  agent: { 'the assigned agent': 'l’agent assigné' },
  duration: { '1 hour': '1 heure', '2 hours': '2 heures', '4 hours': '4 heures', '1 day': '1 jour', '2 days': '2 jours', '3 days': '3 jours', '5 days': '5 jours', '1 week': '1 semaine' },
  day: { Monday: 'lundi', Tuesday: 'mardi', Wednesday: 'mercredi', Thursday: 'jeudi', Friday: 'vendredi', 'every weekday': 'chaque jour de semaine' },
  channel: { 'an SMS': 'un SMS', 'an email': 'un courriel', 'a WhatsApp message': 'un message WhatsApp' },
};
export const valLabel = (kind, v, lang) => (lang === 'fr' && VOCAB_FR[kind] && VOCAB_FR[kind][v]) || v;

// ---- recipe gallery ----
export const REC_CATS = [
  { key: 'followup', label: { en: 'Follow-ups', fr: 'Relances' }, icon: 'refresh' },
  { key: 'routing', label: { en: 'Lead routing', fr: 'Acheminement des prospects' }, icon: 'share' },
  { key: 'visits', label: { en: 'Visit reminders', fr: 'Rappels de visite' }, icon: 'calendar' },
  { key: 'notify', label: { en: 'Notifications', fr: 'Notifications' }, icon: 'bell' },
  { key: 'listings', label: { en: 'Listings', fr: 'Inscriptions' }, icon: 'home' },
];

export const RECIPES = [
  { id: 'r1', cat: 'followup', uses: 312,
    tpl: { en: 'When a lead hasn’t replied in {{days}}, send them {{channel}} as a friendly follow-up.', fr: 'Quand un prospect n’a pas répondu depuis {{days}}, lui envoyer {{channel}} en guise de relance amicale.' },
    blanks: { days: { kind: 'duration', def: '3 days' }, channel: { kind: 'channel', def: 'an SMS' } } },
  { id: 'r2', cat: 'followup', uses: 188,
    tpl: { en: 'After a visit, wait {{days}} and remind {{agent}} to check in with the client.', fr: 'Après une visite, attendre {{days}} puis rappeler à {{agent}} de prendre des nouvelles du client.' },
    blanks: { days: { kind: 'duration', def: '1 day' }, agent: { kind: 'agent', def: 'the assigned agent' } } },
  { id: 'r3', cat: 'followup', uses: 96,
    tpl: { en: 'If a lead has had no activity for {{days}}, quietly mark them as {{status}}.', fr: 'Si un prospect est inactif depuis {{days}}, le marquer discrètement comme {{status}}.' },
    blanks: { days: { kind: 'duration', def: '1 week' }, status: { kind: 'status', def: 'Follow-up' } } },
  { id: 'r4', cat: 'routing', uses: 241,
    tpl: { en: 'When a new lead comes from {{source}}, assign it to {{agent}}.', fr: 'Quand un nouveau prospect provient de {{source}}, l’assigner à {{agent}}.' },
    blanks: { source: { kind: 'source', def: 'Referral' }, agent: { kind: 'agent', def: 'Camille Tremblay' } } },
  { id: 'r5', cat: 'routing', uses: 154,
    tpl: { en: 'When a lead’s budget is over {{money}}, move it to {{board}}.', fr: 'Quand le budget d’un prospect dépasse {{money}}, le déplacer vers {{board}}.' },
    blanks: { money: { kind: 'money', def: '$1M' }, board: { kind: 'board', def: 'Westmount Luxury Listings' } } },
  { id: 'r6', cat: 'routing', uses: 72,
    tpl: { en: 'When a form is submitted, create a lead and notify {{agent}}.', fr: 'Quand un formulaire est soumis, créer un prospect et aviser {{agent}}.' },
    blanks: { agent: { kind: 'agent', def: 'the assigned agent' } } },
  { id: 'r7', cat: 'visits', uses: 203,
    tpl: { en: '{{days}} before a booked visit, text the client a friendly reminder.', fr: '{{days}} avant une visite réservée, envoyer au client un rappel amical par texto.' },
    blanks: { days: { kind: 'duration', def: '2 hours' } } },
  { id: 'r8', cat: 'visits', uses: 118,
    tpl: { en: 'When a visit is booked, add it to {{agent}}’s calendar and notify them.', fr: 'Quand une visite est réservée, l’ajouter au calendrier de {{agent}} et l’aviser.' },
    blanks: { agent: { kind: 'agent', def: 'the assigned agent' } } },
  { id: 'r9', cat: 'notify', uses: 276,
    tpl: { en: 'When a lead’s status becomes {{status}}, notify {{agent}}.', fr: 'Quand le statut d’un prospect devient {{status}}, aviser {{agent}}.' },
    blanks: { status: { kind: 'status', def: 'Interested' }, agent: { kind: 'agent', def: 'the assigned agent' } } },
  { id: 'r10', cat: 'notify', uses: 134,
    tpl: { en: 'Every {{day}} at {{time}}, send me a summary of new leads.', fr: 'Chaque {{day}} à {{time}}, m’envoyer un résumé des nouveaux prospects.' },
    blanks: { day: { kind: 'day', def: 'Monday' }, time: { kind: 'time', def: '8:00 AM' } } },
  { id: 'r11', cat: 'notify', uses: 61,
    tpl: { en: 'When {{agent}} is assigned a lead, send them a welcome checklist.', fr: 'Quand un prospect est assigné à {{agent}}, lui envoyer une liste de bienvenue.' },
    blanks: { agent: { kind: 'agent', def: 'the assigned agent' } } },
  { id: 'r12', cat: 'listings', uses: 89,
    tpl: { en: 'When a listing is marked {{status}}, notify {{agent}} to update the website.', fr: 'Quand une inscription est marquée {{status}}, aviser {{agent}} de mettre à jour le site.' },
    blanks: { status: { kind: 'status', def: 'Won' }, agent: { kind: 'agent', def: 'the assigned agent' } } },
];

// ---- sentence builder vocabulary ----
export const TRIGGERS = [
  { key: 'status', label: { en: 'A lead’s status changes', fr: 'Le statut d’un prospect change' }, tpl: { en: 'a lead’s status becomes {{v}}', fr: 'le statut d’un prospect devient {{v}}' }, param: { kind: 'status', def: 'Interested' } },
  { key: 'new', label: { en: 'A new lead is created', fr: 'Un prospect est créé' }, tpl: { en: 'a new lead is created in {{v}}', fr: 'un prospect est créé dans {{v}}' }, param: { kind: 'board', def: 'Plateau Mont-Royal Leads' } },
  { key: 'noreply', label: { en: 'A lead doesn’t reply', fr: 'Un prospect ne répond pas' }, tpl: { en: 'a lead hasn’t replied in {{v}}', fr: 'un prospect n’a pas répondu depuis {{v}}' }, param: { kind: 'duration', def: '3 days' } },
  { key: 'visit', label: { en: 'A visit is booked', fr: 'Une visite est réservée' }, tpl: { en: 'a visit is booked', fr: 'une visite est réservée' }, param: null },
  { key: 'form', label: { en: 'A form is submitted', fr: 'Un formulaire est soumis' }, tpl: { en: 'a form is submitted', fr: 'un formulaire est soumis' }, param: null },
];
export const CONDITIONS = [
  { key: 'budget', label: { en: 'Budget is over…', fr: 'Le budget dépasse…' }, tpl: { en: 'their budget is over {{v}}', fr: 'leur budget dépasse {{v}}' }, param: { kind: 'money', def: '$700K' } },
  { key: 'source', label: { en: 'Source is…', fr: 'La source est…' }, tpl: { en: 'the source is {{v}}', fr: 'la source est {{v}}' }, param: { kind: 'source', def: 'Referral' } },
  { key: 'statusis', label: { en: 'Status is…', fr: 'Le statut est…' }, tpl: { en: 'the status is {{v}}', fr: 'le statut est {{v}}' }, param: { kind: 'status', def: 'New Lead' } },
];
export const ACTIONS = [
  { key: 'sms', label: { en: 'Send an SMS', fr: 'Envoyer un SMS' }, tpl: { en: 'send them an SMS', fr: 'leur envoyer un SMS' }, param: { kind: 'text', def: 'Hi! Just checking in on your home search 🙂' } },
  { key: 'email', label: { en: 'Send an email', fr: 'Envoyer un courriel' }, tpl: { en: 'send them an email', fr: 'leur envoyer un courriel' }, param: { kind: 'text', def: '' } },
  { key: 'notify', label: { en: 'Notify an agent', fr: 'Aviser un agent' }, tpl: { en: 'notify {{v}}', fr: 'aviser {{v}}' }, param: { kind: 'agent', def: 'the assigned agent' } },
  { key: 'assign', label: { en: 'Assign to an agent', fr: 'Assigner à un agent' }, tpl: { en: 'assign it to {{v}}', fr: 'l’assigner à {{v}}' }, param: { kind: 'agent', def: 'Camille Tremblay' } },
  { key: 'move', label: { en: 'Move to a board', fr: 'Déplacer vers un tableau' }, tpl: { en: 'move it to {{v}}', fr: 'le déplacer vers {{v}}' }, param: { kind: 'board', def: 'Westmount Luxury Listings' } },
  { key: 'task', label: { en: 'Create a task', fr: 'Créer une tâche' }, tpl: { en: 'create a follow-up task', fr: 'créer une tâche de relance' }, param: null },
];

// ---- sample live automations (for the Forms list + Automations hub) ----
export const AUTOMATIONS = [
  { id: 'a1', board: 'b1', enabled: true, creator: 'u1', lastRun: '2026-06-09T07:42:00', runs: { ok: 184, fail: 0 }, spark: [3, 5, 4, 6, 5, 7, 6, 8, 7, 9, 8, 6], tpl: { en: 'When a lead’s status becomes {{0}}, notify {{1}}.', fr: 'Quand le statut d’un prospect devient {{0}}, aviser {{1}}.' }, chips: ['Interested', 'the assigned agent'] },
  { id: 'a2', board: 'b1', enabled: true, creator: 'u2', lastRun: '2026-06-09T06:10:00', runs: { ok: 96, fail: 0 }, spark: [2, 3, 2, 4, 3, 5, 4, 3, 5, 4, 6, 5], tpl: { en: 'When a lead hasn’t replied in {{0}}, send them {{1}} as a follow-up.', fr: 'Quand un prospect n’a pas répondu depuis {{0}}, lui envoyer {{1}} en relance.' }, chips: ['3 days', 'an SMS'] },
  { id: 'a3', board: 'b3', enabled: true, creator: 'u3', lastRun: '2026-06-09T08:01:00', runs: { ok: 241, fail: 0 }, spark: [5, 6, 7, 6, 8, 7, 9, 8, 10, 9, 11, 10], tpl: { en: 'When a new lead comes from {{0}}, assign it to {{1}}.', fr: 'Quand un nouveau prospect provient de {{0}}, l’assigner à {{1}}.' }, chips: ['Website Form', 'Mathieu Gagnon'] },
  { id: 'a4', board: 'b8', enabled: true, creator: 'u1', lastRun: '2026-06-09T07:00:00', runs: { ok: 203, fail: 0 }, spark: [4, 5, 6, 5, 7, 6, 8, 7, 6, 8, 7, 9], tpl: { en: '{{0}} before a booked visit, text the client a reminder.', fr: '{{0}} avant une visite réservée, envoyer un rappel au client par texto.' }, chips: ['2 hours'] },
  { id: 'a5', board: 'b2', enabled: false, creator: 'u6', lastRun: '2026-06-05T14:22:00', runs: { ok: 47, fail: 0 }, spark: [2, 1, 2, 1, 0, 1, 2, 1, 2, 1, 1, 0], tpl: { en: 'When a lead’s budget is over {{0}}, move it to {{1}}.', fr: 'Quand le budget d’un prospect dépasse {{0}}, le déplacer vers {{1}}.' }, chips: ['$1M', 'Westmount Luxury Listings'] },
  { id: 'a6', board: 'b3', enabled: true, creator: 'u3', lastRun: '2026-06-08T19:40:00', runs: { ok: 132, fail: 7 }, spark: [6, 5, 7, 4, 8, 3, 7, 9, 2, 8, 6, 7], broken: { kind: 'warn', reason: { en: 'Twilio SMS hit a rate limit 7 times today', fr: 'Twilio SMS a atteint une limite de débit 7 fois aujourd’hui' }, fix: { en: 'Review SMS settings', fr: 'Vérifier les réglages SMS' } }, tpl: { en: 'When a visit is booked, send the client {{0}} confirmation.', fr: 'Quand une visite est réservée, envoyer au client une confirmation par {{0}}.' }, chips: ['SMS'] },
  { id: 'a7', board: 'b4', enabled: false, creator: 'u5', lastRun: '2026-06-02T11:05:00', runs: { ok: 18, fail: 12 }, spark: [3, 0, 2, 0, 1, 0, 0, 1, 0, 0, 0, 0], broken: { kind: 'error', reason: { en: 'The column “Budget” was renamed — this automation needs a quick update', fr: 'La colonne « Budget » a été renommée — cette automatisation a besoin d’une mise à jour' }, fix: { en: 'Pick the new column', fr: 'Choisir la nouvelle colonne' } }, tpl: { en: 'When a lead’s budget is over {{0}}, notify {{1}}.', fr: 'Quand le budget d’un prospect dépasse {{0}}, aviser {{1}}.' }, chips: ['$500K', 'Sophie Roy'] },
  { id: 'a8', board: 'b6', enabled: false, creator: 'u8', lastRun: null, runs: { ok: 0, fail: 0 }, spark: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], needsSetup: true, tpl: { en: 'When a lease application is submitted, notify {{0}}.', fr: 'Quand une demande de location est soumise, aviser {{0}}.' }, chips: ['Anaïs Bélanger'] },
];

// daily-actions usage series (last 14 days) + busiest boards
export const USAGE_SERIES = [142, 168, 151, 189, 176, 203, 221, 198, 234, 247, 219, 268, 255, 289];
export const USAGE_TOP_BOARDS = [
  { board: 'b3', actions: 1284 }, { board: 'b1', actions: 967 },
  { board: 'b8', actions: 642 }, { board: 'b2', actions: 318 }, { board: 'b4', actions: 201 },
];
