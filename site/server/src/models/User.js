const mongoose = require('mongoose');

/**
 * User.organisations — per-membership role list (Phase 1 / F3).
 *
 * Previously a flat `[ObjectId]`. Reshaped to carry a role + join timestamp per
 * workspace so the UI can render "owner / admin / member / viewer" and so
 * `requireResourceAccess` can reason about a user's standing in each workspace
 * without re-deriving it from the Organisation doc every time.
 *
 * NOTE: `Organisation.members[]` / `admins[]` / `admin` remain the SOURCE OF
 * TRUTH for membership and admin checks across the app — this array is the
 * denormalised, role-annotated convenience index that mirrors it. The two are
 * kept in sync by orgController (create/join/removeMember) and orgCascade.
 * `authController.getCurrentUser` populates `organisations.workspaceId` and
 * flattens each entry back into a workspace object (with `role`/`joinedAt`
 * merged) so the existing frontend keeps receiving an array of workspace docs.
 */
const MEMBERSHIP_ROLES = ['owner', 'admin', 'member', 'viewer'];

const membershipSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organisation',
      required: true,
    },
    role: {
      type: String,
      enum: MEMBERSHIP_ROLES,
      default: 'member',
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema({
  googleId: {
    type: String,
    required: true,
    unique: true,
  },
  name: {
    type: String,
  },
  email: {
    type: String,
    required: true,
    unique: true,
  },
  profilePic: {
    type: String,
  },
  // Personal AI provider keys for the "Describe what you want" automation drafter.
  // Stored AES-256-GCM encrypted (same scheme as email/SMS/WhatsApp tokens) and
  // NEVER returned to the client — getCurrentUser strips them and surfaces only
  // presence flags. `aiProvider`/`aiModel` are the user's chosen drafter model.
  aiKeys: {
    anthropic: { type: String, default: null }, // encrypted Anthropic (Claude) API key
    openai: { type: String, default: null }, // encrypted OpenAI (ChatGPT) API key
  },
  aiProvider: {
    type: String,
    enum: ['claude', 'openai'],
    default: 'claude',
  },
  aiModel: {
    type: String,
    default: null,
  },
  organisations: [membershipSchema],
  defaultWorkspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organisation',
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

userSchema.statics.MEMBERSHIP_ROLES = MEMBERSHIP_ROLES;

/**
 * Idempotently add a workspace membership and adopt it as the user's default
 * workspace when they don't have one yet. Safe to call repeatedly — the guard
 * on `organisations.workspaceId` prevents duplicate entries.
 */
userSchema.statics.addMembership = async function addMembership(
  userId,
  workspaceId,
  role = 'member',
  joinedAt = new Date()
) {
  await this.updateOne(
    { _id: userId, 'organisations.workspaceId': { $ne: workspaceId } },
    { $push: { organisations: { workspaceId, role, joinedAt } } }
  );
  await this.updateOne(
    {
      _id: userId,
      $or: [{ defaultWorkspaceId: null }, { defaultWorkspaceId: { $exists: false } }],
    },
    { $set: { defaultWorkspaceId: workspaceId } }
  );
};

/**
 * Remove a workspace membership. If it was the user's default workspace, repoint
 * the default at whichever membership remains first (or null when none remain).
 */
userSchema.statics.removeMembership = async function removeMembership(userId, workspaceId) {
  await this.updateOne({ _id: userId }, { $pull: { organisations: { workspaceId } } });
  const user = await this.findById(userId).select('organisations defaultWorkspaceId').lean();
  if (
    user &&
    user.defaultWorkspaceId &&
    user.defaultWorkspaceId.toString() === workspaceId.toString()
  ) {
    const next = (user.organisations || [])[0];
    await this.updateOne(
      { _id: userId },
      { $set: { defaultWorkspaceId: next ? next.workspaceId : null } }
    );
  }
};

module.exports = mongoose.model('User', userSchema);
module.exports.MEMBERSHIP_ROLES = MEMBERSHIP_ROLES;
