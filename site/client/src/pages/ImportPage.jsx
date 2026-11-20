import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Upload, ArrowRight, Check, AlertTriangle, FileSpreadsheet } from 'lucide-react';
import PageWrapper from '../components/layout/PageWrapper';
import { PageHeader, PageBody } from '../components/layout/PageHeader';
import Button from '../components/ui/Button';
import Dropdown from '../components/ui/Dropdown';
import useOrgStore from '../store/orgStore';
import { getBoards } from '../services/boardService';
import { previewImport, runImport } from '../services/importService';

/**
 * ImportPage — bring an existing CRM's contacts in.
 *
 * Three steps: choose a file → confirm the mapping we guessed → import. The
 * middle step exists because nobody should find out what an import did after
 * it has already written five thousand rows.
 */

const card = {
  background: 'var(--color-bg-surface)',
  borderRadius: 16,
  boxShadow: 'var(--shadow-card)',
};

const ImportPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const orgId = currentOrg?._id || null;
  const fileRef = useRef(null);

  const [boards, setBoards] = useState([]);
  const [boardId, setBoardId] = useState('');
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState([]);
  const [groupId, setGroupId] = useState('');
  const [skipExisting, setSkipExisting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!orgId) return;
    getBoards(orgId)
      .then((b) => {
        setBoards(b || []);
        if (b?.[0]?._id) setBoardId(String(b[0]._id));
      })
      .catch(() => setBoards([]));
  }, [orgId]);

  const onFile = async (file) => {
    if (!file) return;
    setError('');
    setResult(null);
    setFileName(file.name);
    const text = await file.text();
    setCsv(text);
    if (!boardId) {
      setError(t('import.pickBoard', 'Choose a board first.'));
      return;
    }
    setBusy(true);
    try {
      const p = await previewImport(boardId, text);
      setPreview(p);
      setMapping(p.mapping || []);
      setGroupId(p.groups?.[0]?._id ? String(p.groups[0]._id) : '');
    } catch (e) {
      setError(e?.response?.data?.error || t('import.readError', 'Could not read that file.'));
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const columnOptions = useMemo(() => {
    const cols = preview?.columns || [];
    return [
      { value: '', label: t('import.skipColumn', 'Skip this column') },
      ...cols
        .filter((c) => c.isPrimary)
        .map((c) => ({ value: 'primary', label: `${c.name} (${t('import.leadTitle', 'lead title')})` })),
      ...cols.filter((c) => !c.isPrimary).map((c) => ({ value: c._id, label: c.name })),
    ];
  }, [preview, t]);

  const matched = mapping.filter((m) => m.columnId).length;

  const doImport = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await runImport(boardId, { csv, mapping, groupId: groupId || undefined, skipExisting });
      setResult(r);
    } catch (e) {
      setError(e?.response?.data?.error || t('import.failed', 'Import failed.'));
    } finally {
      setBusy(false);
    }
  };

  const resetToStart = () => {
    setResult(null);
    setPreview(null);
    setCsv('');
    setFileName('');
    setError('');
    if (fileRef.current) fileRef.current.value = '';
  };

  // 1 = choose a file, 2 = match columns, 3 = imported.
  const step = result ? 3 : preview ? 2 : 1;
  const boardName = boards.find((b) => String(b._id) === String(boardId))?.name || '';

  // First non-empty sample value for a CSV header — the "Example value" column.
  const exampleFor = (header) => {
    const sample = Array.isArray(preview?.sample) ? preview.sample : [];
    for (const row of sample) {
      const v = row && typeof row === 'object' ? row[header] : undefined;
      if (v != null && String(v).trim() !== '') return String(v);
    }
    return '';
  };

  const stepper = (
    <ol
      aria-label={t('import.progress', 'Import progress')}
      className="flex flex-wrap items-center font-body"
      style={{ margin: 0, padding: 0, listStyle: 'none', gap: 10, fontSize: 13.5 }}
    >
      {[
        t('import.stepChoose', 'Choose a file'),
        t('import.matchTitle', 'Match your columns'),
        t('import.stepImport', 'Import'),
      ].map((label, i) => {
        const n = i + 1;
        const done = n < step || (n === 3 && step === 3);
        const current = n === step && !done;
        return (
          <li key={n} className="flex items-center" style={{ gap: 10 }} aria-current={n === step ? 'step' : undefined}>
            {i > 0 && (
              <span
                aria-hidden="true"
                style={{ width: 60, height: 2, background: n <= step ? 'var(--color-accent)' : 'var(--color-border)' }}
              />
            )}
            <span
              className="flex items-center"
              style={{
                gap: 8,
                fontWeight: current ? 700 : 600,
                color: done ? 'var(--color-status-done)' : current ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
              }}
            >
              <span
                aria-hidden="true"
                className="inline-flex items-center justify-center"
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 'var(--radius-full)',
                  fontSize: 12,
                  boxSizing: 'border-box',
                  ...(done
                    ? { background: 'var(--color-accent)', color: '#FFFFFF' }
                    : current
                      ? { background: 'var(--color-text-primary)', color: '#FFFFFF' }
                      : { border: '2px solid var(--color-border-strong)' }),
                }}
              >
                {done ? <Check size={13} /> : n}
              </span>
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );

  const errorText = error ? (
    <p role="alert" className="font-body" style={{ fontSize: 13, color: 'var(--color-status-stuck)', margin: 0 }}>
      {error}
    </p>
  ) : null;

  // File + destination summary — shown in the side column on steps 2 and 3.
  const fileSummary = (
    <section className="flex flex-col" style={{ ...card, padding: '18px 20px', gap: 10 }}>
      <div className="font-body" style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
        {t('import.fileLabel', 'File')}
      </div>
      <div className="flex items-center gap-2 font-body" style={{ fontWeight: 700, color: 'var(--color-text-primary)', minWidth: 0 }}>
        <FileSpreadsheet size={16} aria-hidden="true" style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
        <span className="truncate">{fileName || '—'}</span>
      </div>
      {preview && (
        <div className="font-body" style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
          {t('import.fileSummary', '{{n}} rows · into {{board}}', { n: preview.totalRows ?? 0, board: boardName || '—' })}
        </div>
      )}
      {step === 2 && (
        <Button variant="ghost" size="sm" onClick={resetToStart} disabled={busy} className="self-start -ml-3">
          {t('import.changeFile', 'Choose a different file')}
        </Button>
      )}
    </section>
  );

  return (
    <PageWrapper flush>
      <PageHeader
        title={t('import.title', 'Import leads')}
        subtitle={t('import.subtitle', 'Bring your contacts across from another CRM or a spreadsheet. We match the columns for you — check them before anything is created.')}
      >
        {stepper}
      </PageHeader>

      <PageBody>
        {/* Kept mounted across steps so "choose a different file" can reuse it. */}
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => onFile(e.target.files?.[0])}
        />

        <div className="grid gap-5 items-start lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
          {step === 3 ? (
            /* Step 3 — done */
            <>
              <section role="status" style={{ ...card, padding: 24 }}>
                <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
                  <Check size={20} aria-hidden="true" style={{ color: 'var(--color-status-done)' }} />
                  <h2 className="font-display" style={{ margin: 0, fontSize: 20, fontWeight: 750, color: 'var(--color-text-primary)' }}>
                    {t('import.doneTitle', '{{n}} leads imported', { n: result.created })}
                  </h2>
                </div>
                <p className="font-body" style={{ margin: 0, fontSize: 14, color: 'var(--color-text-secondary)' }}>
                  {t('import.doneBody', '{{skipped}} already existed and were skipped. {{failed}} could not be read.', {
                    skipped: result.skipped,
                    failed: result.failed,
                  })}
                </p>
                <div className="flex items-center gap-2 flex-wrap" style={{ marginTop: 18 }}>
                  <Button variant="primary" onClick={() => navigate(`/boards/${boardId}`)}>
                    {t('import.viewBoard', 'Open the board')}
                  </Button>
                  <Button variant="secondary" onClick={resetToStart}>
                    {t('import.another', 'Import another file')}
                  </Button>
                </div>
              </section>
              <aside className="flex flex-col gap-4">{fileSummary}</aside>
            </>
          ) : step === 2 ? (
            /* Step 2 — mapping table + summary / duplicates / landing stage */
            <>
              <section aria-labelledby="import-match-title" style={{ ...card, overflow: 'hidden', minWidth: 0 }}>
                <div className="flex items-center gap-3 flex-wrap" style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border)' }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <h2 id="import-match-title" className="font-display" style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                      {t('import.matchTitle', 'Match your columns')}
                    </h2>
                    <p className="font-body" style={{ margin: 0, fontSize: 13, color: 'var(--color-text-secondary)' }}>
                      {t('import.matchBody', 'We guessed these from your file. Change anything that looks wrong.')}
                    </p>
                  </div>
                  <span
                    className="font-body"
                    style={{ fontSize: 12.5, fontWeight: 700, padding: '4px 10px', borderRadius: 'var(--radius-full)', background: 'var(--color-status-done-bg)', color: 'var(--color-status-done)' }}
                  >
                    {t('import.matchedN', '{{n}} of {{total}} matched', { n: matched, total: mapping.length })}
                  </span>
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table className="font-body" style={{ width: '100%', minWidth: 640, borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: 13.5 }}>
                    <colgroup>
                      <col style={{ width: '28%' }} />
                      <col style={{ width: 40 }} />
                      <col style={{ width: '30%' }} />
                      <col />
                    </colgroup>
                    <thead>
                      <tr style={{ textAlign: 'left', color: 'var(--color-text-secondary)', fontSize: 12 }}>
                        <th scope="col" style={{ padding: '10px 20px', fontWeight: 700 }}>{t('import.inFile', 'In your file')}</th>
                        <th scope="col"><span className="sr-only">{t('import.mapsTo', 'Maps to')}</span></th>
                        <th scope="col" style={{ padding: '10px 12px', fontWeight: 700 }}>{t('import.leadloopColumn', 'LeadLoop column')}</th>
                        <th scope="col" style={{ padding: '10px 20px', fontWeight: 700 }}>{t('import.example', 'Example value')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mapping.map((m, i) => {
                        const example = exampleFor(m.header);
                        return (
                          <tr key={m.header} style={{ borderTop: '1px solid var(--color-bg-subtle)' }}>
                            <th
                              scope="row"
                              className="font-mono"
                              title={m.header}
                              style={{ padding: '10px 20px', fontSize: 12.5, fontWeight: 400, textAlign: 'left', color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            >
                              {m.header}
                            </th>
                            <td style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>
                              <ArrowRight size={14} aria-hidden="true" style={{ display: 'inline-block' }} />
                            </td>
                            <td style={{ padding: '8px 12px' }}>
                              <div
                                role="group"
                                aria-label={t('import.columnFor', 'LeadLoop column for {{header}}', { header: m.header })}
                                style={{
                                  borderRadius: 'var(--radius-md)',
                                  boxShadow: m.columnId ? 'none' : '0 0 0 1.5px var(--color-status-working-solid)',
                                }}
                              >
                                <Dropdown
                                  size="sm"
                                  options={columnOptions}
                                  value={m.columnId || ''}
                                  onChange={(v) =>
                                    setMapping((prev) => prev.map((x, idx) => (idx === i ? { ...x, columnId: v || null } : x)))
                                  }
                                />
                              </div>
                            </td>
                            <td
                              title={example}
                              style={{ padding: '10px 20px', color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            >
                              {example || '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              <aside className="flex flex-col gap-4">
                {fileSummary}

                {/* Existing rows */}
                {preview.duplicateCount > 0 && (
                  <section
                    className="flex flex-col font-body"
                    style={{ background: 'var(--color-status-working-bg)', borderRadius: 16, padding: '16px 18px', gap: 10, fontSize: 13.5 }}
                  >
                    <h2 className="flex items-center gap-2 font-body" style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: 'var(--color-status-working)' }}>
                      <AlertTriangle size={15} aria-hidden="true" style={{ flexShrink: 0 }} />
                      {t('import.dupTitle', '{{n}} rows already exist', { n: preview.duplicateCount })}
                    </h2>
                    <label className="flex items-start gap-2.5" style={{ color: 'var(--color-text-primary)', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={skipExisting}
                        onChange={(e) => setSkipExisting(e.target.checked)}
                        style={{ accentColor: 'var(--color-accent)', margin: '3px 0 0' }}
                      />
                      {t('import.skipExisting', 'Skip them and import only the {{n}} new leads', { n: preview.newCount })}
                    </label>
                  </section>
                )}

                <section className="flex flex-col" style={{ ...card, padding: '18px 20px', gap: 14 }}>
                  <Dropdown
                    label={t('import.landing', 'Landing stage')}
                    options={(preview.groups || []).map((g) => ({ value: String(g._id), label: g.name }))}
                    value={groupId}
                    onChange={setGroupId}
                  />
                  {errorText}
                  <Button variant="primary" size="lg" onClick={doImport} disabled={busy} className="w-full">
                    {busy
                      ? t('import.importing', 'Importing…')
                      : t('import.run', 'Import {{n}} leads', {
                          n: skipExisting ? preview.newCount : preview.totalRows,
                        })}
                  </Button>
                </section>
              </aside>
            </>
          ) : (
            /* Step 1 — file drop zone + destination board */
            <>
              <section className="flex flex-col" style={{ ...card, padding: 20, gap: 12, minWidth: 0 }}>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={!boardId || busy}
                  aria-describedby="import-file-hint"
                  className="w-full flex flex-col items-center justify-center transition-colors enabled:hover:bg-[color:var(--color-bg-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)] disabled:opacity-60"
                  style={{
                    minHeight: 220,
                    padding: '32px 18px',
                    borderRadius: 'var(--radius-md)',
                    border: '2px dashed var(--color-border-strong)',
                    background: 'var(--color-bg-input)',
                    cursor: boardId && !busy ? 'pointer' : 'default',
                    textAlign: 'center',
                  }}
                >
                  <Upload size={24} aria-hidden="true" style={{ color: 'var(--color-accent)' }} />
                  <span className="font-display" style={{ display: 'block', fontSize: 16, fontWeight: 700, marginTop: 10, color: 'var(--color-text-primary)' }}>
                    {busy ? t('common.loading', 'Loading…') : fileName || t('import.choose', 'Choose a CSV file')}
                  </span>
                  <span id="import-file-hint" className="font-body" style={{ display: 'block', fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
                    {t('import.exportHint', 'Export from your current CRM as CSV — commas, semicolons and tabs all work.')}
                  </span>
                </button>
                {errorText}
              </section>
              <aside className="flex flex-col gap-4">
                <section style={{ ...card, padding: '18px 20px' }}>
                  <Dropdown
                    label={t('import.board', 'Import into board')}
                    options={boards.map((b) => ({ value: String(b._id), label: b.name }))}
                    value={boardId}
                    onChange={setBoardId}
                    placeholder={t('import.pickBoardShort', 'Choose a board…')}
                  />
                </section>
              </aside>
            </>
          )}
        </div>
      </PageBody>
    </PageWrapper>
  );
};

export default ImportPage;
