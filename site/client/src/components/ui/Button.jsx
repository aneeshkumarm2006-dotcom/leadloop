import { forwardRef } from 'react';

/**
 * Button — reusable button component matching Macan design system.
 * Variants: primary (blue fill) | secondary (outlined) | ghost (text) | danger (red fill)
 * Sizes:    sm (32px) | default (38px) | lg (44px)
 *
 * See Macan_Design.md Section 6.3.
 */

const SIZE_STYLES = {
  sm:      { height: 32, padding: '0 12px', fontSize: 13 },
  default: { height: 38, padding: '0 18px', fontSize: 14 },
  lg:      { height: 44, padding: '0 22px', fontSize: 15 },
};

const VARIANT_STYLES = {
  primary: {
    background: 'var(--color-accent)',
    color: '#FFFFFF',
    border: 'none',
    fontWeight: 600,
    boxShadow: '0 1px 2px rgba(29,30,38,.12)',
  },
  secondary: {
    background: 'var(--color-bg-surface)',
    color: 'var(--color-text-primary)',
    border: '1px solid var(--color-border-strong)',
    fontWeight: 600,
    boxShadow: '0 1px 2px rgba(29,30,38,.04)',
  },
  ghost: {
    background: 'transparent',
    color: 'var(--color-accent)',
    border: 'none',
    fontWeight: 600,
  },
  danger: {
    background: 'var(--color-status-stuck-solid)',
    color: '#FFFFFF',
    border: 'none',
    fontWeight: 600,
    boxShadow: '0 1px 2px rgba(29,30,38,.12)',
  },
};

const hoverClassByVariant = {
  primary: 'hover:bg-accent-hover',
  secondary: 'hover:bg-[color:var(--color-bg-subtle)]',
  ghost: 'hover:bg-[color:var(--color-accent-light)]',
  danger: 'hover:bg-[#B91C1C]',
};

const Button = forwardRef(function Button(
  {
    variant = 'primary',
    size = 'default',
    icon: Icon,
    iconPosition = 'left',
    children,
    className = '',
    disabled = false,
    type = 'button',
    onClick,
    ...rest
  },
  ref,
) {
  const sizeStyles = SIZE_STYLES[size] || SIZE_STYLES.default;
  const variantStyles = VARIANT_STYLES[variant] || VARIANT_STYLES.primary;
  const hoverClass = hoverClassByVariant[variant] || '';

  // Ghost uses smaller padding + slightly smaller radius per Design Section 6.3
  const radius =
    variant === 'ghost' ? 'var(--radius-sm)' : 'var(--radius-md)';

  const ghostOverride =
    variant === 'ghost'
      ? { height: size === 'sm' ? 28 : 32, padding: '0 12px' }
      : {};

  return (
    <button
      ref={ref}
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={[
        'inline-flex items-center justify-center gap-2 font-body whitespace-nowrap select-none',
        'transition-[background-color,box-shadow,transform] duration-150 ease-[cubic-bezier(.22,.61,.36,1)]',
        'active:scale-[.97]',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]',
        'disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100',
        !disabled && hoverClass,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        ...sizeStyles,
        ...variantStyles,
        ...ghostOverride,
        borderRadius: radius,
        cursor: disabled ? 'not-allowed' : 'pointer',
        lineHeight: 1,
      }}
      {...rest}
    >
      {Icon && iconPosition === 'left' && <Icon size={16} aria-hidden="true" />}
      {children}
      {Icon && iconPosition === 'right' && <Icon size={16} aria-hidden="true" />}
    </button>
  );
});

export default Button;
