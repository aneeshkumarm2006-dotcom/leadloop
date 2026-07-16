/* Shared premium primitives — Avatar, Toggle, skeleton, loading state. */
import { CRM } from './premiumData';

export const Avatar = ({ user, size = 30, ring }) => {
  const m = typeof user === 'string' ? CRM.members.find((x) => x.id === user) : user;
  if (!m) return null;
  return (
    <span
      className={'av' + (ring ? ' av-ring' : '')} title={m.name}
      style={{ width: size, height: size, background: m.color, fontSize: size * 0.4 }}
    >
      {m.initials}
    </span>
  );
};

export const Toggle = ({ on, onChange, label }) => (
  <button
    type="button" role="switch" aria-checked={on} aria-label={label}
    className={'toggle' + (on ? ' on' : '')}
    onClick={() => onChange && onChange(!on)}
  >
    <i />
  </button>
);

export const Sk = ({ w, h = 12, style }) => (
  <div className="sk" style={{ width: w, height: h, ...style }} />
);

export const LoadingState = ({ rows = 4 }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="card card-pad" style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        <div className="sk" style={{ width: 40, height: 40, borderRadius: 11, flex: '0 0 auto' }} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Sk w={`${50 + ((i * 9) % 35)}%`} h={13} />
          <Sk w={`${30 + ((i * 7) % 25)}%`} h={11} />
        </div>
        <div className="sk" style={{ width: 60, height: 26, borderRadius: 99, flex: '0 0 auto' }} />
      </div>
    ))}
  </div>
);
