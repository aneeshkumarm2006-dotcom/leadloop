import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Pencil, Copy, Check } from 'lucide-react';

/**
 * FormBoardView — the board-view panel shown when a form tab is active. Mirrors
 * how Monday surfaces a form as a board view: a header with the public link +
 * actions (copy / open / edit) and a live preview of the public form below.
 *
 * The preview / share link uses the client origin so it loads the actual public
 * form page (`/f/:slug`).
 */
const FormBoardView = ({ form, isAdmin }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  const publicHref = `${window.location.origin}/f/${form.slug}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(publicHref);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };

  const btn = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 34,
    padding: '0 12px',
    fontSize: 13,
    fontWeight: 600,
    borderRadius: 'var(--radius-md)',
    border: '1.5px solid var(--color-border-strong)',
    background: 'var(--color-bg-surface, #FFFFFF)',
    color: 'var(--color-text-secondary)',
    cursor: 'pointer',
  };

  return (
    <div className="mt-5">
      {/* Header: public URL + actions */}
      <div className="flex items-center gap-3 flex-wrap">
        <code
          className="font-body"
          style={{
            fontSize: 12,
            padding: '6px 10px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-bg-subtle)',
            color: 'var(--color-text-secondary)',
            maxWidth: '100%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {publicHref}
        </code>
        <button type="button" onClick={copy} style={btn}>
          {copied ? <Check size={14} color="var(--color-status-done)" /> : <Copy size={14} />}
          {copied ? t('itemTabs.copied') : t('itemTabs.copyUrl')}
        </button>
        <a href={publicHref} target="_blank" rel="noopener noreferrer" style={{ ...btn, textDecoration: 'none' }}>
          <ExternalLink size={14} />
          {t('itemTabs.openForm')}
        </a>
        {isAdmin && (
          <button type="button" onClick={() => navigate(`/forms/${form._id}/edit`)} style={btn}>
            <Pencil size={14} />
            {t('itemTabs.editForm')}
          </button>
        )}
      </div>

      {/* Live preview of the public form */}
      <div
        className="mt-4"
        style={{
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--color-border)',
          overflow: 'hidden',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <iframe
          key={form._id}
          title={form.name}
          src={publicHref}
          style={{ width: '100%', height: '70vh', border: 'none', display: 'block', background: '#fff' }}
        />
      </div>
    </div>
  );
};

export default FormBoardView;
