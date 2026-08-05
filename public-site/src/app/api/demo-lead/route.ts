/**
 * POST /api/demo-lead — server-side proxy for the marketing "Book a demo" form.
 *
 * The browser posts here (same origin → no CORS). We forward server-to-server to
 * the LeadLoop app's public form pipeline (`/f/:slug/submit`), so a submission
 * becomes a real lead that lands on the board + stage configured in that in-app
 * Form, with fields synced to columns. The app URL and form slug stay
 * server-side (never shipped to the browser); nothing here handles credentials.
 *
 * Field mapping: we post values keyed by human labels (Full name / Email /
 * Phone / Message). The app's form validator resolves those against the Form's
 * fields by label, so the in-app Form just needs fields with matching labels.
 */

export const dynamic = "force-dynamic"

type DemoLeadBody = {
  name?: unknown
  email?: unknown
  phone?: unknown
  message?: unknown
}

const str = (v: unknown, max: number) =>
  (typeof v === "string" ? v : v == null ? "" : String(v)).trim().slice(0, max)

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export async function POST(request: Request) {
  const apiUrl = process.env.LEADLOOP_API_URL
  const slug = process.env.LEADLOOP_DEMO_FORM_SLUG
  if (!apiUrl || !slug) {
    return Response.json(
      { error: "The demo form isn't connected yet. Please email us instead." },
      { status: 503 }
    )
  }

  let body: DemoLeadBody
  try {
    body = (await request.json()) as DemoLeadBody
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 })
  }

  const name = str(body.name, 200)
  const email = str(body.email, 200)
  const phone = str(body.phone, 60)
  const message = str(body.message, 2000)

  if (!name || !email) {
    return Response.json(
      { error: "Name and email are required." },
      { status: 400 }
    )
  }
  if (!EMAIL_RE.test(email)) {
    return Response.json({ error: "Enter a valid email." }, { status: 400 })
  }

  // Keyed by label — the app resolves these against the Form's fields.
  const payload = {
    "Full name": name,
    Email: email,
    Phone: phone,
    Message: message,
  }

  try {
    const res = await fetch(
      `${apiUrl.replace(/\/+$/, "")}/f/${encodeURIComponent(slug)}/submit`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload }),
        cache: "no-store",
      }
    )
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    if (!res.ok) {
      return Response.json(
        { error: data?.error || "We couldn't submit that. Please try again." },
        { status: res.status === 400 ? 400 : 502 }
      )
    }
    return Response.json({ ok: true })
  } catch {
    return Response.json(
      { error: "We couldn't reach the server. Please try again." },
      { status: 502 }
    )
  }
}
