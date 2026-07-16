/**
 * CellPlaceholder — muted hint text shown inside an empty, editable grid cell
 * (e.g. "Add phone", "Set date") in place of a bare dash. Keeps the cell's
 * click target obvious without implying the field already holds a value.
 */
const CellPlaceholder = ({ text }) => (
  <span
    style={{
      color: 'var(--color-text-muted)',
      opacity: 0.7,
      userSelect: 'none',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }}
  >
    {text}
  </span>
);

export default CellPlaceholder;
