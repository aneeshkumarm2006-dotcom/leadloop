import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, Plus, Trash2, Download, Ban } from 'lucide-react';
import PageWrapper from '../components/layout/PageWrapper';
import { PageHeader, PageBody } from '../components/layout/PageHeader';
import Button from '../components/ui/Button';
import Dropdown from '../components/ui/Dropdown';
import EmptyState from '../components/onboarding/EmptyState';
import useOrgStore from '../store/orgStore';
import * as complianceService from '../services/complianceService';
import { formatShortDate } from '../utils/dateUtils';

/**
 * CompliancePage — the do-not-contact list and the consent audit export.
 *
 * LeadLoop messages people in the US (TCPA) and Canada (CASL). This page is
 * where a workspace proves it is doing so lawfully: who must never be contacted,
 * why, and a downloadable record of every consent held.
 */

const card = {
  background: 'var(--color-bg-surface)',
  borderRadius: 16,
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

  const exportButton = (
    <Button variant="secondary" onClick={exportCsv} icon={Download}>
      {t('compliance.export', 'Export audit trail')}
    </Button>
  );

  return (
    <PageWrapper flush>
      <PageHeader
        title={t('compliance.title', 'Consent & do-not-contact')}
        subtitle={t('compliance.subtitle', 'Anyone on this list is never messaged again — on any channel, by any automation. Replies of STOP and email unsubscribes are added here automatically.')}
        actions={exportButton}
      />
      <PageBody>
        <div className="grid gap-5 items-start lg:grid-cols-[minmax(0,1fr)_minmax(260px,320px)]">
          <div className="flex flex-col gap-4 min-w-0">
            {/* Add — one row on wide screens, stacks on narrow ones */}
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                add();
              }}
              aria-label={t('compliance.addLabel', 'Add to the do-not-contact list')}
              style={{ ...card, padding: '16px 18px' }}
            >
              <div className="grid gap-3 items-end grid-cols-1 sm:grid-cols-2 xl:grid-cols-[170px_minmax(0,1fr)_200px_auto]">
                <Dropdown
                  label={t('compliance.kind', 'Type')}
                  options={[
                    { value: 'email', label: t('compliance.email', 'Email address') },
                    { value: 'phone', label: t('compliance.phone', 'Phone number') },
                  ]}
                  value={kind}
                  onChange={setKind}
                />
                <div className="min-w-0">
                  <label
                    htmlFor="dnc-value"
                    className="block mb-2 font-body font-medium text-[color:var(--color-text-secondary)] text-xs uppercase tracking-wide"
                  >
                    {kind === 'email' ? t('compliance.email', 'Email address') : t('compliance.phone', 'Phone number')}
                  </label>
                  <input
                    id="dnc-value"
                    type={kind === 'email' ? 'email' : 'tel'}
                    autoComplete="off"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={kind === 'email' ? 'name@example.com' : '+1 514 555 0142'}
                    className="font-body"
                    style={{
                      width: '100%',
                      height: 38,
                      fontSize: 14,
                      padding: '0 11px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--color-border-strong)',
                      background: 'var(--color-bg-input)',
                      color: 'var(--color-text-primary)',
                    }}
                  />
                </div>
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
                <Button type="submit" variant="primary" icon={Plus} disabled={busy || !value.trim()}>
                  {t('compliance.add', 'Add')}
                </Button>
              </div>
              {error && (
                <p role="alert" className="font-body" style={{ fontSize: 12.5, color: 'var(--color-status-stuck)', margin: '10px 0 0' }}>
                  {error}
                </p>
              )}
            </form>

            {/* List */}
            {rows === null ? (
              <div className="skeleton" aria-busy="true" style={{ height: 200, borderRadius: 16 }} />
            ) : rows.length === 0 ? (
              <EmptyState
                icon={Ban}
                title={t('compliance.emptyTitle', 'Nobody is blocked yet')}
                body={t('compliance.emptyBody', 'When someone replies STOP or unsubscribes, they appear here automatically and are never contacted again.')}
              />
            ) : (
              <section aria-labelledby="dnc-title" style={{ ...card, overflow: 'hidden' }}>
                <div className="flex items-center gap-3" style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border)' }}>
                  <h2 id="dnc-title" className="font-display" style={{ margin: 0, flex: 1, fontSize: 18, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                    {t('compliance.listTitle', 'Do-not-contact list')}
                  </h2>
                  <span className="font-body" style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>
                    {t('compliance.entries', '{{count}} entries', { count: rows.length })}
                  </span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="font-body" style={{ width: '100%', minWidth: 600, borderCollapse: 'collapse', fontSize: 13.5 }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: 'var(--color-text-secondary)', fontSize: 12 }}>
                        <th scope="col" style={{ padding: '10px 20px', fontWeight: 700 }}>{t('compliance.contact', 'Contact')}</th>
                        <th scope="col" style={{ padding: '10px 12px', fontWeight: 700 }}>{t('compliance.kind', 'Type')}</th>
                        <th scope="col" style={{ padding: '10px 12px', fontWeight: 700 }}>{t('compliance.reason', 'Reason')}</th>
                        <th scope="col" style={{ padding: '10px 12px', fontWeight: 700 }}>{t('compliance.added', 'Added')}</th>
                        <th scope="col" style={{ padding: '10px 20px' }}>
                          <span className="sr-only">{t('compliance.actions', 'Actions')}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r._id} style={{ borderTop: '1px solid var(--color-bg-subtle)' }}>
                          <td style={{ padding: '13px 20px', fontWeight: 600, color: 'var(--color-text-primary)', wordBreak: 'break-word' }}>
                            {r.display}
                          </td>
                          <td style={{ padding: '13px 12px' }}>
                            <span
                              style={{
                                fontSize: 12,
                                fontWeight: 700,
                                color: 'var(--color-text-secondary)',
                                background: 'var(--color-bg-subtle)',
                                padding: '3px 9px',
                                borderRadius: 'var(--radius-full)',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {r.kind === 'email' ? t('compliance.email', 'Email address') : t('compliance.phone', 'Phone number')}
                            </span>
                          </td>
                          <td style={{ padding: '13px 12px', color: REASON_COLORS[r.reason] || 'var(--color-text-secondary)' }}>
                            {t(`compliance.reasons.${r.reason}`, r.reason)}
                            {r.note ? (
                              <span style={{ color: 'var(--color-text-secondary)' }}>{` · ${r.note}`}</span>
                            ) : null}
                          </td>
                          <td style={{ padding: '13px 12px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                            {r.createdAt ? formatShortDate(r.createdAt) : '—'}
                          </td>
                          <td style={{ padding: '13px 20px', textAlign: 'right' }}>
                            <button
                              type="button"
                              onClick={() => remove(r._id)}
                              aria-label={t('compliance.removeNamed', 'Remove {{value}}', { value: r.display })}
                              className="inline-flex items-center justify-center transition-colors hover:bg-[color:var(--color-status-stuck-bg)] hover:text-[color:var(--color-status-stuck)]"
                              style={{
                                width: 32,
                                height: 32,
                                borderRadius: 8,
                                border: '1px solid var(--color-border)',
                                background: 'var(--color-bg-surface)',
                                color: 'var(--color-text-secondary)',
                                cursor: 'pointer',
                              }}
                            >
                              <Trash2 size={15} aria-hidden="true" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>

          <aside className="flex flex-col gap-4">
            <section
              className="font-body"
              style={{ background: 'var(--color-pine)', color: 'var(--color-pine-text)', borderRadius: 16, padding: 20, fontSize: 13.5, lineHeight: 1.55 }}
            >
              <h2 className="flex items-center gap-2 font-display" style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
                <ShieldCheck size={17} aria-hidden="true" style={{ color: 'var(--color-pine-gold)' }} />
                {t('compliance.enforcedTitle', 'Enforced on every send')}
              </h2>
              <p style={{ margin: '6px 0 0', color: 'var(--color-pine-text-2)' }}>
                {t('compliance.enforcedBody', 'Email, SMS, WhatsApp, sequences and automations all check this list first. Nothing gets through.')}
              </p>
            </section>
            <p className="font-body" style={{ margin: 0, fontSize: 12.5, color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>
              {t('compliance.disclaimer', 'LeadLoop enforces these rules on every send, but this is not legal advice — confirm your consent wording and retention with counsel for your market.')}
            </p>
          </aside>
        </div>
      </PageBody>
    </PageWrapper>
  );
};

export default CompliancePage;
