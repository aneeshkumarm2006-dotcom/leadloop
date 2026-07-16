import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Zap,
  Plus,
  Pencil,
  Trash2,
  Play,
  History,
  Sparkles,
  Workflow,
  ChevronRight,
} from 'lucide-react';
import PageWrapper from '../components/layout/PageWrapper';
import Button from '../components/ui/Button';
import useAuthStore from '../store/authStore';
import useOrgStore from '../store/orgStore';
import useBoardStore from '../store/boardStore';
import useTaskStore from '../store/taskStore';
import useToastStore from '../store/toastStore';
import * as automationService from '../services/automationService';
import AutomationBuilder from '../components/board/AutomationBuilder';
import AutomationChainEditor from '../components/board/AutomationChainEditor';
import AutomationRunLog from '../components/board/AutomationRunLog';
import RecipeCatalogue from '../components/board/RecipeCatalogue';
import { Toggle } from '../components/board/automationFields';

/**
 * AutomationsPage — the F6 automation surface (tabs: My Automations / Recipes).
 *
 * Usable inline (`<AutomationsPage boardId={id} />`) and standalone via the
 * routes `/automations` and `/boards/:id/automations` (F6.5). Without a board in
 * scope it shows a board picker; once a board is chosen it lists that board's
 * automations and offers the recipe catalogue. "Use recipe" clones a disabled,
 * pre-filled automation (F6.3) and drops the user straight into the drag-drop
 * chain editor to review, finish binding, and enable it.
 */

// Local admin check (mirrors the duplicated helper in the other pages).
const useIsCurrentOrgAdmin = () => {
  const user = useAuthStore((s) => s.user);
  const currentOrg = useOrgStore((s) => s.currentOrg);
  if (!user || !currentOrg) return false;
  const adminId =
    typeof currentOrg.admin === 'object' && currentOrg.admin !== null
      ? currentOrg.admin._id || currentOrg.admin
      : currentOrg.admin;
  const isMainAdmin = !!adminId && String(adminId) === String(user._id);
  const isExtraAdmin =
    Array.isArray(currentOrg.admins) &&
    currentOrg.admins.some((a) => {
      const id = typeof a === 'object' && a !== null ? a._id || a : a;
      return String(id) === String(user._id);
    });
  return isMainAdmin || isExtraAdmin;
};

const EVENT_TRIGGERS = [
  'ITEM_CREATED',
  'COLUMN_VALUE_CHANGED',
  'STATUS_BECAME',
  'CHECKBOX_CHECKED',
  'NUMBER_CROSSED',
  'ITEM_MOVED_TO_GROUP',
  'UPDATE_POSTED',
  'DATE_ARRIVED',
  'PERSON_ASSIGNED',
  'FORM_SUBMITTED',
  'WEBHOOK_RECEIVED',
];

const TRIGGER_TITLES = {
  SCHEDULE: 'On a schedule',
  ITEM_CREATED: 'When an item is created',
  GROUP_CREATED: 'When a group is created',
  COLUMN_VALUE_CHANGED: 'When a column changes',
  STATUS_BECAME: 'When status becomes…',
  CHECKBOX_CHECKED: 'When a checkbox is checked',
  NUMBER_CROSSED: 'When a number crosses a threshold',
  ITEM_MOVED_TO_GROUP: 'When an item moves to a group',
  UPDATE_POSTED: 'When an update is posted',
  DATE_ARRIVED: 'When a date arrives',
  PERSON_ASSIGNED: 'When a person is assigned',
  FORM_SUBMITTED: 'When a form is submitted',
  WEBHOOK_RECEIVED: 'When a webhook is received',
};

const isEventAutomation = (a) => EVENT_TRIGGERS.includes(a.triggerType);

const summariseAutomation = (a) => {
  const title = TRIGGER_TITLES[a.triggerType] || a.triggerType;
  const n = Array.isArray(a.actions) ? a.actions.length : 0;
  if (n > 0) return `${title} → ${n} action${n === 1 ? '' : 's'}`;
  if (a.triggerType === 'GROUP_CREATED') {
    const t = (a.groupCreatedTaskTemplates || []).length;
    return `${title} → create ${t} task${t === 1 ? '' : 's'}`;
  }
  if (a.taskTemplate) return `${title} → create "${a.taskTemplate.name}"`;
  return title;
};

const TabButton = ({ active, onClick, icon: Icon, children, count }) => (
  <button
    type="button"
    onClick={onClick}
    className="font-body inline-flex items-center gap-2"
    style={{
      fontSize: 13,
      fontWeight: 600,
      padding: '8px 14px',
      borderRadius: 'var(--radius-md)',
      border: '1.5px solid',
      borderColor: active ? 'var(--color-accent)' : 'var(--color-border)',
      background: active ? 'var(--color-accent-light)' : 'transparent',
      color: active ? 'var(--color-accent-text)' : 'var(--color-text-secondary)',
      cursor: 'pointer',
    }}
  >
    {Icon && <Icon size={15} aria-hidden="true" />}
    {children}
    {typeof count === 'number' && (
      <span style={{ opacity: 0.7 }}>({count})</span>
    )}
  </button>
);

const AutomationsPage = ({ boardId: boardIdProp = null }) => {
  const params = useParams();
  const isAdmin = useIsCurrentOrgAdmin();

  const currentOrg = useOrgStore((s) => s.currentOrg);
  const orgId = currentOrg?._id || null;
  const members = useOrgStore((s) => s.members);
  const fetchMembers = useOrgStore((s) => s.fetchMembers);

  const boards = useBoardStore((s) => s.boards);
  const fetchBoards = useBoardStore((s) => s.fetchBoards);
  const getBoardById = useBoardStore((s) => s.getBoardById);

  const groups = useTaskStore((s) => s.groups);
  const fetchBoardData = useTaskStore((s) => s.fetchBoardData);

  const toastError = useToastStore((s) => s.error);
  const toastSuccess = useToastStore((s) => s.success);

  // Board scope: prop (inline) → route param → user-picked (standalone).
  const routeBoardId = boardIdProp || params.id || null;
  const [pickedBoardId, setPickedBoardId] = useState(null);
  const boardId = routeBoardId || pickedBoardId;
  const board = boardId ? getBoardById(boardId) : null;

  const [tab, setTab] = useState('mine'); // 'mine' | 'recipes'
  const [automations, setAutomations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [busyId, setBusyId] = useState(null);

  const [recipes, setRecipes] = useState([]);
  const [recipesLoading, setRecipesLoading] = useState(false);
  const [recipesError, setRecipesError] = useState(null);
  const [busySlug, setBusySlug] = useState(null);

  const [editing, setEditing] = useState(null); // automation in the chain editor
  // Inline classic builder: null = closed, 'new' = create, automation = edit.
  const [builderFor, setBuilderFor] = useState(null);
  const [runLogFor, setRunLogFor] = useState(null);

  // Ensure boards are loaded so the picker + board record resolve.
  useEffect(() => {
    if (orgId && boards.length === 0) {
      fetchBoards(orgId).catch((err) => console.error('Failed to fetch boards:', err));
    }
  }, [orgId, boards.length, fetchBoards]);

  // Load board groups + members once a board is in scope.
  useEffect(() => {
    if (!boardId) return;
    fetchBoardData(boardId).catch(() => {});
    if (orgId) fetchMembers(orgId).catch(() => {});
  }, [boardId, orgId, fetchBoardData, fetchMembers]);

  // Load this board's automations + the action catalog.
  const reloadAutomations = (id) => {
    if (!id) return;
    setLoading(true);
    setListError(null);
    automationService
      .listAutomations(id)
      .then((data) => setAutomations(data || []))
      .catch((err) => {
        console.error('Failed to load automations:', err);
        setListError(err?.response?.data?.error || 'Failed to load automations.');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setEditing(null);
    reloadAutomations(boardId);
    if (boardId) {
      automationService
        .getActionCatalog()
        .then((c) => setCatalog(Array.isArray(c) ? c : []))
        .catch((err) => console.error('Failed to load action catalog:', err));
    } else {
      setAutomations([]);
    }
  }, [boardId]);

  // Load recipes once (catalogue is board-agnostic).
  useEffect(() => {
    setRecipesLoading(true);
    setRecipesError(null);
    automationService
      .listRecipes()
      .then((data) => setRecipes(data || []))
      .catch((err) => {
        console.error('Failed to load recipes:', err);
        setRecipesError(err?.response?.data?.error || 'Failed to load recipes.');
      })
      .finally(() => setRecipesLoading(false));
  }, []);

  const boardOptions = useMemo(
    () =>
      (boards || [])
        .filter((b) => !orgId || String(b.organisation || '') === String(orgId))
        .map((b) => ({ value: b._id, label: b.name })),
    [boards, orgId]
  );

  // --- Recipe clone (AC2 / AC4) --------------------------------------------
  const handleUseRecipe = async (recipe) => {
    if (!boardId) {
      toastError('Pick a board first.');
      return;
    }
    setBusySlug(recipe.slug);
    try {
      const { automation, validation, warnings } = await automationService.createFromRecipe(
        recipe.slug,
        { boardId }
      );
      setAutomations((list) => [automation, ...list]);
      if (validation === 'incomplete') {
        toastSuccess('Recipe added (disabled). Finish setup, then enable it.');
      } else {
        toastSuccess('Recipe added as a disabled automation — review and enable it.');
      }
      if (Array.isArray(warnings) && warnings.length) {
        console.info('[recipe] follow-ups:', warnings);
      }
      setTab('mine');
      setEditing(automation); // drop straight into the chain editor to review
    } catch (e) {
      toastError(e?.response?.data?.error || 'Failed to add recipe.');
    } finally {
      setBusySlug(null);
    }
  };

  // --- Chain editor save (create vs update) --------------------------------
  const handleEditorSave = async (payload) => {
    const updated = await automationService.updateAutomation(editing._id, payload);
    setAutomations((list) => list.map((a) => (a._id === updated._id ? updated : a)));
    setEditing(null);
    toastSuccess('Automation saved.');
  };

  const openEdit = (automation) => {
    if (isEventAutomation(automation)) setEditing(automation);
    else setBuilderFor(automation); // SCHEDULE / GROUP_CREATED use the classic builder
  };

  const closeBuilder = () => {
    setBuilderFor(null);
    reloadAutomations(boardId);
  };

  const handleToggle = async (automation, enabled) => {
    setBusyId(automation._id);
    try {
      const updated = await automationService.updateAutomation(automation._id, { enabled });
      setAutomations((list) => list.map((a) => (a._id === updated._id ? updated : a)));
    } catch (e) {
      toastError(e?.response?.data?.error || 'Failed to update automation.');
    } finally {
      setBusyId(null);
    }
  };

  const handleRunNow = async (automation) => {
    setBusyId(automation._id);
    try {
      const data = await automationService.runAutomationNow(automation._id);
      if (data?.automation) {
        setAutomations((list) =>
          list.map((a) => (a._id === data.automation._id ? data.automation : a))
        );
      }
      toastSuccess('Automation run.');
    } catch (e) {
      toastError(e?.response?.data?.error || 'Failed to run automation.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (automation) => {
    if (!window.confirm(`Delete automation "${automation.name}"?`)) return;
    setBusyId(automation._id);
    try {
      await automationService.deleteAutomation(automation._id);
      setAutomations((list) => list.filter((a) => a._id !== automation._id));
    } catch (e) {
      toastError(e?.response?.data?.error || 'Failed to delete automation.');
    } finally {
      setBusyId(null);
    }
  };

  const recipeCount = recipes.length;

  // ---- Render --------------------------------------------------------------
  const renderBoardPicker = () => (
    <div
      className="flex flex-col gap-2"
      style={{ maxWidth: 360 }}
    >
      <label className="font-body font-medium text-xs uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>
        Board
      </label>
      <select
        value={pickedBoardId || ''}
        onChange={(e) => setPickedBoardId(e.target.value || null)}
        className="font-body"
        style={{
          height: 38,
          padding: '0 10px',
          borderRadius: 'var(--radius-md)',
          border: '1.5px solid var(--color-border)',
          background: 'var(--color-bg-input)',
          color: 'var(--color-text-primary)',
          fontSize: 14,
        }}
      >
        <option value="">Choose a board…</option>
        {boardOptions.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );

  const renderMine = () => {
    if (editing) {
      if (!board) {
        return <p className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Loading board…</p>;
      }
      return (
        <AutomationChainEditor
          automation={editing}
          board={board}
          groups={groups}
          members={members}
          catalog={catalog}
          onSave={handleEditorSave}
          onCancel={() => setEditing(null)}
        />
      );
    }

    // Inline classic builder — replaces the old "New automation" modal popup so
    // create/edit stays on this screen.
    if (builderFor) {
      if (!board) {
        return <p className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Loading board…</p>;
      }
      return (
        <AutomationBuilder
          key={builderFor === 'new' ? 'new' : builderFor._id}
          isOpen
          embedded
          editAutomation={builderFor === 'new' ? null : builderFor}
          onClose={closeBuilder}
          boardId={boardId}
          board={board}
          groups={groups}
          members={members}
          isAdmin={isAdmin}
        />
      );
    }

    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            Automations that run on this board.
          </p>
          {isAdmin && boardId && (
            <Button variant="secondary" size="sm" icon={Plus} onClick={() => setBuilderFor('new')}>
              New automation
            </Button>
          )}
        </div>

        {listError && (
          <p className="font-body text-xs" style={{ color: 'var(--color-status-stuck)' }}>{listError}</p>
        )}

        {loading ? (
          <p className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Loading…</p>
        ) : automations.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center" style={{ padding: '32px 16px', color: 'var(--color-text-muted)' }}>
            <Zap size={28} aria-hidden="true" />
            <p className="font-body mt-2" style={{ fontSize: 14 }}>No automations yet</p>
            <p className="font-body" style={{ fontSize: 12 }}>Start from a recipe, or build one from scratch.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {automations.map((a) => {
              const isBusy = busyId === a._id;
              const incomplete = a.validation === 'incomplete';
              return (
                <li
                  key={a._id}
                  style={{
                    border: '1.5px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '12px 14px',
                    background: a.enabled ? 'var(--color-bg-surface)' : 'var(--color-bg-subtle)',
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-display font-semibold truncate" style={{ fontSize: 14, color: 'var(--color-text-primary)' }}>
                          {a.name}
                        </span>
                        {!a.enabled && (
                          <span className="font-body" style={{ fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 'var(--radius-full)', background: 'var(--color-bg-subtle)', color: 'var(--color-text-muted)' }}>
                            paused
                          </span>
                        )}
                        {incomplete && (
                          <span className="font-body" style={{ fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 'var(--radius-full)', background: 'var(--color-bg-subtle)', color: 'var(--color-status-stuck)', border: '1px solid var(--color-status-stuck)' }}>
                            needs setup
                          </span>
                        )}
                      </div>
                      <p className="font-body mt-1" style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                        {summariseAutomation(a)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Toggle checked={a.enabled} disabled={isBusy} onChange={(v) => handleToggle(a, v)} />
                      <IconBtn label="Run now" onClick={() => handleRunNow(a)} disabled={isBusy} icon={Play} />
                      <IconBtn label="Run log" onClick={() => setRunLogFor(a)} disabled={isBusy} icon={History} />
                      <IconBtn label="Edit" onClick={() => openEdit(a)} disabled={isBusy} icon={Pencil} />
                      <IconBtn label="Delete" onClick={() => handleDelete(a)} disabled={isBusy} icon={Trash2} danger />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  };

  return (
    <PageWrapper>
      {/* Breadcrumb — keeps the board context visible so users know where they
          are while building automations (mirrors the board/groups breadcrumb). */}
      {boardId && (
        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-1.5 font-body mb-3"
          style={{ fontSize: 13 }}
        >
          <Link
            to="/boards"
            className="transition-colors duration-150 hover:text-[color:var(--color-accent)]"
            style={{ color: 'var(--color-text-muted)' }}
          >
            My Boards
          </Link>
          <ChevronRight size={14} color="var(--color-text-muted)" aria-hidden="true" />
          <Link
            to={`/boards/${boardId}`}
            className="transition-colors duration-150 hover:text-[color:var(--color-accent)] truncate"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {board?.name || 'Loading…'}
          </Link>
          <ChevronRight size={14} color="var(--color-text-muted)" aria-hidden="true" />
          <span style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>
            Automations
          </span>
        </nav>
      )}

      <header className="mb-6">
        <h1 className="font-display font-bold" style={{ fontSize: 22, color: 'var(--color-text-primary)' }}>
          Automations
        </h1>
        <p className="font-body mt-1" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          Build no-code workflows or start from a ready-made recipe.
        </p>
      </header>

      {!routeBoardId && (
        <div className="mb-6">{renderBoardPicker()}</div>
      )}

      <div className="flex items-center gap-2 mb-5">
        <TabButton active={tab === 'mine'} onClick={() => setTab('mine')} icon={Workflow}>
          My Automations
        </TabButton>
        <TabButton active={tab === 'recipes'} onClick={() => setTab('recipes')} icon={Sparkles} count={recipeCount}>
          Recipes
        </TabButton>
      </div>

      {boardId == null ? (
        tab === 'recipes' ? (
          <RecipeCatalogue
            recipes={recipes}
            onUse={handleUseRecipe}
            busySlug={busySlug}
            useDisabled
            loading={recipesLoading}
            error={recipesError}
          />
        ) : (
          <p className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            Choose a board above to see and build its automations.
          </p>
        )
      ) : tab === 'mine' ? (
        renderMine()
      ) : (
        <RecipeCatalogue
          recipes={recipes}
          onUse={handleUseRecipe}
          busySlug={busySlug}
          useDisabled={!isAdmin}
          loading={recipesLoading}
          error={recipesError}
        />
      )}

      <AutomationRunLog
        isOpen={!!runLogFor}
        onClose={() => setRunLogFor(null)}
        automationId={runLogFor?._id}
        automationName={runLogFor?.name}
      />
    </PageWrapper>
  );
};

const IconBtn = ({ label, onClick, disabled, icon: Icon, danger }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    title={label}
    className="flex items-center justify-center rounded-md transition-colors duration-150 hover:bg-[color:var(--color-bg-subtle)]"
    style={{
      width: 30,
      height: 30,
      border: '1.5px solid var(--color-border)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.6 : 1,
    }}
  >
    {Icon && <Icon size={14} color={danger ? '#DC2626' : 'var(--color-text-secondary)'} />}
  </button>
);

export default AutomationsPage;
