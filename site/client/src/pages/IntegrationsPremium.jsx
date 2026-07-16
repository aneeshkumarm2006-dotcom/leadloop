/* ============================================================
   Integrations / Connections (teal) — marketplace grid + drawer.
   WIRED to real connection status via GET /api/automations/connections.
   Connect / Manage deep-link to the real settings flows.
   ============================================================ */
import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageWrapper from '../components/layout/PageWrapper';
import Icon from '../premium/PremiumIcons';
import { Sk } from '../premium/PremiumShared';
import { L } from '../premium/premiumData';
import { getConnections } from '../services/automationService';
import IntegrationsTab from '../components/board/IntegrationsTab';
import ApiConnectSection from '../components/board/ApiConnectSection';
import useOrgStore from '../store/orgStore';
import useBoardStore from '../store/boardStore';
import '../premium/premium.css';

// Static provider catalog — names/colors/copy are presentation; status is real.
// `channel`/`emailProvider` map each card to a real channel in getConnections.
const PROVIDERS = [
  { id: 'gmail', name: 'Gmail', mono: 'G', color: '#EA4335', cat: 'comm', channel: 'email', emailProvider: 'gmail', desc: { en: 'Send and track emails to leads straight from their card.', fr: 'Envoyez et suivez les courriels aux prospects depuis leur fiche.' } },
  { id: 'outlook', name: 'Outlook', mono: 'O', color: '#0F6CBD', cat: 'comm', channel: 'email', emailProvider: 'microsoft', desc: { en: 'Two-way sync with your Microsoft 365 mailbox.', fr: 'Synchronisation bidirectionnelle avec votre boîte Microsoft 365.' } },
  { id: 'imap', name: 'IMAP email', mono: '@', color: '#5B6470', cat: 'comm', channel: 'email', emailProvider: 'smtp', desc: { en: 'Connect any mailbox with standard IMAP / SMTP.', fr: 'Connectez toute boîte courriel via IMAP / SMTP standard.' } },
  { id: 'twilio', name: 'Twilio SMS', mono: 'T', color: '#F22F46', cat: 'comm', channel: 'sms', desc: { en: 'Text leads and send visit reminders by SMS.', fr: 'Textez les prospects et envoyez des rappels de visite par SMS.' } },
  { id: 'whatsapp', name: 'WhatsApp Business', mono: 'W', color: '#25D366', cat: 'comm', channel: 'whatsapp', desc: { en: 'Reach clients on WhatsApp with approved templates.', fr: 'Joignez les clients sur WhatsApp avec des modèles approuvés.' } },
  { id: 'webhooks', name: 'Webhooks', mono: '{}', color: '#4F46E5', cat: 'dev', channel: 'webhooks', desc: { en: 'Push and receive events — inbound and outbound.', fr: 'Envoyez et recevez des événements — entrants et sortants.' } },
  { id: 'leadapi', name: 'Lead Intake API', mono: '</>', color: '#0EA5E9', cat: 'dev', channel: 'leadapi', desc: { en: 'Connect your own website form — every submission becomes a lead, columns build themselves.', fr: 'Connectez votre propre formulaire web — chaque envoi devient un prospect, les colonnes se créent d’elles-mêmes.' } },
  { id: 'ics', name: 'Calendar / .ics', mono: '31', color: '#0E9F8E', cat: 'cal', channel: 'calendar', desc: { en: 'Add booked visits to any calendar with .ics feeds.', fr: 'Ajoutez les visites à tout calendrier via des flux .ics.' } },
  { id: 'zapier', name: 'Zapier', mono: 'Z', color: '#FF4F00', cat: 'dev', soon: true, desc: { en: 'Connect 6,000+ apps with no-code automations.', fr: 'Reliez plus de 6 000 applis sans code.' } },
  { id: 'slack', name: 'Slack', mono: 'S', color: '#611f69', cat: 'comm', soon: true, desc: { en: 'Get deal alerts in your team channels.', fr: 'Recevez les alertes dans vos canaux d’équipe.' } },
  { id: 'gcal', name: 'Google Calendar', mono: 'C', color: '#1A73E8', cat: 'cal', soon: true, desc: { en: 'Live two-way calendar sync for every agent.', fr: 'Synchronisation bidirectionnelle en temps réel.' } },
];

const CATS = [
  { key: 'all', label: { en: 'All', fr: 'Tout' } },
  { key: 'comm', label: { en: 'Communication', fr: 'Communication' } },
  { key: 'cal', label: { en: 'Calendar', fr: 'Calendrier' } },
  { key: 'dev', label: { en: 'Developer', fr: 'Développeur' } },
];

// Resolve a provider's real status + account label from the channels payload.
const resolveStatus = (p, channels) => {
  if (p.soon) return { st: 'soon' };
  if (!channels) return { st: 'connect' };
  if (p.channel === 'email') {
    const acct = (channels.email?.accounts || []).find((a) => a.provider === p.emailProvider);
    return acct ? { st: 'connected', account: acct.defaultFrom } : { st: 'connect' };
  }
  if (p.channel === 'sms') return channels.sms?.connected ? { st: 'connected', account: channels.sms.defaultFrom } : { st: 'connect' };
  if (p.channel === 'whatsapp') return channels.whatsapp?.connected ? { st: 'connected', account: channels.whatsapp.sender } : { st: 'connect' };
  if (p.channel === 'webhooks') return channels.webhooks?.connected ? { st: 'connected', account: `${channels.webhooks.count} endpoints` } : { st: 'connect' };
  if (p.channel === 'leadapi') return channels.leadApi?.connected ? { st: 'connected', account: `${channels.leadApi.count} keys` } : { st: 'connect' };
  if (p.channel === 'calendar') return channels.calendar?.connected ? { st: 'connected', account: 'via Google' } : { st: 'connect' };
  return { st: 'connect' };
};

// Where "Connect / Manage" sends the user (the real flow lives there).
const manageLinkFor = (p, channels) => {
  if (p.channel === 'sms') return '/settings?tab=sms';
  if (p.channel === 'whatsapp') return '/settings?tab=whatsapp';
  if (p.channel === 'webhooks') {
    const b = channels?.webhooks?.boards?.[0];
    return b ? `/boards/${b._id}/intake` : '/';
  }
  return '/settings?tab=email'; // email + calendar
};

function ConnectDrawer({ provider, lang, onClose, onGo }) {
  const unlocks = {
    gmail: [{ en: 'Log every email on the lead’s timeline', fr: 'Consignez chaque courriel sur la fiche' }, { en: 'Send from automations & templates', fr: 'Envoyez via automatisations et modèles' }, { en: 'Track opens and replies', fr: 'Suivez ouvertures et réponses' }],
    default: [{ en: 'Reach leads where they already are', fr: 'Joignez les prospects là où ils sont' }, { en: 'Trigger automations on new messages', fr: 'Déclenchez des automatisations' }, { en: 'Keep everything on one timeline', fr: 'Gardez tout sur une seule chronologie' }],
  };
  const list = unlocks[provider.id] || unlocks.default;
  return createPortal(
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={provider.name}>
        <div className="drawer-head" style={{ background: `linear-gradient(135deg, ${provider.color}, ${provider.color}cc)` }}>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="Close"><Icon name="x" size={18} /></button>
          <div className="dh-tile">{provider.mono}</div>
          <h2>{L({ en: 'Connect ', fr: 'Connecter ' }, lang)}{provider.name}</h2>
          <div className="dh-sub">{L(provider.desc, lang)}</div>
        </div>
        <div className="drawer-body">
          <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 13 }}>{L({ en: 'What this unlocks', fr: 'Ce que ça débloque' }, lang)}</div>
          <div className="unlock-list">
            {list.map((u, i) => <div className="unlock" key={i}><span className="ul-ic"><Icon name="check" size={14} stroke={3} /></span><span className="ul-t">{L(u, lang)}</span></div>)}
          </div>
          <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '16px', display: 'flex', gap: 11, alignItems: 'center' }}>
            <span className="ul-ic" style={{ width: 30, height: 30, background: 'var(--integ-tint)', color: 'var(--integ)' }}><Icon name="lock" size={15} /></span>
            <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.45 }}>{L({ en: 'You’ll finish connecting on the secure settings screen — we never store credentials in the browser.', fr: 'Vous terminerez la connexion sur l’écran sécurisé des paramètres — aucun identifiant n’est stocké dans le navigateur.' }, lang)}</div>
          </div>
        </div>
        <div className="drawer-foot">
          <button type="button" className="btn btn-ghost" style={{ flex: '0 0 auto' }} onClick={onClose}>{L({ en: 'Cancel', fr: 'Annuler' }, lang)}</button>
          <button type="button" className="btn btn-primary" style={{ flex: 1, background: 'var(--integ)', boxShadow: '0 2px 10px -2px var(--integ)' }} onClick={onGo}>
            <Icon name="arrowRight" size={15} />{L({ en: 'Continue in Settings', fr: 'Continuer dans Paramètres' }, lang)}
          </button>
        </div>
      </aside>
    </>, document.body);
}

export default function IntegrationsPremium() {
  const { i18n } = useTranslation();
  const lang = i18n.language && i18n.language.startsWith('fr') ? 'fr' : 'en';
  const navigate = useNavigate();
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const boards = useBoardStore((s) => s.boards);
  const fetchBoards = useBoardStore((s) => s.fetchBoards);
  const getBoardById = useBoardStore((s) => s.getBoardById);

  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const [drawer, setDrawer] = useState(null);
  const [channels, setChannels] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [webhookOpen, setWebhookOpen] = useState(false);
  const [whBoardId, setWhBoardId] = useState('');
  const [leadApiOpen, setLeadApiOpen] = useState(false);
  const [laBoardId, setLaBoardId] = useState('');

  const load = useCallback(async () => {
    if (!currentOrg?._id) return;
    setLoading(true); setError(false);
    try {
      const data = await getConnections(currentOrg._id);
      setChannels(data.channels || data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [currentOrg?._id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (currentOrg?._id && boards.length === 0) fetchBoards(currentOrg._id).catch(() => {}); }, [currentOrg?._id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!whBoardId && boards[0]) setWhBoardId(boards[0]._id); }, [boards, whBoardId]);
  useEffect(() => { if (!laBoardId && boards[0]) setLaBoardId(boards[0]._id); }, [boards, laBoardId]);

  const filtered = PROVIDERS.filter((p) => (cat === 'all' || p.cat === cat) && (q === '' || p.name.toLowerCase().includes(q.toLowerCase())));
  // Webhooks + the Lead Intake API are board-scoped: open the in-page manager
  // sheet. Everything else → Settings.
  const openManage = (p) => {
    if (p.channel === 'webhooks') return setWebhookOpen(true);
    if (p.channel === 'leadapi') return setLeadApiOpen(true);
    return navigate(manageLinkFor(p, channels));
  };
  const openConnect = (p) => {
    if (p.channel === 'webhooks') return setWebhookOpen(true);
    if (p.channel === 'leadapi') return setLeadApiOpen(true);
    return setDrawer(p);
  };

  return (
    <PageWrapper>
      <div className="page">
        <div className="page-head">
          <span className="page-eyebrow dm-integ"><span className="pe-ic"><Icon name="plug" size={13} /></span>{L({ en: 'Integrations', fr: 'Intégrations' }, lang)}</span>
          <h1 className="page-title">{L({ en: 'Connect your tools', fr: 'Connectez vos outils' }, lang)}</h1>
          <p className="page-sub">{L({ en: 'Plug in email, SMS, WhatsApp, calendars and webhooks. Everything a lead does flows onto one timeline.', fr: 'Branchez courriel, SMS, WhatsApp, calendriers et webhooks. Tout ce qu’un prospect fait arrive sur une seule chronologie.' }, lang)}</p>
        </div>

        {error && (
          <div className="nudge" style={{ background: 'var(--red-bg)', borderColor: 'rgba(220,38,38,.26)' }}>
            <span className="nd-ic" style={{ background: 'rgba(220,38,38,.16)', color: 'var(--red)' }}><Icon name="info" size={17} /></span>
            <div>
              <div className="nd-t">{L({ en: 'Couldn’t load connections', fr: 'Impossible de charger les connexions' }, lang)}</div>
              <div className="nd-s">{L({ en: 'Check your access and try again.', fr: 'Vérifiez votre accès et réessayez.' }, lang)}</div>
            </div>
            <button type="button" className="nd-fix" style={{ background: 'var(--red)' }} onClick={load}><Icon name="refresh" size={14} />{L({ en: 'Retry', fr: 'Réessayer' }, lang)}</button>
          </div>
        )}

        <div className="integ-toolbar">
          <div className="integ-search">
            <Icon name="search" size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L({ en: 'Search integrations…', fr: 'Rechercher des intégrations…' }, lang)} />
          </div>
          <div className="fpills">
            {CATS.map((c) => <button type="button" key={c.key} className={'fpill' + (cat === c.key ? ' on' : '')} onClick={() => setCat(c.key)}>{L(c.label, lang)}</button>)}
          </div>
        </div>

        {loading ? (
          <div className="integ-grid">
            {Array.from({ length: 6 }).map((_, i) => (
              <div className="integ-card" key={i}><div className="ic-top"><div className="sk" style={{ width: 46, height: 46, borderRadius: 13 }} /><div style={{ flex: 1 }}><Sk w="60%" h={14} /><div style={{ height: 6 }} /><Sk w="40%" h={11} /></div></div><Sk w="100%" h={32} /><Sk w="50%" h={34} style={{ borderRadius: 8 }} /></div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty" style={{ padding: 50 }}><div className="eic"><Icon name="search" size={20} /></div><div className="et">{L({ en: 'No matches for “', fr: 'Aucun résultat pour « ' }, lang)}{q}{L({ en: '”', fr: ' »' }, lang)}</div></div>
        ) : (
          <div className="integ-grid">
            {filtered.map((p) => {
              const { st, account } = resolveStatus(p, channels);
              return (
                <div className={'integ-card' + (st === 'connected' ? ' connected' : '') + (st === 'soon' ? ' soon' : '')} key={p.id}>
                  <div className="ic-top">
                    <span className="integ-tile" style={{ background: `linear-gradient(140deg, ${p.color}, ${p.color}cc)` }}>{p.mono}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="ic-name">{p.name}</div>
                      <div className="ic-cat">{L(CATS.find((c) => c.key === p.cat).label, lang)}</div>
                    </div>
                    {st === 'connected' && <span className="integ-status"><span className="status-dot ok"><Icon name="checkCircle" size={15} /></span></span>}
                  </div>
                  <div className="ic-desc">{L(p.desc, lang)}</div>
                  <div className="ic-foot">
                    {st === 'connected' && <>
                      <span className="conn-account"><Icon name="check" size={12} stroke={3} />{account || L({ en: 'Connected', fr: 'Connecté' }, lang)}</span>
                      <button type="button" className="btn-connect ghost" style={{ marginLeft: 'auto', pointerEvents: 'auto', cursor: 'pointer', color: 'var(--text-2)' }} onClick={() => openManage(p)}>{L({ en: 'Manage', fr: 'Gérer' }, lang)}</button>
                    </>}
                    {st === 'connect' && <button type="button" className="btn-connect outline" onClick={() => openConnect(p)}><Icon name="plus" size={14} />{L({ en: 'Connect', fr: 'Connecter' }, lang)}</button>}
                    {st === 'soon' && <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--muted)', background: 'var(--subtle)', padding: '6px 12px', borderRadius: 999 }}>{L({ en: 'Coming soon', fr: 'Bientôt' }, lang)}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {drawer && <ConnectDrawer provider={drawer} lang={lang} onClose={() => setDrawer(null)} onGo={() => { const p = drawer; setDrawer(null); navigate(manageLinkFor(p, channels)); }} />}

        {webhookOpen && (
          <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setWebhookOpen(false); }}>
            <div className="sheet wide" style={{ maxWidth: 920, maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
              <div className="sheet-head">
                <div className="sh-eyebrow" style={{ color: 'var(--integ)' }}><Icon name="webhook" size={14} />{L({ en: 'Webhooks', fr: 'Webhooks' }, lang)}</div>
                <h2>{L({ en: 'Inbound & outbound webhooks', fr: 'Webhooks entrants et sortants' }, lang)}</h2>
                <div className="sh-sub">{L({ en: 'Push and receive events — chosen per board.', fr: 'Envoyez et recevez des événements — par tableau.' }, lang)}</div>
                <button type="button" className="sheet-close" onClick={() => setWebhookOpen(false)} aria-label="Close"><Icon name="x" size={18} /></button>
              </div>
              <div className="sheet-body" style={{ overflowY: 'auto' }}>
                <div className="blank-field" style={{ maxWidth: 360 }}>
                  <label>{L({ en: 'Board', fr: 'Tableau' }, lang)}</label>
                  <div className="bf-control">
                    <select className="bf-select" value={whBoardId} onChange={(e) => setWhBoardId(e.target.value)}>
                      {boards.length === 0 && <option value="">{L({ en: 'No boards yet', fr: 'Aucun tableau' }, lang)}</option>}
                      {boards.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
                    </select>
                    <span className="bf-caret"><Icon name="chevronDown" size={16} /></span>
                  </div>
                </div>
                {whBoardId && getBoardById(whBoardId)
                  ? <IntegrationsTab boardId={whBoardId} board={getBoardById(whBoardId)} />
                  : <div style={{ fontSize: 13, color: 'var(--text-2)' }}>{L({ en: 'Pick a board to manage its webhooks.', fr: 'Choisissez un tableau pour gérer ses webhooks.' }, lang)}</div>}
              </div>
            </div>
          </div>
        )}

        {leadApiOpen && (
          <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setLeadApiOpen(false); }}>
            <div className="sheet wide" style={{ maxWidth: 920, maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
              <div className="sheet-head">
                <div className="sh-eyebrow" style={{ color: 'var(--integ)' }}><Icon name="key" size={14} />{L({ en: 'Lead Intake API', fr: 'API d’entrée de prospects' }, lang)}</div>
                <h2>{L({ en: 'Connect your website form', fr: 'Connectez votre formulaire web' }, lang)}</h2>
                <div className="sh-sub">{L({ en: 'Create an API key, point your form at the endpoint — the first submission defines the columns, and new fields keep adding columns automatically.', fr: 'Créez une clé API et pointez votre formulaire vers le point de terminaison — le premier envoi définit les colonnes, et les nouveaux champs en ajoutent automatiquement.' }, lang)}</div>
                <button type="button" className="sheet-close" onClick={() => setLeadApiOpen(false)} aria-label="Close"><Icon name="x" size={18} /></button>
              </div>
              <div className="sheet-body" style={{ overflowY: 'auto' }}>
                <div className="blank-field" style={{ maxWidth: 360, marginBottom: 16 }}>
                  <label>{L({ en: 'Board receiving the leads', fr: 'Tableau recevant les prospects' }, lang)}</label>
                  <div className="bf-control">
                    <select className="bf-select" value={laBoardId} onChange={(e) => setLaBoardId(e.target.value)}>
                      {boards.length === 0 && <option value="">{L({ en: 'No boards yet', fr: 'Aucun tableau' }, lang)}</option>}
                      {boards.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
                    </select>
                    <span className="bf-caret"><Icon name="chevronDown" size={16} /></span>
                  </div>
                </div>
                {laBoardId
                  ? <ApiConnectSection boardId={laBoardId} />
                  : <div style={{ fontSize: 13, color: 'var(--text-2)' }}>{L({ en: 'Pick a board to manage its API keys.', fr: 'Choisissez un tableau pour gérer ses clés API.' }, lang)}</div>}
              </div>
            </div>
          </div>
        )}
      </div>
    </PageWrapper>
  );
}
