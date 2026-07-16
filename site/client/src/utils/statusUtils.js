/**
 * Status-related helpers shared across views.
 *
 * Tasks reference statuses in one of two shapes:
 *   - ObjectId / string id pointing into `board.statuses[]` (post Phase 2)
 *   - Legacy enum string ('done', 'working_on_it', 'stuck', 'not_started')
 *     used by personal tasks and pre-migration board tasks
 *
 * Helpers here accept either shape and resolve the correct answer.
 */

/**
 * Whether the task's status — interpreted against the board — is the
 * "done" status.
 *
 * `board` may be null (personal task) — in that case the legacy enum
 * string is the only thing to check.
 */
export const isStatusDone = (board, statusRef) => {
  if (board && Array.isArray(board.statuses) && statusRef != null) {
    const match = board.statuses.find(
      (s) => s._id && s._id.toString() === statusRef.toString()
    );
    if (match) return match.key === 'done';
  }
  return statusRef === 'done';
};

export default { isStatusDone };
