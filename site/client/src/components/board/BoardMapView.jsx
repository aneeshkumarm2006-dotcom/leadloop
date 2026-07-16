import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin } from 'lucide-react';
import Dropdown from '../ui/Dropdown';

/**
 * BoardMapView — a board-scoped map view tab. Plots leads/properties by a chosen
 * `location` column (value shape `{ lat, lng, label }`). No geocoding needed —
 * coordinates are stored on the column. Clicking a pin opens that lead.
 */

// Default fallback center — Montréal, QC (matches the FR-QC real-estate context).
const DEFAULT_CENTER = [45.5019, -73.5674];

// A premium teardrop pin via inline SVG; `var(--color-accent)` resolves in DOM.
const pinIcon = () =>
  L.divIcon({
    className: 'crm-map-pin',
    html:
      '<svg width="28" height="38" viewBox="0 0 28 38" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M14 0C6.27 0 0 6.27 0 14c0 9.86 12.07 22.3 13.2 23.43a1.13 1.13 0 0 0 1.6 0C15.93 36.3 28 23.86 28 14 28 6.27 21.73 0 14 0z" ' +
      'fill="var(--color-accent)" stroke="white" stroke-width="1.5"/>' +
      '<circle cx="14" cy="14" r="5" fill="white"/></svg>',
    iconSize: [28, 38],
    iconAnchor: [14, 38],
    popupAnchor: [0, -34],
  });

/** Fit the viewport to the plotted points whenever they change. */
const FitBounds = ({ points }) => {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 13);
      return;
    }
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 15 });
  }, [points, map]);
  return null;
};

const readLoc = (task, colId) => {
  const v = task && task.columnValues ? task.columnValues[String(colId)] : undefined;
  if (v && typeof v === 'object' && typeof v.lat === 'number' && typeof v.lng === 'number') {
    return { lat: v.lat, lng: v.lng, label: typeof v.label === 'string' ? v.label : '' };
  }
  return null;
};

const BoardMapView = ({ board, tasks = [], onOpenTask }) => {
  const { t } = useTranslation();

  const locationColumns = useMemo(
    () => (board?.columns || []).filter((c) => c.type === 'location'),
    [board]
  );
  const options = useMemo(
    () => locationColumns.map((c) => ({ value: String(c._id), label: c.name })),
    [locationColumns]
  );
  const [colId, setColId] = useState(options[0]?.value || '');

  // Keep the selection valid if columns change.
  useEffect(() => {
    if (options.length && !options.some((o) => o.value === colId)) setColId(options[0].value);
  }, [options, colId]);

  const points = useMemo(() => {
    if (!colId) return [];
    return (tasks || [])
      .map((task) => {
        const loc = readLoc(task, colId);
        return loc ? { ...loc, task } : null;
      })
      .filter(Boolean);
  }, [tasks, colId]);

  const icon = useMemo(() => pinIcon(), []);

  // No location column on the board → guide the user to add one.
  if (locationColumns.length === 0) {
    return (
      <div
        className="mt-5"
        style={{
          textAlign: 'center', padding: '64px 20px', border: '1px dashed var(--color-border)',
          borderRadius: 'var(--radius-lg)', background: 'var(--color-bg-surface)',
        }}
      >
        <MapPin size={32} color="var(--color-text-muted)" style={{ margin: '0 auto 12px' }} />
        <div className="font-display" style={{ fontSize: 17, fontWeight: 600, marginBottom: 6 }}>
          {t('map.noColumnTitle')}
        </div>
        <div className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          {t('map.noColumnBody')}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-5 flex flex-col gap-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          {options.length > 1 && (
            <>
              <span className="font-body" style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                {t('map.plotBy')}
              </span>
              <div style={{ width: 200 }}>
                <Dropdown size="sm" options={options} value={colId} onChange={setColId} />
              </div>
            </>
          )}
        </div>
        <span className="font-body" style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>
          {t('map.pinnedCount', { n: points.length })}
        </span>
      </div>

      <div
        style={{
          position: 'relative', borderRadius: 'var(--radius-lg)', overflow: 'hidden',
          border: '1px solid var(--color-border)',
        }}
      >
        <MapContainer
          center={points[0] ? [points[0].lat, points[0].lng] : DEFAULT_CENTER}
          zoom={points.length ? 12 : 10}
          scrollWheelZoom
          style={{ height: '68vh', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitBounds points={points} />
          {points.map((p) => (
            <Marker key={p.task._id} position={[p.lat, p.lng]} icon={icon}>
              <Popup>
                <div className="font-body" style={{ minWidth: 160 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>{p.task.name || '—'}</div>
                  {p.label && (
                    <div style={{ fontSize: 12, color: '#6B665C', marginBottom: 8 }}>{p.label}</div>
                  )}
                  <button
                    type="button"
                    onClick={() => onOpenTask?.(p.task)}
                    style={{
                      fontSize: 12, fontWeight: 600, color: 'var(--color-accent)',
                      background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
                    }}
                  >
                    {t('map.openLead')} →
                  </button>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>

        {points.length === 0 && (
          <div
            className="font-body"
            style={{
              position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 1000,
              background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)',
              borderRadius: 999, padding: '7px 16px', fontSize: 12.5, color: 'var(--color-text-secondary)',
              boxShadow: 'var(--color-shadow-md, 0 4px 12px rgba(0,0,0,0.08))',
            }}
          >
            {t('map.noPins')}
          </div>
        )}
      </div>
    </div>
  );
};

export default BoardMapView;
