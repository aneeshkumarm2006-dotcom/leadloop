/**
 * emailHtml.js — HTML normalisation + tracking injection for email (F8.3/F8.4).
 *
 * Dependency-free (no `sanitize-html` / `node-html-to-text`): a conservative
 * sanitizer that strips active content for safe rendering in the read pane, a
 * tag-stripping `htmlToText` for the plain-text body/preview, and the open-pixel
 * + click-rewrite helpers the send path uses to wire tracking to a message id.
 */

/** Strip script/style/iframe blocks, inline event handlers, and javascript: URLs. */
const sanitizeEmailHtml = (html) => {
  if (!html || typeof html !== 'string') return '';
  return (
    html
      // Drop entire dangerous element blocks (content included).
      .replace(/<\s*(script|style|iframe|object|embed|link|meta|base)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
      // Drop self-closing / unclosed variants of the same tags.
      .replace(/<\s*(script|style|iframe|object|embed|link|meta|base)\b[^>]*\/?>/gi, '')
      // Strip inline event handlers: on*="..." / on*='...' / on*=value.
      .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
      .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
      .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
      // Neutralise javascript: and data: URIs in attributes.
      .replace(/(href|src)\s*=\s*"(\s*javascript:|\s*data:)[^"]*"/gi, '$1="#"')
      .replace(/(href|src)\s*=\s*'(\s*javascript:|\s*data:)[^']*'/gi, "$1='#'")
  );
};

const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
};

/** Render HTML to a readable plain-text approximation (for `body` / previews). */
const htmlToText = (html) => {
  if (!html || typeof html !== 'string') return '';
  return html
    .replace(/<\s*(script|style)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|h[1-6]|li|tr)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-z#0-9]+;/gi, (m) => (ENTITIES[m.toLowerCase()] != null ? ENTITIES[m.toLowerCase()] : m))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

/** Minimal text → HTML (escape + nl2br) for plain-text-only compositions. */
const textToHtml = (text) => {
  if (!text) return '';
  const escaped = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped.replace(/\n/g, '<br />');
};

const isHttpUrl = (value) => /^https?:\/\//i.test(value || '');

/**
 * Rewrite every `http(s)` href in the HTML through the click-tracking redirect
 * `${base}/api/email/track/:messageId/click?u=<encoded>`. Non-http links and
 * the open-pixel/tracking links themselves are left untouched.
 */
const rewriteLinksForTracking = (html, messageId, baseUrl) => {
  if (!html || !messageId || !baseUrl) return html || '';
  return html.replace(/href\s*=\s*"([^"]*)"/gi, (whole, url) => {
    if (!isHttpUrl(url) || url.includes('/api/email/track/')) return whole;
    const tracked = `${baseUrl}/api/email/track/${messageId}/click?u=${encodeURIComponent(url)}`;
    return `href="${tracked}"`;
  });
};

/** The 1×1 transparent open-tracking pixel for `:messageId`. */
const openPixelTag = (messageId, baseUrl) => {
  if (!messageId || !baseUrl) return '';
  return `<img src="${baseUrl}/api/email/track/${messageId}/open.gif" width="1" height="1" alt="" style="display:none;max-height:0;overflow:hidden" />`;
};

/**
 * Inject open + click tracking into an HTML body for `:messageId`. Returns the
 * original HTML unchanged when `baseUrl` is unset (tracking disabled locally).
 */
const injectTracking = (html, messageId, baseUrl) => {
  if (!baseUrl || !messageId) return html || '';
  const rewritten = rewriteLinksForTracking(html || '', messageId, baseUrl);
  return `${rewritten}${openPixelTag(messageId, baseUrl)}`;
};

module.exports = {
  sanitizeEmailHtml,
  htmlToText,
  textToHtml,
  rewriteLinksForTracking,
  openPixelTag,
  injectTracking,
};
