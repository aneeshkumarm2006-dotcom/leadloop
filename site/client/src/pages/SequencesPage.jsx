import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Mail, Plus, Pencil, Trash2, ChevronLeft, BarChart3, Send, StopCircle,
  Clock, GripVertical, X, Users,
} from 'lucide-react';
import PageWrapper from '../components/layout/PageWrapper';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import useBoardStore from '../store/boardStore';
import useOrgStore from '../store/orgStore';
import useToastStore from '../store/toastStore';
import * as sequenceService from '../services/sequenceService';
import { getTasks } from '../services/taskService';

const DELAY_UNITS = ['minutes', 'hours', 'days'];

const STATUS_COLOR = {
  active: 'var(--color-status-working)',
  completed: 'var(--color-status-done)',
  replied: 'var(--color-accent)',
  stopped: 'var(--color-text-muted)',
  failed: 'var(--color-status-stuck)',
  unsubscribed: 'var(--color-text-muted)',
};

const blankStep = () => ({ delayAmount: 0, delayUnit: 'days', subject: '', body: '' });

const pct = (n) => `${Math.round((n || 0) * 100)}%`;

// ---------------------------------------------------------------------------
// Builder modal — name, recipient column, stop-on-reply, ordered steps.
// ---------------------------------------------------------------------------
const SequenceForm = ({ initial, emailColumns, onSave, onCancel, t }) => {
  const [name, setName] = useState(initial?.name || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [emailColumnId, setEmailColumnId] = useState(initial?.emailColumnId || '');
  const [stopOnReply, setStopOnReply] = useState(initial?.stopOnReply !== false);
  const [steps, setSteps] = useState(
    initial?.steps?.length ? initial.steps.map((s) => ({ ...s })) : [blankStep()]
  );
  const [saving, setSaving] = useState(false);

  const setStep = (i, patch) =>
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const addStep = () =>
    setSteps((prev) => [...prev, { ...blankStep(), delayAmount: 2, delayUnit: 'days' }]);
  const removeStep = (i) => setSteps((prev) => prev.filter((_, idx) => idx !== i));

  const submit = async () => {
    setSaving(true);
    const ok = await onSave({
      name: name.trim(),
      description: description.trim(),
      emailColumnId,
      stopOnReply,
      steps: steps.map((s) => ({
        delayAmount: Math.max(0, Number(s.delayAmount) || 0),
        delayUnit: DELAY_UNITS.includes(s.delayUnit) ? s.delayUnit : 'days',
        subject: s.subject || '',
        body: s.body || '',
      })),
    });
    setSaving(false);
    return ok;
  };

  return (
    <div className="font-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Input label={t('sequences.name')} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('sequences.namePh')} required />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block" style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
            {t('sequences.emailColumn')}
          </label>
          <select
            value={emailColumnId}
            onChange={(e) => setEmailColumnId(e.target.value)}
            className="w-full font-body"
            style={{ fontSize: 14, padding: '9px 10px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg-input)' }}
          >
            <option value="">{t('sequences.emailColumnAuto')}</option>
            {emailColumns.map((c) => (
              <option key={c._id} value={c._id}>{c.name}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2" style={{ alignSelf: 'flex-end', paddingBottom: 9, cursor: 'pointer' }}>
          <input type="checkbox" checked={stopOnReply} onChange={(e) => setStopOnReply(e.target.checked)} />
          <span style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>{t('sequences.stopOnReply')}</span>
        </label>
      </div>

      <div>
        <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>{t('sequences.steps')}</span>
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{t('sequences.varsHint')}</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {steps.map((s, i) => (
            <div key={i} style={{ border: '1px solid var(--color-border)', borderRadius: 12, padding: 12, background: 'var(--color-bg-surface)' }}>
              <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
                <div className="flex items-center gap-2" style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)' }}>
                  <GripVertical size={14} /> {t('sequences.stepN', { n: i + 1 })}
                </div>
                {steps.length > 1 && (
                  <button type="button" onClick={() => removeStep(i)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
                    <X size={15} />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2" style={{ marginBottom: 10, fontSize: 13, color: 'var(--color-text-secondary)' }}>
                <Clock size={14} color="var(--color-text-muted)" />
                {i === 0 && Number(s.delayAmount) === 0 ? (
                  <span>{t('sequences.sendImmediately')}</span>
                ) : (
                  <span>{i === 0 ? t('sequences.afterEnroll') : t('sequences.afterPrev')}</span>
                )}
                <input
                  type="number" min={0} value={s.delayAmount}
                  onChange={(e) => setStep(i, { delayAmount: e.target.value })}
                  style={{ width: 64, fontSize: 13, padding: '5px 8px', borderRadius: 7, border: '1px solid var(--color-border)' }}
                />
                <select
                  value={s.delayUnit} onChange={(e) => setStep(i, { delayUnit: e.target.value })}
                  style={{ fontSize: 13, padding: '5px 8px', borderRadius: 7, border: '1px solid var(--color-border)', background: 'var(--color-bg-input)' }}
                >
                  {DELAY_UNITS.map((u) => <option key={u} value={u}>{t(`sequences.unit_${u}`)}</option>)}
                </select>
                <span>{t('sequences.thenSend')}</span>
              </div>

              <Input value={s.subject} onChange={(e) => setStep(i, { subject: e.target.value })} placeholder={t('sequences.subjectPh')} />
              <div style={{ height: 8 }} />
              <Input multiline rows={4} value={s.body} onChange={(e) => setStep(i, { body: e.target.value })} placeholder={t('sequences.bodyPh')} />
            </div>
          ))}
        </div>

        <button
          type="button" onClick={addStep}
          className="inline-flex items-center gap-1.5"
          style={{ marginTop: 10, fontSize: 13, fontWeight: 600, color: 'var(--color-accent)', background: 'transparent', border: 'none', cursor: 'pointer' }}
        >
          <Plus size={15} /> {t('sequences.addStep')}
        </button>
      </div>

      <div className="flex items-center justify-end gap-2" style={{ marginTop: 4 }}>
        <Button variant="secondary" onClick={onCancel}>{t('common.cancel')}</Button>
        <Button variant="primary" onClick={submit} disabled={saving || !name.trim()}>{t('common.save')}</Button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Manage panel — stats, bulk enroll (mass email), live enrollment list.
// ---------------------------------------------------------------------------
const ManagePanel = ({ sequence, boardId, onClose, t }) => {
  const toastError = useToastStore((s) => s.error);
  const toastSuccess = useToastStore((s) => s.success);
  const [stats, setStats] = useState(null);
  const [enrollments, setEnrollments] = useState([]);
  const [picking, setPicking] = useState(false);
  const [leads, setLeads] = useState([]);
  const [selected, setSelected] = useState({});

  const refresh = useCallback(async () => {
    try {
      const [st, en] = await Promise.all([
        sequenceService.getSequenceStats(sequence._id),
        sequenceService.listEnrollments(sequence._id),
      ]);
      setStats(st);
      setEnrollments(en);
    } catch (err) {
      toastError(err?.response?.data?.error || t('sequences.loadError'));
    }
  }, [sequence._id, toastError, t]);

  useEffect(() => { refresh(); }, [refresh]);

  const openPicker = async () => {
    setPicking(true);
    try {
      const tasks = await getTasks(boardId);
      setLeads(tasks || []);
    } catch {
      setLeads([]);
    }
  };

  const enroll = async () => {
    const ids = Object.keys(selected).filter((k) => selected[k]);
    if (!ids.length) return;
    try {
      const res = await sequenceService.enrollLeads(sequence._id, ids);
      toastSuccess(t('sequences.enrolledN', { n: res.enrolled }));
      setPicking(false);
      setSelected({});
      await refresh();
    } catch (err) {
      toastError(err?.response?.data?.error || t('sequences.enrollError'));
    }
  };

  const stop = async (enrollmentId) => {
    try {
      await sequenceService.stopEnrollment(enrollmentId);
      await refresh();
    } catch (err) {
      toastError(err?.response?.data?.error || t('sequences.stopError'));
    }
  };

  const statCards = stats
    ? [
        { label: t('sequences.statActive'), value: stats.byStatus.active, color: 'var(--color-status-working)' },
        { label: t('sequences.statCompleted'), value: stats.byStatus.completed, color: 'var(--color-status-done)' },
        { label: t('sequences.statReplied'), value: stats.replied, color: 'var(--color-accent)' },
        { label: t('sequences.statOpenRate'), value: pct(stats.emails.openRate), color: 'var(--color-text-primary)' },
        { label: t('sequences.statClickRate'), value: pct(stats.emails.clickRate), color: 'var(--color-text-primary)' },
      ]
    : [];

  if (picking) {
    return (
      <div className="font-body">
        <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{t('sequences.pickLeads')}</span>
          <button type="button" onClick={() => setPicking(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}><X size={16} /></button>
        </div>
        <div style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 10 }}>
          {leads.length === 0 && <div style={{ padding: 16, fontSize: 13, color: 'var(--color-text-muted)' }}>{t('sequences.noLeads')}</div>}
          {leads.map((lead) => (
            <label key={lead._id} className="flex items-center gap-2" style={{ padding: '9px 12px', borderBottom: '1px solid var(--color-border)', cursor: 'pointer', fontSize: 13 }}>
              <input type="checkbox" checked={!!selected[lead._id]} onChange={(e) => setSelected((p) => ({ ...p, [lead._id]: e.target.checked }))} />
              <span>{lead.name}</span>
            </label>
          ))}
        </div>
        <div className="flex items-center justify-end gap-2" style={{ marginTop: 14 }}>
          <Button variant="secondary" onClick={() => setPicking(false)}>{t('common.cancel')}</Button>
          <Button variant="primary" icon={Send} onClick={enroll} disabled={Object.values(selected).every((v) => !v)}>
            {t('sequences.enrollSelected')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="font-body">
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(5, 1fr)', marginBottom: 18 }}>
        {statCards.map((c) => (
          <div key={c.label} style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: '10px 12px', background: 'var(--color-bg-surface)' }}>
            <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-display)', color: c.color }}>{c.value}</div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{c.label}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{t('sequences.enrollmentsN', { n: enrollments.length })}</span>
        <Button variant="primary" icon={Users} onClick={openPicker}>{t('sequences.enrollLeads')}</Button>
      </div>

      <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 10 }}>
        {enrollments.length === 0 && (
          <div style={{ padding: 16, fontSize: 13, color: 'var(--color-text-muted)' }}>{t('sequences.noEnrollments')}</div>
        )}
        {enrollments.map((e) => (
          <div key={e._id} className="flex items-center justify-between" style={{ padding: '10px 12px', borderBottom: '1px solid var(--color-border)', fontSize: 13 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.task?.name || '—'}</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{e.recipientEmail} · {t('sequences.sentCount', { n: e.sentCount })}</div>
            </div>
            <div className="flex items-center gap-3">
              <span style={{ fontSize: 11, fontWeight: 600, color: STATUS_COLOR[e.status], textTransform: 'capitalize' }}>{t(`sequences.es_${e.status}`)}</span>
              {e.status === 'active' && (
                <button type="button" onClick={() => stop(e._id)} title={t('sequences.stop')} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
                  <StopCircle size={16} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end" style={{ marginTop: 14 }}>
        <Button variant="secondary" onClick={onClose}>{t('common.close')}</Button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
const SequencesPage = () => {
  const { id: boardId } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toastError = useToastStore((s) => s.error);
  const toastSuccess = useToastStore((s) => s.success);

  const getBoardById = useBoardStore((s) => s.getBoardById);
  const fetchBoards = useBoardStore((s) => s.fetchBoards);
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const board = getBoardById(boardId);

  const [sequences, setSequences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // sequence | 'new' | null
  const [managing, setManaging] = useState(null); // sequence | null

  const emailColumns = useMemo(
    () => (board?.columns || []).filter((c) => c.type === 'email'),
    [board]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSequences(await sequenceService.listSequences(boardId));
    } catch (err) {
      toastError(err?.response?.data?.error || t('sequences.loadError'));
    } finally {
      setLoading(false);
    }
  }, [boardId, toastError, t]);

  useEffect(() => {
    if (currentOrg?._id && !board) fetchBoards(currentOrg._id).catch(() => {});
    load();
  }, [boardId, currentOrg?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async (payload) => {
    try {
      if (editing && editing !== 'new') await sequenceService.updateSequence(editing._id, payload);
      else await sequenceService.createSequence(boardId, payload);
      setEditing(null);
      toastSuccess(t('sequences.saved'));
      await load();
      return true;
    } catch (err) {
      toastError(err?.response?.data?.error || t('sequences.saveError'));
      return false;
    }
  };

  const toggleActive = async (seq) => {
    try {
      await sequenceService.updateSequence(seq._id, { active: !seq.active });
      await load();
    } catch (err) {
      toastError(err?.response?.data?.error || t('sequences.saveError'));
    }
  };

  const handleDelete = async (seq) => {
    if (!window.confirm(t('sequences.deleteConfirm', { name: seq.name }))) return;
    try {
      await sequenceService.deleteSequence(seq._id);
      await load();
    } catch (err) {
      toastError(err?.response?.data?.error || t('sequences.deleteError'));
    }
  };

  return (
    <PageWrapper>
      <button
        type="button" onClick={() => navigate(`/boards/${boardId}`)}
        className="inline-flex items-center gap-1 font-body"
        style={{ fontSize: 13, color: 'var(--color-text-muted)', background: 'transparent', border: 'none', cursor: 'pointer', marginBottom: 10 }}
      >
        <ChevronLeft size={15} /> {board?.name || t('sequences.backToBoard')}
      </button>

      <div className="flex items-center justify-between flex-wrap gap-3" style={{ marginBottom: 6 }}>
        <div className="flex items-center gap-2">
          <Mail size={22} color="var(--color-accent)" />
          <h1 className="font-display" style={{ fontSize: 24, fontWeight: 700, color: 'var(--color-text-primary)' }}>{t('sequences.title')}</h1>
        </div>
        <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>{t('sequences.new')}</Button>
      </div>
      <p className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 20, maxWidth: 620 }}>
        {t('sequences.subtitle')}
      </p>

      {loading ? (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
          {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 120, borderRadius: 14 }} />)}
        </div>
      ) : sequences.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '64px 20px', border: '1px dashed var(--color-border)', borderRadius: 16, background: 'var(--color-bg-surface)' }}>
          <Mail size={32} color="var(--color-text-muted)" style={{ margin: '0 auto 12px' }} />
          <div className="font-display" style={{ fontSize: 17, fontWeight: 600, marginBottom: 6 }}>{t('sequences.emptyTitle')}</div>
          <div className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 16 }}>{t('sequences.emptyBody')}</div>
          <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>{t('sequences.new')}</Button>
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
          {sequences.map((seq) => (
            <div key={seq._id} style={{ border: '1px solid var(--color-border)', borderRadius: 14, padding: 16, background: 'var(--color-bg-surface)', boxShadow: 'var(--shadow-card, none)' }}>
              <div className="flex items-start justify-between gap-2" style={{ marginBottom: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div className="font-display" style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{seq.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                    {t('sequences.stepCount', { n: seq.steps?.length || 0 })} · {t('sequences.activeN', { n: seq.activeEnrollments || 0 })}
                  </div>
                </div>
                <button
                  type="button" onClick={() => toggleActive(seq)}
                  style={{
                    flexShrink: 0, fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 999, cursor: 'pointer', border: 'none',
                    background: seq.active ? 'var(--color-status-done-bg)' : 'var(--color-bg-subtle)',
                    color: seq.active ? 'var(--color-status-done)' : 'var(--color-text-muted)',
                  }}
                >
                  {seq.active ? t('sequences.on') : t('sequences.off')}
                </button>
              </div>

              {seq.description && (
                <p style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', marginBottom: 12, lineHeight: 1.5 }}>{seq.description}</p>
              )}

              <div className="flex items-center gap-2" style={{ marginTop: 12 }}>
                <Button variant="secondary" icon={BarChart3} onClick={() => setManaging(seq)}>{t('sequences.manage')}</Button>
                <button type="button" onClick={() => setEditing(seq)} title={t('common.edit')} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}><Pencil size={16} /></button>
                <button type="button" onClick={() => handleDelete(seq)} title={t('common.delete')} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}><Trash2 size={16} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        isOpen={!!editing}
        onClose={() => setEditing(null)}
        title={editing && editing !== 'new' ? t('sequences.editTitle') : t('sequences.newTitle')}
        maxWidth={620}
      >
        {editing && (
          <SequenceForm
            initial={editing === 'new' ? null : editing}
            emailColumns={emailColumns}
            onSave={handleSave}
            onCancel={() => setEditing(null)}
            t={t}
          />
        )}
      </Modal>

      <Modal
        isOpen={!!managing}
        onClose={() => setManaging(null)}
        title={managing?.name || t('sequences.manage')}
        maxWidth={640}
      >
        {managing && <ManagePanel sequence={managing} boardId={boardId} onClose={() => setManaging(null)} t={t} />}
      </Modal>
    </PageWrapper>
  );
};

export default SequencesPage;
