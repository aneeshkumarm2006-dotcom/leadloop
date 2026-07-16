const User = require('../models/User');
const Organisation = require('../models/Organisation');
const Task = require('../models/Task');
const Comment = require('../models/Comment');
const Notification = require('../models/Notification');
const WorkspaceGrant = require('../models/WorkspaceGrant');
const { cascadeDeleteOrg } = require('../services/orgCascade');
const aesEncrypt = require('../utils/aesEncrypt');

// Derive the {anthropic, openai} presence flags the client uses to render
// "key saved" state without ever shipping the (encrypted) key itself.
const aiKeysPresent = (user) => ({
  anthropic: !!user?.aiKeys?.anthropic,
  openai: !!user?.aiKeys?.openai,
});

/**
 * PUT /api/profile — Update the current user's display name.
 */
const updateProfile = async (req, res) => {
  try {
    const { name } = req.body;

    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const user = await User.findByIdAndUpdate(
      req.user.userId,
      { name: name.trim() },
      { new: true }
    ).select('-__v');

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({ user });
  } catch (err) {
    console.error('updateProfile error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * PUT /api/profile/ai — Save the current user's AI drafter settings: the
 * Anthropic (Claude) and OpenAI (ChatGPT) API keys, plus the chosen provider
 * and model. Keys are AES-256-GCM encrypted at rest and never returned.
 *
 * A blank string clears a stored key; omitting a key field leaves it untouched
 * (so the model picker on the Forms page can save provider/model without
 * needing the keys re-entered).
 */
const updateAiSettings = async (req, res) => {
  try {
    const { anthropicKey, openaiKey, aiProvider, aiModel } = req.body || {};
    const update = {};

    const wantsKeyWrite =
      typeof anthropicKey === 'string' || typeof openaiKey === 'string';
    if (wantsKeyWrite && !aesEncrypt.isConfigured()) {
      return res.status(503).json({
        error:
          'Secure key storage is not configured on the server (EMAIL_TOKEN_ENCRYPTION_KEY).',
      });
    }

    if (typeof anthropicKey === 'string') {
      const trimmed = anthropicKey.trim();
      update['aiKeys.anthropic'] = trimmed ? aesEncrypt.encrypt(trimmed) : null;
    }
    if (typeof openaiKey === 'string') {
      const trimmed = openaiKey.trim();
      update['aiKeys.openai'] = trimmed ? aesEncrypt.encrypt(trimmed) : null;
    }
    if (aiProvider === 'claude' || aiProvider === 'openai') {
      update.aiProvider = aiProvider;
    }
    if (typeof aiModel === 'string' && aiModel.trim()) {
      update.aiModel = aiModel.trim();
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    const user = await User.findByIdAndUpdate(
      req.user.userId,
      { $set: update },
      { new: true }
    )
      .select('-__v')
      .lean();

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const present = aiKeysPresent(user);
    delete user.aiKeys;
    return res.json({ user: { ...user, aiKeysPresent: present } });
  } catch (err) {
    console.error('updateAiSettings error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * POST /api/profile/upload-avatar — Upload a new profile picture.
 * Multer + Cloudinary have already uploaded and transformed the image.
 * Here we just persist the resulting URL to the user record.
 */
const uploadAvatar = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // multer-storage-cloudinary stores the Cloudinary URL on req.file.path
    const url = req.file.path || req.file.secure_url;

    const user = await User.findByIdAndUpdate(
      req.user.userId,
      { profilePic: url },
      { new: true }
    ).select('-__v');

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({ user, profilePic: url });
  } catch (err) {
    console.error('uploadAvatar error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * DELETE /api/profile — Permanently delete the current user's account.
 *
 * Cascade:
 *  - Orgs where user is the primary admin → delete org + all boards, groups,
 *    tasks, comments, and notifications inside them.
 *  - Orgs where user is only a member/extra-admin → remove from members/admins.
 *  - Personal tasks created by the user → deleted with their comments/notifications.
 *  - User removed from assignedTo on all remaining tasks.
 *  - All comments authored by the user → deleted.
 *  - All notifications addressed to the user → deleted.
 *  - User document → deleted.
 */
const deleteAccount = async (req, res) => {
  try {
    const userId = req.user.userId;

    // ── 1. Orgs where this user is the primary admin ──────────────────────
    const adminOrgs = await Organisation.find({ admin: userId }).select('_id');
    for (const org of adminOrgs) {
      await cascadeDeleteOrg(org._id);
    }

    // ── 2. Remove user from orgs they are only a member / extra-admin of ──
    await Organisation.updateMany(
      { members: userId },
      { $pull: { members: userId, admins: userId } }
    );

    // F3: drop cross-workspace grants this user received (so the grants tables
    // of other workspaces don't keep dangling rows for a deleted user).
    await WorkspaceGrant.deleteMany({ granteeUserId: userId });

    // ── 3. Personal tasks this user created ───────────────────────────────
    const personalTaskIds = await Task.distinct('_id', {
      isPersonal: true,
      createdBy: userId,
    });
    if (personalTaskIds.length) {
      await Comment.deleteMany({ task: { $in: personalTaskIds } });
      await Notification.deleteMany({ task: { $in: personalTaskIds } });
      await Task.deleteMany({ _id: { $in: personalTaskIds } });
    }

    // ── 4. Remove user from assignedTo on any remaining tasks ────────────
    await Task.updateMany({ assignedTo: userId }, { $pull: { assignedTo: userId } });

    // ── 5. Delete comments authored by the user ───────────────────────────
    await Comment.deleteMany({ author: userId });

    // ── 6. Delete all notifications sent to the user ─────────────────────
    await Notification.deleteMany({ user: userId });

    // ── 7. Delete the user document ───────────────────────────────────────
    await User.findByIdAndDelete(userId);

    return res.json({ message: 'Account deleted' });
  } catch (err) {
    console.error('deleteAccount error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  updateProfile,
  updateAiSettings,
  uploadAvatar,
  deleteAccount,
};
