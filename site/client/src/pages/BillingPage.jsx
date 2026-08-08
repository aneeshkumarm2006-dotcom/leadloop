import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { CreditCard, Check, Users, AlertTriangle, ExternalLink, Sparkles } from 'lucide-react';
import PageWrapper from '../components/layout/PageWrapper';
import Button from '../components/ui/Button';
import useOrgStore from '../store/orgStore';
import { getBilling, createCheckout, createPortal } from '../services/billingService';

/**
 * BillingPage — plan selection, seat usage, and the link into Stripe's hosted
 * portal (payment method, invoices, cancellation).
 *
 * The page never grants a plan itself: "Upgrade" redirects to Stripe Checkout
 * and entitlements only change once Stripe's webhook reaches our server. On
 * return from checkout we simply re-fetch — which may briefly still show the
 * old plan while the webhook lands, so we say so rather than faking success.
 */

const FEATURE_ORDER = [
  'core',
  'booking',
  'automations',
  'lead_connectors',
  'production_reports',
  'api_access',
  'priority_support',
];

const card = {
  background: 'var(--color-bg-surface, #fff)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-card)',
  padding: 20,
};

const BillingPage = () => {
  const { t } = useTranslation();
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const orgId = currentOrg?._id || null;
  const [params, setParams] = useSearchParams();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const checkoutResult = params.get('checkout');

  const load = useCallback(() => {
    if (!orgId) return;
    setLoading(true);
    getBilling(orgId)
      .then(setData)
      .catch((e) => setError(e?.response?.data?.error || t('billing.loadError', 'Could not load billing.')))
      .finally(() => setLoading(false));
  }, [orgId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const upgrade = async (planId) => {
    setBusy(planId);
    setError('');
    try {
      const url = await createCheckout(orgId, planId);
      if (url) window.location.href = url;
    } catch (e) {
      setError(e?.response?.data?.error || t('billing.checkoutError', 'Could not start checkout.'));
      setBusy('');
    }
  };

  const manage = async () => {
    setBusy('portal');
    setError('');
    try {
      const url = await createPortal(orgId);
      if (url) window.location.href = url;
    } catch (e) {
      setError(e?.response?.data?.error || t('billing.portalError', 'Could not open the billing portal.'));
      setBusy('');
    }
  };

  const sub = data?.subscription;
  const seats = data?.seats;
  const plans = (data?.plans || []).filter((p) => p.id !== 'free' || sub?.planId === 'free');

  return (
    <PageWrapper>
      <div style={{ maxWidth: 1040, margin: '0 auto', padding: '4px 2px 40px' }}>
        <div className="flex items-center gap-3" style={{ marginBottom: 6 }}>
          <span
            className="inline-flex items-center justify-center"
            style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--color-accent-subtle, rgba(62,107,78,.14))', color: 'var(--color-accent)' }}
          >
            <CreditCard size={18} />
          </span>
          <h1 className="font-heading" style={{ fontSize: 24, fontWeight: 800, color: 'var(--color-text-primary)' }}>
            {t('billing.title', 'Plans & billing')}
          </h1>
        </div>
        <p className="font-body" style={{ fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 22, maxWidth: 620 }}>
          {t('billing.subtitle', 'Per-agent pricing. Upgrade, downgrade or cancel any time — no contract.')}
        </p>

        {checkoutResult === 'success' && (
          <div
            className="flex items-start gap-2"
            style={{ ...card, padding: '12px 14px', marginBottom: 16, borderColor: 'var(--color-status-done)' }}
          >
            <Check size={16} style={{ color: 'var(--color-status-done)', marginTop: 2, flexShrink: 0 }} />
            <div>
              <div className="font-heading" style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                {t('billing.successTitle', 'Payment received — thank you!')}
              </div>
              <p className="font-body" style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: 2 }}>
                {t('billing.successBody', 'Your plan activates as soon as Stripe confirms it — usually a few seconds. Refresh if it still shows the old plan.')}
              </p>
              <button
                type="button"
                onClick={() => {
                  params.delete('checkout');
                  setParams(params, { replace: true });
                  load();
                }}
                className="font-body"
                style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-accent)', background: 'none', border: 'none', padding: 0, marginTop: 6, cursor: 'pointer' }}
              >
                {t('billing.refresh', 'Refresh now')}
              </button>
            </div>
          </div>
        )}

        {error && (
          <p className="font-body" style={{ fontSize: 13, color: 'var(--color-status-stuck)', marginBottom: 14 }}>
            {error}
          </p>
        )}

        {data && !data.configured && (
          <div className="flex items-start gap-2" style={{ ...card, padding: '12px 14px', marginBottom: 18 }}>
            <AlertTriangle size={16} style={{ color: 'var(--color-status-working)', marginTop: 2, flexShrink: 0 }} />
            <p className="font-body" style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>
              {t('billing.notConfigured', 'Billing is not connected yet. Add your Stripe keys on the server to enable checkout.')}
            </p>
          </div>
        )}

        {/* Current plan + seats */}
        {!loading && sub && (
          <div style={{ ...card, marginBottom: 22 }}>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <div className="font-body" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>
                  {t('billing.currentPlan', 'Current plan')}
                </div>
                <div className="font-heading" style={{ fontSize: 22, fontWeight: 800, color: 'var(--color-text-primary)', marginTop: 4 }}>
                  {sub.planName}
                  {sub.status === 'trialing' && (
                    <span
                      className="font-body"
                      style={{ fontSize: 11.5, fontWeight: 700, marginLeft: 10, padding: '3px 8px', borderRadius: 20, background: 'var(--color-accent-subtle, rgba(62,107,78,.14))', color: 'var(--color-accent)', verticalAlign: 'middle' }}
                    >
                      {t('billing.trial', 'Trial')}
                    </span>
                  )}
                  {sub.status === 'past_due' && (
                    <span
                      className="font-body"
                      style={{ fontSize: 11.5, fontWeight: 700, marginLeft: 10, padding: '3px 8px', borderRadius: 20, background: 'rgba(200,80,60,.12)', color: 'var(--color-status-stuck)', verticalAlign: 'middle' }}
                    >
                      {t('billing.pastDue', 'Payment failed')}
                    </span>
                  )}
                </div>
                {sub.currentPeriodEnd && (
                  <div className="font-body" style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: 4 }}>
                    {sub.cancelAtPeriodEnd
                      ? t('billing.endsOn', 'Ends on {{date}}', { date: new Date(sub.currentPeriodEnd).toLocaleDateString() })
                      : t('billing.renewsOn', 'Renews on {{date}}', { date: new Date(sub.currentPeriodEnd).toLocaleDateString() })}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-4 flex-wrap">
                <div>
                  <div className="font-body inline-flex items-center gap-1.5" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>
                    <Users size={13} /> {t('billing.seats', 'Seats')}
                  </div>
                  <div className="font-heading" style={{ fontSize: 20, fontWeight: 800, color: seats?.withinLimit ? 'var(--color-text-primary)' : 'var(--color-status-stuck)', marginTop: 4 }}>
                    {seats?.used}
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-muted)' }}>
                      {' / '}
                      {seats?.limit == null ? t('billing.unlimited', 'Unlimited') : seats.limit}
                    </span>
                  </div>
                </div>
                {sub.hasBillingProfile && (
                  <Button variant="secondary" onClick={manage} disabled={busy === 'portal'}>
                    <span className="inline-flex items-center gap-1.5">
                      {t('billing.manage', 'Manage billing')} <ExternalLink size={14} />
                    </span>
                  </Button>
                )}
              </div>
            </div>

            {seats && !seats.withinLimit && (
              <div className="flex items-start gap-2" style={{ marginTop: 14, padding: '10px 12px', borderRadius: 'var(--radius-md)', background: 'rgba(200,80,60,.08)' }}>
                <AlertTriangle size={15} style={{ color: 'var(--color-status-stuck)', marginTop: 1, flexShrink: 0 }} />
                <p className="font-body" style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>
                  {t('billing.overSeats', 'You have {{over}} member(s) over your plan limit. Upgrade to keep everyone active.', { over: seats.over })}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Plan cards */}
        {loading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
            {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 300, borderRadius: 12 }} />)}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 14 }}>
            {plans.map((p) => {
              const isCurrent = sub?.planId === p.id;
              return (
                <div
                  key={p.id}
                  style={{
                    ...card,
                    position: 'relative',
                    display: 'flex',
                    flexDirection: 'column',
                    borderColor: p.recommended ? 'var(--color-accent)' : 'var(--color-border)',
                    borderWidth: p.recommended ? 2 : 1,
                  }}
                >
                  {p.recommended && (
                    <span
                      className="font-body inline-flex items-center gap-1"
                      style={{
                        position: 'absolute',
                        top: -11,
                        left: 18,
                        fontSize: 10.5,
                        fontWeight: 800,
                        letterSpacing: '0.05em',
                        textTransform: 'uppercase',
                        padding: '4px 9px',
                        borderRadius: 20,
                        background: 'var(--color-accent)',
                        color: '#fff',
                      }}
                    >
                      <Sparkles size={11} /> {t('billing.popular', 'Most popular')}
                    </span>
                  )}
                  <div className="font-heading" style={{ fontSize: 17, fontWeight: 800, color: 'var(--color-text-primary)' }}>
                    {p.name}
                  </div>
                  <div style={{ margin: '10px 0 4px' }}>
                    <span className="font-heading" style={{ fontSize: 32, fontWeight: 800, color: 'var(--color-text-primary)' }}>
                      ${p.amount}
                    </span>
                    <span className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                      {t('billing.perSeat', '/agent/mo')}
                    </span>
                  </div>
                  <div className="font-body" style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginBottom: 14 }}>
                    {p.seats == null
                      ? t('billing.unlimitedSeats', 'Unlimited agents')
                      : t('billing.upToSeats', 'Up to {{n}} agents', { n: p.seats })}
                  </div>

                  <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 18px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {FEATURE_ORDER.filter((f) => p.features.includes(f)).map((f) => (
                      <li key={f} className="font-body flex items-start gap-2" style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>
                        <Check size={14} style={{ color: 'var(--color-accent)', marginTop: 2, flexShrink: 0 }} />
                        {t(`billing.features.${f}`, f)}
                      </li>
                    ))}
                  </ul>

                  <div style={{ marginTop: 'auto' }}>
                    {isCurrent ? (
                      <Button variant="secondary" disabled style={{ width: '100%' }}>
                        {t('billing.currentPlanBtn', 'Current plan')}
                      </Button>
                    ) : !p.purchasable ? (
                      <Button variant="secondary" disabled style={{ width: '100%' }}>
                        {t('billing.contactUs', 'Contact us')}
                      </Button>
                    ) : (
                      <Button
                        variant={p.recommended ? 'primary' : 'secondary'}
                        onClick={() => upgrade(p.id)}
                        disabled={!!busy || !data?.configured}
                        style={{ width: '100%' }}
                      >
                        {busy === p.id ? t('billing.redirecting', 'Redirecting…') : t('billing.choose', 'Choose {{plan}}', { plan: p.name })}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {data?.trialDays > 0 && (
          <p className="font-body" style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 16, textAlign: 'center' }}>
            {t('billing.trialNote', '{{days}}-day free trial on your first subscription. Cancel any time.', { days: data.trialDays })}
          </p>
        )}
      </div>
    </PageWrapper>
  );
};

export default BillingPage;
