import AutomationsModal from './AutomationsModal';

/**
 * AutomationBuilder — the Phase 2 entry point for the automation UI.
 *
 * It wraps the (now F4-extended) AutomationsModal, which handles all nine
 * triggers — the legacy SCHEDULE / ITEM_CREATED / GROUP_CREATED plus the six
 * new event triggers (COLUMN_VALUE_CHANGED, STATUS_BECAME, DATE_ARRIVED,
 * PERSON_ASSIGNED, FORM_SUBMITTED, WEBHOOK_RECEIVED) with their per-type
 * trigger-config forms and the run-log drawer.
 *
 * Kept as a thin wrapper so callers migrate to `AutomationBuilder` while the
 * underlying modal (and the existing automationService functions) keep working
 * through the transition. The F5/F6 action picker and chain editor extend this
 * surface next.
 *
 * Props (forwarded verbatim):
 *   isOpen, onClose, boardId, board, groups, members, isAdmin
 */
const AutomationBuilder = (props) => <AutomationsModal {...props} />;

export default AutomationBuilder;
