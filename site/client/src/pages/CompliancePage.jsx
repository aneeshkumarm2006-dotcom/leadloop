import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, Plus, Trash2, Download, Ban } from 'lucide-react';
import PageWrapper from '../components/layout/PageWrapper';
import Button from '../components/ui/Button';
import Dropdown from '../components/ui/Dropdown';
import EmptyState from '../components/onboarding/EmptyState';
import useOrgStore from '../store/orgStore';
import * as complianceService from '../services/complianceService';

/**
 * CompliancePage — the do-not-contact list and the consent audit export.
 *
 * LeadLoop messages people in the US (TCPA) and Canada (CASL). This page is
 * where a workspace proves it is doing so lawfully: who must never be contacted,
 * why, and a downloadable record of every consent held.
 */

const card = {
  background: 'var(--color-bg-surface, #fff)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-card)',
};

const REASON_COLORS = {
  stop: 'var(--color-status-stuck)',
  unsubscribe: 'var(--color-status-working)',
  dnc: 'var(--color-status-stuck)',
  bounce: 'var(--color-text-muted)',
  manual: 'var(--color-text-secondary)',
};

const CompliancePage = () => {
  const { t } = useTranslation();
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const orgId = currentOrg?._id || null;

  const [rows, setRows] = useState(null);
  const [kind, setKind] = useState('email');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('manual');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!orgId) return;
    complianceService
      .listSuppressions(orgId)
      .then(setRows)
      .catch(() => setRows([]));
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  const add = async () => {
    if (!value.trim()) return;
    setBusy(true);
    setError('');
    try {
      await complianceService.addSuppression(orgId, { kind, value: value.trim(), reason });
      setValue('');
      load();
    } catch (e) {
      setError(e?.response?.data?.error || t('compliance.addError', 'Could not add that.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    try {
      await complianceService.removeSuppression(id);
      setRows((r) => (r || []).filter((x) => x._id !== id));
    } catch {
      /* leave the row in place */
    }
  };

  const exportCsv = async () => {
    try {
      const blob = await complianceService.exportAudit(orgId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'consent-audit.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError(t('compliance.exportError', 'Could not export right now.'));
    }
  };

  return (
    <PageWrapper>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '4px 2px 40px' }}>
        <div className="flex items-center gap-3" style={{ marginBottom: 6 }}>
          <span
            className="inline-flex items-center justify-center"
            style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--color-accent-light, #EEF3EA)', color: 'var(--color-accent)' }}
          >
            <ShieldCheck size={18} />
          </span>
          <h1 className="font-heading" style={{ fontSize: 24, fontWeight: 800, color: 'var(--color-text-primary)' }}>
            {t('compliance.title', 'Consent & do-not-contact')}
          </h1>
        </div>
        <p className="font-body" style={{ fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 22, maxWidth: 640 }}>
          {t('compliance.subtitle', 'Anyone on this list is never messaged again — on any channel, by any automation. Replies of STOP and email unsubscribes are added here automatically.')}
        </p>

        {/* Add */}
        <div style={{ ...card, padding: 16, marginBottom: 18 }}>
          <div className="flex items-end gap-3 flex-wrap">
            <div style={{ width: 150 }}>
              <Dropdown
                label={t('compliance.kind', 'Type')}
                options={[
                  { value: 'email', label: t('compliance.email', 'Email address') },
                  { value: 'phone', label: t('compliance.phone', 'Phone number') },
                ]}
                value={kind}
                onChange={setKind}
              />
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label className="font-body" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 6 }}>
                {kind === 'email' ? t('compliance.email', 'Email address') : t('compliance.phone', 'Phone number')}
              </label>
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && add()}
                placeholder={kind === 'email' ? 'name@example.com' : '+1 514 555 0142'}
                className="font-body"
                style={{
                  width: '100%',
                  fontSize: 14,
                  padding: '9px 11px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg-input, #FCFAF4)',
                  color: 'var(--color-text-primary)',
                }}
              />
            </div>
            <div style={{ width: 160 }}>
              <Dropdown
                label={t('compliance.reason', 'Reason')}
                options={[
                  { value: 'manual', label: t('compliance.reasons.manual', 'Added by us') },
                  { value: 'dnc', label: t('compliance.reasons.dnc', 'Do-not-call list') },
                  { value: 'unsubscribe', label: t('compliance.reasons.unsubscribe', 'Unsubscribed') },
                  { value: 'stop', label: t('compliance.reasons.stop', 'Replied STOP') },
                  { value: 'bounce', label: t('compliance.reasons.bounce', 'Bounced') },
                ]}
                value={reason}
                onChange={setReason}
              />
            </div>
            <Button variant="primary" onClick={add} disabled={busy || !value.trim()}>
              <span className="inline-flex items-center gap-1.5">
                <Plus size={15} /> {t('compliance.add', 'Add')}
              </span>
            </Button>
          </div>
          {error && (
            <p className="font-body" style={{ fontSize: 12.5, color: 'var(--color-status-stuck)', marginTop: 10 }}>
              {error}
            </p>
          )}
        </div>

        {/* List */}
        <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
          <h2 className="font-heading" style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>
            {t('compliance.listTitle', 'Do-not-contact list')}
          </h2>
          <Button variant="secondary" onClick={exportCsv}>
            <span className="inline-flex items-center gap-1.5">
              <Download size={14} /> {t('compliance.export', 'Export audit trail')}
            </span>
          </Button>
        </div>

        {rows === null ? (
          <div className="skeleton" style={{ height: 160, borderRadius: 12 }} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Ban}
            title={t('compliance.emptyTitle', 'Nobody is blocked yet')}
            body={t('compliance.emptyBody', 'When someone replies STOP or unsubscribes, they appear here automatically and are never contacted again.')}
          />
        ) : (
          <div style={{ ...card, overflow: 'hidden' }}>
            {rows.map((r) => (
              <div
                key={r._id}
                className="flex items-center justify-between gap-3 flex-wrap"
                style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)' }}
              >
                <div style={{ minWidth: 0 }}>
                  <div className="font-body" style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                    {r.display}
                  </div>
                  <div className="font-body" style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                    {t(`compliance.reasons.${r.reason}`, r.reason)}
                    {r.note ? ` · ${r.note}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className="font-body"
                    style={{
                      fontSize: 11.5,
                      fontWeight: 700,
                      padding: '3px 9px',
                      borderRadius: 20,
                      background: 'var(--color-bg-subtle)',
                      color: REASON_COLORS[r.reason] || 'var(--color-text-secondary)',
                    }}
                  >
                    {r.kind === 'email' ? t('compliance.email', 'Email address') : t('compliance.phone', 'Phone number')}
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(r._id)}
                    aria-label={t('compliance.remove', 'Remove')}
                    style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: 4 }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="font-body" style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 16, lineHeight: 1.5 }}>
          {t('compliance.disclaimer', 'LeadLoop enforces these rules on every send, but this is not legal advice — confirm your consent wording and retention with counsel for your market.')}
        </p>
      </div>
    </PageWrapper>
  );
};

export default CompliancePage;
