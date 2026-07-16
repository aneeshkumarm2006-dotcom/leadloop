const express = require('express');
const { URL } = require('url');
const authMiddleware = require('../middleware/auth');
const { cloudinary } = require('../config/cloudinary');

const router = express.Router();
router.use(authMiddleware);

const ALLOWED_HOST = 'res.cloudinary.com';

/**
 * Parse a Cloudinary delivery URL into { resourceType, publicId, ext }.
 *
 * URL format:
 *   https://res.cloudinary.com/{cloud}/{resource_type}/upload/[v{ver}/]{public_id}.{ext}
 *
 * public_id includes folder separators (e.g. "macan/updates/filename").
 */
const parseCloudinaryUrl = (urlStr) => {
  const m = urlStr.match(
    /res\.cloudinary\.com\/([^/]+)\/(image|video|raw)\/upload\/(.+?)(?:\?.*)?$/
  );
  if (!m) return null;

  const resourceType = m[2];
  let path = m[3];

  // Strip optional version prefix "v<digits>/"
  path = path.replace(/^v\d+\//, '');

  // Extract extension from the filename portion only (not folder names)
  const lastSlash = path.lastIndexOf('/');
  const filename  = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
  const folder    = lastSlash >= 0 ? path.slice(0, lastSlash)  : '';
  const lastDot   = filename.lastIndexOf('.');

  let publicId, ext;
  if (lastDot > 0) {
    ext      = filename.slice(lastDot + 1);
    const base = filename.slice(0, lastDot);
    publicId = folder ? `${folder}/${base}` : base;
  } else {
    ext      = null;
    publicId = path;
  }

  return { resourceType, publicId, ext };
};

/**
 * GET /api/proxy/download?url=<cloudinary-url>&name=<filename>
 *
 * Uses Node's native fetch (Node 18+, auto-redirect, proper SSL) to
 * download a Cloudinary asset server-side and stream it to the browser
 * as Content-Disposition: attachment, regardless of resource_type.
 */
router.get('/download', async (req, res) => {
  const { url, name } = req.query;
  if (!url) return res.status(400).json({ error: 'url query param required' });

  // Express URL-decodes query params automatically
  const cleanUrl = url;

  try {
    const parsed = new URL(cleanUrl);
    if (parsed.hostname !== ALLOWED_HOST) {
      return res.status(403).json({ error: 'Only Cloudinary URLs are allowed' });
    }
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const safeFilename =
    (name || 'file').replace(/[^\w.\-() ]/g, '_').trim() || 'file';

  // Try to build a signed URL (bypasses Cloudinary access restrictions)
  const parts = parseCloudinaryUrl(cleanUrl);
  let primaryUrl = cleanUrl;

  console.log('[proxy] cleanUrl   :', cleanUrl);
  console.log('[proxy] parsed     :', parts);

  if (parts) {
    try {
      primaryUrl = cloudinary.url(parts.publicId, {
        resource_type: parts.resourceType,
        sign_url: true,
        secure: true,    // generate https:// — http:// gets redirected and breaks the signature
        type: 'upload',
        // Omit format so Cloudinary serves the stored file as-is
      });
      console.log('[proxy] signed URL :', primaryUrl);
    } catch (e) {
      console.error('[proxy] sign error :', e.message);
      primaryUrl = cleanUrl;
    }
  }

  // Attempt the download using native fetch (Node 18+).
  // fetch follows redirects automatically and handles TLS correctly.
  const tryFetch = async (fetchUrl) => {
    const response = await fetch(fetchUrl, {
      headers: { 'User-Agent': 'Macan-Proxy/1.0' },
    });
    console.log('[proxy] fetch status:', response.status, fetchUrl.slice(0, 80));
    return response;
  };

  try {
    let response = await tryFetch(primaryUrl);

    // If signed URL fails, fall back to the original URL
    if (!response.ok && primaryUrl !== cleanUrl) {
      console.log('[proxy] signed URL failed, trying original');
      response = await tryFetch(cleanUrl);
    }

    if (!response.ok) {
      console.error('[proxy] all attempts failed, status:', response.status);
      return res
        .status(502)
        .json({ error: `Cloudinary returned HTTP ${response.status}` });
    }

    const contentType =
      response.headers.get('content-type') || 'application/octet-stream';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);

    // Stream the response body to the client
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) {
    console.error('[proxy] fetch threw:', err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Failed to fetch file from storage' });
    }
  }
});

module.exports = router;
