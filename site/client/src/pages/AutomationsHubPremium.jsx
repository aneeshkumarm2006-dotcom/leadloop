/* ============================================================
   Automations Hub (violet) — Workflows · Health · Usage.
   WIRED to real data: GET /api/automations/hub + /usage, real
   enable/disable toggle, and per-board deep-links to the editor.
   ============================================================ */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageWrapper from '../components/layout/PageWrapper';
import Icon from '../premium/PremiumIcons';
import { Toggle, LoadingState } from '../premium/PremiumShared';
import { L } from '../premium/premiumData';
import { getHub, getUsage, updateAutomation } from '../services/automationService';
import useOrgStore from '../store/orgStore';
import '../premium/premium.css';

// real triggerType / actionType → plain-language phrases
const TRIGGER_PHRASE = {
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
const ACTION_PHRASE = {
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

function Sentence({ a, lang }) {
  const trig = TRIGGER_PHRASE[a.triggerType] || { en: a.triggerType, fr: a.triggerType };
  const acts = (a.actionTypes || []).map((tp) => ACTION_PHRASE[tp] || { en: tp, fr: tp });
  const isSched = a.triggerType === 'SCHEDULE';
  return (
    <>
      {!isSched && <span className="sb-fixed">{L({ en: 'When ', fr: 'Quand ' }, lang)}</span>}
      <span className="vchip">{L(trig, lang)}</span>
      {acts.length > 0 && <span>{L({ en: ', ', fr: ', ' }, lang)}</span>}
      {acts.map((ac, i) => <span key={i}>{i > 0 ? L({ en: ' and ', fr: ' et ' }, lang) : ''}<span className="vchip">{L(ac, lang)}</span></span>)}
      {acts.length === 0 && <span style={{ color: 'var(--muted)' }}> · {L({ en: 'no actions yet', fr: 'aucune action' }, lang)}</span>}
      .
    </>
  );
}

const initials = (name) => (name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
function MiniAvatar({ owner, size = 16 }) {
  if (!owner) return null;
  return owner.profilePic
    ? <img src={owner.profilePic} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover' }} />
    : <span className="av" style={{ width: size, height: size, fontSize: size * 0.42, background: 'var(--autom)' }}>{initials(owner.name)}</span>;
}

function AreaChart({ data, w = 560, h = 180 }) {
  if (!data.length) data = [0];
  const max = Math.max(...data, 1) * 1.1; const min = 0;
  const span = max - min || 1;
  const X = (i) => (data.length === 1 ? w : (i / (data.length - 1)) * w);
  const Y = (v) => h - ((v - min) / span) * (h - 10) - 4;
  const line = data.map((v, i) => `${X(i)},${Y(v)}`).join(' ');
  const area = `0,${h} ${line} ${w},${h}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="areaGh" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--autom)" stopOpacity="0.30" />
          <stop offset="100%" stopColor="var(--autom)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" y1={h * f} x2={w} y2={h * f} stroke="var(--border)" strokeWidth="1" />)}
      <polygon points={area} fill="url(#areaGh)" />
      <polyline points={line} fill="none" stroke="var(--autom)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const relTime = (iso, lang) => {
  if (!iso) return L({ en: 'never run', fr: 'jamais exécutée' }, lang);
  const mins = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return L({ en: `${mins} min ago`, fr: `il y a ${mins} min` }, lang);
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return L({ en: `${hrs}h ago`, fr: `il y a ${hrs} h` }, lang);
  const d = Math.round(hrs / 24);
  return L({ en: `${d}d ago`, fr: `il y a ${d} j` }, lang);
};

function StatCard({ icon, tint, ink, label, value, foot }) {
  return (
    <div className="stat">
      <div className="st-top">
        <span className="st-ic" style={{ background: tint, color: ink }}><Icon name={icon} size={16} /></span>
        <span className="st-label">{label}</span>
      </div>
      <div className="st-val tnum">{value}</div>
      <div className="st-foot">{foot}</div>
    </div>
  );
}

export default function AutomationsHubPremium() {
  const { i18n } = useTranslation();
  const lang = i18n.language && i18n.language.startsWith('fr') ? 'fr' : 'en';
  const navigate = useNavigate();
  const currentOrg = useOrgStore((s) => s.currentOrg);

  const [section, setSection] = useState('workflows');
  const [hub, setHub] = useState(null);
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    if (!currentOrg?._id) return;
    setLoading(true); setError(false);
    try {
      const [h, u] = await Promise.all([getHub(currentOrg._id), getUsage(currentOrg._id)]);
      setHub(h); setUsage(u);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [currentOrg?._id]);

  useEffect(() => { load(); }, [load]);

  const autos = hub?.automations || [];
  const stats = hub?.stats || { total: 0, enabled: 0, needsSetup: 0, failing: 0, boards: 0 };
  const broken = autos.filter((a) => a.recentFailures > 0 || a.needsSetup);
  const byBoard = useMemo(() => {
    const groups = {};
    autos.forEach((a) => { const id = a.board?._id || '—'; (groups[id] = groups[id] || []).push(a); });
    return Object.entries(groups);
  }, [autos]);
  const nf = lang === 'fr' ? 'fr-CA' : 'en-US';

  const toggle = async (a, v) => {
    setHub((h) => ({ ...h, automations: h.automations.map((x) => (x._id === a._id ? { ...x, enabled: v } : x)) }));
    try { await updateAutomation(a._id, { enabled: v }); } catch { load(); }
  };

  const isEmpty = !loading && !error && stats.total === 0;

  return (
    <PageWrapper>
      <div className="page">
        <div className="page-head">
          <span className="page-eyebrow dm-autom"><span className="pe-ic"><Icon name="zap" size={13} /></span>{L({ en: 'Automations', fr: 'Automatisations' }, lang)}</span>
          <h1 className="page-title">{L({ en: 'Everything running for you', fr: 'Tout ce qui travaille pour vous' }, lang)}</h1>
          <p className="page-sub">{L({ en: 'A calm overview of every automation across your boards — written in plain language, with health you can trust. No quotas, no meters.', fr: 'Un aperçu serein de chaque automatisation de vos tableaux — en langage clair, avec une santé fiable. Aucun quota, aucun compteur.' }, lang)}</p>
        </div>

        <div className="stat-row">
          <StatCard icon="zap" tint="var(--autom-tint)" ink="var(--autom)" label={L({ en: 'Total workflows', fr: 'Total des flux' }, lang)} value={stats.total} foot={<span style={{ fontSize: 12, color: 'var(--muted)' }}>{stats.boards} {L({ en: 'boards', fr: 'tableaux' }, lang)}</span>} />
          <StatCard icon="play" tint="var(--done-bg)" ink="var(--done)" label={L({ en: 'Active', fr: 'Actifs' }, lang)} value={stats.enabled}
            foot={<div className="battery">{Array.from({ length: 8 }).map((_, i) => <i key={i} style={i < Math.round((stats.enabled / (stats.total || 1)) * 8) ? { background: 'var(--done)' } : null} />)}</div>} />
          <StatCard icon="sliders" tint="var(--subtle)" ink="var(--text-2)" label={L({ en: 'Needs setup', fr: 'À configurer' }, lang)} value={stats.needsSetup}
            foot={<span style={{ fontSize: 12, color: 'var(--muted)' }}>{L({ en: 'ready when you are', fr: 'prêt quand vous l’êtes' }, lang)}</span>} />
          <StatCard icon="heart" tint="var(--amber-bg)" ink="var(--amber)" label={L({ en: 'Needs attention', fr: 'À surveiller' }, lang)} value={stats.failing}
            foot={<span style={{ fontSize: 12, color: stats.failing ? 'var(--amber)' : 'var(--done)', fontWeight: 600 }}>{stats.failing ? L({ en: 'we paused them safely', fr: 'mises en pause sans risque' }, lang) : L({ en: 'all healthy', fr: 'tout va bien' }, lang)}</span>} />
        </div>

        <div className="subnav">
          {[['workflows', 'zap', { en: 'Workflows', fr: 'Flux' }, stats.total],
            ['health', 'heart', { en: 'Health', fr: 'Santé' }, broken.length],
            ['usage', 'activity', { en: 'Usage', fr: 'Utilisation' }, null]].map(([k, ic, lbl, ct]) => (
            <button type="button" key={k} className={section === k ? 'on' : ''} onClick={() => setSection(k)}>
              <Icon name={ic} size={15} />{L(lbl, lang)}{ct != null && <span className="sn-ct">{ct}</span>}
            </button>
          ))}
        </div>

        {error && (
          <div className="nudge" style={{ background: 'var(--red-bg)', borderColor: 'rgba(220,38,38,.26)' }}>
            <span className="nd-ic" style={{ background: 'rgba(220,38,38,.16)', color: 'var(--red)' }}><Icon name="info" size={17} /></span>
            <div><div className="nd-t">{L({ en: 'Couldn’t load automations', fr: 'Impossible de charger les automatisations' }, lang)}</div></div>
            <button type="button" className="nd-fix" style={{ background: 'var(--red)' }} onClick={load}><Icon name="refresh" size={14} />{L({ en: 'Retry', fr: 'Réessayer' }, lang)}</button>
          </div>
        )}

        {loading && <LoadingState rows={5} />}

        {isEmpty && (
          <div className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '48px 24px', gap: 6 }}>
            <div style={{ width: 64, height: 64, borderRadius: 18, display: 'grid', placeItems: 'center', background: 'var(--autom-tint)', color: 'var(--autom)', marginBottom: 10 }}><Icon name="zap" size={28} /></div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18 }}>{L({ en: 'Nothing automated yet', fr: 'Rien d’automatisé pour l’instant' }, lang)}</div>
            <div style={{ color: 'var(--text-2)', fontSize: 14, maxWidth: 380, textWrap: 'pretty' }}>{L({ en: 'Set up your first automation from the Form builder — it takes about a minute and runs forever.', fr: 'Créez votre première automatisation depuis le Créateur de formulaires — environ une minute, et elle tourne pour toujours.' }, lang)}</div>
            <button type="button" className="btn btn-primary" style={{ marginTop: 14, background: 'var(--autom)' }} onClick={() => navigate('/automations/forms')}><Icon name="arrowRight" size={15} />{L({ en: 'Open the builder', fr: 'Ouvrir le créateur' }, lang)}</button>
          </div>
        )}

        {!loading && !error && !isEmpty && section === 'workflows' && (
          <div>
            {byBoard.map(([bid, list]) => {
              const b = list[0].board;
              return (
                <div className="board-group" key={bid}>
                  <div className="bg-head">
                    <span className="bg-dot" style={{ background: b?.color || 'var(--muted)' }} />
                    <span className="bg-name">{b?.name || '—'}</span>
                    <span className="bg-ct">{list.length} {L({ en: list.length === 1 ? 'automation' : 'automations', fr: list.length === 1 ? 'automatisation' : 'automatisations' }, lang)}</span>
                  </div>
                  {list.map((a) => (
                    <div className={'wf-row' + (a.enabled ? '' : ' off')} key={a._id} style={{ cursor: 'default' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="wf-sentence"><Sentence a={a} lang={lang} /></div>
                        <div className="wf-meta">
                          {a.needsSetup ? <span className="wf-stat-dot" style={{ color: 'var(--text-2)' }}><i style={{ background: 'var(--muted)' }} />{L({ en: 'Needs setup', fr: 'À configurer' }, lang)}</span>
                            : a.recentFailures > 0 ? <span className="wf-stat-dot" style={{ color: 'var(--amber)' }}><i style={{ background: 'var(--amber)' }} />{L({ en: 'Needs a quick update', fr: 'Mise à jour requise' }, lang)}</span>
                              : <span className="wf-stat-dot" style={{ color: 'var(--done)' }}><i style={{ background: 'var(--done)' }} />{L({ en: 'Healthy', fr: 'En santé' }, lang)}</span>}
                          <span>·</span>
                          <span><Icon name="clock" size={11} style={{ verticalAlign: '-1px' }} /> {relTime(a.lastRunAt, lang)}</span>
                          {a.owner && <><span>·</span><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><MiniAvatar owner={a.owner} size={15} /> {a.owner.name}</span></>}
                        </div>
                      </div>
                      <div onClick={(e) => e.stopPropagation()}><Toggle on={a.enabled} onChange={(v) => toggle(a, v)} label="Toggle" /></div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {!loading && !error && !isEmpty && section === 'health' && (
          <div>
            {broken.length === 0 ? (
              <div className="health-card setup" style={{ alignItems: 'center' }}>
                <span className="hc-ic" style={{ background: 'var(--done)' }}><Icon name="checkCircle" size={20} /></span>
                <div className="hc-body"><div className="hc-title">{L({ en: 'Everything’s healthy', fr: 'Tout est en bonne santé' }, lang)}</div>
                  <div className="hc-sentence">{L({ en: 'All your automations are running as expected.', fr: 'Toutes vos automatisations fonctionnent comme prévu.' }, lang)}</div></div>
              </div>
            ) : broken.map((a) => {
              const kind = a.needsSetup ? 'setup' : a.lastError ? 'error' : 'warn';
              return (
                <div className={'health-card ' + kind} key={a._id}>
                  <span className="hc-ic"><Icon name={kind === 'error' ? 'alert' : kind === 'warn' ? 'info' : 'sliders'} size={19} /></span>
                  <div className="hc-body">
                    <div className="hc-title">{a.board?.name || '—'} · {a.name}</div>
                    <div className="hc-sentence"><Sentence a={a} lang={lang} /></div>
                    <div className="hc-reason">{a.needsSetup ? L({ en: 'Finish setup to turn this on.', fr: 'Terminez la configuration pour l’activer.' }, lang) : (a.lastError || L({ en: `${a.recentFailures} recent failures`, fr: `${a.recentFailures} échecs récents` }, lang))}</div>
                  </div>
                  <button type="button" className="hc-fix" onClick={() => a.board?._id && navigate(`/boards/${a.board._id}/automations`)}><Icon name="wand" size={14} />{a.needsSetup ? L({ en: 'Finish setup', fr: 'Configurer' }, lang) : L({ en: 'Open & fix', fr: 'Ouvrir et corriger' }, lang)}</button>
                </div>
              );
            })}
          </div>
        )}

        {!loading && !error && !isEmpty && section === 'usage' && usage && (
          <div className="usage-grid">
            <div className="usage-chart">
              <div className="uc-head">
                <span className="uc-big tnum">{(usage.totalActions || 0).toLocaleString(nf)}</span>
                <span style={{ color: 'var(--text-2)', fontSize: 13.5 }}>{L({ en: 'actions run for you in the last 30 days', fr: 'actions exécutées pour vous ces 30 derniers jours' }, lang)}</span>
              </div>
              <AreaChart data={(usage.byDay || []).map((d) => d.count)} />
              {usage.byDay?.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 11, color: 'var(--muted)' }}>
                  <span>{usage.byDay[0].date}</span><span>{usage.byDay[usage.byDay.length - 1].date}</span>
                </div>
              )}
            </div>
            <div className="usage-side">
              <div className="usage-list">
                <h3>{L({ en: 'Busiest boards', fr: 'Tableaux les plus actifs' }, lang)}</h3>
                {(usage.topBoards || []).length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>{L({ en: 'No activity yet.', fr: 'Aucune activité.' }, lang)}</div>}
                {(usage.topBoards || []).map((b) => {
                  const max = usage.topBoards[0].count || 1;
                  return (
                    <div className="ul-row" key={b._id}>
                      <span className="ul-name">{b.name}</span>
                      <span className="ul-bar"><i style={{ width: `${(b.count / max) * 100}%` }} /></span>
                      <span className="ul-val tnum">{b.count.toLocaleString(nf)}</span>
                    </div>
                  );
                })}
              </div>
              <div className="usage-list">
                <h3>{L({ en: 'Top creators', fr: 'Principaux créateurs' }, lang)}</h3>
                {(usage.topCreators || []).length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>{L({ en: 'No activity yet.', fr: 'Aucune activité.' }, lang)}</div>}
                {(usage.topCreators || []).map((m) => (
                  <div className="ul-row" key={m._id} style={{ marginBottom: 12 }}>
                    <MiniAvatar owner={m} size={26} />
                    <span style={{ flex: 1, fontSize: 13.5, fontWeight: 500 }}>{m.name}</span>
                    <span className="ul-val tnum" style={{ color: 'var(--text-2)' }}>{m.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </PageWrapper>
  );
}
