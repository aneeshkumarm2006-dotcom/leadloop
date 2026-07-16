/* ============================================================
   WorkflowEditor — booking reminder/alert editor, styled to the
   CRM "premium" design (no Calendly shell). Rendered inline inside
   the Booking page. WIRED to BookingWorkflow CRUD.
   ============================================================ */
import { useState } from 'react';
import Icon from '../../premium/PremiumIcons';
import { L } from '../../premium/premiumData';
import * as bookingService from '../../services/bookingService';

const VARS = ['Invitee Full Name', 'Event Name', 'Event Time', 'Location', 'Invitee Email', 'Invitee Phone Number', 'Agent First Name', 'Questions And Answers'];
const ADD_OPTS = [
  { type: 'email_invitee', label: { en: 'Send email to invitee', fr: 'Envoyer un courriel à l’invité' }, desc: { en: 'Email the person who booked', fr: 'Courriel à la personne qui a réservé' } },
  { type: 'email_host', label: { en: 'Send email to host (agent)', fr: 'Envoyer un courriel à l’agent' }, desc: { en: 'Email the assigned agent', fr: 'Courriel à l’agent assigné' } },
  { type: 'email_other', label: { en: 'Send email to someone else', fr: 'Envoyer à quelqu’un d’autre' }, desc: { en: 'Email a fixed address', fr: 'Courriel à une adresse fixe' } },
];
const actionLabel = (type, lang) => L(ADD_OPTS.find((o) => o.type === type)?.label || { en: 'Send email', fr: 'Envoyer un courriel' }, lang);

const TRIGGERS = [
  { value: 'on_booking', label: { en: 'Immediately when a visit is booked', fr: 'Dès qu’une visite est réservée' }, triggerType: 'on_booking', beforeMinutes: 0 },
  { value: 'before_1440', label: { en: '24 hours before the visit', fr: '24 heures avant la visite' }, triggerType: 'before_event', beforeMinutes: 1440 },
  { value: 'before_120', label: { en: '2 hours before the visit', fr: '2 heures avant la visite' }, triggerType: 'before_event', beforeMinutes: 120 },
  { value: 'before_60', label: { en: '1 hour before the visit', fr: '1 heure avant la visite' }, triggerType: 'before_event', beforeMinutes: 60 },
];
const triggerValue = (triggerType, beforeMinutes) => (triggerType === 'on_booking' ? 'on_booking' : `before_${beforeMinutes}`);

const DEFAULT_BODY = `Hi {{Invitee Full Name}},

This is a reminder about your upcoming property tour.

• Event: {{Event Name}}
• When: {{Event Time}}
• Location: {{Location}}

If anything changes, just reply to this email.

Best,
{{Agent First Name}}`;

function EmailModal({ action, lang, onClose, onSave }) {
  const type = action.type;
  const [recipientEmail, setRecipientEmail] = useState(action.recipientEmail || '');
  const [subject, setSubject] = useState(action.subject || 'Reminder: {{Event Name}} tour');
  const [body, setBody] = useState(action.body || DEFAULT_BODY);
  const [varsOpen, setVarsOpen] = useState(false);

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" style={{ maxWidth: 560 }}>
        <div className="sheet-head">
          <h2>{L({ en: 'Edit email', fr: 'Modifier le courriel' }, lang)} · {actionLabel(type, lang)}</h2>
          <button type="button" className="sheet-close" onClick={onClose} aria-label="Close"><Icon name="x" size={18} /></button>
        </div>
        <div className="sheet-body">
          {type === 'email_other' && (
            <div className="blank-field"><label>{L({ en: 'Send to', fr: 'Envoyer à' }, lang)}</label>
              <input className="bf-input" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} placeholder="name@email.com" /></div>
          )}
          <div className="blank-field"><label>{L({ en: 'Subject', fr: 'Objet' }, lang)}</label>
            <input className="bf-input" value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
          <div className="blank-field" style={{ position: 'relative' }}>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              {L({ en: 'Body', fr: 'Message' }, lang)}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setVarsOpen((o) => !o)}><Icon name="plus" size={13} />{L({ en: 'Variables', fr: 'Variables' }, lang)}</button>
            </label>
            <textarea className="bf-input" rows={9} style={{ height: 'auto', resize: 'vertical', fontFamily: 'var(--font-body)' }} value={body} onChange={(e) => setBody(e.target.value)} />
            {varsOpen && (
              <div style={{ position: 'absolute', right: 0, top: 40, width: 240, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: 'var(--sh-pop, 0 12px 30px -10px rgba(0,0,0,.25))', zIndex: 5, maxHeight: 230, overflow: 'auto', padding: 5 }}>
                {VARS.map((vn) => (
                  <div key={vn} role="button" tabIndex={0} onClick={() => { setBody((b) => `${b} {{${vn}}}`); setVarsOpen(false); }}
                    style={{ padding: '7px 9px', fontSize: 13, borderRadius: 7, cursor: 'pointer' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--subtle)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>{vn}</div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="sheet-foot">
          <div className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>{L({ en: 'Cancel', fr: 'Annuler' }, lang)}</button>
          <button type="button" className="btn btn-primary" onClick={() => onSave({ type, recipientEmail, subject, body })}>{L({ en: 'Done', fr: 'Terminé' }, lang)}</button>
        </div>
      </div>
    </div>
  );
}

export default function WorkflowEditor({ workflow, eventTypes, orgId, lang, onClose, onSaved, toastError, toastSuccess }) {
  const [name, setName] = useState(workflow ? workflow.name || '' : (lang === 'fr' ? 'Nouveau rappel' : 'New reminder workflow'));
  const [links, setLinks] = useState((workflow?.links || []).map((l) => (l._id ? l._id : l)));
  const [triggerType, setTriggerType] = useState(workflow?.triggerType || 'before_event');
  const [beforeMinutes, setBeforeMinutes] = useState(workflow?.beforeMinutes ?? 1440);
  const [actions, setActions] = useState(workflow?.actions || []);
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [mail, setMail] = useState(null); // { action, index }

  const toggleLink = (lid) => setLinks((s) => (s.includes(lid) ? s.filter((x) => x !== lid) : [...s, lid]));
  const setTrigger = (val) => { const o = TRIGGERS.find((x) => x.value === val) || TRIGGERS[0]; setTriggerType(o.triggerType); setBeforeMinutes(o.beforeMinutes); };

  const save = async () => {
    if (!name.trim()) { toastError(L({ en: 'A workflow name is required', fr: 'Un nom est requis' }, lang)); return; }
    setSaving(true);
    const payload = { org: orgId, name: name.trim(), links, triggerType, beforeMinutes, actions, enabled: workflow ? workflow.enabled !== false : true };
    try {
      if (workflow?._id) await bookingService.updateBookingWorkflow(workflow._id, payload);
      else await bookingService.createBookingWorkflow(payload);
      toastSuccess(L({ en: 'Workflow saved', fr: 'Flux enregistré' }, lang));
      onSaved();
    } catch (err) {
      toastError(err?.response?.data?.error || L({ en: 'Could not save the workflow', fr: 'Impossible d’enregistrer' }, lang));
    } finally { setSaving(false); }
  };

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}><Icon name="arrowLeft" size={15} />{L({ en: 'All workflows', fr: 'Tous les flux' }, lang)}</button>
        <h1 style={{ fontSize: 22 }}>{workflow ? L({ en: 'Edit workflow', fr: 'Modifier le flux' }, lang) : L({ en: 'New workflow', fr: 'Nouveau flux' }, lang)}</h1>
        <div style={{ flex: 1 }} />
        <button type="button" className="btn btn-primary" style={{ background: 'var(--book)' }} disabled={saving} onClick={save}><Icon name="check" size={15} />{saving ? L({ en: 'Saving…', fr: 'Enregistrement…' }, lang) : L({ en: 'Save', fr: 'Enregistrer' }, lang)}</button>
      </div>

      <div className="bk-editor book" style={{ gridTemplateColumns: '1fr', maxWidth: 720 }}>
        <div className="bk-form">
          <div className="bk-section">
            <h3><span className="bs-ic"><Icon name="form" size={15} /></span>{L({ en: 'Basics', fr: 'Général' }, lang)}</h3>
            <div className="blank-field"><label>{L({ en: 'Workflow name', fr: 'Nom du flux' }, lang)}</label><input className="bf-input" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <label style={{ fontSize: 13, fontWeight: 600, display: 'block', margin: '6px 0 9px' }}>{L({ en: 'Which booking links does this apply to?', fr: 'À quels liens s’applique-t-il ?' }, lang)}</label>
            {eventTypes.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>{L({ en: 'No booking links yet — applies to all by default.', fr: 'Aucun lien — s’applique à tous par défaut.' }, lang)}</div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {eventTypes.map((et) => {
                  const on = links.includes(et._id);
                  return (
                    <button type="button" key={et._id} onClick={() => toggleLink(et._id)}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 999, border: '1px solid', borderColor: on ? 'var(--book)' : 'var(--border)', background: on ? 'var(--book-tint)' : 'var(--surface)', fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>
                      {on && <Icon name="check" size={13} />}{et.title}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="bf-help" style={{ marginTop: 8 }}>{links.length === 0 ? L({ en: 'Applies to all booking links.', fr: 'S’applique à tous les liens.' }, lang) : L({ en: `${links.length} selected.`, fr: `${links.length} sélectionné(s).` }, lang)}</div>
          </div>

          <div className="bk-section">
            <h3><span className="bs-ic"><Icon name="clock" size={15} /></span>{L({ en: 'When this happens', fr: 'Quand cela se produit' }, lang)}</h3>
            <div className="bf-control">
              <select className="bf-select" value={triggerValue(triggerType, beforeMinutes)} onChange={(e) => setTrigger(e.target.value)}>
                {TRIGGERS.map((tg) => <option key={tg.value} value={tg.value}>{L(tg.label, lang)}</option>)}
              </select><span className="bf-caret"><Icon name="chevronDown" size={15} /></span>
            </div>
          </div>

          <div className="bk-section">
            <h3><span className="bs-ic"><Icon name="mail" size={15} /></span>{L({ en: 'Do this', fr: 'Faire ceci' }, lang)}</h3>
            {actions.length === 0 && <div style={{ fontSize: 13.5, color: 'var(--muted)', padding: '2px 0 10px' }}>{L({ en: 'No actions yet — add an email below.', fr: 'Aucune action — ajoutez un courriel ci-dessous.' }, lang)}</div>}
            {actions.map((a, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 8 }}>
                <span className="bs-ic"><Icon name="mail" size={15} /></span>
                <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>{actionLabel(a.type, lang)}{a.type === 'email_other' && a.recipientEmail ? ` → ${a.recipientEmail}` : ''}</span>
                <button type="button" className="link-act" onClick={() => setMail({ action: a, index: i })} title="Edit"><Icon name="edit" size={15} /></button>
                <button type="button" className="link-act" onClick={() => setActions((s) => s.filter((_, j) => j !== i))} title="Delete"><Icon name="trash" size={15} /></button>
              </div>
            ))}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAddOpen(true)}><Icon name="plus" size={15} />{L({ en: 'Add action', fr: 'Ajouter une action' }, lang)}</button>
          </div>
        </div>
      </div>

      {addOpen && (
        <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setAddOpen(false); }}>
          <div className="sheet" style={{ maxWidth: 460 }}>
            <div className="sheet-head"><h2>{L({ en: 'Add action', fr: 'Ajouter une action' }, lang)}</h2><button type="button" className="sheet-close" onClick={() => setAddOpen(false)}><Icon name="x" size={18} /></button></div>
            <div className="sheet-body">
              {ADD_OPTS.map((o) => (
                <button type="button" key={o.type} onClick={() => { setAddOpen(false); setMail({ action: { type: o.type, recipientEmail: '', subject: '', body: '' }, index: -1 }); }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 8, background: 'var(--surface)', cursor: 'pointer' }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{L(o.label, lang)}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{L(o.desc, lang)}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {mail && (
        <EmailModal action={mail.action} lang={lang} onClose={() => setMail(null)}
          onSave={(updated) => { setActions((s) => (mail.index < 0 ? [...s, updated] : s.map((x, j) => (j === mail.index ? updated : x)))); setMail(null); }} />
      )}
    </div>
  );
}
