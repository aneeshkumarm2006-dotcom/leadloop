import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3, Plus } from 'lucide-react';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import EmptyState from '../ui/EmptyState';
import { ChartWidgetForm, WidgetCard } from '../board/InsightsTab';
import * as chartService from '../../services/chartService';
import { getBoards } from '../../services/boardService';

/**
 * WorkspaceDashboard — the composable Reports dashboard (Phase 2.1). Admins add
 * chart widgets, each pulling from any board in the workspace, arranged in a
 * responsive grid. Reuses the board Insights widget engine (ChartWidget +
 * ChartWidgetRenderer) with a per-widget board picker.
 *
 * Props: { orgId, isAdmin }
 */
const WorkspaceDashboard = ({ orgId, isAdmin }) => {
  const { t } = useTranslation();
  const [boards, setBoards] = useState([]);
  const [widgets, setWidgets] = useState([]);
  const [dataById, setDataById] = useState({});
  const [loadingById, setLoadingById] = useState({});
  const [errorById, setErrorById] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [pendingDelete, setPendingDelete] = useState(null);

  const fetchData = useCallback(
    async (widget) => {
      setLoadingById((m) => ({ ...m, [widget._id]: true }));
      setErrorById((m) => ({ ...m, [widget._id]: '' }));
      try {
        const data = await chartService.getChartData(widget._id);
        setDataById((m) => ({ ...m, [widget._id]: data }));
      } catch (err) {
        setErrorById((m) => ({ ...m, [widget._id]: err?.response?.data?.error || t('reports.loadFailed') }));
      } finally {
        setLoadingById((m) => ({ ...m, [widget._id]: false }));
      }
    },
    [t]
  );

  const reload = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError('');
    try {
      const [bd, list] = await Promise.all([
        getBoards(orgId),
        chartService.listCharts({ workspaceId: orgId }),
      ]);
      setBoards(Array.isArray(bd) ? bd : []);
      setWidgets(Array.isArray(list) ? list : []);
      (list || []).forEach((w) => fetchData(w));
    } catch (err) {
      setError(err?.response?.data?.error || t('reports.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [orgId, fetchData, t]);

  useEffect(() => {
    reload();
  }, [reload]);

  const openCreate = () => { setEditing(null); setFormError(''); setFormOpen(true); };
  const openEdit = (w) => { setEditing(w); setFormError(''); setFormOpen(true); };

  const handleSubmit = async (payload) => {
    setSaving(true);
    setFormError('');
    try {
      if (editing) {
        const updated = await chartService.updateChart(editing._id, payload);
        setWidgets((l) => l.map((w) => (w._id === updated._id ? updated : w)));
        await fetchData(updated);
      } else {
        const created = await chartService.createChart(payload); // payload carries boardId
        setWidgets((l) => [...l, created]);
        await fetchData(created);
      }
      setFormOpen(false);
    } catch (err) {
      setFormError(err?.response?.data?.error || t('reports.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    const w = pendingDelete;
    setPendingDelete(null);
    if (!w) return;
    try {
      await chartService.deleteChart(w._id);
      setWidgets((l) => l.filter((x) => x._id !== w._id));
    } catch (err) {
      setError(err?.response?.data?.error || t('reports.deleteFailed'));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display font-bold" style={{ fontSize: 18, color: 'var(--color-text-primary)' }}>
            {t('reports.customDashboard')}
          </h2>
          <p className="font-body mt-0.5" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            {t('reports.customDashboardDesc')}
          </p>
        </div>
        {isAdmin && (
          <Button variant="primary" size="sm" icon={Plus} onClick={openCreate} disabled={boards.length === 0}>
            {t('reports.addWidget')}
          </Button>
        )}
      </div>

      {error && <p style={{ fontSize: 13, color: 'var(--color-status-stuck)' }}>{error}</p>}

      {loading && widgets.length === 0 ? (
        <p className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{t('common.loading')}</p>
      ) : widgets.length === 0 ? (
        <div className="bg-surface" style={{ borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '48px 16px' }}>
          <EmptyState
            icon={BarChart3}
            title={t('reports.noWidgets')}
            description={isAdmin ? t('reports.noWidgetsAdmin') : t('reports.noWidgetsMember')}
            actionLabel={isAdmin ? t('reports.addWidget') : undefined}
            onAction={isAdmin ? openCreate : undefined}
          />
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
          {widgets.map((w) => (
            <WidgetCard
              key={w._id}
              widget={w}
              data={dataById[w._id]}
              loading={!!loadingById[w._id]}
              error={errorById[w._id]}
              isAdmin={isAdmin}
              onEdit={() => openEdit(w)}
              onDelete={() => setPendingDelete(w)}
              onRefresh={() => fetchData(w)}
            />
          ))}
        </div>
      )}

      {formOpen && (
        <ChartWidgetForm
          isOpen={formOpen}
          onClose={() => setFormOpen(false)}
          boards={boards}
          initial={editing}
          saving={saving}
          error={formError}
          onSubmit={handleSubmit}
        />
      )}

      <Modal
        isOpen={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        title={t('reports.deleteWidgetQ')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingDelete(null)}>{t('common.cancel')}</Button>
            <Button variant="danger" onClick={handleConfirmDelete}>{t('common.delete')}</Button>
          </>
        }
      >
        <p className="font-body" style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>
          {t('reports.deleteWidgetBody', { name: pendingDelete?.title || t('reports.thisWidget') })}
        </p>
      </Modal>
    </div>
  );
};

export default WorkspaceDashboard;
