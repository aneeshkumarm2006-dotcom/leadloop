/**
 * authMailer.js — sends the 6-digit one-time codes for email+password auth
 * (email verification + password reset) over Gmail SMTP via nodemailer.
 *
 * Credentials come from env: GMAIL_USER + GMAIL_APP_PASSWORD (a Google
 * "app password", NOT the account password). When EITHER is unset we fall back
 * to console.log so local dev works with no mail creds — we NEVER throw, so a
 * misconfigured mailer can never take down the register/login flow.
 *
 * The code itself is transient and low-value on its own (short TTL, single use),
 * but we still keep it out of client responses; it only ever appears in the
 * email body or — in dev fallback — the server log.
 */

const nodemailer = require('nodemailer');

let cachedTransporter;

/**
 * Lazily build (and memoise) the Gmail transporter. Returns null when creds are
 * missing so callers can take the console.log dev fallback.
 */
const getTransporter = () => {
  if (cachedTransporter !== undefined) return cachedTransporter;

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    cachedTransporter = null;
    return cachedTransporter;
  }

  cachedTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });
  return cachedTransporter;
};

const escapeHtml = (str) =>
  String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const COPY = {
  verify: {
    subject: 'Your LeadLoop verification code',
    heading: 'Confirm your email',
    intro: 'Use the code below to finish setting up your LeadLoop account.',
  },
  reset: {
    subject: 'Your LeadLoop password reset code',
    heading: 'Reset your password',
    intro: 'Use the code below to set a new password for your LeadLoop account.',
  },
};

/**
 * Render a small branded HTML email around the code.
 */
const renderHtml = (copy, code) => `
  <div style="margin:0;padding:24px;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:440px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      <div style="font-size:19px;font-weight:800;color:#1f2937;">LeadLoop</div>
      <h1 style="font-size:20px;font-weight:800;color:#111827;margin:20px 0 8px;">${escapeHtml(
        copy.heading
      )}</h1>
      <p style="font-size:14px;line-height:1.6;color:#4b5563;margin:0 0 20px;">${escapeHtml(
        copy.intro
      )}</p>
      <div style="font-size:32px;font-weight:800;letter-spacing:8px;color:#111827;background:#f3f4f6;border-radius:10px;padding:16px;text-align:center;">${escapeHtml(
        code
      )}</div>
      <p style="font-size:13px;line-height:1.6;color:#6b7280;margin:20px 0 0;">This code expires in 15 minutes. If you didn't request it, you can safely ignore this email.</p>
    </div>
  </div>
`;

/**
 * Send a one-time code email.
 * @param {Object} opts
 * @param {string} opts.to      - recipient email
 * @param {string} opts.code    - the 6-digit code
 * @param {'verify'|'reset'} opts.purpose
 * @returns {Promise<boolean>} true if an email was actually dispatched
 */
const sendCode = async ({ to, code, purpose = 'verify' }) => {
  const copy = COPY[purpose] || COPY.verify;
  const transporter = getTransporter();

  if (!transporter) {
    // Dev fallback — never crash when creds are absent.
    console.log(`[auth] ${purpose} code for ${to}: ${code}`);
    return false;
  }

  try {
    await transporter.sendMail({
      from: `LeadLoop <${process.env.GMAIL_USER}>`,
      to,
      subject: copy.subject,
      text: `${copy.intro}\n\nYour code: ${code}\n\nThis code expires in 15 minutes.`,
      html: renderHtml(copy, code),
    });
    return true;
  } catch (err) {
    // Log server-side only (no code leakage to the client) and keep the dev
    // fallback so the flow still completes even if Gmail rejects the send.
    console.error('[auth] failed to send code email:', err.message);
    console.log(`[auth] ${purpose} code for ${to}: ${code}`);
    return false;
  }
};

module.exports = { sendCode };
