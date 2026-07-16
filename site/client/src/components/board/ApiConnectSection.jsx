import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, KeyRound, Trash2, BookOpen } from 'lucide-react';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import { Toggle } from './automationFields';
import LeadApiDocsModal from './LeadApiDocsModal';
import * as leadService from '../../services/leadConnectionService';

/**
 * ApiConnectSection — "connect your website form via API" (F14).
 *
 * Sits in the board Integrations tab alongside public forms and webhooks. Lists
 * the board's API keys, creates new ones (opening the docs popup with the key
 * revealed once), and toggles / deletes them. The heavy lifting — endpoint,
 * snippets, detected columns, submission log — lives in [LeadApiDocsModal].
 */

const cardStyle = {
  border: '1.5px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  padding: '12px 14px',
  background: 'var(--color-bg-surface)',
};

const IconBtn = ({ label, onClick, disabled, icon: Icon, danger }) => (
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
      border: '1.5px solid var(--color-border)',
      background: 'transparent',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.6 : 1,
    }}
  >
    {Icon && <Icon size={14} color={danger ? '#DC2626' : 'var(--color-text-secondary)'} />}
  </button>
);

const ApiConnectSection = ({ boardId }) => {
  const { t } = useTranslation();
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);
  // { connection, apiKey } — apiKey is only set right after create/rotate.
  const [docs, setDocs] = useState(null);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    leadService
      .listConnections(boardId)
      .then(setConnections)
      .catch((e) => setError(e?.response?.data?.error || t('leadApi.loadError', 'Could not load API keys.')))
      .finally(() => setLoading(false));
  }, [boardId, t]);

  useEffect(() => { if (boardId) reload(); }, [boardId, reload]);

  const create = async () => {
    setBusyId('new');
    setError(null);
    try {
      const { connection, apiKey } = await leadService.createConnection(boardId, {});
      setConnections((list) => [connection, ...list]);
      setDocs({ connection, apiKey }); // open docs with the key revealed once
    } catch (e) {
      setError(e?.response?.data?.error || t('leadApi.createError', 'Could not create the API key.'));
    } finally {
      setBusyId(null);
    }
  };

  const toggle = async (conn, enabled) => {
    setBusyId(conn._id);
    setError(null);
    try {
      const updated = await leadService.updateConnection(conn._id, { enabled });
      setConnections((list) => list.map((c) => (c._id === updated._id ? updated : c)));
    } catch (e) {
      setError(e?.response?.data?.error || t('leadApi.updateError', 'Could not update the API key settings.'));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (conn) => {
    if (!window.confirm(t('leadApi.deleteConfirm', 'Delete this API key? Any form still using it will stop creating leads.'))) return;
    setBusyId(conn._id);
    setError(null);
    try {
      await leadService.deleteConnection(conn._id);
      setConnections((list) => list.filter((c) => c._id !== conn._id));
    } catch (e) {
      setError(e?.response?.data?.error || t('leadApi.deleteError', 'Could not delete the API key.'));
    } finally {
      setBusyId(null);
    }
  };

  // Passed into the modal: rotate returns the new plaintext key; the list is
  // updated so the masked last-4 + stats stay in sync.
  const handleRotate = async (conn) => {
    const { connection, apiKey } = await leadService.rotateKey(conn._id);
    setConnections((list) => list.map((c) => (c._id === connection._id ? connection : c)));
    setDocs((d) => (d ? { ...d, connection } : d));
    return apiKey;
  };

  const handleReset = async (conn) => {
    const connection = await leadService.resetSchema(conn._id);
    setConnections((list) => list.map((c) => (c._id === connection._id ? connection : c)));
    setDocs((d) => (d ? { ...d, connection } : d));
  };

  // Generic PATCH passthrough for the docs modal (e.g. the evolve-schema toggle).
  const handleUpdate = async (conn, payload) => {
    const connection = await leadService.updateConnection(conn._id, payload);
    setConnections((list) => list.map((c) => (c._id === connection._id ? connection : c)));
    setDocs((d) => (d ? { ...d, connection } : d));
    return connection;
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-display font-semibold inline-flex items-center gap-2" style={{ fontSize: 15, color: 'var(--color-text-primary)' }}>
          <KeyRound size={16} /> {t('leadApi.sectionTitle', 'Connect your website form (API)')}
        </h3>
        <Button variant="secondary" size="sm" icon={Plus} onClick={create} disabled={busyId === 'new'}>
          {t('leadApi.newKey', 'New API key')}
        </Button>
      </div>
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
        {t('leadApi.sectionDesc', 'Already have a form on your site? Create a key and POST submissions to the endpoint — the first submission defines the columns and every lead lands on this board.')}
      </p>

      {error && <p style={{ fontSize: 12, color: 'var(--color-status-stuck)' }}>{error}</p>}

      {loading && connections.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{t('leadApi.loading', 'Loading…')}</p>
      ) : connections.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{t('leadApi.noKeys', 'No API keys yet.')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {connections.map((conn) => (
            <li key={conn._id} style={{ ...cardStyle, opacity: conn.enabled ? 1 : 0.7 }}>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-body" style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text-primary)' }}>{conn.name}</span>
                <code style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>lk_••••{conn.tokenLast4}</code>
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)', flex: 1, minWidth: 120 }}>
                  {conn.schemaLocked
                    ? t('leadApi.leadCount', '{{count}} leads · {{n}} fields', { count: conn.submissionCount || 0, n: (conn.fields || []).length })
                    : t('leadApi.awaitingFirst', 'Awaiting first submission')}
                </span>
                <Button variant="ghost" size="sm" icon={BookOpen} onClick={() => setDocs({ connection: conn, apiKey: null })}>
                  {t('leadApi.setupDocs', 'Setup & docs')}
                </Button>
                <Toggle checked={conn.enabled} disabled={busyId === conn._id} onChange={(v) => toggle(conn, v)} />
                <IconBtn label={t('leadApi.delete', 'Delete')} icon={Trash2} danger onClick={() => remove(conn)} disabled={busyId === conn._id} />
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        isOpen={!!docs}
        onClose={() => setDocs(null)}
        title={docs?.connection?.name || t('leadApi.sectionTitle', 'Connect your website form (API)')}
        maxWidth={720}
      >
        {docs && (
          <LeadApiDocsModal
            connection={docs.connection}
            apiKey={docs.apiKey}
            onClose={() => setDocs(null)}
            onRotate={() => handleRotate(docs.connection)}
            onReset={() => handleReset(docs.connection)}
            onUpdate={(payload) => handleUpdate(docs.connection, payload)}
          />
        )}
      </Modal>
    </section>
  );
};

export default ApiConnectSection;
