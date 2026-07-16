const Board = require('../models/Board');
const Task = require('../models/Task');
const Organisation = require('../models/Organisation');

/**
 * GET /api/search?q=:query&org=:orgId
 *
 * Searches boards by name and tasks by name within the given org.
 * - Admin: sees all boards (public + private) and all board tasks.
 * - Regular user: sees only public boards and tasks assigned to them.
 *
 * Returns: { boards: [...], tasks: [...] }
 */
const search = async (req, res) => {
  try {
    const { q, org: orgId } = req.query;

    if (!q || !q.trim()) return res.json({ boards: [], tasks: [] });
    if (!orgId) return res.status(400).json({ error: 'Organisation ID required' });

    const userId = req.user.userId;

    const org = await Organisation.findById(orgId);
    if (!org) return res.status(404).json({ error: 'Organisation not found' });

    const isMember = org.members.some((m) => m.toString() === userId);
    if (!isMember) {
      return res.status(403).json({ error: 'Not a member of this organisation' });
    }

    // Escape special regex characters to prevent ReDoS
    const escaped = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const queryRegex = new RegExp(escaped, 'i');

    const isAdmin =
      (org.admin && org.admin.toString() === userId) ||
      (Array.isArray(org.admins) && org.admins.some((a) => a.toString() === userId));
    const visibilityFilter = isAdmin ? {} : { visibility: 'public' };

    const boards = await Board.find({ organisation: orgId, name: queryRegex, ...visibilityFilter })
      .select('name visibility')
      .limit(10)
      .lean();

    const orgBoardIds = await Board.distinct('_id', { organisation: orgId, ...visibilityFilter });
    const tasks = await Task.find({
      board: { $in: orgBoardIds },
      name: queryRegex,
      isPersonal: { $ne: true },
    })
      .select('name status priority board labels')
      .populate('board', 'name statuses labels')
      .limit(20)
      .lean();

    return res.json({ boards, tasks });
  } catch (err) {
    console.error('search error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { search };
