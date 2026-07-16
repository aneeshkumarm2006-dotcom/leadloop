import { Check } from 'lucide-react';
import { cellWrapperStyle } from './cellShared';

const CheckboxCell = ({ value, readOnly, onChange }) => {
  const checked = !!value;
  return (
    <div
      style={{ ...cellWrapperStyle, justifyContent: 'center', cursor: readOnly ? 'default' : 'pointer' }}
      onClick={() => !readOnly && onChange?.(!checked)}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 18,
          height: 18,
          borderRadius: 'var(--radius-sm)',
          border: '1.5px solid var(--color-border)',
          background: checked ? 'var(--color-accent)' : 'transparent',
        }}
        aria-checked={checked}
        role="checkbox"
      >
        {checked && <Check size={12} color="#fff" />}
      </span>
    </div>
  );
};

export default CheckboxCell;
