import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CopyCheck, AlertTriangle, Check } from 'lucide-react';
import PageWrapper from '../components/layout/PageWrapper';
import Button from '../components/ui/Button';
import EmptyState from '../components/onboarding/EmptyState';
import useOrgStore from '../store/orgStore';
import { listDuplicates, mergeDuplicate, dismissDuplicate } from '../services/duplicateService';

/**
 * DuplicatesPage — review pairs of leads that look like the same person.
 *
 * The connectors ingest the same buyer from Zillow, Facebook and the website,
 * so duplicates are expected rather than exceptional. Detection only ever
 * flags; merging is an explicit choice made here, field by field, because a
 * wrong merge destroys two real people's records.
 */

const card = {
  background: 'var(--color-bg-surface, #fff)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-card)',
};

const fmtDate = (d) => {
  try {
    return new Date(d).toLocaleDateString();
  } catch {
    return '';
  }
};

const asText = (v) => {
  if (v == null || v === '') return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

const DuplicatePair = ({ pair, onResolved }) => {
  const { t } = useTranslation();
  // Which side each field takes. Default 'primary' = the existing (older) lead.
  const [choices, setChoices] = useState({});
  const [busy, setBusy] = useState('');

  const columns = pair.existing.columns || [];
  const strong = pair.score >= 90;

  const run = async (action) => {
    setBusy(action);
    try {
      if (action === 'merge') await mergeDuplicate(pair._id, choices, 'existing');
      else await dismissDuplicate(pair._id);
      onResolved(pair._id);
    } catch {
      setBusy('');
    }
  };

  const Radio = ({ on }) => (
    <span
      aria-hidden="true"
      style={{
        width: 13,
        height: 13,
        borderRadius: '50%',
        border: `1.5px solid ${on ? 'var(--color-accent)' : 'var(--color-border-strong)'}`,
        background: on ? 'radial-gradient(circle, var(--color-accent) 0 45%, transparent 47%)' : 'transparent',
        display: 'inline-block',
        flex: '0 0 13px',
      }}
    />
  );

  const Cell = ({ side, value, columnId }) => {
    const chosen = (choices[columnId] || 'primary') === side;
    return (
      <button
        type="button"
        onClick={() => setChoices((c) => ({ ...c, [columnId]: side }))}
        className="text-left flex items-center gap-2"
        style={{
          padding: '10px 12px',
          borderBottom: '1px solid var(--color-border)',
          background: chosen ? 'var(--color-accent-light, #EEF3EA)' : 'transparent',
          boxShadow: chosen ? 'inset 2px 0 0 var(--color-accent)' : 'none',
          border: 'none',
          borderRadius: 0,
          width: '100%',
          fontSize: 13,
          color: 'var(--color-text-primary)',
          cursor: 'pointer',
          minWidth: 0,
        }}
      >
        <Radio on={chosen} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{asText(value)}</span>
      </button>
    );
  };

  return (
    <div style={{ ...card, marginBottom: 16, overflow: 'hidden' }}>
      {/* Why we think these match */}
      <div
        className="flex items-start gap-3 flex-wrap"
        style={{
          padding: '12px 16px',
          background: 'var(--color-status-working-bg, #FBF2DE)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <AlertTriangle size={17} style={{ color: 'var(--color-status-working)', marginTop: 2, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <div className="font-heading" style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--color-text-primary)' }}>
            {strong
              ? t('duplicates.strongTitle', 'Almost certainly the same person')
              : t('duplicates.maybeTitle', 'This might already be in your pipeline')}
          </div>
          <p className="font-body" style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', marginTop: 2 }}>
            {t('duplicates.matchedOn', 'Matched on {{fields}}', {
              fields: (pair.reasons || [])
                .map((r) => t(`duplicates.reason.${r}`, r))
                .join(t('duplicates.and', ' and ')),
            })}{' '}
            · {pair.boardName}
          </p>
        </div>
        <span
          className="font-body"
          style={{
            fontSize: 11.5,
            fontWeight: 700,
            padding: '3px 9px',
            borderRadius: 20,
            background: 'var(--color-bg-surface, #fff)',
            color: 'var(--color-status-working)',
            whiteSpace: 'nowrap',
          }}
        >
          {t('duplicates.confidence', '{{score}}% match', { score: pair.score })}
        </span>
      </div>

      {/* Field-by-field picker */}
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 520, display: 'grid', gridTemplateColumns: '120px 1fr 1fr' }}>
          <div style={{ ...headCell }}>{t('duplicates.field', 'Field')}</div>
          <div style={{ ...headCell }}>
            {t('duplicates.existing', 'Already in LeadLoop')}
            <span style={subLabel}>{fmtDate(pair.existing.createdAt)}</span>
          </div>
          <div style={{ ...headCell }}>
            {t('duplicates.incoming', 'Just arrived')}
            <span style={subLabel}>{fmtDate(pair.incoming.createdAt)}</span>
          </div>

          <div style={labelCell}>{t('duplicates.name', 'Name')}</div>
          <div style={{ borderBottom: '1px solid var(--color-border)', padding: '10px 12px', fontSize: 13 }}>
            {asText(pair.existing.name)}
          </div>
          <div style={{ borderBottom: '1px solid var(--color-border)', padding: '10px 12px', fontSize: 13 }}>
            {asText(pair.incoming.name)}
          </div>

          {columns.map((col) => (
            <div key={col._id} style={{ display: 'contents' }}>
              <div style={labelCell}>{col.name}</div>
              <Cell side="primary" columnId={col._id} value={pair.existing.values[col._id]} />
              <Cell side="duplicate" columnId={col._id} value={pair.incoming.values[col._id]} />
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap" style={{ padding: '13px 16px' }}>
        <p className="font-body" style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
          {t('duplicates.mergeNote', 'The older lead is kept, with its history. The newer copy is removed.')}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => run('dismiss')} disabled={!!busy}>
            {t('duplicates.notDuplicate', 'Not a duplicate')}
          </Button>
          <Button variant="primary" onClick={() => run('merge')} disabled={!!busy}>
            {busy === 'merge' ? t('duplicates.merging', 'Merging…') : t('duplicates.merge', 'Merge into one lead')}
          </Button>
        </div>
      </div>
    </div>
  );
};

const headCell = {
  padding: '10px 12px',
  background: 'var(--color-bg-subtle)',
  borderBottom: '1px solid var(--color-border)',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: 'var(--color-text-secondary)',
};
const subLabel = { display: 'block', fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--color-text-muted)', fontSize: 11 };
const labelCell = {
  padding: '10px 12px',
  borderBottom: '1px solid var(--color-border)',
  fontSize: 11,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--color-text-muted)',
};

const DuplicatesPage = () => {
  const { t } = useTranslation();
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const orgId = currentOrg?._id || null;
  const [pairs, setPairs] = useState(null);

  const load = useCallback(() => {
    if (!orgId) return;
    listDuplicates(orgId)
      .then(setPairs)
      .catch(() => setPairs([]));
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  const onResolved = (id) => setPairs((p) => (p || []).filter((x) => x._id !== id));

  return (
    <PageWrapper>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '4px 2px 40px' }}>
        <div className="flex items-center gap-3" style={{ marginBottom: 6 }}>
          <span
            className="inline-flex items-center justify-center"
            style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--color-accent-light, #EEF3EA)', color: 'var(--color-accent)' }}
          >
            <CopyCheck size={18} />
          </span>
          <h1 className="font-heading" style={{ fontSize: 24, fontWeight: 800, color: 'var(--color-text-primary)' }}>
            {t('duplicates.title', 'Possible duplicates')}
          </h1>
        </div>
        <p className="font-body" style={{ fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 22, maxWidth: 620 }}>
          {t('duplicates.subtitle', 'The same buyer often enquires through more than one source. Review each pair and keep one record — nothing is merged automatically.')}
        </p>

        {pairs === null ? (
          <div className="flex flex-col gap-3">
            {[0, 1].map((i) => (
              <div key={i} className="skeleton" style={{ height: 200, borderRadius: 12 }} />
            ))}
          </div>
        ) : pairs.length === 0 ? (
          <EmptyState
            icon={Check}
            title={t('duplicates.emptyTitle', 'No duplicates to review')}
            body={t('duplicates.emptyBody', 'When the same person arrives from two sources, the pair shows up here before anything is merged.')}
          />
        ) : (
          pairs.map((pair) => <DuplicatePair key={pair._id} pair={pair} onResolved={onResolved} />)
        )}
      </div>
    </PageWrapper>
  );
};

export default DuplicatesPage;
