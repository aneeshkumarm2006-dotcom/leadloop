import type { Metadata } from "next"

import { LEGAL, LegalPage } from "@/components/legal/legal-page"

export const metadata: Metadata = {
  title: "Privacy Policy — LeadLoop",
  description:
    "How LeadLoop collects, uses, shares and protects personal information, including data from connected Meta, Google and TikTok accounts.",
}

const toc = [
  { id: "who-we-are", label: "Who we are" },
  { id: "roles", label: "Our role and yours" },
  { id: "what-we-collect", label: "What we collect" },
  { id: "ad-platforms", label: "Meta, Google and TikTok data" },
  { id: "how-we-use", label: "How we use information" },
  { id: "sharing", label: "Who we share it with" },
  { id: "website-tag", label: "The LeadLoop website tag" },
  { id: "retention", label: "How long we keep it" },
  { id: "security", label: "Security" },
  { id: "transfers", label: "Where data is stored" },
  { id: "your-rights", label: "Your rights" },
  { id: "children", label: "Children" },
  { id: "changes", label: "Changes" },
  { id: "contact", label: "Contact us" },
]

export default function PrivacyPage() {
  const mail = `mailto:${LEGAL.email}`
  return (
    <LegalPage
      eyebrow="Legal · Privacy"
      title="Privacy Policy"
      toc={toc}
      intro={
        <p>
          LeadLoop is a lead-management and leasing CRM for property and sales
          teams. This policy explains what personal information we handle, why,
          who we share it with, and the choices you have. It applies to our
          website, the LeadLoop app, and the integrations you connect to it.
        </p>
      }
    >
      <h2 id="who-we-are">1. Who we are</h2>
      <p>
        LeadLoop (&ldquo;LeadLoop&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;)
        is based in {LEGAL.location}. You can reach us, including our person in
        charge of the protection of personal information, at{" "}
        <a href={mail}>{LEGAL.email}</a>.
      </p>

      <h2 id="roles">2. Our role and yours</h2>
      <p>
        When a business (&ldquo;Customer&rdquo;) uses LeadLoop, it decides
        whose information goes into its workspace: its leads, contacts,
        tenants and buyers. For that information the Customer is responsible
        for having a lawful basis and giving any notices required, and LeadLoop
        processes it <strong>on the Customer&rsquo;s behalf and only on its
        instructions</strong>. If you are a lead or contact of one of our
        Customers and want to access or delete your information, please
        contact that business; we will help them respond.
      </p>
      <p>
        For information about our own users (people who sign up for and use
        LeadLoop) and visitors to our website, LeadLoop is responsible.
      </p>

      <h2 id="what-we-collect">3. What we collect</h2>
      <h3>Account information</h3>
      <ul>
        <li>Name, email address, password (stored only as a secure hash) and workspace details.</li>
        <li>If you sign in with Google: your name, email address and profile picture from your Google account.</li>
        <li>Billing details handled by our payment processor (Stripe). We do not store full card numbers.</li>
      </ul>
      <h3>Customer content</h3>
      <ul>
        <li>Leads, contacts, boards, notes, tasks, bookings, files and other content you add or import.</li>
        <li>Leads that arrive from your website forms, ad lead forms, email, SMS, WhatsApp, Zapier or other sources you connect.</li>
        <li>Messages sent and received through connected mailboxes (Gmail, Microsoft 365), SMS and WhatsApp, when you choose to connect them.</li>
      </ul>
      <h3>Website and lead-form visitors (on Customers&rsquo; sites)</h3>
      <p>
        When a Customer installs the LeadLoop website tag, it collects what a
        visitor types into a form, the page address, ad click identifiers
        (such as <code>gclid</code>, <code>fbclid</code>, <code>ttclid</code>),
        campaign parameters, IP address, browser user agent and whether the
        visitor agreed to their information being used for advertising
        measurement. See <a href="#website-tag">section 7</a>.
      </p>
      <h3>Usage and device information</h3>
      <ul>
        <li>Log data such as IP address, browser type, pages viewed and timestamps, used to run and secure the service.</li>
        <li>Push-notification subscriptions if you turn on notifications on a device.</li>
      </ul>

      <h2 id="ad-platforms">4. Meta, Google and TikTok data</h2>
      <p>
        You can connect your Meta (Facebook and Instagram), Google Ads and
        TikTok for Business accounts to LeadLoop. You sign in with the
        platform directly; we never see your password. Depending on what you
        approve, we receive:
      </p>
      <table>
        <thead>
          <tr>
            <th>Platform</th>
            <th>What we access</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Meta</td>
            <td>Your name and Facebook user ID; the business portfolios, ad accounts, pixels/datasets and Pages you choose; leads submitted to your Lead Ads forms.</td>
            <td>To let you pick where results are sent, create a pixel if you ask us to, bring Lead Ads leads into your board, and send qualified-lead and customer events back to your chosen pixel.</td>
          </tr>
          <tr>
            <td>Google</td>
            <td>Your email address; the Google Ads accounts you can access and their basic settings; conversion actions; and, only if you choose the Tag Manager option, your Tag Manager accounts and containers.</td>
            <td>To create LeadLoop conversion actions, turn on auto-tagging, upload offline conversions for qualified leads, and publish the LeadLoop tag to your site through Tag Manager when you ask us to.</td>
          </tr>
          <tr>
            <td>TikTok</td>
            <td>Your display name; the Business Centers, advertiser accounts and pixels you choose; leads from your Instant Forms.</td>
            <td>To create a pixel if you ask, bring Instant Form leads into your board, and send qualified-lead and customer events back to TikTok.</td>
          </tr>
        </tbody>
      </table>
      <p>
        Access tokens from these platforms are encrypted at rest and are never
        shown in the app. We use platform data <strong>only to provide the
        features you turned on</strong>. We do not sell it, use it for
        advertising of our own, use it to build profiles across Customers, or
        let humans read it except where you ask us for support, where it is
        needed for security or legal reasons, or in aggregated, anonymised
        form for running the service.
      </p>
      <p>
        <strong>Google API Services.</strong> LeadLoop&rsquo;s use and transfer
        of information received from Google APIs adheres to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>
      <p>
        <strong>Sending results back.</strong> When a lead reaches a stage you
        mark as &ldquo;Qualified&rdquo; or &ldquo;Customer&rdquo;, LeadLoop
        can send that event to the platforms you connected. Contact details
        (email, phone, name) are converted to an irreversible SHA-256 hash
        before they are sent, together with ad click identifiers. Events are
        only sent for leads whose ad-measurement consent was recorded.
      </p>
      <p>
        You can disconnect any platform at any time in{" "}
        <strong>Settings → Ads &amp; tracking</strong>, and remove LeadLoop from
        the platform&rsquo;s own settings. See our{" "}
        <a href="/data-deletion">data deletion instructions</a>.
      </p>

      <h2 id="how-we-use">5. How we use information</h2>
      <ul>
        <li>To provide, maintain and improve LeadLoop and the features you turn on.</li>
        <li>To route, de-duplicate and display leads, run your automations, sequences and reminders, and send the messages you ask us to send.</li>
        <li>To report qualified leads back to connected ad platforms, as described above.</li>
        <li>To secure the service: detect abuse, spam and fraud, and keep audit logs.</li>
        <li>To communicate with you about your account, billing, security and product changes.</li>
        <li>To comply with law and enforce our <a href="/terms">Terms of Service</a>.</li>
      </ul>
      <p>We do not sell personal information.</p>

      <h2 id="sharing">6. Who we share it with</h2>
      <p>
        We use service providers who process data for us under contracts that
        require them to protect it and use it only to provide their service:
      </p>
      <ul>
        <li>Cloud hosting and databases (application hosting and a managed database).</li>
        <li>File storage (Cloudinary) for uploads.</li>
        <li>Email delivery (Resend) for transactional and workspace email.</li>
        <li>Payments (Stripe).</li>
        <li>Messaging providers you connect, such as Twilio for SMS and WhatsApp.</li>
        <li>Ad platforms you connect (Meta, Google, TikTok), only for the events and requests described in section 4.</li>
        <li>AI providers, only if you add your own AI key and use AI-assisted features.</li>
      </ul>
      <p>
        We may also disclose information if required by law or to protect
        rights, safety and the integrity of the service, or as part of a
        merger or acquisition, subject to this policy.
      </p>

      <h2 id="website-tag">7. The LeadLoop website tag</h2>
      <p>
        Customers can add a single LeadLoop script to their website. It
        captures form submissions as leads, remembers ad click identifiers
        from the landing page, and, if the Customer turns it on, loads the
        Customer&rsquo;s own Meta Pixel, Google tag and TikTok Pixel. It also
        tells LeadLoop which pages it is active on so the Customer can confirm
        it is installed. The Customer operating the website is responsible for
        its own cookie and privacy notices and for obtaining any consent
        required where its visitors are located.
      </p>

      <h2 id="retention">8. How long we keep it</h2>
      <ul>
        <li>Account and Customer content: for as long as the workspace is active.</li>
        <li>After a workspace is closed or deletion is requested: deleted within 30 days, and removed from backups within a further 30 days.</li>
        <li>Ad-platform access tokens: deleted immediately when you disconnect the platform.</li>
        <li>Records we must keep for legal, tax or accounting reasons: for the period the law requires.</li>
      </ul>

      <h2 id="security">9. Security</h2>
      <p>
        We use encryption in transit (HTTPS) and encrypt sensitive credentials
        such as platform access tokens at rest. Access is limited to
        workspace members, with admin-only controls for integrations. No
        system is perfectly secure; if we become aware of a breach affecting
        your information we will notify you and the authorities as the law
        requires.
      </p>

      <h2 id="transfers">10. Where data is stored</h2>
      <p>
        We are based in Canada and our service providers may store or process
        information in other countries, including the United States. Where
        information leaves Québec or Canada we assess and contractually
        require protection comparable to what applicable law requires.
      </p>

      <h2 id="your-rights">11. Your rights</h2>
      <p>
        Depending on where you live (for example under Canada&rsquo;s PIPEDA,
        Québec&rsquo;s Law 25, the GDPR or US state privacy laws), you may have
        the right to access, correct, delete or receive a copy of your
        personal information, to withdraw consent, and to complain to a
        privacy regulator such as the Commission d&rsquo;accès à
        l&rsquo;information du Québec or the Office of the Privacy
        Commissioner of Canada. Email <a href={mail}>{LEGAL.email}</a> and we
        will respond within 30 days. If your information is in a
        Customer&rsquo;s workspace, see <a href="#roles">section 2</a>.
      </p>

      <h2 id="children">12. Children</h2>
      <p>LeadLoop is a business tool and is not directed to children under 16.</p>

      <h2 id="changes">13. Changes</h2>
      <p>
        We will post any changes on this page and update the effective date.
        If a change is significant we will tell account owners by email or in
        the app before it takes effect.
      </p>

      <h2 id="contact">14. Contact us</h2>
      <p>
        Questions or requests: <a href={mail}>{LEGAL.email}</a>
        <br />
        LeadLoop · {LEGAL.location}
      </p>
    </LegalPage>
  )
}
