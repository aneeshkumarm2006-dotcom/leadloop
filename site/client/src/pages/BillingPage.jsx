import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Check, Minus, Users, AlertTriangle, ExternalLink, Sparkles } from 'lucide-react';
import PageWrapper from '../components/layout/PageWrapper';
import { PageHeader, PageBody } from '../components/layout/PageHeader';
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
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-card)',
  padding: 20,
};

const notice = { ...card, padding: '12px 16px' };

const pillStyle = {
  fontSize: 12,
  fontWeight: 700,
  padding: '3px 9px',
  borderRadius: 999,
  whiteSpace: 'nowrap',
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

  const seatPct =
    seats && seats.limit != null && seats.limit > 0 ? Math.min(100, Math.round(((seats.used || 0) / seats.limit) * 100)) : null;

  return (
    <PageWrapper flush>
      <PageHeader
        title={t('billing.title', 'Plans & billing')}
        subtitle={t('billing.subtitle', 'Per-agent pricing. Upgrade, downgrade or cancel any time — no contract.')}
      />
      <PageBody className="flex flex-col gap-5">
        {checkoutResult === 'success' && (
          <div
            role="status"
            className="flex items-start gap-2"
            style={{ ...notice, boxShadow: '0 1px 3px rgba(33,30,24,.06), 0 0 0 1px var(--color-status-done)' }}
          >
            <Check size={16} aria-hidden="true" style={{ color: 'var(--color-status-done)', marginTop: 2, flexShrink: 0 }} />
            <div>
              <div className="font-display" style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                {t('billing.successTitle', 'Payment received — thank you!')}
              </div>
              <p className="font-body" style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 2 }}>
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
                style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-accent)', background: 'none', border: 'none', padding: 0, marginTop: 6, cursor: 'pointer' }}
              >
                {t('billing.refresh', 'Refresh now')}
              </button>
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="font-body" style={{ margin: 0, fontSize: 13.5, color: 'var(--color-status-stuck)' }}>
            {error}
          </p>
        )}

        {data && !data.configured && (
          <div className="flex items-start gap-2" style={notice}>
            <AlertTriangle size={16} aria-hidden="true" style={{ color: 'var(--color-status-working)', marginTop: 2, flexShrink: 0 }} />
            <p className="font-body" style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
              {t('billing.notConfigured', 'Billing is not connected yet. Add your Stripe keys on the server to enable checkout.')}
            </p>
          </div>
        )}

        {/* Current plan + seats — dark pine banner */}
        {!loading && sub && (
          <section
            aria-label={t('billing.currentPlan', 'Current plan')}
            style={{ background: 'var(--color-pine)', color: 'var(--color-pine-text)', borderRadius: 18, padding: '22px 26px' }}
          >
            <div className="flex items-center flex-wrap" style={{ gap: 28 }}>
              <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                <div className="font-mono" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--color-pine-text-2)' }}>
                  {t('billing.currentPlan', 'Current plan')}
                </div>
                <div className="flex items-center flex-wrap" style={{ gap: 10, marginTop: 6 }}>
                  <span className="font-display" style={{ fontSize: 26, fontWeight: 750, lineHeight: 1.15 }}>
                    {sub.planName}
                  </span>
                  {sub.status === 'trialing' && (
                    <span className="font-body" style={{ ...pillStyle, background: 'var(--color-pine-gold)', color: 'var(--color-pine)' }}>
                      {t('billing.trial', 'Trial')}
                    </span>
                  )}
                  {sub.status === 'past_due' && (
                    <span className="font-body" style={{ ...pillStyle, background: 'var(--color-status-stuck-bg)', color: 'var(--color-status-stuck)' }}>
                      {t('billing.pastDue', 'Payment failed')}
                    </span>
                  )}
                </div>
                {sub.currentPeriodEnd && (
                  <div className="font-body" style={{ fontSize: 13, color: '#C9D4C7', marginTop: 4 }}>
                    {sub.cancelAtPeriodEnd
                      ? t('billing.endsOn', 'Ends on {{date}}', { date: new Date(sub.currentPeriodEnd).toLocaleDateString() })
                      : t('billing.renewsOn', 'Renews on {{date}}', { date: new Date(sub.currentPeriodEnd).toLocaleDateString() })}
                  </div>
                )}
              </div>

              <div style={{ flex: '0 1 240px', minWidth: 160 }}>
                <div className="font-body inline-flex items-center gap-1.5" style={{ fontSize: 13, color: 'var(--color-pine-text-2)' }}>
                  <Users size={13} aria-hidden="true" /> {t('billing.seats', 'Seats')}
                </div>
                <div
                  className="font-display"
                  style={{ fontSize: 22, fontWeight: 700, color: seats?.withinLimit === false ? '#F2A598' : 'var(--color-pine-text)' }}
                >
                  {seats?.used ?? '—'}
                  <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-pine-text-2)' }}>
                    {' / '}
                    {seats?.limit == null ? t('billing.unlimited', 'Unlimited') : seats.limit}
                  </span>
                </div>
                {seatPct != null && (
                  <div aria-hidden="true" style={{ height: 6, borderRadius: 6, background: 'rgba(237,232,218,.18)', marginTop: 6 }}>
                    <div
                      style={{
                        width: `${seatPct}%`,
                        height: 6,
                        borderRadius: 6,
                        background: seats?.withinLimit === false ? 'var(--color-status-stuck-solid)' : 'var(--color-pine-gold)',
                      }}
                    />
                  </div>
                )}
              </div>

              {sub.hasBillingProfile && (
                <button
                  type="button"
                  onClick={manage}
                  disabled={busy === 'portal'}
                  className="font-body inline-flex items-center gap-1.5 transition-colors hover:bg-[color:var(--color-pine-raise)] disabled:opacity-60 disabled:cursor-not-allowed"
                  style={{
                    height: 42,
                    padding: '0 16px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid rgba(237,232,218,.3)',
                    background: 'transparent',
                    color: 'var(--color-pine-text)',
                    fontWeight: 700,
                    fontSize: 14,
                    cursor: 'pointer',
                  }}
                >
                  {t('billing.manage', 'Manage billing')} <ExternalLink size={14} aria-hidden="true" />
                </button>
              )}
            </div>

            {seats && !seats.withinLimit && (
              <div
                role="alert"
                className="flex items-start gap-2"
                style={{ marginTop: 16, padding: '10px 12px', borderRadius: 'var(--radius-md)', background: 'rgba(201,70,60,.22)' }}
              >
                <AlertTriangle size={15} aria-hidden="true" style={{ color: '#F2A598', marginTop: 1, flexShrink: 0 }} />
                <p className="font-body" style={{ fontSize: 13, color: 'var(--color-pine-text)' }}>
                  {t('billing.overSeats', 'You have {{over}} member(s) over your plan limit. Upgrade to keep everyone active.', { over: seats.over })}
                </p>
              </div>
            )}
          </section>
        )}

        {/* Plan cards — across the full width, stack on narrow screens */}
        {loading ? (
          <div aria-busy="true" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: 18 }}>
            {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 380, borderRadius: 18 }} />)}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: 18, alignItems: 'stretch' }}>
            {plans.map((p) => {
              const isCurrent = sub?.planId === p.id;
              const features = Array.isArray(p.features) ? p.features : [];
              return (
                <article
                  key={p.id}
                  aria-labelledby={`plan-${p.id}`}
                  style={{
                    background: 'var(--color-bg-surface, #fff)',
                    borderRadius: 18,
                    padding: 26,
                    position: 'relative',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 14,
                    boxShadow: p.recommended
                      ? '0 12px 32px -12px rgba(var(--color-accent-rgb), .35), 0 0 0 2px var(--color-accent)'
                      : 'var(--shadow-card)',
                  }}
                >
                  {p.recommended && (
                    <span
                      className="font-body inline-flex items-center gap-1"
                      style={{ ...pillStyle, position: 'absolute', top: 18, right: 18, fontSize: 11.5, padding: '4px 10px', background: 'var(--color-accent)', color: '#fff' }}
                    >
                      <Sparkles size={11} aria-hidden="true" /> {t('billing.popular', 'Most popular')}
                    </span>
                  )}
                  <h2
                    id={`plan-${p.id}`}
                    className="font-display"
                    style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--color-text-primary)', paddingRight: p.recommended ? 120 : 0 }}
                  >
                    {p.name}
                  </h2>
                  <div>
                    <span className="font-display" style={{ fontSize: 40, fontWeight: 800, color: 'var(--color-text-primary)', lineHeight: 1 }}>
                      ${p.amount}
                    </span>
                    <span className="font-body" style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>
                      {' '}{t('billing.perSeat', '/agent/mo')}
                    </span>
                  </div>
                  <div className="font-body" style={{ fontSize: 13.5, color: 'var(--color-text-secondary)' }}>
                    {p.seats == null
                      ? t('billing.unlimitedSeats', 'Unlimited agents')
                      : t('billing.upToSeats', 'Up to {{n}} agents', { n: p.seats })}
                  </div>

                  <ul
                    style={{ listStyle: 'none', margin: '4px 0 0', padding: '14px 0 0', borderTop: '1px solid var(--color-bg-subtle)', display: 'flex', flexDirection: 'column', gap: 9 }}
                  >
                    {FEATURE_ORDER.map((f) => {
                      const on = features.includes(f);
                      return (
                        <li
                          key={f}
                          className="font-body flex items-start gap-2"
                          style={{ fontSize: 13.5, color: on ? 'var(--color-text-primary)' : 'var(--color-text-secondary)' }}
                        >
                          {on ? (
                            <Check size={15} aria-hidden="true" style={{ color: 'var(--color-accent)', marginTop: 2, flexShrink: 0 }} />
                          ) : (
                            <Minus size={15} aria-hidden="true" style={{ color: 'var(--color-status-notstarted-solid)', marginTop: 2, flexShrink: 0 }} />
                          )}
                          <span>
                            {t(`billing.features.${f}`, f)}
                            {!on && <span className="sr-only"> ({t('billing.notIncluded', 'not included')})</span>}
                          </span>
                        </li>
                      );
                    })}
                  </ul>

                  <div style={{ marginTop: 'auto', paddingTop: 4 }}>
                    {isCurrent ? (
                      <Button variant="secondary" size="lg" disabled className="w-full">
                        {t('billing.currentPlanBtn', 'Current plan')}
                      </Button>
                    ) : !p.purchasable ? (
                      <Button variant="secondary" size="lg" disabled className="w-full">
                        {t('billing.contactUs', 'Contact us')}
                      </Button>
                    ) : (
                      <Button
                        variant={p.recommended ? 'primary' : 'secondary'}
                        size="lg"
                        onClick={() => upgrade(p.id)}
                        disabled={!!busy || !data?.configured}
                        className="w-full"
                      >
                        {busy === p.id ? t('billing.redirecting', 'Redirecting…') : t('billing.choose', 'Choose {{plan}}', { plan: p.name })}
                      </Button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {data?.trialDays > 0 && (
          <p className="font-body" style={{ margin: 0, fontSize: 13, color: 'var(--color-text-secondary)', textAlign: 'center' }}>
            {t('billing.trialNote', '{{days}}-day free trial on your first subscription. Cancel any time.', { days: data.trialDays })}
          </p>
        )}
      </PageBody>
    </PageWrapper>
  );
};

export default BillingPage;
