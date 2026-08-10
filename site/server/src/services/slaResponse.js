/**
 * slaResponse.js — stop the speed-to-lead clock.
 *
 * The clock stops on the FIRST outbound message to a lead, on any channel:
 * email, SMS or WhatsApp. Whichever way an agent reaches out first counts, so
 * a team that works by text isn't penalised against one that works by email.
 *
 * Deliberately:
 *   • only the first response is recorded (`firstResponseAt: null` guard), so a
 *     later follow-up can't reset or improve a lead's measured response time;
 *   • only leads with a clock (`slaDueAt` set) are touched — leads typed in by
 *     hand were never waiting on a reply;
 *   • failures are swallowed. Missing a metric must never fail a real message.
 */

const Task = require('../models/Task');

/**
 * Record the first outbound response to a lead.
 * @returns {Promise<boolean>} true when this call was the one that stamped it
 */
const markFirstResponse = async (taskId, now = new Date()) => {
  if (!taskId) return false;
  try {
    // Conditional update: whichever channel gets there first wins, and a
    // concurrent second message cannot overwrite it.
    const res = await Task.updateOne(
      { _id: taskId, firstResponseAt: null, slaDueAt: { $ne: null } },
      { $set: { firstResponseAt: now } }
    );
    return (res.modifiedCount || 0) > 0;
  } catch (err) {
    console.warn('sla first-response not recorded:', err.message);
    return false;
  }
};

module.exports = { markFirstResponse };
