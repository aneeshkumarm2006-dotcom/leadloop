import { useTranslation } from 'react-i18next';
import { SettingsCard, CardTitle, PineCard } from './SettingsLayout';

/**
 * Aside for the SMS / WhatsApp tabs: "Where to find these" steps in the
 * Twilio console plus a pine "Used by" note.
 */
const TwilioAside = ({ idPrefix, steps, usedBy }) => {
  const { t } = useTranslation();
  return (
    <aside className="flex flex-col gap-4 min-w-0">
      <SettingsCard aria-labelledby={`${idPrefix}-where-title`} style={{ padding: 22, gap: 10 }}>
        <CardTitle id={`${idPrefix}-where-title`} size={17}>{t('settings.twilio.whereTitle')}</CardTitle>
        <ol className="m-0 flex flex-col gap-2 font-body" style={{ paddingLeft: 18, fontSize: 13.5, color: 'var(--color-text-secondary)', listStyleType: 'decimal' }}>
          {steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </SettingsCard>
      <PineCard aria-labelledby={`${idPrefix}-usedby-title`}>
        <h2 id={`${idPrefix}-usedby-title`} className="font-display font-bold" style={{ margin: 0, fontSize: 16 }}>
          {t('settings.twilio.usedByTitle')}
        </h2>
        <p style={{ margin: 0, color: '#C9D4C7' }}>{usedBy}</p>
      </PineCard>
    </aside>
  );
};

export default TwilioAside;
