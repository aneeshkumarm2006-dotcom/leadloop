import { useTranslation } from 'react-i18next';
import { GroupEditor, updateNode, removeNode } from './AdvancedFilterPanel';
import { advancedFilterableColumns } from '../../utils/columnFilter';

/**
 * ConditionTreeBuilder — the "Only run if…" AND/OR condition builder for
 * automations (Phase 1b §1b.3). A thin wrapper around the board filter's
 * GroupEditor so the automation condition tree (`{ conjunction, rules }`)
 * previews exactly as it fires server-side (see server/utils/conditionTree.js).
 *
 * Props:
 *   board    — current board doc (reads `columns`)
 *   tree     — current condition tree (or null/empty)
 *   onChange — (nextTree) => void
 *   allTasks — optional; feeds person/option value pickers (defaults to [])
 */
const emptyTree = () => ({ conjunction: 'and', rules: [] });

const ConditionTreeBuilder = ({ board, tree, onChange, allTasks = [] }) => {
  const { t } = useTranslation();
  const cols = advancedFilterableColumns(board);
  const root = tree && Array.isArray(tree.rules) ? tree : emptyTree();
  const optionLabels = {
    checked: t('boardMisc.checked'),
    unchecked: t('boardMisc.unchecked'),
    unassigned: t('boardMisc.unassigned'),
  };

  const handleUpdate = (path, fn) => onChange(updateNode(root, path, fn));
  const handleRemove = (path) => onChange(removeNode(root, path));
  const handleAdd = (path, node) =>
    onChange(updateNode(root, path, (g) => ({ ...g, rules: [...(g.rules || []), node] })));

  return (
    <div
      style={{
        padding: '12px 14px',
        border: '1.5px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--color-bg-surface)',
      }}
    >
      <div
        className="font-body"
        style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 10 }}
      >
        {t('automation.onlyRunIf')}
      </div>
      {cols.length === 0 ? (
        <p className="font-body" style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
          {t('automation.noFilterableColumns')}
        </p>
      ) : (
        <GroupEditor
          group={root}
          path={[]}
          depth={0}
          cols={cols}
          allTasks={allTasks}
          optionLabels={optionLabels}
          onUpdate={handleUpdate}
          onRemove={handleRemove}
          onAdd={handleAdd}
        />
      )}
    </div>
  );
};

export default ConditionTreeBuilder;
