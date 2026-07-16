/* ============================================================
   Automation Forms page — "Mad Libs for grown-ups"
   WIRED: the active-automations list reads GET /api/automations/hub,
   and Activate creates a REAL board-scoped automation (board picker
   + auto-resolved action config, NOTIFY_PERSON fallback).
   ============================================================ */
import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import PageWrapper from '../components/layout/PageWrapper';
import Icon from '../premium/PremiumIcons';
import { Toggle, LoadingState } from '../premium/PremiumShared';
import {
  L, t, STR, splitTpl, valLabel, VOCAB,
  REC_CATS, RECIPES, TRIGGERS, CONDITIONS, ACTIONS,
} from '../premium/premiumData';
import { AutomationSentence, buildPayload, recipeToAction, recipeToTrigger } from '../premium/automationSentence';
import { getHub, createAutomation, updateAutomation, draftAutomation } from '../services/automationService';
import { updateAiSettings } from '../services/profileService';
import { ClaudeIcon, OpenAIIcon } from '../components/icons/AiBrandIcons';
import { AI_MODELS, defaultModelFor } from '../components/icons/aiModels';
import useBoardStore from '../store/boardStore';
import useOrgStore from '../store/orgStore';
import useAuthStore from '../store/authStore';
import useToastStore from '../store/toastStore';
import '../premium/premium.css';

const chipDisplay = (spec, val, lang) => valLabel(spec.kind, val != null ? val : spec.def, lang);
const enFill = (tpl, vals) => splitTpl(L(tpl, 'en')).map((p) => (p.text != null ? p.text : String(vals?.[p.blank] ?? ''))).join('');

function RecipeSentence({ recipe, values, lang, chipClass = 'rchip' }) {
  const parts = splitTpl(L(recipe.tpl, lang));
  return (
    <>{parts.map((p, i) => (p.text != null
      ? <span key={i}>{p.text}</span>
      : <span key={i} className={chipClass}>{chipDisplay(recipe.blanks[p.blank], values && values[p.blank], lang)}</span>))}</>
  );
}

function BoardPicker({ boards, value, onChange, lang }) {
  return (
    <div className="blank-field">
      <label>{L({ en: 'Which board should this run on?', fr: 'Sur quel tableau l’exécuter ?' }, lang)}</label>
      <div className="bf-control">
        <select className="bf-select" value={value} onChange={(e) => onChange(e.target.value)}>
          {boards.length === 0 && <option value="">{L({ en: 'No boards yet', fr: 'Aucun tableau' }, lang)}</option>}
          {boards.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
        </select>
        <span className="bf-caret"><Icon name="chevronDown" size={16} /></span>
      </div>
    </div>
  );
}

function Popover({ rect, onClose, children }) {
  if (!rect) return null;
  const W = 280;
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - W - 12));
  const top = Math.min(rect.bottom + 8, window.innerHeight - 20);
  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 94 }} />
      <div className="pop" style={{ left, top, width: W }} role="dialog">{children}</div>
    </>, document.body);
}

function BlankField({ name, spec, value, onChange, lang }) {
  const labelMap = {
    days: { en: 'How long?', fr: 'Combien de temps ?' }, channel: { en: 'How should we reach them?', fr: 'Comment les joindre ?' },
    agent: { en: 'Who handles it?', fr: 'Qui s’en occupe ?' }, source: { en: 'Which source?', fr: 'Quelle source ?' },
    money: { en: 'Above what budget?', fr: 'Au-dessus de quel budget ?' }, board: { en: 'Which board?', fr: 'Quel tableau ?' },
    status: { en: 'Which status?', fr: 'Quel statut ?' }, day: { en: 'Which day?', fr: 'Quel jour ?' },
    time: { en: 'What time?', fr: 'À quelle heure ?' }, message: { en: 'Your message', fr: 'Votre message' },
  };
  const help = {
    channel: { en: 'We’ll use the client’s preferred contact if available.', fr: 'On utilisera le moyen préféré du client si disponible.' },
    agent: { en: '“The assigned agent” keeps it personal — or pick someone specific.', fr: '« L’agent assigné » reste personnel — ou choisissez quelqu’un.' },
    days: { en: 'Counted in business hours so weekends don’t count against you.', fr: 'Calculé en heures ouvrables — les fins de semaine ne comptent pas.' },
  };
  const label = L(labelMap[name] || { en: name, fr: name }, lang);
  if (spec.kind === 'channel') {
    const opts = VOCAB.channel();
    const icons = { 'an SMS': 'sms', 'an email': 'mail', 'a WhatsApp message': 'message' };
    return (
      <div className="blank-field">
        <label>{label}</label>
        <div className="choice-row">
          {opts.map((o) => (
            <button type="button" key={o} className={'choice' + (value === o ? ' on' : '')} onClick={() => onChange(o)}>
              <Icon name={icons[o]} size={16} />{valLabel('channel', o, lang)}
            </button>
          ))}
        </div>
        {help[name] && <div className="bf-help">{L(help[name], lang)}</div>}
      </div>
    );
  }
  if (spec.kind === 'text') {
    return (
      <div className="blank-field">
        <label>{L(labelMap.message, lang)}</label>
        <textarea className="bf-input" rows={3} value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    );
  }
  const opts = VOCAB[spec.kind] ? VOCAB[spec.kind]() : [];
  return (
    <div className="blank-field">
      <label>{label}</label>
      <div className="bf-control">
        <select className="bf-select" value={value} onChange={(e) => onChange(e.target.value)}>
          {opts.map((o) => <option key={o} value={o}>{valLabel(spec.kind, o, lang)}</option>)}
        </select>
        <span className="bf-caret"><Icon name="chevronDown" size={16} /></span>
      </div>
      {help[name] && <div className="bf-help">{L(help[name], lang)}</div>}
    </div>
  );
}

function SuccessBurst({ lang, onClose, sentence }) {
  return (
    <div className="sheet-body" style={{ padding: '30px 26px 24px' }}>
      <div className="burst">
        <div className="burst-ring"><Icon name="check" size={40} stroke={3} /></div>
        <h2>{L({ en: 'It’s live 🎉', fr: 'C’est actif 🎉' }, lang)}</h2>
        <p>{L({ en: 'Your automation is now running quietly in the background. We’ll handle it from here.', fr: 'Votre automatisation tourne maintenant en arrière-plan. On s’en occupe à partir d’ici.' }, lang)}</p>
        <div style={{ marginTop: 18, fontSize: 15, lineHeight: 1.6, color: 'var(--text-2)', maxWidth: 420, textWrap: 'pretty' }}>{sentence}</div>
        <div className="live-pill"><span className="lp-dot" />{L({ en: 'Active · runs automatically', fr: 'Actif · s’exécute automatiquement' }, lang)}</div>
      </div>
      <div className="sheet-foot" style={{ marginTop: 22, marginLeft: -26, marginRight: -26, marginBottom: -24, borderRadius: 0 }}>
        <div className="spacer" />
        <button type="button" className="btn btn-primary" onClick={onClose}>{L({ en: 'Great, done', fr: 'Parfait, terminé' }, lang)}</button>
      </div>
    </div>
  );
}

function FillSheet({ recipe, lang, onClose, boards, currentUserId, onCreated, toastError }) {
  const tt = t(lang);
  const init = {};
  Object.keys(recipe.blanks).forEach((k) => { init[k] = recipe.blanks[k].def; });
  const [vals, setVals] = useState(init);
  const [pulse, setPulse] = useState(null);
  const [done, setDone] = useState(false);
  const [boardId, setBoardId] = useState(boards[0]?._id || '');
  const [creating, setCreating] = useState(false);
  const cat = REC_CATS.find((c) => c.key === recipe.cat);
  const set = (k, v) => { setVals((s) => ({ ...s, [k]: v })); setPulse(k); setTimeout(() => setPulse(null), 500); };

  const activate = async () => {
    const board = boards.find((b) => b._id === boardId);
    if (!board) { toastError(L({ en: 'Pick a board first', fr: 'Choisissez d’abord un tableau' }, lang)); return; }
    const payload = buildPayload({ name: enFill(recipe.tpl, vals), trigger: recipeToTrigger(recipe, vals), actions: [recipeToAction(vals)], board, currentUserId });
    setCreating(true);
    try { await createAutomation(boardId, payload); onCreated && onCreated(); setDone(true); }
    catch (err) { toastError(err?.response?.data?.error || L({ en: 'Could not create the automation', fr: 'Impossible de créer l’automatisation' }, lang)); }
    finally { setCreating(false); }
  };

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet">
        {!done ? (
          <>
            <div className="sheet-head">
              <div className="sh-eyebrow"><Icon name={cat.icon} size={14} />{L(cat.label, lang)}</div>
              <h2>{L({ en: 'Just fill in the blanks', fr: 'Remplissez simplement les espaces' }, lang)}</h2>
              <div className="sh-sub">{L({ en: 'Adjust anything below, then activate. You can change it later.', fr: 'Ajustez ce que vous voulez, puis activez. Modifiable plus tard.' }, lang)}</div>
              <button type="button" className="sheet-close" onClick={onClose} aria-label="Close"><Icon name="x" size={18} /></button>
            </div>
            <div className="sheet-body">
              <div className="fill-sentence">
                {splitTpl(L(recipe.tpl, lang)).map((p, i) => (p.text != null
                  ? <span key={i}>{p.text}</span>
                  : <span key={i} className={'fill-chip' + (pulse === p.blank ? ' live' : '')}>{chipDisplay(recipe.blanks[p.blank], vals[p.blank], lang)}</span>))}
              </div>
              {Object.keys(recipe.blanks).map((k) => (
                <BlankField key={k} name={k} spec={recipe.blanks[k]} value={vals[k]} lang={lang} onChange={(v) => set(k, v)} />
              ))}
              <BoardPicker boards={boards} value={boardId} onChange={setBoardId} lang={lang} />
            </div>
            <div className="sheet-foot">
              <div className="spacer" />
              <button type="button" className="btn btn-ghost" onClick={onClose}>{tt(STR.cancel)}</button>
              <button type="button" className="btn btn-primary" disabled={creating || !boardId} onClick={activate}>
                <Icon name="zap" size={15} />{creating ? L({ en: 'Activating…', fr: 'Activation…' }, lang) : L({ en: 'Activate', fr: 'Activer' }, lang)}
              </button>
            </div>
          </>
        ) : (
          <SuccessBurst lang={lang} onClose={onClose} sentence={<RecipeSentence recipe={recipe} values={vals} lang={lang} chipClass="rchip" />} />
        )}
      </div>
    </div>
  );
}

const SLOT_DEFS = { trigger: TRIGGERS, cond: CONDITIONS, action: ACTIONS };
const SLOT_PLACEHOLD = {
  trigger: { en: 'choose a trigger', fr: 'choisir un déclencheur' },
  cond: { en: 'add a condition', fr: 'ajouter une condition' },
  action: { en: 'choose an action', fr: 'choisir une action' },
};
const SLOT_ICON = { trigger: 'zap', cond: 'filter', action: 'bolt' };

function filledPhrase(slotType, opt, val, lang) {
  if (!opt) return null;
  const parts = splitTpl(L(opt.tpl, lang));
  return parts.map((p) => (p.text != null ? p.text : valLabel(opt.param && opt.param.kind, val, lang))).join('');
}

function BuilderChip({ slotType, slot, onPick, lang }) {
  const ref = useRef(null);
  const [rect, setRect] = useState(null);
  const opts = SLOT_DEFS[slotType];
  const opt = slot && opts.find((o) => o.key === slot.key);
  const open = () => { const r = ref.current.getBoundingClientRect(); setRect(r); };
  const phrase = opt ? filledPhrase(slotType, opt, slot.val, lang) : null;
  const tclass = slotType === 'trigger' ? 't-trigger' : slotType === 'cond' ? 't-cond' : 't-action';
  const choose = (o) => onPick({ key: o.key, val: o.param ? o.param.def : null });
  const setVal = (v) => onPick({ ...slot, val: v });

  return (
    <span ref={ref} className={'sb-chip ' + tclass + (opt ? '' : ' empty')} onClick={open} tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') open(); }}>
      <span className="sbc-ic"><Icon name={SLOT_ICON[slotType]} size={14} /></span>
      {phrase || L(SLOT_PLACEHOLD[slotType], lang)}
      {rect && (
        <Popover rect={rect} onClose={() => setRect(null)}>
          <div className="pop-label">{L(SLOT_PLACEHOLD[slotType], lang)}</div>
          {opts.map((o) => (
            <button type="button" key={o.key} className={'pop-opt' + (opt && opt.key === o.key ? ' on' : '')} onClick={() => choose(o)}>
              <span className="po-ic"><Icon name={SLOT_ICON[slotType]} size={15} /></span>{L(o.label, lang)}
            </button>
          ))}
          {opt && opt.param && (
            <>
              <div className="pop-divide" />
              <div className="pop-label">{L({ en: 'Set the detail', fr: 'Préciser le détail' }, lang)}</div>
              {opt.param.kind === 'text' ? (
                <textarea className="bf-input" rows={3} style={{ fontSize: 14 }} value={slot.val || ''} onChange={(e) => setVal(e.target.value)} />
              ) : (
                <div className="bf-control">
                  <select className="bf-select" style={{ height: 40, fontSize: 14 }} value={slot.val || ''} onChange={(e) => setVal(e.target.value)}>
                    {VOCAB[opt.param.kind]().map((v) => <option key={v} value={v}>{valLabel(opt.param.kind, v, lang)}</option>)}
                  </select>
                  <span className="bf-caret"><Icon name="chevronDown" size={15} /></span>
                </div>
              )}
            </>
          )}
        </Popover>
      )}
    </span>
  );
}

function SentenceBuilder({ lang, draft, onClose, boards, currentUserId, onCreated, toastError }) {
  const tt = t(lang);
  const [trigger, setTrigger] = useState(draft ? draft.trigger : null);
  const [conds, setConds] = useState(draft && draft.cond ? [draft.cond] : []);
  const [actions, setActions] = useState(draft && draft.action ? [draft.action] : [null]);
  const [done, setDone] = useState(false);
  const [boardId, setBoardId] = useState(boards[0]?._id || '');
  const [creating, setCreating] = useState(false);
  const ready = trigger && actions.some((a) => a) && boardId;
  const setAction = (i, v) => setActions((a) => a.map((x, j) => (j === i ? v : x)));

  const enName = () => {
    const tp = trigger ? filledPhrase('trigger', TRIGGERS.find((o) => o.key === trigger.key), trigger.val, 'en') : '';
    const ap = actions.filter(Boolean).map((a) => filledPhrase('action', ACTIONS.find((o) => o.key === a.key), a.val, 'en')).join(' and ');
    return `When ${tp}, then ${ap}`;
  };

  const activate = async () => {
    const board = boards.find((b) => b._id === boardId);
    if (!board) { toastError(L({ en: 'Pick a board first', fr: 'Choisissez d’abord un tableau' }, lang)); return; }
    const payload = buildPayload({ name: enName(), trigger, actions: actions.filter(Boolean).map((a) => ({ key: a.key, val: a.val })), board, currentUserId });
    setCreating(true);
    try { await createAutomation(boardId, payload); onCreated && onCreated(); setDone(true); }
    catch (err) { toastError(err?.response?.data?.error || L({ en: 'Could not create the automation', fr: 'Impossible de créer l’automatisation' }, lang)); }
    finally { setCreating(false); }
  };

  const fullSentence = (
    <span style={{ fontSize: 15, lineHeight: 1.6 }}>
      {L({ en: 'When ', fr: 'Quand ' }, lang)}
      <b>{trigger ? filledPhrase('trigger', TRIGGERS.find((o) => o.key === trigger.key), trigger.val, lang) : '…'}</b>
      {conds.filter(Boolean).map((c, i) => <span key={i}>{L({ en: ' and ', fr: ' et ' }, lang)}<b>{filledPhrase('cond', CONDITIONS.find((o) => o.key === c.key), c.val, lang)}</b></span>)}
      {L({ en: ', then ', fr: ', alors ' }, lang)}
      {actions.filter(Boolean).map((a, i) => <span key={i}>{i > 0 ? L({ en: ' and ', fr: ' et ' }, lang) : ''}<b>{filledPhrase('action', ACTIONS.find((o) => o.key === a.key), a.val, lang)}</b></span>)}.
    </span>
  );

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet wide">
        {!done ? (
          <>
            <div className="sheet-head">
              <div className="sh-eyebrow"><Icon name="sliders" size={14} />{L({ en: 'Build your own', fr: 'Créez la vôtre' }, lang)}</div>
              <h2>{L({ en: 'Compose it like a sentence', fr: 'Composez-la comme une phrase' }, lang)}</h2>
              <div className="sh-sub">{draft
                ? L({ en: 'Here’s a draft from your description — tap any chip to fine-tune.', fr: 'Voici un brouillon tiré de votre description — touchez une puce pour ajuster.' }, lang)
                : L({ en: 'Tap each chip to fill it in. The sentence always reads naturally.', fr: 'Touchez chaque puce pour la remplir. La phrase se lit toujours naturellement.' }, lang)}</div>
              <button type="button" className="sheet-close" onClick={onClose} aria-label="Close"><Icon name="x" size={18} /></button>
            </div>
            <div className="sheet-body">
              <div className="sb-canvas">
                <div className="sb-sentence">
                  <span className="sb-fixed">{L({ en: 'When ', fr: 'Quand ' }, lang)}</span>
                  <BuilderChip slotType="trigger" slot={trigger} lang={lang} onPick={setTrigger} />
                  {conds.map((c, i) => (
                    <span key={i}>
                      <span className="sb-fixed">{L({ en: ' and ', fr: ' et ' }, lang)}</span>
                      <BuilderChip slotType="cond" slot={c} lang={lang} onPick={(v) => setConds((cs) => cs.map((x, j) => (j === i ? v : x)))} />
                      <button type="button" className="sb-remove" onClick={() => setConds((cs) => cs.filter((_, j) => j !== i))} aria-label="Remove condition"><Icon name="x" size={14} /></button>
                    </span>
                  ))}
                  {conds.length === 0 && (
                    <button type="button" className="sb-add" onClick={() => setConds([{ key: CONDITIONS[0].key, val: CONDITIONS[0].param.def }])}>
                      <Icon name="plus" size={13} />{L({ en: 'if…', fr: 'si…' }, lang)}
                    </button>
                  )}
                  <span className="sb-fixed">{L({ en: ', then ', fr: ', alors ' }, lang)}</span>
                  {actions.map((a, i) => (
                    <span key={i}>
                      {i > 0 && <span className="sb-fixed">{L({ en: ' and ', fr: ' et ' }, lang)}</span>}
                      <BuilderChip slotType="action" slot={a} lang={lang} onPick={(v) => setAction(i, v)} />
                      {i > 0 && <button type="button" className="sb-remove" onClick={() => setActions((as) => as.filter((_, j) => j !== i))} aria-label="Remove action"><Icon name="x" size={14} /></button>}
                    </span>
                  ))}
                  {' '}
                  <button type="button" className="sb-add" onClick={() => setActions((as) => [...as, { key: ACTIONS[2].key, val: ACTIONS[2].param.def }])}>
                    <Icon name="plus" size={13} />{L({ en: 'and…', fr: 'et…' }, lang)}
                  </button>
                </div>
                <div style={{ marginTop: 20, maxWidth: 360 }}>
                  <BoardPicker boards={boards} value={boardId} onChange={setBoardId} lang={lang} />
                </div>
                <div className="sb-legend">
                  {[['trigger', 'chip-trigger'], ['cond', 'chip-cond'], ['action', 'chip-action']].map(([k, v]) => (
                    <span key={k} className="lg"><i style={{ background: `var(--${v})` }} />
                      {L({ trigger: { en: 'Trigger', fr: 'Déclencheur' }, cond: { en: 'Condition', fr: 'Condition' }, action: { en: 'Action', fr: 'Action' } }[k], lang)}</span>
                  ))}
                </div>
              </div>
            </div>
            <div className="sheet-foot">
              <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{ready ? L({ en: 'Reads clean — ready to go.', fr: 'Bien lisible — prêt à lancer.' }, lang) : L({ en: 'Fill the trigger, an action, and a board.', fr: 'Remplissez le déclencheur, une action et un tableau.' }, lang)}</div>
              <div className="spacer" />
              <button type="button" className="btn btn-ghost" onClick={onClose}>{tt(STR.cancel)}</button>
              <button type="button" className="btn btn-primary" disabled={!ready || creating} style={{ opacity: ready && !creating ? 1 : 0.5 }} onClick={activate}>
                <Icon name="zap" size={15} />{creating ? L({ en: 'Activating…', fr: 'Activation…' }, lang) : L({ en: 'Activate', fr: 'Activer' }, lang)}
              </button>
            </div>
          </>
        ) : (
          <SuccessBurst lang={lang} onClose={onClose} sentence={fullSentence} />
        )}
      </div>
    </div>
  );
}

function parseDescribe(text) {
  const s = (text || '').toLowerCase();
  let trigger = { key: 'status', val: 'Interested' };
  let action = { key: 'notify', val: 'the assigned agent' };
  let cond = null;
  if (/visit|tour|showing|visite/.test(s)) { trigger = { key: 'visit', val: null }; action = { key: 'sms', val: 'Reminder: your visit is coming up!' }; }
  else if (/repl|follow|relan|répond|days|jours/.test(s)) { trigger = { key: 'noreply', val: '2 days' }; action = { key: 'sms', val: 'Hi! Just following up on your home search 🙂' }; }
  else if (/new lead|nouveau|assign|achemin/.test(s)) { trigger = { key: 'new', val: 'Plateau Mont-Royal Leads' }; action = { key: 'assign', val: 'Camille Tremblay' }; }
  else if (/form|formulaire/.test(s)) { trigger = { key: 'form', val: null }; action = { key: 'notify', val: 'the assigned agent' }; }
  if (/budget|luxury|over|dépasse|million|1m/.test(s)) cond = { key: 'budget', val: '$1M' };
  if (/referral|référ/.test(s)) cond = { key: 'source', val: 'Referral' };
  return { trigger, cond, action };
}

// Model picker shown under "Draft it": choose the AI brand (Claude / ChatGPT)
// and a specific model. Selection is persisted to the user's profile so it
// sticks across sessions and is what the draft endpoint uses.
function ModelPicker({ lang, provider, model, onProvider, onModel }) {
  const PROVIDERS = [
    { key: 'claude', label: 'Claude' },
    { key: 'openai', label: 'ChatGPT' },
  ];
  return (
    <div className="magic-model">
      <span className="mm-label">{L({ en: 'Drafted by', fr: 'Rédigé par' }, lang)}</span>
      <div className="mm-providers">
        {PROVIDERS.map(({ key, label }) => (
          <button
            type="button"
            key={key}
            className={'mm-prov' + (provider === key ? ' on' : '')}
            onClick={() => onProvider(key)}
            aria-pressed={provider === key}
          >
            {key === 'claude'
              ? <ClaudeIcon size={15} color={provider === key ? undefined : 'currentColor'} />
              : <OpenAIIcon size={15} color={provider === key ? undefined : 'currentColor'} />}
            {label}
          </button>
        ))}
      </div>
      <div className="mm-select-wrap">
        <select className="mm-select" value={model || ''} onChange={(e) => onModel(e.target.value)}>
          {(AI_MODELS[provider] || []).map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
        <span className="mm-caret"><Icon name="chevronDown" size={15} /></span>
      </div>
    </div>
  );
}

function FormsPage({ lang, autos, loading, error, boards, currentUserId, reload, toastError }) {
  const [cat, setCat] = useState('all');
  const [sheet, setSheet] = useState(null);
  const [desc, setDesc] = useState('');
  const [drafting, setDrafting] = useState(false);

  // AI drafter model selection — seeded from the user's saved preference and
  // persisted back to the profile whenever it changes (best-effort).
  const savedProvider = useAuthStore((s) => s.user?.aiProvider);
  const savedModel = useAuthStore((s) => s.user?.aiModel);
  const fetchCurrentUser = useAuthStore((s) => s.fetchCurrentUser);
  const [provider, setProvider] = useState(savedProvider || 'claude');
  const [model, setModel] = useState(savedModel || defaultModelFor(savedProvider || 'claude'));

  useEffect(() => {
    if (savedProvider) setProvider(savedProvider);
    if (savedModel) setModel(savedModel);
  }, [savedProvider, savedModel]);

  const persistAi = (patch) => {
    updateAiSettings(patch).then(() => fetchCurrentUser()).catch(() => {});
  };
  const chooseProvider = (p) => {
    const m = defaultModelFor(p);
    setProvider(p);
    setModel(m);
    persistAi({ aiProvider: p, aiModel: m });
  };
  const chooseModel = (m) => {
    setModel(m);
    persistAi({ aiModel: m });
  };

  const counts = useMemo(() => {
    const m = { all: RECIPES.length };
    REC_CATS.forEach((c) => { m[c.key] = RECIPES.filter((r) => r.cat === c.key).length; });
    return m;
  }, []);
  const shown = cat === 'all' ? RECIPES : RECIPES.filter((r) => r.cat === cat);
  const needsAttention = autos.some((a) => a.needsSetup || a.recentFailures > 0);

  // Draft from plain language: try the AI endpoint, fall back to the local
  // keyword heuristic (also used when no ANTHROPIC_API_KEY is configured).
  const draftFrom = async (text) => {
    if (!text.trim() || drafting) return;
    setDrafting(true);
    let draft;
    try {
      const res = await draftAutomation(text, { provider, model });
      draft = res && res.draft && !res.fallback ? res.draft : parseDescribe(text);
    } catch {
      draft = parseDescribe(text);
    } finally {
      setDrafting(false);
    }
    setSheet({ kind: 'builder', draft });
  };
  const submitDescribe = () => draftFrom(desc);
  const suggestions = lang === 'fr'
    ? ['Relancer les nouveaux prospects après 2 jours', 'Rappeler aux clients leur visite', 'Aviser quand un prospect devient Intéressé']
    : ['Follow up with new leads after 2 days', 'Remind clients about their visit', 'Notify me when a lead becomes Interested'];

  const toggle = async (a, v) => {
    try { await updateAutomation(a._id, { enabled: v }); } finally { reload(); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <span className="page-eyebrow dm-forms"><span className="pe-ic"><Icon name="sparkle" size={13} /></span>{L({ en: 'Automation forms', fr: 'Formulaires d’automatisation' }, lang)}</span>
        <h1 className="page-title">{L({ en: 'Set up an automation', fr: 'Créer une automatisation' }, lang)}</h1>
        <p className="page-sub">{L({ en: 'No flowcharts, no code. Pick a recipe, fill in the blanks, and you’re done — usually in under 30 seconds.', fr: 'Aucun diagramme, aucun code. Choisissez une recette, remplissez les espaces, et c’est fait — souvent en moins de 30 secondes.' }, lang)}</p>
      </div>

      <div className="magic">
        <div className="magic-inner">
          <div className="magic-label">
            <span className="magic-spark"><Icon name="wand" size={17} /></span>
            <div>
              <div className="ml-t">{L({ en: 'Describe what you want', fr: 'Décrivez ce que vous voulez' }, lang)}</div>
              <div className="ml-s">{L({ en: 'Type it in plain words — we’ll draft the automation for you.', fr: 'Dites-le simplement — on rédige l’automatisation pour vous.' }, lang)}</div>
            </div>
          </div>
          <div className="magic-field">
            <textarea rows={1} value={desc} placeholder={L({ en: 'e.g. Remind me to follow up with new leads after 2 days…', fr: 'ex. Me rappeler de relancer les nouveaux prospects après 2 jours…' }, lang)}
              onChange={(e) => setDesc(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitDescribe(); } }} />
            <button type="button" className="btn btn-primary" onClick={submitDescribe} disabled={drafting}><Icon name="arrowRight" size={16} />{drafting ? L({ en: 'Drafting…', fr: 'Rédaction…' }, lang) : L({ en: 'Draft it', fr: 'Rédiger' }, lang)}</button>
          </div>
          <ModelPicker lang={lang} provider={provider} model={model} onProvider={chooseProvider} onModel={chooseModel} />
          <div className="magic-suggest">
            {suggestions.map((s) => <button type="button" key={s} className="magic-chip" onClick={() => { setDesc(s); draftFrom(s); }}>{s}</button>)}
          </div>
        </div>
      </div>

      <div className="forms-bar">
        <div className="cat-pills">
          <button type="button" className={'cat-pill' + (cat === 'all' ? ' on' : '')} onClick={() => setCat('all')}>
            {L({ en: 'All recipes', fr: 'Toutes les recettes' }, lang)}<span className="cp-ct">{counts.all}</span>
          </button>
          {REC_CATS.map((c) => (
            <button type="button" key={c.key} className={'cat-pill' + (cat === c.key ? ' on' : '')} onClick={() => setCat(c.key)}>
              <Icon name={c.icon} size={14} />{L(c.label, lang)}<span className="cp-ct">{counts[c.key]}</span>
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => setSheet({ kind: 'builder', draft: null })}>
          <Icon name="sliders" size={15} />{L({ en: 'Create your own', fr: 'Créer la vôtre' }, lang)}
        </button>
      </div>

      <div className="recipe-grid">
        {shown.map((r) => {
          const c = REC_CATS.find((x) => x.key === r.cat);
          return (
            <button type="button" key={r.id} className="recipe-card" onClick={() => setSheet({ kind: 'fill', recipe: r })}>
              <div className="rc-top">
                <span className="rc-ic"><Icon name={c.icon} size={15} /></span>
                <span className="rc-cat">{L(c.label, lang)}</span>
                <span className="rc-uses"><Icon name="users" size={12} />{r.uses.toLocaleString(lang === 'fr' ? 'fr-CA' : 'en-US')}</span>
              </div>
              <div className="recipe-sentence"><RecipeSentence recipe={r} lang={lang} /></div>
              <span className="rc-foot">{L({ en: 'Use this recipe', fr: 'Utiliser cette recette' }, lang)}<Icon name="arrowRight" size={15} /></span>
            </button>
          );
        })}
      </div>

      <div className="your-head">
        <h2>{L({ en: 'Your active automations', fr: 'Vos automatisations actives' }, lang)}</h2>
        <span className="sec-head" style={{ margin: 0 }}><span className="count">{autos.length}</span></span>
      </div>

      {loading && <LoadingState rows={3} />}

      {error && !loading && (
        <div className="nudge" style={{ background: 'var(--red-bg)', borderColor: 'rgba(220,38,38,.26)' }}>
          <span className="nd-ic" style={{ background: 'rgba(220,38,38,.16)', color: 'var(--red)' }}><Icon name="info" size={17} /></span>
          <div><div className="nd-t">{L({ en: 'Couldn’t load your automations', fr: 'Impossible de charger vos automatisations' }, lang)}</div></div>
          <button type="button" className="nd-fix" style={{ background: 'var(--red)' }} onClick={reload}><Icon name="refresh" size={14} />{L({ en: 'Retry', fr: 'Réessayer' }, lang)}</button>
        </div>
      )}

      {!loading && !error && autos.length === 0 && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '44px 24px', gap: 6 }}>
          <div style={{ width: 64, height: 64, borderRadius: 18, display: 'grid', placeItems: 'center', background: 'var(--accent-light)', color: 'var(--accent)', marginBottom: 10 }}><Icon name="sparkle" size={28} /></div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18 }}>{L({ en: 'No automations yet', fr: 'Aucune automatisation' }, lang)}</div>
          <div style={{ color: 'var(--text-2)', fontSize: 14, maxWidth: 360, textWrap: 'pretty' }}>{L({ en: 'Pick a recipe above and you’ll have your first one running in under a minute.', fr: 'Choisissez une recette ci-dessus et la première tournera en moins d’une minute.' }, lang)}</div>
        </div>
      )}

      {!loading && !error && autos.length > 0 && (
        <div className="auto-list">
          {needsAttention && (
            <div className="nudge">
              <span className="nd-ic"><Icon name="info" size={17} /></span>
              <div>
                <div className="nd-t">{L({ en: 'Some automations need a quick look', fr: 'Certaines automatisations méritent un coup d’œil' }, lang)}</div>
                <div className="nd-s">{L({ en: 'We paused anything that hit a snag so nothing breaks — open the Automations hub to fix them.', fr: 'On met en pause tout ce qui coince pour éviter les bris — ouvrez le centre d’automatisations pour corriger.' }, lang)}</div>
              </div>
            </div>
          )}
          {autos.map((a) => (
            <div className="auto-row" key={a._id}>
              <span className="rc-ic" style={{ width: 34, height: 34, flex: '0 0 auto' }}><Icon name="zap" size={16} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="ar-sentence"><AutomationSentence a={a} lang={lang} chipClass="rchip" /></div>
                <div className="ar-meta">
                  <span>{a.board?.name || '—'}</span>
                  {a.name && <><span>·</span><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 240 }}>{a.name}</span></>}
                </div>
              </div>
              <Toggle on={a.enabled} onChange={(v) => toggle(a, v)} label="Toggle automation" />
            </div>
          ))}
        </div>
      )}

      {sheet && sheet.kind === 'fill' && <FillSheet recipe={sheet.recipe} lang={lang} boards={boards} currentUserId={currentUserId} onCreated={reload} toastError={toastError} onClose={() => setSheet(null)} />}
      {sheet && sheet.kind === 'builder' && <SentenceBuilder lang={lang} draft={sheet.draft} boards={boards} currentUserId={currentUserId} onCreated={reload} toastError={toastError} onClose={() => setSheet(null)} />}
    </div>
  );
}

export default function AutomationFormsPage() {
  const { i18n } = useTranslation();
  const lang = i18n.language && i18n.language.startsWith('fr') ? 'fr' : 'en';
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const currentUserId = useAuthStore((s) => s.user?._id);
  const boards = useBoardStore((s) => s.boards);
  const fetchBoards = useBoardStore((s) => s.fetchBoards);
  const toastError = useToastStore((s) => s.error);

  const [autos, setAutos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const reload = useCallback(async () => {
    if (!currentOrg?._id) return;
    setLoading(true); setError(false);
    try {
      const h = await getHub(currentOrg._id);
      setAutos((h.automations || []).filter((a) => a.enabled));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [currentOrg?._id]);

  useEffect(() => {
    if (currentOrg?._id && boards.length === 0) fetchBoards(currentOrg._id).catch(() => {});
    reload();
  }, [currentOrg?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <PageWrapper>
      <FormsPage lang={lang} autos={autos} loading={loading} error={error} boards={boards} currentUserId={currentUserId} reload={reload} toastError={toastError} />
    </PageWrapper>
  );
}
