"use client"

import { useState, type ChangeEvent, type FormEvent } from "react"
import { cn } from "@/lib/utils"

/**
 * DemoForm — the marketing "Book a demo" form. Posts to the same-origin
 * `/api/demo-lead` route handler, which forwards to the LeadLoop app so the
 * submission becomes a lead on the configured board + stage. On success it
 * swaps to a confirmation state; on failure it falls back to the email link.
 */

type Status = "idle" | "submitting" | "done" | "error"

const fieldClass =
  "w-full rounded-[12px] border border-[#4d7860] bg-[#33553f] px-4 py-3 text-[15px] text-[#f1f5ee] placeholder:text-[#9fb8a3] outline-none transition-colors focus:border-[#cbdbc7] focus:bg-[#375943]"

export function DemoForm() {
  const [status, setStatus] = useState<Status>("idle")
  const [error, setError] = useState("")
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    message: "",
  })

  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (status === "submitting") return
    setStatus("submitting")
    setError("")
    try {
      const res = await fetch("/api/demo-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setError(data?.error || "Something went wrong. Please try again.")
        setStatus("error")
        return
      }
      setStatus("done")
    } catch {
      setError("We couldn't reach the server. Please try again.")
      setStatus("error")
    }
  }

  if (status === "done") {
    return (
      <div className="mx-auto max-w-[520px] rounded-[20px] border border-[#4d7860] bg-[#33553f] px-8 py-10 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-cream text-2xl text-forest-deep">
          ✓
        </div>
        <h3 className="font-display text-[26px] font-bold tracking-[-0.02em] text-[#f1f5ee]">
          Request received
        </h3>
        <p className="mt-2 text-[15px] leading-[1.55] text-[#cbdbc7]">
          Thanks, {form.name.split(" ")[0] || "there"} — we&apos;ll be in touch
          shortly to set up your demo.
        </p>
      </div>
    )
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mx-auto grid max-w-[560px] grid-cols-1 gap-3 text-left sm:grid-cols-2"
      noValidate
    >
      <input
        className={fieldClass}
        type="text"
        name="name"
        placeholder="Full name"
        autoComplete="name"
        value={form.name}
        onChange={set("name")}
        required
      />
      <input
        className={fieldClass}
        type="email"
        name="email"
        placeholder="Work email"
        autoComplete="email"
        value={form.email}
        onChange={set("email")}
        required
      />
      <input
        className={cn(fieldClass, "sm:col-span-2")}
        type="tel"
        name="phone"
        placeholder="Phone (optional)"
        autoComplete="tel"
        value={form.phone}
        onChange={set("phone")}
      />
      <textarea
        className={cn(fieldClass, "sm:col-span-2 min-h-[92px] resize-y")}
        name="message"
        placeholder="Which buildings or portfolio should we set up? (optional)"
        value={form.message}
        onChange={set("message")}
        rows={3}
      />

      {status === "error" && (
        <p className="sm:col-span-2 text-[14px] text-[#f2c4b8]">
          {error}{" "}
          <a href="mailto:hello@leadloop.ca" className="underline">
            or email us
          </a>
          .
        </p>
      )}

      <button
        type="submit"
        disabled={status === "submitting"}
        className="sm:col-span-2 mt-1 inline-flex items-center justify-center rounded-full bg-cream px-[26px] py-[15px] text-base font-semibold text-forest-deep transition-colors hover:bg-white disabled:opacity-60"
      >
        {status === "submitting" ? "Sending…" : "Book a demo →"}
      </button>
      <p className="sm:col-span-2 text-center font-mono text-[10px] uppercase tracking-[0.12em] text-[#a6bfa1]">
        No trial to expire · We reply within one business day
      </p>
    </form>
  )
}
