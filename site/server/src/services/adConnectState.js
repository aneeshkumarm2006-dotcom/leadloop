/**
 * adConnectState.js — the OAuth `state` for one-click ad-platform connections
 * (Meta / Google Ads / TikTok), mirroring services/emailOAuth.js.
 *
 * `state` is a short-lived (15 min) JWT binding the connect to
 * `{ userId, workspaceId, platform }` plus a random nonce. The nonce's sha256 is
 * stored on the workspace's AdConversionConfig (`oauthNonces[platform]`) when
 * the admin clicks Connect and is CLEARED when the callback consumes it, so a
 * state works once, and only for the most recent Connect click.
 *
 * The callback additionally re-checks that `userId` is still an admin of
 * `workspaceId` (an admin removed mid-flow can't finish connecting).
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const PLATFORMS = ['meta', 'google', 'tiktok'];
const KIND = 'ad_connect_oauth';

const isPlatform = (p) => PLATFORMS.includes(p);

const hashNonce = (nonce) => crypto.createHash('sha256').update(String(nonce)).digest('hex');

/**
 * @returns {{ state: string, nonceHash: string }}
 */
const signState = ({ userId, workspaceId, platform, gtm = false }, { secret = process.env.JWT_SECRET, expiresIn = '15m' } = {}) => {
  if (!secret) throw new Error('JWT_SECRET is not configured');
  if (!isPlatform(platform)) throw new Error('Unsupported platform');
  const nonce = crypto.randomBytes(16).toString('hex');
  const state = jwt.sign(
    { kind: KIND, userId: String(userId), workspaceId: String(workspaceId), platform, gtm: !!gtm, nonce },
    secret,
    { expiresIn }
  );
  return { state, nonceHash: hashNonce(nonce) };
};

/** Throws on a bad / expired / foreign state. */
const verifyState = (state, { secret = process.env.JWT_SECRET } = {}) => {
  if (!secret) throw new Error('JWT_SECRET is not configured');
  if (typeof state !== 'string' || state.length > 4096) throw new Error('Invalid OAuth state');
  const decoded = jwt.verify(state, secret, { algorithms: ['HS256'] });
  if (!decoded || decoded.kind !== KIND || !isPlatform(decoded.platform) || !decoded.nonce) {
    throw new Error('Invalid OAuth state');
  }
  return decoded;
};

/** Constant-time compare of a decoded state's nonce against the stored hash. */
const nonceMatches = (decoded, storedHash) => {
  if (!decoded || !decoded.nonce || typeof storedHash !== 'string' || !storedHash) return false;
  const a = Buffer.from(hashNonce(decoded.nonce), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

module.exports = { signState, verifyState, nonceMatches, hashNonce, isPlatform, PLATFORMS };
