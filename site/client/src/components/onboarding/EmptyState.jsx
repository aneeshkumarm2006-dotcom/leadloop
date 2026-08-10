import { useTranslation } from 'react-i18next';

/**
 * EmptyState — a blank screen that teaches instead of just being empty.
 *
 * The product tour explains things once, on day one, in a popup people click
 * past. An empty state explains the same thing at the moment it is actually
 * needed: when someone is looking at the page and wondering what to do.
 *
 * Props:
 *   icon       — a lucide component
 *   title      — headline
 *   body       — one or two sentences on why this page matters
 *   steps      — optional [{ label, text }]; ONLY use where the steps really
 *                are a sequence (numbering implies order)
 *   action     — optional { label, onClick }
 *   secondary  — optional { label, onClick }
 */
const EmptyState = ({ icon: Icon, title, body, steps = [], action, secondary }) => {
  const { t } = useTranslation();
  return (
    <div
      style={{
        background: 'var(--color-bg-surface, #fff)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-card)',
        padding: '34px 24px',
        textAlign: 'center',
      }}
    >
      {Icon && (
        <span
          className="inline-flex items-center justify-center"
          style={{
            width: 52,
            height: 52,
            borderRadius: 14,
            background: 'var(--color-accent-light, #EEF3EA)',
            color: 'var(--color-accent)',
            marginBottom: 14,
          }}
        >
          <Icon size={23} />
        </span>
      )}

      <h3 className="font-heading" style={{ fontSize: 18, fontWeight: 750, color: 'var(--color-text-primary)' }}>
        {title}
      </h3>
      {body && (
        <p
          className="font-body"
          style={{
            fontSize: 13.5,
            color: 'var(--color-text-muted)',
            margin: '7px auto 0',
            maxWidth: '44ch',
            lineHeight: 1.55,
          }}
        >
          {body}
        </p>
      )}

      {steps.length > 0 && (
        <div
          className="grid"
          style={{
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 12,
            textAlign: 'left',
            margin: '20px auto 0',
            maxWidth: 620,
          }}
        >
          {steps.map((s, i) => (
            <div
              key={s.label || i}
              style={{
                background: 'var(--color-bg-input, #FCFAF4)',
                border: '1px solid var(--color-border)',
                borderRadius: 9,
                padding: '11px 12px',
              }}
            >
              <span
                className="font-mono"
                style={{
                  display: 'block',
                  fontSize: 10,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: 'var(--color-accent)',
                  marginBottom: 5,
                }}
              >
                {s.label || t('setup.stepN', 'Step {{n}}', { n: i + 1 })}
              </span>
              <p className="font-body" style={{ fontSize: 12.5, color: 'var(--color-text-muted)', lineHeight: 1.45 }}>
                {s.text}
              </p>
            </div>
          ))}
        </div>
      )}

      {(action || secondary) && (
        <div className="flex items-center justify-center flex-wrap" style={{ gap: 10, marginTop: 20 }}>
          {action && (
            <button
              type="button"
              onClick={action.onClick}
              className="font-body"
              style={{
                fontSize: 13.5,
                fontWeight: 650,
                padding: '10px 18px',
                borderRadius: 'var(--radius-md)',
                border: 'none',
                background: 'var(--color-accent)',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              {action.label}
            </button>
          )}
          {secondary && (
            <button
              type="button"
              onClick={secondary.onClick}
              disabled={secondary.disabled}
              className="font-body"
              style={{
                fontSize: 13.5,
                fontWeight: 650,
                padding: '10px 18px',
                borderRadius: 'var(--radius-md)',
                border: '1.5px solid var(--color-border-strong)',
                background: 'transparent',
                color: 'var(--color-text-secondary)',
                cursor: secondary.disabled ? 'default' : 'pointer',
                opacity: secondary.disabled ? 0.6 : 1,
              }}
            >
              {secondary.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default EmptyState;
