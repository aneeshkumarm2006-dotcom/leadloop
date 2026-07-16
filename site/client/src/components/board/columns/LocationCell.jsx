import { useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import { focusedInputStyle, cellWrapperStyle } from './cellShared';
import CellPlaceholder from './CellPlaceholder';

/**
 * LocationCell — value: { lat, lng, label }. Label is the user-typed name;
 * lat/lng come from `navigator.geolocation` when the user clicks "Pin".
 * No reverse-geocoding in v1.
 */
const LocationCell = ({ value, readOnly, onChange }) => {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(value?.label || '');
  const ref = useRef(null);

  useEffect(() => setLabel(value?.label || ''), [value]);
  useEffect(() => {
    if (editing && ref.current) ref.current.focus();
  }, [editing]);

  const commit = () => {
    const next = { ...(value || {}), label: label.trim() };
    if (!next.label && next.lat == null) {
      if (value) onChange?.(null);
    } else if (JSON.stringify(next) !== JSON.stringify(value || {})) {
      onChange?.(next);
    }
    setEditing(false);
  };

  const pin = (e) => {
    e.stopPropagation();
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onChange?.({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          label: label.trim() || (value?.label || ''),
        });
      },
      (err) => console.warn('geolocation failed', err)
    );
  };

  if (readOnly || !editing) {
    return (
      <div
        style={{ ...cellWrapperStyle, gap: 6, cursor: readOnly ? 'default' : 'text' }}
        onClick={() => !readOnly && setEditing(true)}
      >
        {value ? (
          <>
            <MapPin size={12} aria-hidden="true" />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {value.label || `${value.lat?.toFixed(3)}, ${value.lng?.toFixed(3)}`}
            </span>
          </>
        ) : !readOnly ? (
          <CellPlaceholder text="Add location" />
        ) : null}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 4, padding: 4 }}>
      <input
        ref={ref}
        type="text"
        placeholder="Address or place"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setEditing(false);
        }}
        style={focusedInputStyle}
      />
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={pin}
        title="Use my current location"
        style={{
          padding: '0 8px',
          fontSize: 11,
          background: 'var(--color-accent)',
          color: '#fff',
          border: 'none',
          borderRadius: 'var(--radius-sm)',
          cursor: 'pointer',
        }}
      >
        Pin
      </button>
    </div>
  );
};

export default LocationCell;
