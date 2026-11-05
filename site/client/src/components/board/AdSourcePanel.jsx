import { useTranslation } from 'react-i18next';
import { formatDate } from '../../utils/dateUtils';

/**
 * AdSourcePanel — read-only "where did this lead come from" block in the lead
 * panel header. Renders `task.attribution` (set by the ingest path from the
 * website capture script): the ad platform, campaign, click IDs and whether the
 * visitor consented to their data being used to measure advertising. Renders
 * nothing for leads that didn't arrive from a tracked click.
 */

const CHANNEL_KEYS = {
  google_ads: 'adSource.channelGoogle',
  meta_ads: 'adSource.channelMeta',
  microsoft_ads: 'adSource.channelMicrosoft',
  tiktok_ads: 'adSource.channelTiktok',
  campaign: 'adSource.channelCampaign',
};

// Click IDs in the order a reader cares about them; first present one is shown.
const CLICK_ID_FIELDS = ['gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'ttclid'];

const DETAIL_FIELDS = [
  ['gclid', 'GCLID'],
  ['gbraid', 'GBRAID'],
  ['wbraid', 'WBRAID'],
  ['fbclid', 'FBCLID'],
  ['fbc', 'fbc'],
  ['fbp', 'fbp'],
  ['msclkid', 'MSCLKID'],
  ['ttclid', 'TTCLID'],
  ['utmSource', 'utm_source'],
  ['utmMedium', 'utm_medium'],
  ['utmCampaign', 'utm_campaign'],
  ['utmTerm', 'utm_term'],
  ['utmContent', 'utm_content'],
  ['landingPage', null],
  ['referrer', null],
];

const labelStyle = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.07em',
  color: 'var(--color-text-muted)',
  marginBottom: 6,
};

const rowLabelStyle = {
  fontSize: 12,
  fontWeight: 500,
  color: 'var(--color-text-muted)',
  width: 88,
  flexShrink: 0,
};

const valueStyle = {
  fontSize: 13,
  color: 'var(--color-text-primary)',
  minWidth: 0,
  overflowWrap: 'anywhere',
};

const Row = ({ label, children }) => (
  <div className="flex items-start gap-3">
    <span className="font-body" style={rowLabelStyle}>
      {label}
    </span>
    <span className="font-body" style={valueStyle}>
      {children}
    </span>
  </div>
);

const truncate = (s, n = 28) => (s && s.length > n ? `${s.slice(0, n)}…` : s);

const AdSourcePanel = ({ attribution }) => {
  const { t } = useTranslation();
  if (!attribution) return null;

  const a = attribution;
  const clickField = CLICK_ID_FIELDS.find((f) => a[f]);
  const consent = a.adConsent;

  let consentText = t('adSource.consentNotAsked');
  let consentColor = 'var(--color-text-muted)';
  if (consent) {
    consentText = consent.granted ? t('adSource.consentGranted') : t('adSource.consentDeclined');
    consentColor = consent.granted ? 'var(--color-success)' : 'var(--color-error)';
  }

  const details = DETAIL_FIELDS.filter(([key]) => a[key]);

  return (
    <section className="mt-4" aria-label={t('adSource.title')}>
      <p className="font-body" style={labelStyle}>
        {t('adSource.title')}
      </p>
      <div className="flex flex-col gap-2">
        <Row label={t('adSource.channel')}>
          <span style={{ fontWeight: 600 }}>
            {a.channel && CHANNEL_KEYS[a.channel] ? t(CHANNEL_KEYS[a.channel]) : t('adSource.channelUnknown')}
          </span>
          {a.utmCampaign ? <span style={{ color: 'var(--color-text-secondary)' }}> · {a.utmCampaign}</span> : null}
        </Row>
        {clickField ? (
          <Row label={t('adSource.clickId')}>
            <span title={a[clickField]}>
              {clickField.toUpperCase()} {truncate(a[clickField])}
            </span>
          </Row>
        ) : null}
        {a.clickedAt ? <Row label={t('adSource.clicked')}>{formatDate(a.clickedAt)}</Row> : null}
        <Row label={t('adSource.consent')}>
          <span style={{ color: consentColor, fontWeight: 500 }}>{consentText}</span>
        </Row>
        {details.length > 0 ? (
          <details>
            <summary
              className="font-body"
              style={{ fontSize: 12, color: 'var(--color-text-muted)', cursor: 'pointer' }}
            >
              {t('adSource.allDetails')}
            </summary>
            <div className="mt-2 flex flex-col gap-1">
              {details.map(([key, wire]) => (
                // Wire names (gclid, utm_source…) are shown raw on purpose —
                // they're what an ads manager searches for in their platform.
                <Row key={key} label={wire || t(`adSource.${key}`)}>
                  {key === 'landingPage' || key === 'referrer' ? (
                    <a href={a[key]} target="_blank" rel="noopener noreferrer nofollow" style={{ color: 'inherit' }}>
                      {truncate(a[key], 60)}
                    </a>
                  ) : (
                    a[key]
                  )}
                </Row>
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </section>
  );
};

export default AdSourcePanel;
