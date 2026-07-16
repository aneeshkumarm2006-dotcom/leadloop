import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Users,
  Calendar as CalendarIcon,
  Folder,
  ChevronRight,
} from 'lucide-react';
import PageWrapper from '../components/layout/PageWrapper';
import Chip from '../components/ui/Chip';
import { getMyTasks } from '../services/taskService';
import useOrgStore from '../store/orgStore';

/**
 * My Leads (Phase 0 §0.1) — repurposed from the old personal-task page into an
 * "assigned to me" view of leads/deals across every board. Personal tasks are
 * no longer a concept here; this lists the items where the current agent is an
 * assignee, grouped by board, each opening its board for work.
 *
 * Route stays /my-tasks and the file name is unchanged to avoid churn — only the
 * presentation is reframed (see PLAN.md §0.1 / §0.4).
 */

const formatDate = (dateStr, lng) => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return d.toLocaleDateString(lng || undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const EmptyState = () => {
  const { t } = useTranslation();
  return (
    <div
      className="flex flex-col items-center justify-center"
      style={{ padding: '80px 20px' }}
    >
      <div
        className="flex items-center justify-center"
        style={{
          width: 64,
          height: 64,
          borderRadius: 'var(--radius-full)',
          background: 'var(--color-accent-light)',
          marginBottom: 20,
        }}
      >
        <Users size={28} color="var(--color-accent)" />
      </div>
      <h3
        className="font-display font-bold"
        style={{ fontSize: 18, color: 'var(--color-text-primary)' }}
      >
        {t('leads.empty')}
      </h3>
      <p
        className="font-body mt-2"
        style={{
          fontSize: 14,
          color: 'var(--color-text-secondary)',
          maxWidth: 360,
          textAlign: 'center',
        }}
      >
        {t('leads.emptyHint')}
      </p>
    </div>
  );
};

const LeadCard = ({ lead, onOpen, lng }) => (
  <button
    type="button"
    onClick={() => onOpen(lead)}
    className="w-full text-left bg-surface transition-shadow duration-150 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]"
    style={{
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-card)',
      padding: '14px 18px',
    }}
  >
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p
          className="font-body font-semibold truncate"
          style={{ fontSize: 15, color: 'var(--color-text-primary)' }}
        >
          {lead.name}
        </p>
        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
          {lead.status && (
            <Chip type="status" value={lead.status} board={lead.board} />
          )}
          {lead.dueDate && (
            <span className="flex items-center gap-1.5">
              <CalendarIcon size={13} color="var(--color-text-muted)" />
              <span
                className="font-body"
                style={{ fontSize: 12, color: 'var(--color-text-muted)' }}
              >
                {formatDate(lead.dueDate, lng)}
              </span>
            </span>
          )}
        </div>
      </div>
      <ChevronRight
        size={18}
        color="var(--color-text-muted)"
        className="shrink-0"
        aria-hidden="true"
      />
    </div>
  </button>
);

const BoardGroup = ({ boardName, leads, onOpen, lng }) => (
  <section>
    <div className="flex items-center gap-2 mb-2.5">
      <Folder size={14} color="var(--color-text-muted)" aria-hidden="true" />
      <h2
        className="font-body font-semibold"
        style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}
      >
        {boardName}
      </h2>
      <span
        className="font-body"
        style={{ fontSize: 12, color: 'var(--color-text-muted)' }}
      >
        ({leads.length})
      </span>
    </div>
    <div className="flex flex-col gap-2.5">
      {leads.map((lead) => (
        <LeadCard key={lead._id} lead={lead} onOpen={onOpen} lng={lng} />
      ))}
    </div>
  </section>
);

const MyTasksPage = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const currentOrgId = useOrgStore((s) => s.currentOrg?._id);
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchLeads = useCallback(async () => {
    try {
      const all = await getMyTasks(currentOrgId || undefined);
      // Assigned leads/deals only — drop the deprecated personal-task concept.
      setLeads(all.filter((task) => !task.isPersonal && task.board));
    } catch (err) {
      console.error('Failed to fetch assigned leads:', err);
    } finally {
      setLoading(false);
    }
  }, [currentOrgId]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  const handleOpen = (lead) => {
    const boardId = lead.board?._id || lead.board;
    if (boardId) navigate(`/boards/${boardId}?highlightTask=${lead._id}`);
  };

  // Group assigned leads by their board for a scannable, cross-board view.
  const groups = useMemo(() => {
    const byBoard = new Map();
    for (const lead of leads) {
      const id = lead.board?._id || lead.board || 'unknown';
      const name = lead.board?.name || 'Board';
      if (!byBoard.has(id)) byBoard.set(id, { name, leads: [] });
      byBoard.get(id).leads.push(lead);
    }
    return Array.from(byBoard.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [leads]);

  return (
    <PageWrapper>
      {/* Header */}
      <div className="flex items-center gap-3">
        <div
          className="flex items-center justify-center"
          style={{
            width: 40,
            height: 40,
            borderRadius: 'var(--radius-lg)',
            background: 'var(--color-accent-light)',
          }}
        >
          <Users size={20} color="var(--color-accent)" />
        </div>
        <div>
          <h1
            className="font-display font-bold"
            style={{ fontSize: 22, color: 'var(--color-text-primary)' }}
          >
            {t('leads.title')}
          </h1>
          <p
            className="font-body"
            style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}
          >
            {t('leads.subtitle')}
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="mt-6">
        {loading ? (
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="animate-pulse bg-surface"
                style={{
                  height: 72,
                  borderRadius: 'var(--radius-lg)',
                  boxShadow: 'var(--shadow-card)',
                }}
              />
            ))}
          </div>
        ) : leads.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="flex flex-col gap-7">
            {groups.map((group) => (
              <BoardGroup
                key={group.name}
                boardName={group.name}
                leads={group.leads}
                onOpen={handleOpen}
                lng={i18n.resolvedLanguage}
              />
            ))}
          </div>
        )}
      </div>
    </PageWrapper>
  );
};

export default MyTasksPage;
