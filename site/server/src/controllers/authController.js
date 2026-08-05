const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Organisation = require('../models/Organisation');
const { sendCode } = require('../services/authMailer');

// --- Email+password helpers -------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LEN = 8;
const CODE_TTL_MS = 15 * 60 * 1000; // one-time codes valid for 15 minutes
const BCRYPT_ROUNDS = 10;

const normEmail = (email) => String(email || '').trim().toLowerCase();

/** Cryptographically-random 6-digit numeric code (leading zeros preserved). */
const generateCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

/** Constant-time-ish compare for the short numeric codes. */
const codesMatch = (a, b) => {
  const x = String(a || '');
  const y = String(b || '');
  if (!x || !y || x.length !== y.length) return false;
  return crypto.timingSafeEqual(Buffer.from(x), Buffer.from(y));
};

/**
 * Sign a JWT for a given user document.
 */
const signToken = (user) => {
  return jwt.sign(
    {
      userId: user._id.toString(),
      email: user.email,
      name: user.name,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

/**
 * Google OAuth callback handler.
 * Passport has attached the authenticated user to req.user.
 * We sign a JWT and redirect the browser back to the frontend with ?token=...
 */
const googleCallback = (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.redirect(`${process.env.CLIENT_URL}/login?error=auth_failed`);
    }

    const token = signToken(user);
    return res.redirect(
      `${process.env.CLIENT_URL}/auth/callback?token=${encodeURIComponent(token)}`
    );
  } catch (err) {
    console.error('Google callback error:', err);
    return res.redirect(`${process.env.CLIENT_URL}/login?error=auth_failed`);
  }
};

/**
 * GET /auth/me — return the current authenticated user.
 *
 * F3 reshaped `User.organisations` into `{ workspaceId, role, joinedAt }`
 * subdocs. To keep the frontend (which reads `user.organisations` as an array
 * of workspace objects) working unchanged, each membership is FLATTENED back
 * into its workspace doc with `role` / `joinedAt` merged in.
 *
 * Reads lean and resolves workspace ids manually so it tolerates BOTH the new
 * shape AND the legacy flat-ObjectId shape — that way the deploy → run
 * `migrateUserMemberships.js` window never makes an existing user look
 * workspace-less. Memberships whose workspace no longer exists are dropped, and
 * order is preserved.
 */
const buildCurrentUser = async (userId) => {
  const user = await User.findById(userId).select('-__v').lean();
  if (!user) return null;

  const raw = Array.isArray(user.organisations) ? user.organisations : [];
  const membershipWorkspaceId = (m) => (m && m.workspaceId != null ? m.workspaceId : m);

  const ids = raw.map(membershipWorkspaceId).filter(Boolean);
  const orgs = ids.length
    ? await Organisation.find({ _id: { $in: ids } }).lean()
    : [];
  const orgById = new Map(orgs.map((o) => [o._id.toString(), o]));

  const organisations = [];
  for (const m of raw) {
    const wsId = membershipWorkspaceId(m);
    if (!wsId) continue;
    const org = orgById.get(wsId.toString());
    if (!org) continue; // workspace deleted — drop the dangling membership
    organisations.push({
      ...org,
      role: (m && m.role) || 'member',
      joinedAt: (m && m.joinedAt) || org.createdAt,
    });
  }

  // Never ship the (encrypted) AI keys to the client — surface only whether
  // each provider key is set so the Profile UI can show "saved" state.
  const aiKeysPresent = {
    anthropic: !!user.aiKeys?.anthropic,
    openai: !!user.aiKeys?.openai,
  };
  delete user.aiKeys;

  // Strip all password/credential material — these must never reach the client.
  delete user.passwordHash;
  delete user.verificationCode;
  delete user.verificationCodeExpires;
  delete user.resetCode;
  delete user.resetCodeExpires;

  return { ...user, organisations, aiKeysPresent };
};

const getCurrentUser = async (req, res) => {
  try {
    const user = await buildCurrentUser(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json({ user });
  } catch (err) {
    console.error('getCurrentUser error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * POST /auth/register — begin email+password signup.
 * Validates input, rejects taken emails (password OR Google), stores the user
 * as unverified with a hashed password + a 6-digit code, emails the code, and
 * responds WITHOUT a JWT (the client must verify first).
 */
const register = async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const email = normEmail(req.body?.email);
    const password = String(req.body?.password || '');

    if (!name) return res.status(400).json({ error: 'Name is required.' });
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (password.length < MIN_PASSWORD_LEN) {
      return res
        .status(400)
        .json({ error: `Password must be at least ${MIN_PASSWORD_LEN} characters.` });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      // Reject whether the collision is a password account or a Google one —
      // don't reveal which, just guide Google users toward the right button.
      if (existing.passwordHash) {
        return res.status(409).json({ error: 'An account with this email already exists.' });
      }
      return res.status(409).json({
        error: 'An account with this email already exists. Try continuing with Google.',
      });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const code = generateCode();

    // NOTE: googleId is intentionally left UNSET (not null) so the partial
    // unique index on googleId never sees this password account.
    await User.create({
      name,
      email,
      passwordHash,
      emailVerified: false,
      verificationCode: code,
      verificationCodeExpires: new Date(Date.now() + CODE_TTL_MS),
    });

    await sendCode({ to: email, code, purpose: 'verify' });

    return res.json({ pendingVerification: true, email });
  } catch (err) {
    console.error('register error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * POST /auth/verify — confirm the emailed code, mark verified, issue a JWT.
 */
const verifyEmail = async (req, res) => {
  try {
    const email = normEmail(req.body?.email);
    const code = String(req.body?.code || '').trim();

    if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'Invalid or expired code.' });
    }

    const user = await User.findOne({ email });
    // Fail closed on any ambiguity — never distinguish the cause to the client.
    if (
      !user ||
      !user.verificationCode ||
      !user.verificationCodeExpires ||
      user.verificationCodeExpires.getTime() < Date.now() ||
      !codesMatch(code, user.verificationCode)
    ) {
      return res.status(400).json({ error: 'Invalid or expired code.' });
    }

    user.emailVerified = true;
    user.verificationCode = null;
    user.verificationCodeExpires = null;
    await user.save();

    const token = signToken(user);
    const safeUser = await buildCurrentUser(user._id);
    return res.json({ token, user: safeUser });
  } catch (err) {
    console.error('verifyEmail error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * POST /auth/resend — regenerate + re-email the verification code. Responds
 * generically to avoid confirming whether an email is registered.
 */
const resendCode = async (req, res) => {
  try {
    const email = normEmail(req.body?.email);
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    const user = await User.findOne({ email });
    if (user && user.passwordHash && !user.emailVerified) {
      const code = generateCode();
      user.verificationCode = code;
      user.verificationCodeExpires = new Date(Date.now() + CODE_TTL_MS);
      await user.save();
      await sendCode({ to: email, code, purpose: 'verify' });
    }

    return res.json({ message: 'If your account needs verification, a new code has been sent.' });
  } catch (err) {
    console.error('resendCode error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * POST /auth/login — email+password sign-in.
 * Google-only accounts (no passwordHash) get a clear "use Google" error.
 * Unverified accounts get a fresh code and a pendingVerification response.
 */
const login = async (req, res) => {
  try {
    const email = normEmail(req.body?.email);
    const password = String(req.body?.password || '');

    if (!EMAIL_RE.test(email) || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Incorrect email or password.' });
    }

    if (!user.passwordHash) {
      // Google-only account — tell them plainly to use Google.
      return res.status(400).json({
        error: 'This account uses Google sign-in. Please continue with Google.',
      });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: 'Incorrect email or password.' });
    }

    if (!user.emailVerified) {
      // Re-issue a code and steer the client into the verify step.
      const code = generateCode();
      user.verificationCode = code;
      user.verificationCodeExpires = new Date(Date.now() + CODE_TTL_MS);
      await user.save();
      await sendCode({ to: email, code, purpose: 'verify' });
      return res.json({ pendingVerification: true, email });
    }

    const token = signToken(user);
    const safeUser = await buildCurrentUser(user._id);
    return res.json({ token, user: safeUser });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * POST /auth/forgot — email a password-reset code. ALWAYS responds 200 with a
 * generic message so it can't be used to enumerate registered emails.
 */
const forgotPassword = async (req, res) => {
  try {
    const email = normEmail(req.body?.email);
    if (EMAIL_RE.test(email)) {
      const user = await User.findOne({ email });
      // Only password accounts can reset a password.
      if (user && user.passwordHash) {
        const code = generateCode();
        user.resetCode = code;
        user.resetCodeExpires = new Date(Date.now() + CODE_TTL_MS);
        await user.save();
        await sendCode({ to: email, code, purpose: 'reset' });
      }
    }

    return res.json({
      message: 'If an account exists for that email, a reset code has been sent.',
    });
  } catch (err) {
    console.error('forgotPassword error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * POST /auth/reset — verify the reset code and set a new password.
 */
const resetPassword = async (req, res) => {
  try {
    const email = normEmail(req.body?.email);
    const code = String(req.body?.code || '').trim();
    const newPassword = String(req.body?.newPassword || '');

    if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'Invalid or expired code.' });
    }
    if (newPassword.length < MIN_PASSWORD_LEN) {
      return res
        .status(400)
        .json({ error: `Password must be at least ${MIN_PASSWORD_LEN} characters.` });
    }

    const user = await User.findOne({ email });
    if (
      !user ||
      !user.passwordHash ||
      !user.resetCode ||
      !user.resetCodeExpires ||
      user.resetCodeExpires.getTime() < Date.now() ||
      !codesMatch(code, user.resetCode)
    ) {
      return res.status(400).json({ error: 'Invalid or expired code.' });
    }

    user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    user.resetCode = null;
    user.resetCodeExpires = null;
    // A successful reset implies control of the mailbox — treat as verified.
    user.emailVerified = true;
    await user.save();

    return res.json({ success: true });
  } catch (err) {
    console.error('resetPassword error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * POST /auth/logout — JWT is stateless, so we just instruct the client to drop it.
 */
const logout = (req, res) => {
  return res.json({ message: 'Logged out' });
};

module.exports = {
  googleCallback,
  getCurrentUser,
  logout,
  register,
  verifyEmail,
  resendCode,
  login,
  forgotPassword,
  resetPassword,
};
