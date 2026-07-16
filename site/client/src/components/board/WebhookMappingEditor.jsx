import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Wand2, Check, X } from 'lucide-react';
import Button from '../ui/Button';

/**
 * WebhookMappingEditor — build the inbound `{ [columnId]: jsonPath }` mapping.
 *
 * Paste a sample JSON payload; the editor flattens it to leaf paths and offers
 * each board column a picker (or a free-text path) so you bind external fields
 * onto columns. "Test mapping" dry-runs the saved mapping against the pasted
 * sample server-side (no task created) and shows which paths resolved.
 *
 * Props:
 *   - board     : { columns: [{ _id, name, type }] }
 *   - endpoint  : the inbound WebhookEndpoint ({ _id, mapping })
 *   - onSave    : (mappingObj) => Promise   — persists the mapping
 *   - onTest    : (sampleObj)  => Promise<{ columnValues, missing }>
 */

/** Flatten an object/array to dotted + bracketed leaf paths. */
const flattenPaths = (value, prefix = '', out = []) => {
  if (value == null) return out;
  if (Array.isArray(value)) {
    value.forEach((v, i) => flattenPaths(v, `${prefix}[${i}]`, out));
  } else if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const next = prefix ? `${prefix}.${k}` : k;
      if (v != null && typeof v === 'object') flattenPaths(v, next, out);
      else out.push(next);
    }
  } else if (prefix) {
    out.push(prefix);
  }
  return out;
};

const labelStyle = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--color-text-secondary)',
};

const inputStyle = {
  height: 34,
  padding: '0 10px',
  borderRadius: 'var(--radius-md)',
  border: '1.5px solid var(--color-border)',
  background: 'var(--color-bg-input)',
  color: 'var(--color-text-primary)',
  fontSize: 13,
  width: '100%',
};

const WebhookMappingEditor = ({ board, endpoint, onSave, onTest }) => {
  const { t } = useTranslation();
  const columns = useMemo(
    () => (board && Array.isArray(board.columns) ? board.columns : []),
    [board]
  );

  const [sampleText, setSampleText] = useState('');
  const [parseError, setParseError] = useState(null);
  const [mapping, setMapping] = useState(() => ({ ...(endpoint?.mapping || {}) }));
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const sampleObj = useMemo(() => {
    if (!sampleText.trim()) return null;
    try {
      const parsed = JSON.parse(sampleText);
      return parsed;
    } catch {
      return undefined; // sentinel for parse error
    }
  }, [sampleText]);

  const detectedPaths = useMemo(() => {
    if (!sampleObj || typeof sampleObj !== 'object') return [];
    return flattenPaths(sampleObj);
  }, [sampleObj]);

  const handleSampleChange = (text) => {
    setSampleText(text);
    setTestResult(null);
    if (!text.trim()) {
      setParseError(null);
      return;
    }
    try {
      JSON.parse(text);
      setParseError(null);
    } catch (e) {
      setParseError(e.message);
    }
  };

  const setColumnPath = (columnId, path) => {
    setMapping((prev) => {
      const next = { ...prev };
      if (!path) delete next[columnId];
      else next[columnId] = path;
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(mapping);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!onTest || sampleObj == null || typeof sampleObj !== 'object') return;
    const result = await onTest(sampleObj);
    setTestResult(result);
  };

  const colName = (id) => columns.find((c) => String(c._id) === String(id))?.name || id;

  return (
    <div className="flex flex-col gap-4" style={{ marginTop: 12 }}>
      {/* Sample payload */}
      <div className="flex flex-col gap-1.5">
        <span style={labelStyle}>{t('automation.webhookSamplePayloadLabel')}</span>
        <textarea
          value={sampleText}
          onChange={(e) => handleSampleChange(e.target.value)}
          placeholder={'{\n  "contact": { "email": "jane@acme.co", "name": "Jane" },\n  "city": "Edmonton"\n}'}
          rows={6}
          spellCheck={false}
          className="font-mono"
          style={{
            ...inputStyle,
            height: 'auto',
            padding: 10,
            resize: 'vertical',
            fontSize: 12,
            lineHeight: 1.5,
          }}
        />
        {parseError && (
          <span style={{ fontSize: 12, color: 'var(--color-status-stuck)' }}>
            {t('automation.webhookInvalidJson', { error: parseError })}
          </span>
        )}
        {detectedPaths.length > 0 && (
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
            {t('automation.webhookFieldPathsDetected', { count: detectedPaths.length })}
          </span>
        )}
      </div>

      {/* Column → path mapping */}
      <div className="flex flex-col gap-2">
        <span style={labelStyle}>{t('automation.webhookMapFieldsLabel')}</span>
        {columns.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            {t('automation.webhookNoColumns')}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {columns.map((col) => {
              const current = mapping[String(col._id)] || '';
              const resolved = testResult?.columnValues?.[String(col._id)];
              const isMissing =
                testResult &&
                Array.isArray(testResult.missing) &&
                testResult.missing.some((m) => String(m.columnId) === String(col._id));
              return (
                <li
                  key={col._id}
                  className="flex items-center gap-3"
                  style={{
                    border: '1.5px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '8px 10px',
                  }}
                >
                  <div style={{ minWidth: 130 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                      {col.name}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block' }}>
                      {col.type}
                    </span>
                  </div>
                  <div className="flex-1 flex items-center gap-2">
                    {detectedPaths.length > 0 && (
                      <select
                        value={detectedPaths.includes(current) ? current : ''}
                        onChange={(e) => setColumnPath(String(col._id), e.target.value)}
                        style={{ ...inputStyle, width: 180 }}
                      >
                        <option value="">{t('automation.webhookPickField')}</option>
                        {detectedPaths.map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    )}
                    <input
                      type="text"
                      value={current}
                      onChange={(e) => setColumnPath(String(col._id), e.target.value)}
                      placeholder="e.g. contact.email"
                      className="font-mono"
                      style={{ ...inputStyle, fontSize: 12 }}
                    />
                  </div>
                  {testResult && (
                    <div style={{ minWidth: 80, textAlign: 'right' }}>
                      {current && isMissing ? (
                        <span title={t('automation.webhookPathUnresolvedTitle')} style={{ color: 'var(--color-status-stuck)', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                          <X size={13} /> {t('automation.webhookUnset')}
                        </span>
                      ) : resolved !== undefined ? (
                        <span title={JSON.stringify(resolved)} style={{ color: 'var(--color-status-done)', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                          <Check size={13} /> {t('automation.webhookOk')}
                        </span>
                      ) : null}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {testResult && Array.isArray(testResult.missing) && testResult.missing.length > 0 && (
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
          {t('automation.webhookUnresolvedNote', {
            columns: testResult.missing.map((m) => colName(m.columnId)).join(', '),
          })}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
          {saving ? t('automation.savingMapping') : t('automation.saveMapping')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={Wand2}
          onClick={handleTest}
          disabled={!sampleObj || typeof sampleObj !== 'object'}
        >
          {t('automation.testMapping')}
        </Button>
      </div>
    </div>
  );
};

export default WebhookMappingEditor;
