/**
 * imapAdapter.js — IMAP read + SMTP send fallback (Phase 3, F8.3).
 *
 * The non-OAuth provider path: send goes out over SMTP (nodemailer, already a
 * dep) and inbound is polled over IMAP (`imapflow`, lazily required so the
 * server still boots if it's absent). Both `send` and `fetchRecent` take an
 * explicit connection `config` assembled by the caller from the decrypted
 * account, keeping the adapter free of model/crypto concerns.
 *
 * This is the drift-correction fallback for mailboxes without push; Gmail /
 * Microsoft are the primary adapters. Parsing is envelope-level + a best-effort
 * text body part (no `mailparser` dep), which is sufficient for thread routing.
 */

const nodemailer = require('nodemailer');
const { buildMailOptions } = require('./mime');
const { htmlToText } = require('../../utils/emailHtml');

/** Lazily load imapflow; returns null (rather than throwing at boot) if absent. */
const loadImapFlow = () => {
  try {
    return require('imapflow').ImapFlow;
  } catch {
    return null;
  }
};

const send = async ({ smtp, mail }) => {
  if (!smtp || !smtp.host) throw new Error('imapAdapter.send requires smtp config');
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port || 587,
    secure: smtp.secure ?? smtp.port === 465,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });
  const info = await transporter.sendMail(buildMailOptions(mail));
  return { providerMessageId: info.messageId || null, threadId: null, rfcMessageId: info.messageId || null };
};

/** Pull the most recent INBOX messages over IMAP, normalised best-effort. */
const fetchRecent = async ({ imap, max = 25 }) => {
  const ImapFlow = loadImapFlow();
  if (!ImapFlow) throw new Error('imapflow is not installed — IMAP polling unavailable');
  if (!imap || !imap.host) throw new Error('imapAdapter.fetchRecent requires imap config');

  const client = new ImapFlow({
    host: imap.host,
    port: imap.port || 993,
    secure: imap.secure ?? true,
    auth: { user: imap.user, pass: imap.pass },
    logger: false,
  });

  const out = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const total = client.mailbox.exists || 0;
      const start = Math.max(1, total - max + 1);
      if (total > 0) {
        for await (const msg of client.fetch(`${start}:*`, {
          envelope: true,
          source: false,
          bodyParts: ['text'],
        })) {
          const env = msg.envelope || {};
          const textPart = msg.bodyParts && msg.bodyParts.get && msg.bodyParts.get('text');
          const bodyText = textPart ? textPart.toString('utf8') : '';
          out.push({
            providerMessageId: env.messageId || String(msg.uid),
            threadId: null,
            rfcMessageId: env.messageId || null,
            inReplyTo: env.inReplyTo || null,
            from: env.from && env.from[0] ? env.from[0].address : '',
            to: (env.to || []).map((a) => a.address).filter(Boolean),
            cc: (env.cc || []).map((a) => a.address).filter(Boolean),
            subject: env.subject || '',
            bodyText: bodyText || '',
            bodyHtml: '',
            sentAt: env.date ? new Date(env.date) : new Date(),
          });
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return out;
};

/** IMAP has no server-side thread grouping here — thread view comes from the DB. */
const fetchThread = async () => [];

module.exports = { provider: 'smtp', send, fetchRecent, fetchThread, htmlToText };
