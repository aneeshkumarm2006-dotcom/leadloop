/**
 * PageHeader + PageBody — the full-width page layout (used with
 * <PageWrapper flush>).
 *
 *   <PageWrapper flush>
 *     <PageHeader eyebrow="Settings › Growth" title="Ads & tracking"
 *                 subtitle="…" actions={<Button>Save</Button>} />
 *     <PageBody>…grids…</PageBody>
 *   </PageWrapper>
 *
 * The header is a white strip across the whole content area (title, one-line
 * description, the page's main buttons on the right, optional extra row such
 * as a stepper or tabs via `children`). PageBody gives the content the shared
 * padding; pages lay content out with grids so it uses the full width.
 */

export const PAGE_PAD_X = 'px-4 md:px-10';

export const PageHeader = ({ eyebrow, title, subtitle, actions, children, className = '' }) => (
  <header
    className={['bg-surface', PAGE_PAD_X, 'pt-6 pb-5 md:pt-7', className].join(' ')}
    style={{ borderBottom: '1px solid var(--color-border)' }}
  >
    <div className="flex flex-wrap items-end gap-4 md:gap-5">
      <div className="min-w-0 flex-1" style={{ minWidth: 240 }}>
        {eyebrow ? (
          <div className="font-body text-[12.5px]" style={{ color: 'var(--color-text-secondary)' }}>
            {eyebrow}
          </div>
        ) : null}
        <h1
          className="font-display font-bold"
          style={{
            margin: eyebrow ? '6px 0 0' : 0,
            fontSize: 'clamp(26px, 2.4vw, 32px)',
            letterSpacing: '-0.02em',
            lineHeight: 1.1,
            color: 'var(--color-text-primary)',
          }}
        >
          {title}
        </h1>
        {subtitle ? (
          <p
            className="font-body"
            style={{ margin: '6px 0 0', fontSize: 15, lineHeight: 1.5, color: 'var(--color-text-secondary)', maxWidth: 860 }}
          >
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2.5">{actions}</div> : null}
    </div>
    {children ? <div className="mt-4">{children}</div> : null}
  </header>
);

export const PageBody = ({ children, className = '', style }) => (
  <div className={[PAGE_PAD_X, 'pt-6 pb-12', className].join(' ')} style={style}>
    {children}
  </div>
);

export default PageHeader;
