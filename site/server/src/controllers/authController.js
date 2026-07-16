const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Organisation = require('../models/Organisation');

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
const getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-__v').lean();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

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

    return res.json({ user: { ...user, organisations, aiKeysPresent } });
  } catch (err) {
    console.error('getCurrentUser error:', err);
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
};
