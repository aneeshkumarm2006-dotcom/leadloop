const Organisation = require('../models/Organisation');
const Board = require('../models/Board');
const TaskGroup = require('../models/TaskGroup');
const Task = require('../models/Task');
const Comment = require('../models/Comment');
const Update = require('../models/Update');
const Notification = require('../models/Notification');
const Automation = require('../models/Automation');
const User = require('../models/User');
const WorkspaceGrant = require('../models/WorkspaceGrant');

/**
 * Permanently delete an organisation and everything that lives under it.
 *
 * Cascade order (children first to avoid dangling refs if anything fails):
 *   1. Updates, Comments, Notifications — scoped by task IDs in the org's boards
 *   2. Notifications — scoped directly by organisation (covers non-task notifs)
 *   3. Tasks → TaskGroups → Automations → Boards
 *   4. WorkspaceGrants where this workspace is the grantor OR the granted
 *      resource (the workspace itself, or any of its boards) — F3 Acceptance #5
 *   5. Pull this workspace from every member/admin's User.organisations array
 *      (and repoint their defaultWorkspaceId if it pointed here)
 *   6. Delete the Organisation document
 *
 * Shared by orgController.deleteOrg and profileController.deleteAccount so
 * the two paths can't drift.
 */
const cascadeDeleteOrg = async (orgId) => {
  const boardIds = await Board.distinct('_id', { organisation: orgId });
  const taskIds = boardIds.length
    ? await Task.distinct('_id', { board: { $in: boardIds } })
    : [];

  if (taskIds.length) {
    await Update.deleteMany({ task: { $in: taskIds } });
    await Comment.deleteMany({ task: { $in: taskIds } });
    await Notification.deleteMany({ task: { $in: taskIds } });
    await Task.deleteMany({ _id: { $in: taskIds } });
  }

  await Notification.deleteMany({ organisation: orgId });

  if (boardIds.length) {
    await TaskGroup.deleteMany({ board: { $in: boardIds } });
    await Automation.deleteMany({ board: { $in: boardIds } });
    await Board.deleteMany({ _id: { $in: boardIds } });
  }

  await Automation.deleteMany({ organisation: orgId });

  // Drop every grant that touches this workspace, on either side:
  //   - workspaceId === orgId            → grants this workspace handed out
  //   - resourceId === orgId             → a 'workspace'-type grant OF this workspace
  //   - resourceId ∈ boards(orgId)       → 'board'-type grants of its boards
  await WorkspaceGrant.deleteMany({
    $or: [
      { workspaceId: orgId },
      { resourceId: orgId },
      ...(boardIds.length ? [{ resourceId: { $in: boardIds } }] : []),
    ],
  });

  // Remove the membership and repoint defaults that pointed at this workspace.
  await User.updateMany(
    { 'organisations.workspaceId': orgId },
    { $pull: { organisations: { workspaceId: orgId } } }
  );
  await User.updateMany(
    { defaultWorkspaceId: orgId },
    { $set: { defaultWorkspaceId: null } }
  );

  await Organisation.deleteOne({ _id: orgId });
};

module.exports = { cascadeDeleteOrg };
