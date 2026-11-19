import type { Metadata } from "next"

import { LEGAL, LegalPage } from "@/components/legal/legal-page"

export const metadata: Metadata = {
  title: "Data Deletion — LeadLoop",
  description:
    "How to disconnect Meta, Google or TikTok from LeadLoop and how to have your LeadLoop data deleted.",
}

const toc = [
  { id: "disconnect", label: "Disconnect an ad platform" },
  { id: "remove-on-platform", label: "Remove LeadLoop on the platform" },
  { id: "delete-account", label: "Delete your LeadLoop data" },
  { id: "leads", label: "If you are a lead or contact" },
  { id: "what-happens", label: "What gets deleted, and when" },
]

export default function DataDeletionPage() {
  const mail = `mailto:${LEGAL.email}?subject=${encodeURIComponent("Data deletion request")}`
  return (
    <LegalPage
      eyebrow="Legal · Your data"
      title="Data deletion instructions"
      toc={toc}
      intro={
        <p>
          You can remove LeadLoop&rsquo;s access to your Meta, Google or TikTok
          account at any time, and ask us to delete the data we hold about
          you. Here is how.
        </p>
      }
    >
      <h2 id="disconnect">1. Disconnect an ad platform in LeadLoop</h2>
      <ol>
        <li>Sign in to LeadLoop as a workspace admin.</li>
        <li>Go to <strong>Settings → Ads &amp; tracking</strong>.</li>
        <li>On the Meta, Google Ads or TikTok Ads card, open the <strong>⋯</strong> menu and choose <strong>Disconnect</strong>.</li>
      </ol>
      <p>
        LeadLoop immediately deletes that platform&rsquo;s access tokens,
        stops sending events to it, and unsubscribes your Facebook Pages or
        TikTok lead forms from LeadLoop. Leads already on your boards stay
        there until you delete them.
      </p>

      <h2 id="remove-on-platform">2. Remove LeadLoop on the platform itself</h2>
      <h3>Facebook / Meta</h3>
      <ol>
        <li>On Facebook, go to <strong>Settings &amp; privacy → Settings</strong>.</li>
        <li>Open <strong>Business integrations</strong> (under Permissions or Your activity, depending on your version).</li>
        <li>Find <strong>LeadLoop</strong>, select it and click <strong>Remove</strong>.</li>
      </ol>
      <p>
        If you connected through a Meta business portfolio, you can also go to{" "}
        <strong>Meta Business Suite → Settings → Integrations → Connected apps</strong>{" "}
        and remove LeadLoop there.
      </p>
      <h3>Google</h3>
      <ol>
        <li>Go to <a href="https://myaccount.google.com/connections">myaccount.google.com/connections</a>.</li>
        <li>Select <strong>LeadLoop</strong> and choose <strong>Delete all connections</strong>.</li>
      </ol>
      <h3>TikTok</h3>
      <ol>
        <li>In TikTok Ads Manager or Business Center, open <strong>Account settings → Authorizations</strong> (also shown as Connected apps).</li>
        <li>Find <strong>LeadLoop</strong> and revoke its access.</li>
      </ol>

      <h2 id="delete-account">3. Delete your LeadLoop data</h2>
      <p>
        To delete your whole workspace, including leads, contacts, messages,
        files and settings, email{" "}
        <a href={mail}>{LEGAL.email}</a> from the address on your account with
        the subject <strong>&ldquo;Data deletion request&rdquo;</strong> and
        your workspace name. If you are a single user who wants only your own
        account removed, say so in the email. We will confirm the request
        within 3 business days and may ask you to verify that you own the
        account before we delete anything.
      </p>

      <h2 id="leads">4. If you are a lead or contact of a LeadLoop customer</h2>
      <p>
        Businesses that use LeadLoop control their own lead lists. Please ask
        the business you contacted to delete your information. If you
        can&rsquo;t reach them, email <a href={mail}>{LEGAL.email}</a> with the
        business&rsquo;s name and your email or phone number, and we will pass
        your request to them and help them complete it.
      </p>

      <h2 id="what-happens">5. What gets deleted, and when</h2>
      <ul>
        <li><strong>Ad-platform tokens:</strong> deleted immediately when you disconnect.</li>
        <li><strong>Workspace data:</strong> deleted within 30 days of a confirmed request, and from backups within a further 30 days.</li>
        <li><strong>Kept by law:</strong> invoices and records we must keep for tax or legal reasons are kept only as long as required.</li>
      </ul>
      <p>
        Data you already sent to Meta, Google or TikTok as conversion events
        is held by those platforms under their own policies. Removing LeadLoop
        on the platform (section 2) and contacting them directly covers that
        data. More detail is in our <a href="/privacy">Privacy Policy</a>.
      </p>
    </LegalPage>
  )
}
