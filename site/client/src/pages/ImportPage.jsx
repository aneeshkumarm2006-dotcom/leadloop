import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Upload, ArrowRight, Check, AlertTriangle, FileSpreadsheet } from 'lucide-react';
import PageWrapper from '../components/layout/PageWrapper';
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
  background: 'var(--color-bg-surface, #fff)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
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

  return (
    <PageWrapper>
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '4px 2px 40px' }}>
        <div className="flex items-center gap-3" style={{ marginBottom: 6 }}>
          <span className="inline-flex items-center justify-center" style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--color-accent-light, #EEF3EA)', color: 'var(--color-accent)' }}>
            <FileSpreadsheet size={18} />
          </span>
          <h1 className="font-heading" style={{ fontSize: 24, fontWeight: 800, color: 'var(--color-text-primary)' }}>
            {t('import.title', 'Import leads')}
          </h1>
        </div>
        <p className="font-body" style={{ fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 20, maxWidth: 620 }}>
          {t('import.subtitle', 'Bring your contacts across from another CRM or a spreadsheet. We match the columns for you — check them before anything is created.')}
        </p>

        {/* Done */}
        {result ? (
          <div style={{ ...card, padding: 22 }}>
            <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
              <Check size={18} style={{ color: 'var(--color-status-done)' }} />
              <h2 className="font-heading" style={{ fontSize: 17, fontWeight: 750 }}>
                {t('import.doneTitle', '{{n}} leads imported', { n: result.created })}
              </h2>
            </div>
            <p className="font-body" style={{ fontSize: 13.5, color: 'var(--color-text-muted)' }}>
              {t('import.doneBody', '{{skipped}} already existed and were skipped. {{failed}} could not be read.', {
                skipped: result.skipped,
                failed: result.failed,
              })}
            </p>
            <div className="flex items-center gap-2" style={{ marginTop: 16 }}>
              <Button variant="primary" onClick={() => navigate(`/boards/${boardId}`)}>
                {t('import.viewBoard', 'Open the board')}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setResult(null);
                  setPreview(null);
                  setCsv('');
                  setFileName('');
                }}
              >
                {t('import.another', 'Import another file')}
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* Step 1 — board + file */}
            <div style={{ ...card, padding: 18, marginBottom: 16 }}>
              <div style={{ maxWidth: 300, marginBottom: 14 }}>
                <Dropdown
                  label={t('import.board', 'Import into board')}
                  options={boards.map((b) => ({ value: String(b._id), label: b.name }))}
                  value={boardId}
                  onChange={setBoardId}
                  placeholder={t('import.pickBoardShort', 'Choose a board…')}
                />
              </div>

              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                style={{ display: 'none' }}
                onChange={(e) => onFile(e.target.files?.[0])}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={!boardId || busy}
                className="w-full"
                style={{
                  padding: '26px 18px',
                  borderRadius: 'var(--radius-md)',
                  border: '2px dashed var(--color-border-strong)',
                  background: 'var(--color-bg-input, #FCFAF4)',
                  cursor: boardId ? 'pointer' : 'default',
                  textAlign: 'center',
                }}
              >
                <Upload size={20} style={{ color: 'var(--color-accent)' }} />
                <div className="font-heading" style={{ fontSize: 14, fontWeight: 700, marginTop: 8, color: 'var(--color-text-primary)' }}>
                  {fileName || t('import.choose', 'Choose a CSV file')}
                </div>
                <div className="font-body" style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: 2 }}>
                  {t('import.exportHint', 'Export from your current CRM as CSV — commas, semicolons and tabs all work.')}
                </div>
              </button>
            </div>

            {error && (
              <p className="font-body" style={{ fontSize: 13, color: 'var(--color-status-stuck)', marginBottom: 14 }}>
                {error}
              </p>
            )}

            {/* Step 2 — mapping */}
            {preview && (
              <div style={{ ...card, padding: 18 }}>
                <div className="flex items-center justify-between gap-3 flex-wrap" style={{ marginBottom: 14 }}>
                  <div>
                    <h2 className="font-heading" style={{ fontSize: 15.5, fontWeight: 750 }}>
                      {t('import.matchTitle', 'Match your columns')}
                    </h2>
                    <p className="font-body" style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>
                      {t('import.matchBody', 'We guessed these from your file. Change anything that looks wrong.')}
                    </p>
                  </div>
                  <span className="font-body" style={{ fontSize: 11.5, fontWeight: 700, padding: '4px 10px', borderRadius: 20, background: 'var(--color-status-done-bg, #E9F1E6)', color: 'var(--color-status-done)' }}>
                    {t('import.matchedN', '{{n}} of {{total}} matched', { n: matched, total: mapping.length })}
                  </span>
                </div>

                {mapping.map((m, i) => (
                  <div
                    key={m.header}
                    className="grid items-center"
                    style={{ gridTemplateColumns: '1fr 26px 1fr', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}
                  >
                    <div
                      className="font-mono"
                      style={{ fontSize: 12.5, padding: '8px 10px', borderRadius: 8, background: 'var(--color-bg-subtle)', color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {m.header}
                    </div>
                    <ArrowRight size={14} style={{ color: 'var(--color-text-muted)', justifySelf: 'center' }} />
                    <Dropdown
                      size="sm"
                      options={columnOptions}
                      value={m.columnId || ''}
                      onChange={(v) =>
                        setMapping((prev) => prev.map((x, idx) => (idx === i ? { ...x, columnId: v || null } : x)))
                      }
                    />
                  </div>
                ))}

                {/* Existing rows */}
                {preview.duplicateCount > 0 && (
                  <div
                    className="flex items-start gap-2"
                    style={{ marginTop: 16, padding: '11px 13px', borderRadius: 'var(--radius-md)', background: 'var(--color-status-working-bg, #FBF2DE)' }}
                  >
                    <AlertTriangle size={15} style={{ color: 'var(--color-status-working)', marginTop: 2, flexShrink: 0 }} />
                    <div>
                      <div className="font-heading" style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                        {t('import.dupTitle', '{{n}} rows already exist', { n: preview.duplicateCount })}
                      </div>
                      <label className="flex items-center gap-2" style={{ marginTop: 6, fontSize: 12.5, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
                        <input type="checkbox" checked={skipExisting} onChange={(e) => setSkipExisting(e.target.checked)} />
                        {t('import.skipExisting', 'Skip them and import only the {{n}} new leads', { n: preview.newCount })}
                      </label>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between gap-3 flex-wrap" style={{ marginTop: 16 }}>
                  <div style={{ width: 220 }}>
                    <Dropdown
                      size="sm"
                      label={t('import.landing', 'Landing stage')}
                      options={(preview.groups || []).map((g) => ({ value: String(g._id), label: g.name }))}
                      value={groupId}
                      onChange={setGroupId}
                    />
                  </div>
                  <Button variant="primary" onClick={doImport} disabled={busy}>
                    {busy
                      ? t('import.importing', 'Importing…')
                      : t('import.run', 'Import {{n}} leads', {
                          n: skipExisting ? preview.newCount : preview.totalRows,
                        })}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </PageWrapper>
  );
};

export default ImportPage;
