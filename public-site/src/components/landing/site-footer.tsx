const productLinks = [
  { href: "#board", label: "The board" },
  { href: "#visits", label: "Visit booking" },
  { href: "#automations", label: "Automations" },
  { href: "#attribution", label: "Attribution" },
]

const contactLinks = [
  { href: "mailto:hello@leadloop.ca", label: "hello@leadloop.ca" },
  { href: "#demo", label: "Book a demo" },
]

const footLink =
  "text-[13.5px] text-clay-2 transition-colors hover:text-forest"
const colTitle =
  "font-mono text-[9px] uppercase tracking-[0.12em] text-taupe-2"

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-cream">
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-start justify-between gap-8 px-[clamp(24px,4vw,56px)] pt-10 pb-6">
        <div>
          <span className="font-display text-[22px] font-extrabold tracking-[-0.02em]">
            LeadLoop
          </span>
          <p className="mt-2 font-mono text-[10px] uppercase leading-[2] tracking-[0.1em] text-taupe">
            Montréal, QC · EN + FR
            <br />
            Single tenant · Google sign-in
          </p>
        </div>

        <div className="flex flex-wrap gap-[clamp(28px,4vw,56px)]">
          <div className="flex flex-col gap-2.5">
            <span className={colTitle}>Product</span>
            {productLinks.map((link) => (
              <a key={link.href} href={link.href} className={footLink}>
                {link.label}
              </a>
            ))}
          </div>
          <div className="flex flex-col gap-2.5">
            <span className={colTitle}>Contact</span>
            {contactLinks.map((link) => (
              <a key={link.label} href={link.href} className={footLink}>
                {link.label}
              </a>
            ))}
          </div>
        </div>
      </div>

      <div className="border-t border-line-2">
        <div className="mx-auto flex max-w-[1180px] flex-wrap justify-between gap-4 px-[clamp(24px,4vw,56px)] py-4 font-mono text-[9px] uppercase tracking-[0.1em] text-taupe-2">
          <span>© 2026 LeadLoop</span>
          <span>The wordmark never translates</span>
        </div>
      </div>
    </footer>
  )
}
