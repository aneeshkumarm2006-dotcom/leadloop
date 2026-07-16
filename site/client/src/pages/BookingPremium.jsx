/* ============================================================
   Booking page — a single CRM-styled page (no Calendly clone):
     • Top    — Booking Links manager + editor with a live preview
                that renders the SAME component as the public page.
     • Bottom — Workflows (reminder / alert emails) list + editor.
   WIRED to real BookingLink + BookingWorkflow CRUD across the org.
   ============================================================ */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import PageWrapper from '../components/layout/PageWrapper';
import Icon from '../premium/PremiumIcons';
import { Toggle, Sk } from '../premium/PremiumShared';
import BookingExperience from '../components/booking/BookingExperience';
import { buildPreviewSlots } from '../components/booking/previewSlots';
import WorkflowEditor from './booking/WorkflowEditor';
import { L } from '../premium/premiumData';
import * as bookingService from '../services/bookingService';
import { getGroups } from '../services/taskService';
import useBoardStore from '../store/boardStore';
import useOrgStore from '../store/orgStore';
import useToastStore from '../store/toastStore';

const ACCENTS = [
  { id: 'amber', c: '#E0982E', c2: '#F2754B' },
  { id: 'coral', c: '#F2754B', c2: '#E0982E' },
  { id: 'indigo', c: '#4F46E5', c2: '#7C3AED' },
  { id: 'teal', c: '#0E9F8E', c2: '#34D8C4' },
  { id: 'violet', c: '#7C3AED', c2: '#A78BFA' },
];
const accentObj = (hex) => ACCENTS.find((a) => a.c.toLowerCase() === String(hex || '').toLowerCase()) || ACCENTS[0];
// Availability is edited in Mon-first order; map design index → backend dayOfWeek (0=Sun).
const DAY_LABELS = { en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], fr: ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'] };
const DOW_MAP = [1, 2, 3, 4, 5, 6, 0];

const initials = (name) => (name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
function MAvatar({ member, size = 18 }) {
  if (!member) return null;
  return member.profilePic
    ? <img src={member.profilePic} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover' }} />
    : <span className="av" style={{ width: size, height: size, fontSize: size * 0.42, background: 'var(--book)' }}>{initials(member.name)}</span>;
}

function LinkCard({ link, members, lang, onToggle, onEdit, onOpen, onDelete }) {
  const [copied, setCopied] = useState(false);
  const acc = accentObj(link.branding?.accentColor);
  const agent = members.find((x) => x._id === (link.agents || [])[0]);
  const url = (link.publicUrl || '').replace(/^https?:\/\//, '');
  const agentLabel = link.assignMode === 'round_robin' ? L({ en: 'Round-robin', fr: 'Rotation' }, lang) : (agent?.name || '—');
  return (
    <div className="link-card">
      <div className="link-cover" style={{ background: `linear-gradient(135deg, ${acc.c}, ${acc.c2})` }}>
        <div className="pub-cover" />
        <span className="lc-dur">{link.durationMinutes} min</span>
        {!link.active && <span className="lc-paused">{L({ en: 'Paused', fr: 'En pause' }, lang)}</span>}
      </div>
      <div className="link-body">
        <div>
          <div className="lb-title">{link.title}</div>
          <div className="lb-agent">{link.assignMode === 'round_robin' ? <Icon name="users" size={14} /> : <MAvatar member={agent} size={18} />}{agentLabel}</div>
        </div>
        <div className="url-row">
          <span className="url">{url}</span>
          <button type="button" className={'url-copy' + (copied ? ' done' : '')} onClick={() => { navigator.clipboard?.writeText(link.publicUrl || url); setCopied(true); setTimeout(() => setCopied(false), 1400); }} aria-label="Copy link">
            <Icon name={copied ? 'check' : 'copy'} size={15} />
          </button>
        </div>
        <div className="link-foot">
          <button type="button" className="link-act" onClick={onOpen} title={L({ en: 'Open', fr: 'Ouvrir' }, lang)}><Icon name="eye" size={16} /></button>
          <button type="button" className="link-act" onClick={onEdit} title={L({ en: 'Edit', fr: 'Modifier' }, lang)}><Icon name="edit" size={15} /></button>
          <button type="button" className="link-act" onClick={onDelete} title={L({ en: 'Delete', fr: 'Supprimer' }, lang)}><Icon name="trash" size={15} /></button>
          <div className="link-toggle">
            <span style={{ color: link.active ? 'var(--done)' : 'var(--muted)' }}>{link.active ? L({ en: 'Active', fr: 'Actif' }, lang) : L({ en: 'Off', fr: 'Inactif' }, lang)}</span>
            <Toggle on={link.active} onChange={onToggle} label="Active" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ScaledPreview — renders its children at a fixed desktop width and scales the
// whole thing down to fit the (narrower) preview column, so the editor preview
// shows the true DESKTOP layout rather than the page's mobile/stacked fallback.
function ScaledPreview({ designWidth = 1040, children }) {
  const outerRef = useRef(null);
  const innerRef = useRef(null);
  const [scale, setScale] = useState(0.5);
  const [height, setHeight] = useState(420);

  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return undefined;
    const recompute = () => {
      const s = outer.clientWidth / designWidth;
      setScale(s);
      setHeight(inner.scrollHeight * s);
    };
    const ro = new ResizeObserver(recompute);
    ro.observe(outer);
    ro.observe(inner);
    recompute();
    return () => ro.disconnect();
  }, [designWidth]);

  return (
    <div ref={outerRef} style={{ position: 'relative', height, overflow: 'hidden' }}>
      <div ref={innerRef} style={{ position: 'absolute', top: 0, left: 0, width: designWidth, transformOrigin: 'top left', transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}

function BookingEditor({ link, boards, members, lang, onClose, onSaved, onPreviewFull, toastError, toastSuccess }) {
  const fromWeekly = () => {
    if (!link) {
      const d = [[], [], [], [], [], [], []];
      [0, 1, 2, 3, 4].forEach((i) => { d[i] = [{ start: '09:00', end: '17:00' }]; });
      return d;
    }
    const dr = [[], [], [], [], [], [], []];
    (link.weeklyHours || []).forEach((w) => { const i = DOW_MAP.indexOf(Number(w.dayOfWeek)); if (i >= 0) dr[i].push({ start: w.start, end: w.end }); });
    return dr;
  };
  const [cfg, setCfg] = useState(() => ({
    title: link ? link.title : (lang === 'fr' ? 'Visite privée' : 'Private property tour'),
    durationMinutes: link ? link.durationMinutes : 30,
    location: link ? (link.location || '') : '',
    timezone: link ? (link.timezone || 'America/Toronto') : 'America/Toronto',
    board: link ? link.board : (boards[0]?._id || ''),
    group: link ? link.group : '',
    agents: link ? [...(link.agents || [])] : (members[0] ? [members[0]._id] : []),
    accent: accentObj(link?.branding?.accentColor).id,
    headline: link?.branding?.headline || (lang === 'fr' ? 'Réservez votre visite' : 'Book your tour'),
    dayRanges: fromWeekly(),
    bufferBefore: link?.bufferBefore || 0,
    bufferAfter: link?.bufferAfter || 0,
    minNoticeHours: link?.minNoticeHours ?? 2,
    dateRangeDays: link?.dateRangeDays ?? 30,
    assign: link?.assignMode === 'fixed' ? 'fixed' : 'robin',
  }));
  const [groups, setGroups] = useState([]);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setCfg((s) => ({ ...s, [k]: v }));
  const acc = ACCENTS.find((a) => a.id === cfg.accent);

  useEffect(() => {
    if (!cfg.board) { setGroups([]); return; }
    getGroups(cfg.board).then((gs) => {
      setGroups(gs || []);
      setCfg((s) => (s.group && (gs || []).some((g) => g._id === s.group) ? s : { ...s, group: (gs || [])[0]?._id || '' }));
    }).catch(() => setGroups([]));
  }, [cfg.board]);

  const toggleAgent = (id) => set('agents', cfg.agents.includes(id) ? cfg.agents.filter((x) => x !== id) : [...cfg.agents, id]);

  // ---- availability editing helpers (per design-day ranges) ----
  const setDayRanges = (i, ranges) => setCfg((s) => ({ ...s, dayRanges: s.dayRanges.map((r, j) => (j === i ? ranges : r)) }));
  const toggleDay = (i) => setDayRanges(i, cfg.dayRanges[i].length ? [] : [{ start: '09:00', end: '17:00' }]);
  const addRange = (i) => setDayRanges(i, [...cfg.dayRanges[i], { start: '09:00', end: '17:00' }]);
  const removeRange = (i, k) => setDayRanges(i, cfg.dayRanges[i].filter((_, j) => j !== k));
  const setRange = (i, k, key, val) => setDayRanges(i, cfg.dayRanges[i].map((r, j) => (j === k ? { ...r, [key]: val } : r)));

  const weeklyHours = useMemo(() => {
    const out = [];
    cfg.dayRanges.forEach((ranges, i) => ranges.forEach((r) => { if (r.start && r.end) out.push({ dayOfWeek: DOW_MAP[i], start: r.start, end: r.end }); }));
    return out;
  }, [cfg.dayRanges]);

  const previewConfig = {
    title: cfg.title,
    durationMinutes: cfg.durationMinutes,
    location: cfg.location,
    branding: { accentColor: acc.c, headline: cfg.headline },
    questions: [],
  };
  const previewSlots = useMemo(() => buildPreviewSlots(weeklyHours, cfg.durationMinutes), [weeklyHours, cfg.durationMinutes]);

  const save = async () => {
    if (!cfg.board || !cfg.group) { toastError(L({ en: 'Pick a board and a group', fr: 'Choisissez un tableau et un groupe' }, lang)); return; }
    if (!cfg.title.trim()) { toastError(L({ en: 'Title is required', fr: 'Le titre est requis' }, lang)); return; }
    if (!weeklyHours.length) { toastError(L({ en: 'Add at least one available time', fr: 'Ajoutez au moins une plage horaire' }, lang)); return; }
    const payload = {
      title: cfg.title.trim(),
      group: cfg.group,
      durationMinutes: cfg.durationMinutes,
      location: cfg.location,
      timezone: cfg.timezone,
      weeklyHours,
      bufferBefore: cfg.bufferBefore,
      bufferAfter: cfg.bufferAfter,
      minNoticeHours: cfg.minNoticeHours,
      dateRangeDays: cfg.dateRangeDays,
      assignMode: cfg.assign === 'robin' ? 'round_robin' : 'fixed',
      agents: cfg.assign === 'robin' ? cfg.agents : cfg.agents.slice(0, 1),
      branding: { accentColor: acc.c, headline: cfg.headline },
    };
    setSaving(true);
    try {
      if (link) await bookingService.updateBookingLink(link._id, payload);
      else await bookingService.createBookingLink(cfg.board, payload);
      toastSuccess(L({ en: 'Booking link saved', fr: 'Lien enregistré' }, lang));
      onSaved();
    } catch (err) {
      toastError(err?.response?.data?.error || L({ en: 'Could not save', fr: 'Impossible d’enregistrer' }, lang));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}><Icon name="arrowLeft" size={15} />{L({ en: 'All links', fr: 'Tous les liens' }, lang)}</button>
        <h1 style={{ fontSize: 22 }}>{link ? L({ en: 'Edit booking link', fr: 'Modifier le lien' }, lang) : L({ en: 'New booking link', fr: 'Nouveau lien' }, lang)}</h1>
        <div style={{ flex: 1 }} />
        <button type="button" className="btn btn-primary" style={{ background: 'var(--book)', boxShadow: '0 2px 10px -2px var(--book)' }} disabled={saving} onClick={save}><Icon name="check" size={15} />{L({ en: 'Save', fr: 'Enregistrer' }, lang)}</button>
      </div>

      <div className="bk-editor book">
        <div className="bk-form">
          <div className="bk-section">
            <h3><span className="bs-ic"><Icon name="home" size={15} /></span>{L({ en: 'Where bookings land', fr: 'Où arrivent les réservations' }, lang)}</h3>
            <div className="bs-sub">{L({ en: 'New visits become leads on this board & group.', fr: 'Les visites deviennent des prospects sur ce tableau et ce groupe.' }, lang)}</div>
            <div className="bk-row">
              <div className="blank-field"><label>{L({ en: 'Board', fr: 'Tableau' }, lang)}</label>
                <div className="bf-control"><select className="bf-select" value={cfg.board} disabled={!!link} onChange={(e) => set('board', e.target.value)}>
                  <option value="">{L({ en: 'Select…', fr: 'Choisir…' }, lang)}</option>
                  {boards.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
                </select><span className="bf-caret"><Icon name="chevronDown" size={15} /></span></div></div>
              <div className="blank-field"><label>{L({ en: 'Group', fr: 'Groupe' }, lang)}</label>
                <div className="bf-control"><select className="bf-select" value={cfg.group} onChange={(e) => set('group', e.target.value)}>
                  <option value="">{L({ en: 'Select…', fr: 'Choisir…' }, lang)}</option>
                  {groups.map((g) => <option key={g._id} value={g._id}>{g.name}</option>)}
                </select><span className="bf-caret"><Icon name="chevronDown" size={15} /></span></div></div>
            </div>
          </div>

          <div className="bk-section">
            <h3><span className="bs-ic"><Icon name="form" size={15} /></span>{L({ en: 'Event details', fr: 'Détails de l’événement' }, lang)}</h3>
            <div className="blank-field"><label>{L({ en: 'Title', fr: 'Titre' }, lang)}</label><input className="bf-input" value={cfg.title} onChange={(e) => set('title', e.target.value)} /></div>
            <div className="blank-field"><label>{L({ en: 'Duration', fr: 'Durée' }, lang)}</label>
              <div className="bf-control" style={{ maxWidth: 200 }}><select className="bf-select" value={cfg.durationMinutes} onChange={(e) => set('durationMinutes', +e.target.value)}>{[15, 20, 30, 45, 60, 90].map((d) => <option key={d} value={d}>{d} min</option>)}</select><span className="bf-caret"><Icon name="chevronDown" size={15} /></span></div></div>

            {/* Property address — shown when a visitor chooses an in-person visit. */}
            <div className="blank-field"><label>{L({ en: 'Property address (for in-person visits)', fr: 'Adresse (visites en personne)' }, lang)}</label><input className="bf-input" value={cfg.location} onChange={(e) => set('location', e.target.value)} placeholder={L({ en: 'e.g. 1200 Rue Sherbrooke, Montréal', fr: 'ex. 1200 Rue Sherbrooke, Montréal' }, lang)} /></div>
            <div className="bf-help" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: 'var(--book-tint)', padding: '10px 12px', borderRadius: 10, marginTop: 8 }}>
              <Icon name="video" size={15} />{L({ en: 'Visitors choose in person or a WhatsApp video call when they book — for video, your agent calls the number they provide.', fr: 'Les visiteurs choisissent en personne ou un appel vidéo WhatsApp lors de la réservation — pour la vidéo, votre agent appelle le numéro fourni.' }, lang)}
            </div>
          </div>

          <div className="bk-section">
            <h3><span className="bs-ic"><Icon name="calendar" size={15} /></span>{L({ en: 'Availability', fr: 'Disponibilités' }, lang)}</h3>
            <div className="bs-sub">{L({ en: 'Set the hours you take visits — add several ranges per day if needed.', fr: 'Définissez vos heures — ajoutez plusieurs plages par jour au besoin.' }, lang)}</div>
            <div className="avail-list">
              {DAY_LABELS[lang].map((d, i) => {
                const on = cfg.dayRanges[i].length > 0;
                return (
                  <div key={i} className="avail-day">
                    <button type="button" className={'avail-toggle' + (on ? ' on' : '')} onClick={() => toggleDay(i)}>{d}</button>
                    <div className="avail-ranges">
                      {!on && <span className="avail-off">{L({ en: 'Unavailable', fr: 'Indisponible' }, lang)}</span>}
                      {cfg.dayRanges[i].map((r, k) => (
                        <div className="avail-range" key={k}>
                          <input type="time" value={r.start} onChange={(e) => setRange(i, k, 'start', e.target.value)} />
                          <span>–</span>
                          <input type="time" value={r.end} onChange={(e) => setRange(i, k, 'end', e.target.value)} />
                          <button type="button" className="link-act" onClick={() => removeRange(i, k)} title={L({ en: 'Remove', fr: 'Retirer' }, lang)}><Icon name="x" size={14} /></button>
                        </div>
                      ))}
                      {on && <button type="button" className="avail-add" onClick={() => addRange(i)}><Icon name="plus" size={13} />{L({ en: 'Add time', fr: 'Ajouter' }, lang)}</button>}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="bk-row" style={{ marginTop: 16 }}>
              <div className="blank-field"><label>{L({ en: 'Buffer before (min)', fr: 'Tampon avant (min)' }, lang)}</label><input className="bf-input" type="number" min="0" value={cfg.bufferBefore} onChange={(e) => set('bufferBefore', Math.max(0, +e.target.value || 0))} /></div>
              <div className="blank-field"><label>{L({ en: 'Buffer after (min)', fr: 'Tampon après (min)' }, lang)}</label><input className="bf-input" type="number" min="0" value={cfg.bufferAfter} onChange={(e) => set('bufferAfter', Math.max(0, +e.target.value || 0))} /></div>
            </div>
            <div className="bk-row">
              <div className="blank-field"><label>{L({ en: 'Min. notice (hours)', fr: 'Préavis min. (heures)' }, lang)}</label><input className="bf-input" type="number" min="0" value={cfg.minNoticeHours} onChange={(e) => set('minNoticeHours', Math.max(0, +e.target.value || 0))} /></div>
              <div className="blank-field"><label>{L({ en: 'Bookable window (days)', fr: 'Fenêtre réservable (jours)' }, lang)}</label><input className="bf-input" type="number" min="1" value={cfg.dateRangeDays} onChange={(e) => set('dateRangeDays', Math.max(1, +e.target.value || 1))} /></div>
            </div>
          </div>

          <div className="bk-section">
            <h3><span className="bs-ic"><Icon name="users" size={15} /></span>{L({ en: 'Agent assignment', fr: 'Attribution d’agent' }, lang)}</h3>
            <div className="seg" style={{ marginBottom: 14 }}>
              <button type="button" className={cfg.assign === 'fixed' ? 'on' : ''} onClick={() => set('assign', 'fixed')}>{L({ en: 'Fixed agent', fr: 'Agent fixe' }, lang)}</button>
              <button type="button" className={cfg.assign === 'robin' ? 'on' : ''} onClick={() => set('assign', 'robin')}>{L({ en: 'Round-robin', fr: 'Rotation' }, lang)}</button>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {members.map((m) => {
                const on = cfg.assign === 'robin' ? cfg.agents.includes(m._id) : cfg.agents[0] === m._id;
                return (
                  <button type="button" key={m._id} onClick={() => (cfg.assign === 'robin' ? toggleAgent(m._id) : set('agents', [m._id]))}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 11px 5px 5px', borderRadius: 999, border: '1px solid', borderColor: on ? 'var(--book)' : 'var(--border)', background: on ? 'var(--book-tint)' : 'var(--surface)', fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>
                    <MAvatar member={m} size={22} />{m.name.split(' ')[0]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="bk-section">
            <h3><span className="bs-ic"><Icon name="palette" size={15} /></span>{L({ en: 'Branding', fr: 'Image de marque' }, lang)}</h3>
            <div className="blank-field"><label>{L({ en: 'Headline', fr: 'Titre d’accroche' }, lang)}</label><input className="bf-input" value={cfg.headline} onChange={(e) => set('headline', e.target.value)} /></div>
            <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 9 }}>{L({ en: 'Accent color', fr: 'Couleur d’accent' }, lang)}</label>
            <div className="color-swatches">
              {ACCENTS.map((a) => (
                <button type="button" key={a.id} className={'cswatch' + (cfg.accent === a.id ? ' on' : '')} style={{ background: `linear-gradient(140deg, ${a.c}, ${a.c2})`, color: a.c }} onClick={() => set('accent', a.id)} aria-label={a.id}>
                  {cfg.accent === a.id && <span style={{ display: 'grid', placeItems: 'center', height: '100%', color: '#fff' }}><Icon name="check" size={15} stroke={3} /></span>}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="bk-preview">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 11 }}>
            <span className="preview-live"><i />{L({ en: 'LIVE PREVIEW', fr: 'APERÇU EN DIRECT' }, lang)}</span>
            <div style={{ flex: 1 }} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onPreviewFull({ config: previewConfig, slots: previewSlots })}><Icon name="eye" size={14} />{L({ en: 'Open full page', fr: 'Page complète' }, lang)}</button>
          </div>
          <div className="bk-live-frame" key={cfg.accent + cfg.durationMinutes}>
            <ScaledPreview>
              <BookingExperience config={previewConfig} slots={previewSlots} lang={lang} preview />
            </ScaledPreview>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Workflows section (bottom of the booking page) ----
const triggerLabel = (w, lang) => {
  if (w.triggerType === 'on_booking') return L({ en: 'Immediately when a visit is booked', fr: 'Dès qu’une visite est réservée' }, lang);
  const m = Number(w.beforeMinutes) || 0;
  if (m % 60 === 0) return L({ en: `${m / 60} hour(s) before the visit`, fr: `${m / 60} heure(s) avant la visite` }, lang);
  return L({ en: `${m} minutes before the visit`, fr: `${m} minutes avant la visite` }, lang);
};
const wfActionLabel = (type, lang) =>
  type === 'email_host' ? L({ en: 'Email the agent', fr: 'Courriel à l’agent' }, lang)
    : type === 'email_other' ? L({ en: 'Email someone else', fr: 'Courriel à un tiers' }, lang)
      : L({ en: 'Email the invitee', fr: 'Courriel à l’invité' }, lang);
const appliesLabel = (w, lang) => {
  if (!w.links || w.links.length === 0) return L({ en: 'All booking links', fr: 'Tous les liens' }, lang);
  const first = w.links[0]?.title || L({ en: 'Booking link', fr: 'Lien' }, lang);
  return w.links.length > 1 ? `${first} +${w.links.length - 1}` : first;
};

function WorkflowsSection({ workflows, loading, lang, onNew, onEdit, onDelete }) {
  return (
    <div className="wf-block">
      <div className="page-head" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginTop: 36 }}>
        <div>
          <span className="page-eyebrow dm-book"><span className="pe-ic"><Icon name="zap" size={13} /></span>{L({ en: 'Automation', fr: 'Automatisation' }, lang)}</span>
          <h2 className="page-title" style={{ fontSize: 24 }}>{L({ en: 'Workflows', fr: 'Flux de travail' }, lang)}</h2>
          <p className="page-sub">{L({ en: 'Reminder and alert emails that run automatically around each booking.', fr: 'Courriels de rappel et d’alerte envoyés automatiquement autour de chaque réservation.' }, lang)}</p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onNew}><Icon name="plus" size={15} />{L({ en: 'New workflow', fr: 'Nouveau flux' }, lang)}</button>
      </div>

      {loading ? (
        <div style={{ color: 'var(--muted)', fontSize: 14, padding: '14px 2px' }}>{L({ en: 'Loading workflows…', fr: 'Chargement…' }, lang)}</div>
      ) : workflows.length === 0 ? (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '40px 24px', gap: 6 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, display: 'grid', placeItems: 'center', background: 'var(--book-tint)', color: 'var(--book-ink)', marginBottom: 8 }}><Icon name="mail" size={24} /></div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17 }}>{L({ en: 'No workflows yet', fr: 'Aucun flux' }, lang)}</div>
          <div style={{ color: 'var(--text-2)', fontSize: 14, maxWidth: 380 }}>{L({ en: 'Add a reminder so leads and agents get an email before each visit, or an alert the moment one is booked.', fr: 'Ajoutez un rappel pour que prospects et agents reçoivent un courriel avant chaque visite, ou une alerte dès la réservation.' }, lang)}</div>
          <button type="button" className="btn btn-primary" style={{ marginTop: 12, background: 'var(--book)' }} onClick={onNew}><Icon name="plus" size={15} />{L({ en: 'New workflow', fr: 'Nouveau flux' }, lang)}</button>
        </div>
      ) : (
        <div className="wf-list">
          {workflows.map((w) => (
            <div className="wf-item" key={w._id} role="button" tabIndex={0} onClick={() => onEdit(w)} style={w.enabled === false ? { opacity: 0.6 } : undefined}>
              <span className="bs-ic" style={{ flex: '0 0 auto' }}><Icon name="mail" size={16} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="wf-name">{w.name}</div>
                <div className="wf-meta">{appliesLabel(w, lang)} · {triggerLabel(w, lang)} · {(w.actions || []).map((a) => wfActionLabel(a.type, lang)).join(', ') || L({ en: 'No actions', fr: 'Aucune action' }, lang)}</div>
              </div>
              <button type="button" className="link-act" onClick={(e) => { e.stopPropagation(); onDelete(w); }} title={L({ en: 'Delete', fr: 'Supprimer' }, lang)}><Icon name="trash" size={15} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function BookingPremium() {
  const { i18n } = useTranslation();
  const lang = i18n.language && i18n.language.startsWith('fr') ? 'fr' : 'en';
  const toastError = useToastStore((s) => s.error);
  const toastSuccess = useToastStore((s) => s.success);

  const currentOrg = useOrgStore((s) => s.currentOrg);
  const members = useOrgStore((s) => s.members);
  const fetchMembers = useOrgStore((s) => s.fetchMembers);
  const boards = useBoardStore((s) => s.boards);
  const fetchBoards = useBoardStore((s) => s.fetchBoards);

  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [workflows, setWorkflows] = useState([]);
  const [wfLoading, setWfLoading] = useState(true);
  const [view, setView] = useState('list'); // 'list' | 'edit' | 'workflow'
  const [editing, setEditing] = useState(null);
  const [editingWf, setEditingWf] = useState(null);
  const [full, setFull] = useState(null); // { config, slots } for the full-page preview overlay

  const load = useCallback(async () => {
    if (!currentOrg?._id) return;
    setLoading(true); setError(false);
    try {
      const bs = boards.length ? boards : await fetchBoards(currentOrg._id);
      const per = await Promise.all((bs || []).map((b) => bookingService.listBookingLinks(b._id).catch(() => [])));
      setLinks(per.flat());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [currentOrg?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadWorkflows = useCallback(async () => {
    if (!currentOrg?._id) return;
    setWfLoading(true);
    try { setWorkflows(await bookingService.listBookingWorkflows(currentOrg._id)); }
    catch { setWorkflows([]); }
    finally { setWfLoading(false); }
  }, [currentOrg?._id]);

  useEffect(() => {
    if (currentOrg?._id && (!members || members.length === 0)) fetchMembers(currentOrg._id).catch(() => {});
    load();
    loadWorkflows();
  }, [currentOrg?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const openEdit = (l) => { setEditing(l); setView('edit'); };
  const openWf = (w) => { setEditingWf(w); setView('workflow'); };
  const eventTypes = useMemo(() => links.map((l) => ({ _id: l._id, title: l.title })), [links]);

  const toggleActive = async (l, v) => {
    setLinks((s) => s.map((x) => (x._id === l._id ? { ...x, active: v } : x)));
    try { await bookingService.updateBookingLink(l._id, { active: v }); } catch { load(); }
  };
  const remove = async (l) => {
    if (!window.confirm(L({ en: `Delete “${l.title}”?`, fr: `Supprimer « ${l.title} » ?` }, lang))) return;
    try { await bookingService.deleteBookingLink(l._id); setLinks((s) => s.filter((x) => x._id !== l._id)); }
    catch (err) { toastError(err?.response?.data?.error || L({ en: 'Could not delete', fr: 'Impossible de supprimer' }, lang)); }
  };
  const previewFor = (l) => ({
    config: {
      title: l.title, durationMinutes: l.durationMinutes, location: l.location,
      branding: { accentColor: accentObj(l.branding?.accentColor).c, headline: l.branding?.headline }, questions: l.questions || [],
    },
    slots: buildPreviewSlots(l.weeklyHours || [], l.durationMinutes),
  });
  const removeWf = async (w) => {
    if (!window.confirm(L({ en: `Delete workflow “${w.name}”?`, fr: `Supprimer le flux « ${w.name} » ?` }, lang))) return;
    try { await bookingService.deleteBookingWorkflow(w._id); setWorkflows((s) => s.filter((x) => x._id !== w._id)); } catch { loadWorkflows(); }
  };

  const overlay = full && (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setFull(null); }}>
      <div className="sheet" style={{ maxWidth: 1080, overflow: 'hidden', background: 'transparent', boxShadow: 'none' }}>
        <button type="button" className="sheet-close" onClick={() => setFull(null)} style={{ zIndex: 5 }}><Icon name="x" size={18} /></button>
        <BookingExperience config={full.config} slots={full.slots} lang={lang} preview />
      </div>
    </div>
  );

  if (view === 'edit') {
    return (
      <PageWrapper>
        <PreviewStyles />
        <BookingEditor link={editing} boards={boards} members={members} lang={lang}
          onClose={() => setView('list')} onSaved={() => { setView('list'); load(); }}
          onPreviewFull={(p) => setFull(p)} toastError={toastError} toastSuccess={toastSuccess} />
        {overlay}
      </PageWrapper>
    );
  }

  if (view === 'workflow') {
    return (
      <PageWrapper>
        <WorkflowEditor workflow={editingWf} eventTypes={eventTypes} orgId={currentOrg?._id} lang={lang}
          onClose={() => setView('list')} onSaved={() => { setView('list'); loadWorkflows(); }}
          toastError={toastError} toastSuccess={toastSuccess} />
      </PageWrapper>
    );
  }

  return (
    <PageWrapper>
      <PreviewStyles />
      <div className="page book">
        <div className="page-head" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <span className="page-eyebrow dm-book"><span className="pe-ic"><Icon name="calendar" size={13} /></span>{L({ en: 'Booking', fr: 'Réservations' }, lang)}</span>
            <h1 className="page-title">{L({ en: 'Booking links', fr: 'Liens de réservation' }, lang)}</h1>
            <p className="page-sub">{L({ en: 'Share a beautiful page and let clients book property tours themselves — visits land straight in your calendar.', fr: 'Partagez une belle page et laissez les clients réserver leurs visites — elles arrivent directement dans votre calendrier.' }, lang)}</p>
          </div>
          <button type="button" className="btn btn-primary" style={{ background: 'var(--book)', boxShadow: '0 2px 10px -2px var(--book)' }} onClick={() => openEdit(null)}><Icon name="plus" size={16} />{L({ en: 'New link', fr: 'Nouveau lien' }, lang)}</button>
        </div>

        {error && (
          <div className="nudge" style={{ background: 'var(--red-bg)', borderColor: 'rgba(220,38,38,.26)' }}>
            <span className="nd-ic" style={{ background: 'rgba(220,38,38,.16)', color: 'var(--red)' }}><Icon name="info" size={17} /></span>
            <div><div className="nd-t">{L({ en: 'Couldn’t load booking links', fr: 'Impossible de charger les liens' }, lang)}</div></div>
            <button type="button" className="nd-fix" style={{ background: 'var(--red)' }} onClick={load}><Icon name="refresh" size={14} />{L({ en: 'Retry', fr: 'Réessayer' }, lang)}</button>
          </div>
        )}

        {loading ? (
          <div className="link-grid">{Array.from({ length: 3 }).map((_, i) => <div className="link-card" key={i}><div className="sk" style={{ height: 96, borderRadius: 0 }} /><div className="link-body"><Sk w="70%" h={15} /><Sk w="100%" h={34} /><Sk w="100%" h={34} /></div></div>)}</div>
        ) : links.length === 0 ? (
          <div className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '48px 24px', gap: 6 }}>
            <div style={{ width: 64, height: 64, borderRadius: 18, display: 'grid', placeItems: 'center', background: 'var(--book-tint)', color: 'var(--book-ink)', marginBottom: 10 }}><Icon name="calendar" size={28} /></div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18 }}>{L({ en: 'No booking links yet', fr: 'Aucun lien de réservation' }, lang)}</div>
            <div style={{ color: 'var(--text-2)', fontSize: 14, maxWidth: 360, textWrap: 'pretty' }}>{L({ en: 'Create your first link in a minute — pick a board, your hours, and share it.', fr: 'Créez votre premier lien en une minute — un tableau, vos heures, et partagez-le.' }, lang)}</div>
            <button type="button" className="btn btn-primary" style={{ marginTop: 14, background: 'var(--book)' }} onClick={() => openEdit(null)}><Icon name="plus" size={15} />{L({ en: 'Create a link', fr: 'Créer un lien' }, lang)}</button>
          </div>
        ) : (
          <div className="link-grid">
            {links.map((l) => (
              <LinkCard key={l._id} link={l} members={members} lang={lang}
                onToggle={(v) => toggleActive(l, v)} onEdit={() => openEdit(l)}
                onOpen={() => (l.publicUrl ? window.open(l.publicUrl, '_blank') : setFull(previewFor(l)))}
                onDelete={() => remove(l)} />
            ))}
          </div>
        )}

        {/* Bottom section — Workflows */}
        <WorkflowsSection workflows={workflows} loading={wfLoading} lang={lang}
          onNew={() => openWf(null)} onEdit={openWf} onDelete={removeWf} />

        {overlay}
      </div>
    </PageWrapper>
  );
}

// Styling for the new availability editor, embedded live preview, and workflow list.
const PreviewStyles = () => (
  <style>{`
.avail-list{ display:flex; flex-direction:column; gap:8px; }
.avail-day{ display:flex; align-items:flex-start; gap:12px; }
.avail-toggle{ width:54px; height:36px; flex:0 0 auto; border-radius:9px; border:1px solid var(--border); background:var(--surface); font-size:12.5px; font-weight:700; color:var(--text-2); cursor:pointer; }
.avail-toggle.on{ background:var(--book-tint); border-color:var(--book); color:var(--book-ink); }
.avail-ranges{ display:flex; flex-wrap:wrap; align-items:center; gap:8px; padding-top:2px; min-height:36px; }
.avail-off{ font-size:13px; color:var(--muted); }
.avail-range{ display:flex; align-items:center; gap:6px; }
.avail-range input[type=time]{ height:36px; border:1px solid var(--border); border-radius:8px; padding:0 8px; font-size:13px; font-family:var(--font-body); color:var(--text); background:var(--surface); }
.avail-add{ display:inline-flex; align-items:center; gap:5px; font-size:12.5px; font-weight:600; color:var(--book-ink); background:none; border:none; cursor:pointer; }
/* Embedded live preview: the true DESKTOP layout, scaled to fit the pane (via ScaledPreview). */
.bk-live-frame{ border:1px solid var(--border); border-radius:16px; overflow:hidden; background:#F4F2ED; }
.bk-live-frame .pubook{ min-height:0; padding:48px 22px 26px; }
.bk-live-frame .pubook .stage{ max-width:100%; }
.wf-list{ display:flex; flex-direction:column; gap:10px; }
.wf-item{ display:flex; align-items:center; gap:12px; padding:14px 16px; background:var(--surface); border:1px solid var(--border); border-radius:14px; cursor:pointer; transition:.15s var(--ease); }
.wf-item:hover{ border-color:var(--book); box-shadow:0 4px 16px -8px var(--book); }
.wf-item .wf-name{ font-weight:700; font-size:14.5px; }
.wf-item .wf-meta{ font-size:12.5px; color:var(--text-2); margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  `}</style>
);
