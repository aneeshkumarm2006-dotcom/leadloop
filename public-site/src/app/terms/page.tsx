import type { Metadata } from "next"

import { LEGAL, LegalPage } from "@/components/legal/legal-page"

export const metadata: Metadata = {
  title: "Terms of Service — LeadLoop",
  description: "The terms that apply when you use LeadLoop.",
}

const toc = [
  { id: "agreement", label: "The agreement" },
  { id: "accounts", label: "Accounts and workspaces" },
  { id: "your-data", label: "Your data" },
  { id: "integrations", label: "Connected platforms" },
  { id: "acceptable-use", label: "Acceptable use" },
  { id: "messaging", label: "Messaging and marketing laws" },
  { id: "fees", label: "Plans, trials and payment" },
  { id: "ip", label: "Our service" },
  { id: "availability", label: "Availability and changes" },
  { id: "termination", label: "Ending the agreement" },
  { id: "disclaimers", label: "Disclaimers" },
  { id: "liability", label: "Limitation of liability" },
  { id: "indemnity", label: "Indemnity" },
  { id: "law", label: "Governing law" },
  { id: "general", label: "General" },
]

export default function TermsPage() {
  const mail = `mailto:${LEGAL.email}`
  return (
    <LegalPage
      eyebrow="Legal · Terms"
      title="Terms of Service"
      toc={toc}
      intro={
        <p>
          These terms apply to your use of LeadLoop, the LeadLoop website, and
          any integrations you connect. By creating an account or using
          LeadLoop you agree to them.
        </p>
      }
    >
      <h2 id="agreement">1. The agreement</h2>
      <p>
        These terms form an agreement between LeadLoop (&ldquo;we&rdquo;,
        &ldquo;us&rdquo;) and the business or person using LeadLoop
        (&ldquo;you&rdquo;). If you accept them for a company, you confirm you
        are authorised to bind that company. Our{" "}
        <a href="/privacy">Privacy Policy</a> explains how we handle personal
        information and forms part of these terms.
      </p>

      <h2 id="accounts">2. Accounts and workspaces</h2>
      <ul>
        <li>You must give accurate information and keep your sign-in credentials secure.</li>
        <li>Workspace admins control who has access and which integrations are connected, and are responsible for activity in their workspace.</li>
        <li>You must be at least 18 and using LeadLoop for business purposes.</li>
        <li>Tell us promptly at <a href={mail}>{LEGAL.email}</a> if you suspect unauthorised access.</li>
      </ul>

      <h2 id="your-data">3. Your data</h2>
      <p>
        You own the content you put into LeadLoop, including your leads and
        contacts (&ldquo;Customer Data&rdquo;). You give us permission to host,
        process and transmit Customer Data only as needed to provide LeadLoop
        to you, to keep it secure, and as the law requires. We process
        personal information in Customer Data on your behalf and on your
        instructions.
      </p>
      <p>
        You are responsible for having the right to collect and use the
        personal information you put into LeadLoop, including giving the
        notices and obtaining the consents required where your leads are
        located (for example for cookies, ad measurement, email, SMS and
        WhatsApp).
      </p>

      <h2 id="integrations">4. Connected platforms</h2>
      <p>
        LeadLoop can connect to third-party services such as Meta (Facebook and
        Instagram), Google Ads, Google Tag Manager, TikTok for Business, Gmail,
        Microsoft 365, Twilio and Stripe. When you connect one:
      </p>
      <ul>
        <li>You authorise LeadLoop to act on that account within the permissions you approved, for example to create a pixel or conversion action, publish the LeadLoop tag to your Tag Manager container, receive your lead-form leads, and send conversion events.</li>
        <li>Your use of each platform remains subject to that platform&rsquo;s own terms and policies (including advertising and data policies), which you are responsible for following.</li>
        <li>We are not responsible for third-party services, their availability, or changes they make that affect an integration.</li>
        <li>LeadLoop does not create, edit, pause or spend money on your ad campaigns.</li>
      </ul>

      <h2 id="acceptable-use">5. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Break the law, or infringe anyone&rsquo;s privacy, intellectual property or other rights.</li>
        <li>Upload personal information you have no right to use, or sensitive information LeadLoop isn&rsquo;t designed for (such as health or payment card data in free-text fields).</li>
        <li>Use LeadLoop to discriminate in housing, credit or employment, or in breach of fair housing laws.</li>
        <li>Probe, scan or attack the service, get around its limits or security, or access other customers&rsquo; data.</li>
        <li>Resell or sublicense LeadLoop without our written permission, or copy it to build a competing product.</li>
      </ul>

      <h2 id="messaging">6. Messaging and marketing laws</h2>
      <p>
        If you send email, SMS or WhatsApp messages through LeadLoop, you are
        the sender and must comply with anti-spam and telemarketing laws,
        including Canada&rsquo;s Anti-Spam Legislation (CASL), the US
        CAN-SPAM Act and TCPA, and carrier and WhatsApp rules. LeadLoop
        provides tools such as consent records and unsubscribe links to help,
        but you are responsible for how you use them.
      </p>

      <h2 id="fees">7. Plans, trials and payment</h2>
      <ul>
        <li>Paid plans are billed in advance through Stripe on a recurring basis until cancelled.</li>
        <li>Free trials end on the date shown; if you don&rsquo;t add a payment method, paid features stop at the end of the trial.</li>
        <li>Fees are exclusive of taxes, which we add where required.</li>
        <li>You can cancel at any time; cancellation takes effect at the end of the current billing period. Except where the law requires otherwise, fees already paid are not refundable.</li>
        <li>We may change prices with at least 30 days&rsquo; notice before your next renewal.</li>
      </ul>

      <h2 id="ip">8. Our service</h2>
      <p>
        LeadLoop, including its software, design and branding, belongs to us
        and our licensors. We give you a non-exclusive, non-transferable right
        to use it for your internal business during your subscription. If you
        send us feedback, we may use it without obligation to you.
      </p>

      <h2 id="availability">9. Availability and changes</h2>
      <p>
        We work to keep LeadLoop available and secure, but it may sometimes be
        interrupted for maintenance or reasons outside our control. We may
        improve, change or retire features; if we remove a material feature
        you pay for, we will tell you in advance.
      </p>

      <h2 id="termination">10. Ending the agreement</h2>
      <p>
        You can stop using LeadLoop and close your workspace at any time. We
        may suspend or end access if you seriously or repeatedly breach these
        terms, if required by law, or to protect the service or other users;
        where reasonable we will give notice first. After closure you can ask
        us to export your Customer Data within 30 days; after that it is
        deleted as described on our{" "}
        <a href="/data-deletion">data deletion page</a>.
      </p>

      <h2 id="disclaimers">11. Disclaimers</h2>
      <p>
        LeadLoop is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;.
        To the extent the law allows, we disclaim all implied warranties,
        including merchantability, fitness for a particular purpose and
        non-infringement. We do not guarantee any advertising, sales or
        leasing results, or that conversion data will be accepted or matched
        by an ad platform.
      </p>

      <h2 id="liability">12. Limitation of liability</h2>
      <p>
        To the extent the law allows, neither party is liable for indirect,
        incidental, special, consequential or punitive damages, or for lost
        profits, revenue or data. Our total liability arising from these terms
        is limited to the amounts you paid us in the 12 months before the
        event giving rise to the claim. Nothing in these terms limits
        liability that cannot be limited by law.
      </p>

      <h2 id="indemnity">13. Indemnity</h2>
      <p>
        You will defend and indemnify us against third-party claims arising
        from Customer Data, from messages you send through LeadLoop, or from
        your breach of these terms or of a connected platform&rsquo;s terms.
      </p>

      <h2 id="law">14. Governing law</h2>
      <p>
        These terms are governed by the laws of the Province of Québec and the
        federal laws of Canada that apply there. The courts of the judicial
        district of Montréal have exclusive jurisdiction, unless consumer
        protection law where you live says otherwise.
      </p>

      <h2 id="general">15. General</h2>
      <ul>
        <li>We may update these terms; we will post changes here and give account owners notice of material changes before they take effect.</li>
        <li>If any part of these terms is unenforceable, the rest stays in effect.</li>
        <li>You may not transfer these terms without our consent; we may transfer them as part of a merger, acquisition or sale of assets.</li>
        <li>Questions about these terms: <a href={mail}>{LEGAL.email}</a>.</li>
      </ul>
    </LegalPage>
  )
}
