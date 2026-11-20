import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check } from 'lucide-react';
import PageWrapper from '../components/layout/PageWrapper';
import { PageHeader, PageBody } from '../components/layout/PageHeader';
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
  background: 'var(--color-bg-surface)',
  borderRadius: 18,
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

const matchedOn = (pair, t) =>
  (pair.reasons || []).map((r) => t(`duplicates.reason.${r}`, r)).join(t('duplicates.and', ' and '));

const headCell = {
  padding: '12px 16px',
  borderBottom: '1px solid var(--color-border)',
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--color-text-secondary)',
  textAlign: 'left',
  verticalAlign: 'bottom',
};
const rowCell = {
  padding: '14px 16px',
  borderBottom: '1px solid var(--color-bg-subtle)',
  fontSize: 13.5,
  color: 'var(--color-text-primary)',
  verticalAlign: 'middle',
};
const subLabel = { display: 'block', fontWeight: 400, color: 'var(--color-text-muted)', fontSize: 11.5, marginTop: 2 };

/** One selectable side of a field: a real radio inside its label. */
const ChoiceCell = ({ name, chosen, value, fieldName, onChoose }) => (
  <td style={{ ...rowCell, padding: 0, background: chosen ? 'var(--color-accent-light)' : 'transparent' }}>
    <label
      className="flex items-center gap-2.5"
      style={{ padding: '14px 16px', cursor: 'pointer', minWidth: 0 }}
    >
      <input
        type="radio"
        name={name}
        checked={chosen}
        onChange={onChoose}
        aria-label={`${fieldName}: ${asText(value)}`}
        style={{ accentColor: 'var(--color-accent)', margin: 0, flexShrink: 0 }}
      />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{asText(value)}</span>
    </label>
  </td>
);

/** The comparison panel for the selected pair. */
const DuplicatePair = ({ pair, onResolved }) => {
  const { t } = useTranslation();
  // Which side each field takes. Default 'primary' = the existing (older) lead.
  const [choices, setChoices] = useState({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const columns = pair.existing.columns || [];
  const strong = pair.score >= 90;
  const titleId = `dup-title-${pair._id}`;

  const run = async (action) => {
    setBusy(action);
    setError('');
    try {
      if (action === 'merge') await mergeDuplicate(pair._id, choices, 'existing');
      else await dismissDuplicate(pair._id);
      onResolved(pair._id);
    } catch (e) {
      setBusy('');
      setError(e?.response?.data?.error || t('duplicates.actionError', 'That didn’t work. Please try again.'));
    }
  };

  return (
    <section aria-labelledby={titleId} style={{ ...card, overflow: 'hidden', minWidth: 0 }}>
      {/* Why we think these match */}
      <div
        className="flex items-center gap-3 flex-wrap"
        style={{ padding: '18px 24px', background: 'var(--color-status-working-bg)' }}
      >
        <AlertTriangle size={18} aria-hidden="true" style={{ color: 'var(--color-status-working)', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <h2 id={titleId} className="font-display" style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--color-text-primary)' }}>
            {strong
              ? t('duplicates.strongTitle', 'Almost certainly the same person')
              : t('duplicates.maybeTitle', 'This might already be in your pipeline')}
          </h2>
          <p className="font-body" style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--color-status-working)' }}>
            {t('duplicates.matchedOn', 'Matched on {{fields}}', { fields: matchedOn(pair, t) })}
            {pair.boardName ? ` · ${pair.boardName}` : ''}
          </p>
        </div>
        <span
          className="font-body"
          style={{
            fontSize: 13,
            fontWeight: 700,
            padding: '5px 12px',
            borderRadius: 'var(--radius-full)',
            background: 'var(--color-status-working)',
            color: '#FFFFFF',
            whiteSpace: 'nowrap',
          }}
        >
          {t('duplicates.confidence', '{{score}}% match', { score: pair.score })}
        </span>
      </div>

      {/* Field-by-field picker */}
      <div style={{ overflowX: 'auto' }}>
        <table className="font-body" style={{ width: '100%', minWidth: 560, borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: 180 }} />
            <col />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" style={{ ...headCell, paddingLeft: 24 }}>{t('duplicates.field', 'Field')}</th>
              <th scope="col" style={headCell}>
                {t('duplicates.existing', 'Already in LeadLoop')}
                <span style={subLabel}>{fmtDate(pair.existing.createdAt)}</span>
              </th>
              <th scope="col" style={headCell}>
                {t('duplicates.incoming', 'Just arrived')}
                <span style={subLabel}>{fmtDate(pair.incoming.createdAt)}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row" style={{ ...rowCell, paddingLeft: 24, fontWeight: 600, textAlign: 'left' }}>
                {t('duplicates.name', 'Name')}
              </th>
              <td style={rowCell}>{asText(pair.existing.name)}</td>
              <td style={rowCell}>{asText(pair.incoming.name)}</td>
            </tr>
            {columns.map((col) => {
              const side = choices[col._id] || 'primary';
              const choose = (v) => () => setChoices((c) => ({ ...c, [col._id]: v }));
              const group = `dup-${pair._id}-${col._id}`;
              return (
                <tr key={col._id}>
                  <th
                    scope="row"
                    style={{ ...rowCell, paddingLeft: 24, fontWeight: 600, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis' }}
                  >
                    {col.name}
                  </th>
                  <ChoiceCell
                    name={group}
                    chosen={side === 'primary'}
                    value={pair.existing.values?.[col._id]}
                    fieldName={col.name}
                    onChoose={choose('primary')}
                  />
                  <ChoiceCell
                    name={group}
                    chosen={side === 'duplicate'}
                    value={pair.incoming.values?.[col._id]}
                    fieldName={col.name}
                    onChoose={choose('duplicate')}
                  />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3 flex-wrap" style={{ padding: '16px 24px' }}>
        <p className="font-body" style={{ flex: 1, minWidth: 200, margin: 0, fontSize: 12.5, color: 'var(--color-text-secondary)' }}>
          {t('duplicates.mergeNote', 'The older lead is kept, with its history. The newer copy is removed.')}
        </p>
        <Button variant="secondary" onClick={() => run('dismiss')} disabled={!!busy}>
          {t('duplicates.notDuplicate', 'Not a duplicate')}
        </Button>
        <Button variant="primary" onClick={() => run('merge')} disabled={!!busy}>
          {busy === 'merge' ? t('duplicates.merging', 'Merging…') : t('duplicates.merge', 'Merge into one lead')}
        </Button>
        {error && (
          <p role="alert" className="font-body w-full" style={{ margin: 0, fontSize: 12.5, color: 'var(--color-status-stuck)' }}>
            {error}
          </p>
        )}
      </div>
    </section>
  );
};

const DuplicatesPage = () => {
  const { t } = useTranslation();
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const orgId = currentOrg?._id || null;
  const [pairs, setPairs] = useState(null);
  const [selectedId, setSelectedId] = useState(null);

  const load = useCallback(() => {
    if (!orgId) return;
    listDuplicates(orgId)
      .then((list) => setPairs(Array.isArray(list) ? list : []))
      .catch(() => setPairs([]));
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  // The selected pair; falls back to the first one so something is always shown.
  const selected = (pairs || []).find((p) => p._id === selectedId) || (pairs || [])[0] || null;

  const onResolved = (id) => {
    const list = pairs || [];
    const idx = list.findIndex((x) => x._id === id);
    const next = list.filter((x) => x._id !== id);
    // Move on to the next pair in the list (or the previous one at the end).
    const following = next[idx] || next[idx - 1] || null;
    setSelectedId(following ? following._id : null);
    setPairs(next);
  };

  const count = pairs?.length || 0;

  return (
    <PageWrapper flush>
      <PageHeader
        title={t('duplicates.title', 'Possible duplicates')}
        subtitle={t('duplicates.subtitle', 'The same buyer often enquires through more than one source. Review each pair and keep one record — nothing is merged automatically.')}
        actions={
          count > 0 ? (
            <span
              className="font-body"
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: 'var(--color-status-working)',
                background: 'var(--color-status-working-bg)',
                padding: '6px 12px',
                borderRadius: 'var(--radius-full)',
              }}
            >
              {t('duplicates.toReview', '{{count}} to review', { count })}
            </span>
          ) : null
        }
      />
      <PageBody>
        {pairs === null ? (
          <div className="grid gap-5 lg:grid-cols-[minmax(280px,380px)_minmax(0,1fr)]" aria-busy="true">
            <div className="skeleton" style={{ height: 240, borderRadius: 18 }} />
            <div className="skeleton" style={{ height: 360, borderRadius: 18 }} />
          </div>
        ) : pairs.length === 0 ? (
          <EmptyState
            icon={Check}
            title={t('duplicates.emptyTitle', 'No duplicates to review')}
            body={t('duplicates.emptyBody', 'When the same person arrives from two sources, the pair shows up here before anything is merged.')}
          />
        ) : (
          <div className="grid gap-5 items-start lg:grid-cols-[minmax(280px,380px)_minmax(0,1fr)]">
            <nav aria-label={t('duplicates.pairsLabel', 'Pairs to review')} style={{ ...card, overflow: 'hidden' }}>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {pairs.map((pair) => {
                  const on = selected?._id === pair._id;
                  const name = pair.existing?.name || pair.incoming?.name || '—';
                  return (
                    <li key={pair._id} style={{ borderBottom: '1px solid var(--color-bg-subtle)' }}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(pair._id)}
                        aria-current={on ? 'true' : undefined}
                        className="block w-full text-left font-body transition-colors hover:bg-[color:var(--color-bg-input)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--color-accent)]"
                        style={{
                          padding: '16px 18px',
                          background: on ? 'var(--color-accent-light)' : undefined,
                          borderLeft: `3px solid ${on ? 'var(--color-accent)' : 'transparent'}`,
                          color: 'var(--color-text-primary)',
                          cursor: 'pointer',
                        }}
                      >
                        <span className="flex justify-between gap-2">
                          <strong className="truncate">{asText(name)}</strong>
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-status-working)', flexShrink: 0 }}>
                            {pair.score}%
                          </span>
                        </span>
                        <span className="block truncate" style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', marginTop: 4 }}>
                          {matchedOn(pair, t)}
                          {pair.boardName ? ` · ${pair.boardName}` : ''}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>
            {selected && <DuplicatePair key={selected._id} pair={selected} onResolved={onResolved} />}
          </div>
        )}
      </PageBody>
    </PageWrapper>
  );
};

export default DuplicatesPage;
