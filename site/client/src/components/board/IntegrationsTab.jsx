import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Copy,
  Check,
  Trash2,
  Send,
  ListTree,
  ArrowDownToLine,
  ArrowUpFromLine,
  RefreshCw,
  FileText,
  Pencil,
  ExternalLink,
} from 'lucide-react';
import Button from '../ui/Button';
import { Toggle } from './automationFields';
import WebhookMappingEditor from './WebhookMappingEditor';
import ApiConnectSection from './ApiConnectSection';
import * as webhookService from '../../services/webhookService';
import * as formService from '../../services/formService';

/**
 * IntegrationsTab — the F7 webhook surface for a board (admin-only).
 *
 * Lists inbound + outbound endpoints. Inbound rows show a copy-URL action and a
 * mapping editor; outbound rows show their destination. Each endpoint can be
 * toggled, tested ("Send test"), and inspected via a delivery-log table
 * (status / attempt / timestamp). Props: { boardId, board }.
 */

const STATUS_COLORS = {
  delivered: 'var(--color-status-done)',
  pending: 'var(--color-status-working)',
  failed: 'var(--color-status-stuck)',
};

const fmtTime = (d) => {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleString();
  } catch {
    return String(d);
  }
};

const CopyButton = ({ value }) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      title={t('itemTabs.copyUrl')}
      aria-label={t('itemTabs.copyInboundUrl')}
      className="inline-flex items-center gap-1.5"
      style={{
        fontSize: 12,
        padding: '4px 8px',
        borderRadius: 'var(--radius-md)',
        border: '1.5px solid var(--color-border)',
        background: 'transparent',
        color: 'var(--color-text-secondary)',
        cursor: 'pointer',
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? t('itemTabs.copied') : t('itemTabs.copyUrl')}
    </button>
  );
};

const DeliveryLog = ({ boardId, endpoint }) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    webhookService
      .listDeliveries(boardId, endpoint._id)
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [boardId, endpoint._id]);

  useEffect(() => { reload(); }, [reload]);

  return (
    <div style={{ marginTop: 10 }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-secondary)' }}>
          {t('itemTabs.deliveryLog')}
        </span>
        <button
          type="button"
          onClick={reload}
          aria-label={t('itemTabs.refreshDeliveryLog')}
          title={t('itemTabs.refresh')}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}
        >
          <RefreshCw size={13} />
        </button>
      </div>
      {loading && !rows ? (
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{t('itemTabs.loading')}</p>
      ) : !rows || rows.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{t('itemTabs.noDeliveries')}</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--color-text-muted)' }}>
                <th style={{ padding: '4px 8px' }}>{t('itemTabs.colStatus')}</th>
                <th style={{ padding: '4px 8px' }}>{t('itemTabs.colAttempt')}</th>
                <th style={{ padding: '4px 8px' }}>{t('itemTabs.colResponse')}</th>
                <th style={{ padding: '4px 8px' }}>{t('itemTabs.colWhen')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r._id} style={{ borderTop: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '4px 8px' }}>
                    <span style={{ color: STATUS_COLORS[r.status] || 'var(--color-text-secondary)', fontWeight: 600 }}>
                      {r.status}
                    </span>
                  </td>
                  <td style={{ padding: '4px 8px' }}>{r.attempt}</td>
                  <td style={{ padding: '4px 8px', color: 'var(--color-text-muted)' }}>
                    {r.response && r.response.status != null ? r.response.status : '—'}
                  </td>
                  <td style={{ padding: '4px 8px', color: 'var(--color-text-muted)' }}>{fmtTime(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const cardStyle = {
  border: '1.5px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  padding: '12px 14px',
  background: 'var(--color-bg-surface)',
};

/**
 * FormsSection — public intake forms for the board (F13). Forms are public
 * brandable surfaces (like inbound webhooks), so they live alongside the
 * webhook integrations. Lists the board's forms with copy-URL, enable toggle,
 * edit (→ builder) and delete; "New form" opens the builder pre-scoped to this
 * board.
 */
const FormsSection = ({ boardId }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [forms, setForms] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const reload = useCallback(() => {
    setLoading(true);
    formService
      .listForms(boardId)
      .then(setForms)
      .catch(() => setForms([]))
      .finally(() => setLoading(false));
  }, [boardId]);

  useEffect(() => {
    if (boardId) reload();
  }, [boardId, reload]);

  const toggle = async (form, enabled) => {
    setBusyId(form._id);
    try {
      const updated = await formService.updateForm(form._id, { enabled });
      setForms((list) => list.map((f) => (f._id === updated._id ? updated : f)));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (form) => {
    if (!window.confirm(t('itemTabs.deleteFormConfirm', { name: form.name }))) return;
    setBusyId(form._id);
    try {
      await formService.deleteForm(form._id);
      setForms((list) => list.filter((f) => f._id !== form._id));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-display font-semibold inline-flex items-center gap-2" style={{ fontSize: 15, color: 'var(--color-text-primary)' }}>
          <FileText size={16} /> {t('itemTabs.publicForms')}
        </h3>
        <Button variant="secondary" size="sm" icon={Plus} onClick={() => navigate(`/forms/new?boardId=${boardId}`)}>
          {t('itemTabs.newForm')}
        </Button>
      </div>
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
        {t('itemTabs.formsDescriptionPrefix')}<code>/f/:slug</code>{t('itemTabs.formsDescriptionSuffix')}
      </p>

      {loading && forms.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{t('itemTabs.loading')}</p>
      ) : forms.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{t('itemTabs.noForms')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {forms.map((form) => (
            <li key={form._id} style={{ ...cardStyle, opacity: form.enabled ? 1 : 0.7 }}>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-body" style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text-primary)' }}>{form.name}</span>
                <code style={{ fontSize: 12, color: 'var(--color-text-secondary)', wordBreak: 'break-all', flex: 1, minWidth: 180 }}>{form.publicUrl}</code>
                <CopyButton value={form.publicUrl} />
                <a href={`/f/${form.slug}`} target="_blank" rel="noreferrer" title={t('itemTabs.openForm')} aria-label={t('itemTabs.openForm')} className="inline-flex items-center" style={{ color: 'var(--color-accent)' }}>
                  <ExternalLink size={14} />
                </a>
                <Toggle checked={form.enabled} disabled={busyId === form._id} onChange={(v) => toggle(form, v)} />
                <IconBtn label={t('itemTabs.editForm')} icon={Pencil} onClick={() => navigate(`/forms/${form._id}/edit`)} />
                <IconBtn label={t('itemTabs.delete')} icon={Trash2} danger onClick={() => remove(form)} disabled={busyId === form._id} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

const IntegrationsTab = ({ boardId, board }) => {
  const { t } = useTranslation();
  const [endpoints, setEndpoints] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [expanded, setExpanded] = useState({}); // id -> 'log' | 'map' | null
  const [newOutUrl, setNewOutUrl] = useState('');
  const [testFeedback, setTestFeedback] = useState({}); // id -> string

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    webhookService
      .listEndpoints(boardId)
      .then(setEndpoints)
      .catch((e) => setError(e?.response?.data?.error || t('itemTabs.webhooksLoadError')))
      .finally(() => setLoading(false));
  }, [boardId, t]);

  useEffect(() => { if (boardId) reload(); }, [boardId, reload]);

  const inbound = endpoints.filter((e) => e.direction === 'in');
  const outbound = endpoints.filter((e) => e.direction === 'out');

  const addInbound = async () => {
    setBusyId('new-in');
    try {
      const ep = await webhookService.createEndpoint(boardId, { direction: 'in', mapping: {} });
      setEndpoints((list) => [ep, ...list]);
    } catch (e) {
      setError(e?.response?.data?.error || t('itemTabs.createInboundError'));
    } finally {
      setBusyId(null);
    }
  };

  const addOutbound = async () => {
    if (!newOutUrl.trim()) return;
    setBusyId('new-out');
    try {
      const ep = await webhookService.createEndpoint(boardId, { direction: 'out', url: newOutUrl.trim() });
      setEndpoints((list) => [ep, ...list]);
      setNewOutUrl('');
    } catch (e) {
      setError(e?.response?.data?.error || t('itemTabs.createOutboundError'));
    } finally {
      setBusyId(null);
    }
  };

  const toggle = async (ep, enabled) => {
    setBusyId(ep._id);
    try {
      const updated = await webhookService.updateEndpoint(boardId, ep._id, { enabled });
      setEndpoints((list) => list.map((e) => (e._id === updated._id ? updated : e)));
    } catch (e) {
      setError(e?.response?.data?.error || t('itemTabs.updateEndpointError'));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (ep) => {
    if (!window.confirm(t('itemTabs.deleteEndpointConfirm'))) return;
    setBusyId(ep._id);
    try {
      await webhookService.deleteEndpoint(boardId, ep._id);
      setEndpoints((list) => list.filter((e) => e._id !== ep._id));
    } catch (e) {
      setError(e?.response?.data?.error || t('itemTabs.deleteEndpointError'));
    } finally {
      setBusyId(null);
    }
  };

  const saveMapping = async (ep, mapping) => {
    const updated = await webhookService.updateEndpoint(boardId, ep._id, { mapping });
    setEndpoints((list) => list.map((e) => (e._id === updated._id ? updated : e)));
  };

  const testMappingDryRun = async (ep, sample) => {
    const res = await webhookService.testEndpoint(boardId, ep._id, { sample });
    return res; // { direction:'in', columnValues, missing }
  };

  const sendTest = async (ep) => {
    setBusyId(ep._id);
    setTestFeedback((f) => ({ ...f, [ep._id]: t('itemTabs.sending') }));
    try {
      const res = await webhookService.testEndpoint(boardId, ep._id, {});
      const status = res?.delivery?.status || 'sent';
      setTestFeedback((f) => ({ ...f, [ep._id]: t('itemTabs.testStatus', { status }) }));
      setExpanded((x) => ({ ...x, [ep._id]: 'log' }));
    } catch (e) {
      setTestFeedback((f) => ({ ...f, [ep._id]: e?.response?.data?.error || t('itemTabs.testFailed') }));
    } finally {
      setBusyId(null);
      setTimeout(() => setTestFeedback((f) => ({ ...f, [ep._id]: null })), 4000);
    }
  };

  const toggleExpand = (id, panel) =>
    setExpanded((x) => ({ ...x, [id]: x[id] === panel ? null : panel }));

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <p style={{ fontSize: 12, color: 'var(--color-status-stuck)' }}>{error}</p>
      )}

      {/* Forms (F13) */}
      <FormsSection boardId={boardId} />

      {/* Connect an external form via API key (F14) */}
      <ApiConnectSection boardId={boardId} />

      {/* Inbound */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="font-display font-semibold inline-flex items-center gap-2" style={{ fontSize: 15, color: 'var(--color-text-primary)' }}>
            <ArrowDownToLine size={16} /> {t('itemTabs.inboundWebhooks')}
          </h3>
          <Button variant="secondary" size="sm" icon={Plus} onClick={addInbound} disabled={busyId === 'new-in'}>
            {t('itemTabs.newInbound')}
          </Button>
        </div>
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
          {t('itemTabs.inboundDescription')}
        </p>

        {loading && endpoints.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{t('itemTabs.loading')}</p>
        ) : inbound.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{t('itemTabs.noInboundEndpoints')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {inbound.map((ep) => (
              <li key={ep._id} style={{ ...cardStyle, opacity: ep.enabled ? 1 : 0.7 }}>
                <div className="flex items-center gap-3 flex-wrap">
                  <code style={{ fontSize: 12, color: 'var(--color-text-secondary)', wordBreak: 'break-all', flex: 1, minWidth: 200 }}>
                    {ep.inboundUrl}
                  </code>
                  <CopyButton value={ep.inboundUrl} />
                  <Toggle checked={ep.enabled} disabled={busyId === ep._id} onChange={(v) => toggle(ep, v)} />
                  <IconBtn label={t('itemTabs.fieldMapping')} icon={ListTree} onClick={() => toggleExpand(ep._id, 'map')} active={expanded[ep._id] === 'map'} />
                  <IconBtn label={t('itemTabs.deliveryLog')} icon={ArrowDownToLine} onClick={() => toggleExpand(ep._id, 'log')} active={expanded[ep._id] === 'log'} />
                  <IconBtn label={t('itemTabs.delete')} icon={Trash2} danger onClick={() => remove(ep)} disabled={busyId === ep._id} />
                </div>
                {expanded[ep._id] === 'map' && (
                  <WebhookMappingEditor
                    board={board}
                    endpoint={ep}
                    onSave={(mapping) => saveMapping(ep, mapping)}
                    onTest={(sample) => testMappingDryRun(ep, sample)}
                  />
                )}
                {expanded[ep._id] === 'log' && <DeliveryLog boardId={boardId} endpoint={ep} />}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Outbound */}
      <section className="flex flex-col gap-3">
        <h3 className="font-display font-semibold inline-flex items-center gap-2" style={{ fontSize: 15, color: 'var(--color-text-primary)' }}>
          <ArrowUpFromLine size={16} /> {t('itemTabs.outboundWebhooks')}
        </h3>
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
          {t('itemTabs.outboundDescriptionPrefix')}<strong>{t('itemTabs.postToWebhook')}</strong>{t('itemTabs.outboundDescriptionMiddle')}<code>X-CRM-Signature</code>{t('itemTabs.outboundDescriptionSuffix')}
        </p>
        <div className="flex items-center gap-2">
          <input
            type="url"
            value={newOutUrl}
            onChange={(e) => setNewOutUrl(e.target.value)}
            placeholder={t('itemTabs.webhookUrlPlaceholder')}
            style={{
              height: 34,
              padding: '0 10px',
              borderRadius: 'var(--radius-md)',
              border: '1.5px solid var(--color-border)',
              background: 'var(--color-bg-input)',
              color: 'var(--color-text-primary)',
              fontSize: 13,
              flex: 1,
            }}
          />
          <Button variant="secondary" size="sm" icon={Plus} onClick={addOutbound} disabled={busyId === 'new-out' || !newOutUrl.trim()}>
            {t('itemTabs.add')}
          </Button>
        </div>

        {outbound.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{t('itemTabs.noOutboundEndpoints')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {outbound.map((ep) => (
              <li key={ep._id} style={{ ...cardStyle, opacity: ep.enabled ? 1 : 0.7 }}>
                <div className="flex items-center gap-3 flex-wrap">
                  <code style={{ fontSize: 12, color: 'var(--color-text-secondary)', wordBreak: 'break-all', flex: 1, minWidth: 200 }}>
                    {ep.url}
                  </code>
                  {testFeedback[ep._id] && (
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{testFeedback[ep._id]}</span>
                  )}
                  <Toggle checked={ep.enabled} disabled={busyId === ep._id} onChange={(v) => toggle(ep, v)} />
                  <IconBtn label={t('itemTabs.sendTest')} icon={Send} onClick={() => sendTest(ep)} disabled={busyId === ep._id} />
                  <IconBtn label={t('itemTabs.deliveryLog')} icon={ArrowDownToLine} onClick={() => toggleExpand(ep._id, 'log')} active={expanded[ep._id] === 'log'} />
                  <IconBtn label={t('itemTabs.delete')} icon={Trash2} danger onClick={() => remove(ep)} disabled={busyId === ep._id} />
                </div>
                <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 6 }}>
                  {t('itemTabs.signingSecret')} <code>{ep.secret}</code>
                </p>
                {expanded[ep._id] === 'log' && <DeliveryLog boardId={boardId} endpoint={ep} />}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

const IconBtn = ({ label, onClick, disabled, icon: Icon, danger, active }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    title={label}
    className="flex items-center justify-center rounded-md transition-colors duration-150 hover:bg-[color:var(--color-bg-subtle)]"
    style={{
      width: 30,
      height: 30,
      border: '1.5px solid',
      borderColor: active ? 'var(--color-accent)' : 'var(--color-border)',
      background: active ? 'var(--color-accent-light)' : 'transparent',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.6 : 1,
    }}
  >
    {Icon && <Icon size={14} color={danger ? '#DC2626' : active ? 'var(--color-accent-text)' : 'var(--color-text-secondary)'} />}
  </button>
);

export default IntegrationsTab;
