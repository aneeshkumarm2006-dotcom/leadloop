/**
 * mime.js — build a raw RFC-5322 message (Phase 3, F8.3).
 *
 * Gmail's `messages.send` and the IMAP/SMTP fallback both need a raw MIME blob.
 * Rather than hand-roll multipart boundaries, we reuse nodemailer's MailComposer
 * (already a dependency) to compile the message, then hand the buffer to the
 * adapter. Microsoft Graph takes a structured JSON message instead, so it does
 * not use this builder.
 */

const MailComposer = require('nodemailer/lib/mail-composer');

/** Normalise a to/cc/bcc input (string | string[]) into a comma list or undefined. */
const addrList = (value) => {
  if (!value) return undefined;
  const arr = Array.isArray(value) ? value : [value];
  const cleaned = arr.map((a) => String(a).trim()).filter(Boolean);
  return cleaned.length ? cleaned.join(', ') : undefined;
};

/**
 * Map our attachment shape (`{ url, name, mime }`) to nodemailer's. Attachments
 * are referenced by URL (Cloudinary), so nodemailer streams them via `path`.
 */
const mapAttachments = (attachments) =>
  (Array.isArray(attachments) ? attachments : [])
    .filter((a) => a && a.url)
    .map((a) => ({ filename: a.name || undefined, path: a.url, contentType: a.mime || undefined }));

/** Build the nodemailer mail options object shared by MailComposer + SMTP send. */
const buildMailOptions = ({
  from,
  to,
  cc,
  bcc,
  subject,
  bodyHtml,
  bodyText,
  inReplyTo,
  attachments,
  headers,
}) => {
  const opts = {
    from,
    to: addrList(to),
    cc: addrList(cc),
    bcc: addrList(bcc),
    subject: subject || '',
    text: bodyText || undefined,
    html: bodyHtml || undefined,
    attachments: mapAttachments(attachments),
  };
  const extraHeaders = { ...(headers || {}) };
  if (inReplyTo) {
    extraHeaders['In-Reply-To'] = inReplyTo;
    extraHeaders.References = inReplyTo;
  }
  if (Object.keys(extraHeaders).length) opts.headers = extraHeaders;
  return opts;
};

/** Compile the message to a raw RFC-5322 Buffer. Returns { raw: Buffer, messageId }. */
const buildRawMime = (mail) =>
  new Promise((resolve, reject) => {
    const composer = new MailComposer(buildMailOptions(mail));
    const mailObj = composer.compile();
    const messageId = mailObj.messageId(); // generates + caches a Message-ID
    mailObj.build((err, message) => {
      if (err) return reject(err);
      return resolve({ raw: message, messageId });
    });
  });

module.exports = { buildRawMime, buildMailOptions, addrList, mapAttachments };
