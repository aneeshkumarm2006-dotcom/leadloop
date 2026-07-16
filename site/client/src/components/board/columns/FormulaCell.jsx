import { cellWrapperStyle } from './cellShared';

/**
 * FormulaCell — read-only. The server computes the value when the task is
 * loaded; if the value isn't present we show "—". v1 doesn't recompute
 * client-side; the next refetch picks up changes.
 */
const FormulaCell = ({ value }) => (
  <div style={{ ...cellWrapperStyle, justifyContent: 'flex-end', color: 'var(--color-text-secondary)' }}>
    {value == null || value === '' ? (
      <span style={{ color: 'var(--color-text-muted)' }}>—</span>
    ) : (
      <span>{Number(value).toLocaleString?.() ?? String(value)}</span>
    )}
  </div>
);

export default FormulaCell;
