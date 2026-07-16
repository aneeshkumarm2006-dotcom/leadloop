/**
 * migrateUserMemberships.js
 *
 * Phase 1 / F3 migration. Reshapes every `User.organisations` entry from a flat
 * `ObjectId` into a role-annotated membership subdoc:
 *
 *     { workspaceId, role, joinedAt }
 *
 * Role is derived from the Organisation the entry points at:
 *   - org.admin === user._id          → 'owner'
 *   - user._id ∈ org.admins[]         → 'admin'
 *   - otherwise (in members[])        → 'member'
 *   (no existing data maps to 'viewer' — that role only arrives via grants.)
 *
 * `joinedAt` is backfilled from `org.createdAt`. `defaultWorkspaceId` is set to
 * the user's existing default if present, otherwise their first workspace.
 *
 * Idempotent — a user whose entries are already `{ workspaceId, role }` objects
 * (and who has a `defaultWorkspaceId` when they have any membership) is skipped.
 * Memberships pointing at a now-deleted Organisation are dropped.
 *
 * Run from the server directory:
 *     node src/scripts/migrateUserMemberships.js [--dry-run]
 *
 * Pattern reference: migrateLegacyColumns.js (connect → for-each → log →
 * idempotent shape).
 */

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
require('../models'); // register all schemas

const User = require('../models/User');
const Organisation = require('../models/Organisation');

const parseArgs = () => {
  const args = process.argv.slice(2);
  const out = { dryRun: false };
  for (const a of args) {
    if (a === '--dry-run' || a === '-n') out.dryRun = true;
  }
  return out;
};

/**
 * Pull the workspace id out of a raw `organisations` entry, tolerating all
 * three shapes seen across the migration boundary:
 *   - ObjectId / string (legacy flat)
 *   - { workspaceId, role, joinedAt } (already migrated)
 */
const entryWorkspaceId = (entry) => {
  if (entry == null) return null;
  if (typeof entry === 'object' && entry.workspaceId != null) return entry.workspaceId;
  return entry;
};

const deriveRole = (org, userId) => {
  if (org.admin && org.admin.toString() === userId) return 'owner';
  if (Array.isArray(org.admins) && org.admins.some((a) => a.toString() === userId)) {
    return 'admin';
  }
  return 'member';
};

/**
 * Is this user already fully migrated? Every entry is an object carrying a
 * `role`, and (if they have memberships) a `defaultWorkspaceId` is set.
 */
const isAlreadyMigrated = (rawUser) => {
  const orgs = Array.isArray(rawUser.organisations) ? rawUser.organisations : [];
  const allShaped = orgs.every(
    (e) => e && typeof e === 'object' && e.workspaceId != null && typeof e.role === 'string'
  );
  if (!allShaped) return false;
  if (orgs.length > 0 && !rawUser.defaultWorkspaceId) return false;
  return true;
};

const run = async () => {
  const args = parseArgs();
  await connectDB();
  console.log('— migrateUserMemberships started', args);

  // `.lean()` returns the RAW stored documents without applying the new subdoc
  // schema casting, so we can read legacy flat-ObjectId arrays safely.
  const users = await User.find({}).lean();

  // Cache org lookups (role derivation + joinedAt) across users.
  const orgCache = new Map();
  const loadOrg = async (id) => {
    const key = id.toString();
    if (orgCache.has(key)) return orgCache.get(key);
    const org = await Organisation.findById(key).select('admin admins createdAt').lean();
    orgCache.set(key, org);
    return org;
  };

  let migrated = 0;
  let skipped = 0;
  let droppedMemberships = 0;

  for (const rawUser of users) {
    const userId = rawUser._id.toString();

    if (isAlreadyMigrated(rawUser)) {
      skipped += 1;
      continue;
    }

    const rawOrgs = Array.isArray(rawUser.organisations) ? rawUser.organisations : [];
    const memberships = [];
    const seen = new Set();

    for (const entry of rawOrgs) {
      const wsRef = entryWorkspaceId(entry);
      if (!wsRef) continue;
      const wsId = wsRef.toString();
      if (seen.has(wsId)) continue; // de-dupe defensively

      // eslint-disable-next-line no-await-in-loop
      const org = await loadOrg(wsId);
      if (!org) {
        droppedMemberships += 1;
        continue; // membership references a deleted workspace — drop it
      }
      seen.add(wsId);

      // Preserve an already-correct role/joinedAt on a partially-migrated entry.
      const existingRole =
        entry && typeof entry === 'object' && typeof entry.role === 'string'
          ? entry.role
          : deriveRole(org, userId);
      const existingJoinedAt =
        entry && typeof entry === 'object' && entry.joinedAt
          ? entry.joinedAt
          : org.createdAt || new Date(rawUser.createdAt || Date.now());

      memberships.push({
        workspaceId: new mongoose.Types.ObjectId(wsId),
        role: existingRole,
        joinedAt: existingJoinedAt,
      });
    }

    const defaultWorkspaceId =
      rawUser.defaultWorkspaceId ||
      (memberships.length ? memberships[0].workspaceId : null);

    if (args.dryRun) {
      console.log(
        `  [dry-run] user ${userId} (${rawUser.email}): ${memberships.length} memberships ` +
          `[${memberships.map((m) => m.role).join(', ')}], default=${defaultWorkspaceId}`
      );
      migrated += 1;
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    await User.updateOne(
      { _id: rawUser._id },
      { $set: { organisations: memberships, defaultWorkspaceId } }
    );
    migrated += 1;
  }

  console.log(
    `— migrateUserMemberships done — users: ${migrated} migrated, ${skipped} already migrated; ` +
      `${droppedMemberships} memberships dropped (deleted workspace)`
  );
  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error('migrateUserMemberships failed:', err);
  process.exit(1);
});
