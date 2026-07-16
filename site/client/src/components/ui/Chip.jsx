import { forwardRef } from 'react';
import {
  STATUS_COLORS,
  PRIORITY_COLORS,
  getStatusPalette,
  getLabelPalette,
} from '../../utils/priorityColors';

/**
 * Chip — status (pill) or priority (rounded-sm) label.
 *
 * Props:
 *   type:  'status' | 'priority' | 'label'
 *   value: priority key, status id/legacy-key, or label id
 *   board: optional board doc (required for `status` and `label` types when
 *          the value is an ObjectId). Falls back to the legacy STATUS_COLORS
 *          palette for status when board is omitted (e.g. personal tasks).
 *   label: optional override label
 *   onClick: optional — makes the chip clickable
 */
const Chip = forwardRef(function Chip(
  {
    type = 'status',
    value,
    board,
    label: labelOverride,
    onClick,
    solid = false,
    dot = false,
    className = '',
    ...rest
  },
  ref,
) {
  let bg;
  let text;
  let solidColor;
  let label;

  if (type === 'priority') {
    const entry = PRIORITY_COLORS[value] || PRIORITY_COLORS.low;
    bg = entry.bg;
    text = entry.text;
    solidColor = entry.solid;
    label = labelOverride ?? entry.label;
  } else if (type === 'label') {
    const pal = getLabelPalette(board, value);
    bg = pal.bg;
    text = pal.text;
    solidColor = pal.solid;
    label = labelOverride ?? pal.label;
  } else {
    // status
    if (board) {
      const pal = getStatusPalette(board, value);
      bg = pal.bg;
      text = pal.text;
      solidColor = pal.solid;
      label = labelOverride ?? pal.label;
    } else {
      const entry =
        STATUS_COLORS[value] || STATUS_COLORS.not_started;
      bg = entry.bg;
      text = entry.text;
      solidColor = entry.solid;
      label = labelOverride ?? entry.label;
    }
  }

  const isClickable = typeof onClick === 'function';
  const radius = 'var(--radius-full)';

  const Tag = isClickable ? 'button' : 'span';

  // Solid (Monday status-cell) vs. pastel pill
  const surface = solid
    ? { backgroundColor: solidColor, color: '#fff', boxShadow: 'none' }
    : {
        backgroundColor: bg,
        color: text,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${solidColor} 22%, transparent)`,
      };

  return (
    <Tag
      ref={ref}
      type={isClickable ? 'button' : undefined}
      onClick={onClick}
      className={[
        'inline-flex items-center gap-1.5 font-body font-semibold text-[12px] leading-none',
        'whitespace-nowrap select-none align-middle',
        isClickable
          ? 'cursor-pointer transition-[transform,filter] duration-150 hover:brightness-[1.03] active:scale-[.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]'
          : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        ...surface,
        borderRadius: radius,
        padding: '4px 11px',
        border: 'none',
      }}
      {...rest}
    >
      {dot && (
        <span
          aria-hidden="true"
          className="inline-block rounded-full shrink-0"
          style={{
            width: 6,
            height: 6,
            background: solid ? 'rgba(255,255,255,.9)' : solidColor,
          }}
        />
      )}
      {label}
    </Tag>
  );
});

export default Chip;
