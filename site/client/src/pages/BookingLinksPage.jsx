import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CalendarClock, Plus, Pencil, Trash2, Copy, ChevronLeft, ExternalLink } from 'lucide-react';
import PageWrapper from '../components/layout/PageWrapper';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import useBoardStore from '../store/boardStore';
import useOrgStore from '../store/orgStore';
import useToastStore from '../store/toastStore';
import * as bookingService from '../services/bookingService';
import { getGroups } from '../services/taskService';

const DAY_NAMES = (lang) =>
  [0, 1, 2, 3, 4, 5, 6].map((d) => new Date(Date.UTC(2026, 0, 4 + d)).toLocaleDateString(lang, { weekday: 'short' }));

const BookingLinksPage = () => {
  const { id: boardId } = useParams();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const toastError = useToastStore((s) => s.error);
  const toastSuccess = useToastStore((s) => s.success);

  const getBoardById = useBoardStore((s) => s.getBoardById);
  const fetchBoards = useBoardStore((s) => s.fetchBoards);
  const currentOrg = useOrgStore((s) => s.currentOrg);
  const members = useOrgStore((s) => s.members);
  const fetchMembers = useOrgStore((s) => s.fetchMembers);

  const board = getBoardById(boardId);
  const [groups, setGroups] = useState([]);
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // link | 'new' | null

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [lk, gr] = await Promise.all([bookingService.listBookingLinks(boardId), getGroups(boardId)]);
      setLinks(lk);
      setGroups(gr || []);
    } catch (err) {
      toastError(err?.response?.data?.error || t('booking.loadError'));
    } finally {
      setLoading(false);
    }
  }, [boardId, toastError, t]);

  useEffect(() => {
    if (currentOrg?._id) {
      if (!board) fetchBoards(currentOrg._id).catch(() => {});
      if (!members || members.length === 0) fetchMembers(currentOrg._id).catch(() => {});
    }
    load();
  }, [boardId, currentOrg?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async (payload) => {
    try {
      if (editing && editing !== 'new') await bookingService.updateBookingLink(editing._id, payload);
      else await bookingService.createBookingLink(boardId, payload);
      setEditing(null);
      toastSuccess(t('booking.saved'));
      await load();
    } catch (err) {
      toastError(err?.response?.data?.error || t('booking.saveError'));
    }
  };

  const handleDelete = async (link) => {
    if (!window.confirm(t('booking.deleteConfirm', { title: link.title }))) return;
    try {
      await bookingService.deleteBookingLink(link._id);
      await load();
    } catch (err) {
      toastError(err?.response?.data?.error || t('booking.deleteError'));
    }
  };

  const copyUrl = (url) => { navigator.clipboard?.writeText(url); toastSuccess(t('booking.linkCopied')); };

  return (
    <PageWrapper>
      <button type="button" onClick={() => navigate(`/boards/${boardId}`)} className="inline-flex items-center gap-1 font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)', background: 'transparent', border: 'none', cursor: 'pointer', marginBottom: 10 }}>
        <ChevronLeft size={15} /> {board?.name || t('booking.backToBoard')}
      </button>

      <div className="flex items-center justify-between flex-wrap gap-3" style={{ marginBottom: 18 }}>
        <div className="flex items-center gap-2">
          <CalendarClock size={22} color="var(--color-accent)" />
          <h1 className="font-display" style={{ fontSize: 24, fontWeight: 700, color: 'var(--color-text-primary)' }}>{t('booking.title')}</h1>
        </div>
        <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>{t('booking.newLink')}</Button>
      </div>
      <p className="font-body" style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 20, maxWidth: 640 }}>{t('booking.subtitle')}</p>

      {loading ? (
        <p className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{t('booking.loading')}</p>
      ) : links.length === 0 ? (
        <div className="bg-surface" style={{ borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: 40, textAlign: 'center' }}>
          <CalendarClock size={36} color="var(--color-text-muted)" />
          <p className="font-body" style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)', marginTop: 12 }}>{t('booking.emptyTitle')}</p>
          <p className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 4 }}>{t('booking.emptySub')}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {links.map((l) => (
            <div key={l._id} className="bg-surface flex items-center gap-3" style={{ borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: 16, opacity: l.active ? 1 : 0.6 }}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-body" style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)' }}>{l.title}</span>
                  {!l.active && <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>· {t('booking.inactive')}</span>}
                </div>
                <div className="font-body" style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                  {t('booking.minutes', { count: l.durationMinutes })} · {t('booking.bookingsCount', { count: l.bookingCount || 0 })}
                </div>
                <button type="button" onClick={() => copyUrl(l.publicUrl)} className="inline-flex items-center gap-1.5 font-body" style={{ fontSize: 12, color: 'var(--color-accent)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, marginTop: 6 }}>
                  <Copy size={12} /> {l.publicUrl}
                </button>
              </div>
              <a href={l.publicUrl} target="_blank" rel="noreferrer" className="flex items-center justify-center rounded-md hover:bg-[color:var(--color-bg-subtle)]" style={{ width: 32, height: 32 }} title={t('booking.open')}><ExternalLink size={15} color="var(--color-text-muted)" /></a>
              <button type="button" onClick={() => setEditing(l)} className="flex items-center justify-center rounded-md hover:bg-[color:var(--color-bg-subtle)]" style={{ width: 32, height: 32 }} title={t('booking.edit')}><Pencil size={15} color="var(--color-text-muted)" /></button>
              <button type="button" onClick={() => handleDelete(l)} className="flex items-center justify-center rounded-md hover:bg-[color:var(--color-bg-subtle)]" style={{ width: 32, height: 32 }} title={t('booking.delete')}><Trash2 size={15} color="#DC2626" /></button>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <BookingLinkForm
          initial={editing === 'new' ? null : editing}
          board={board}
          groups={groups}
          members={members}
          lang={i18n.resolvedLanguage}
          onClose={() => setEditing(null)}
          onSubmit={handleSave}
        />
      )}
    </PageWrapper>
  );
};

const BookingLinkForm = ({ initial, board, groups, members, lang, onClose, onSubmit }) => {
  const { t } = useTranslation();
  const cols = board?.columns || [];
  const dateCols = cols.filter((c) => ['date', 'timeline'].includes(c.type));

  const [title, setTitle] = useState(initial?.title || '');
  const [location, setLocation] = useState(initial?.location || '');
  const [groupId, setGroupId] = useState(initial?.group ? String(initial.group) : (groups[0]?._id ? String(groups[0]._id) : ''));
  const [dateColumnId, setDateColumnId] = useState(initial?.dateColumnId ? String(initial.dateColumnId) : (dateCols[0]?._id ? String(dateCols[0]._id) : ''));
  const [durationMinutes, setDuration] = useState(initial?.durationMinutes ?? 30);
  const [timezone, setTimezone] = useState(initial?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Toronto');
  const [minNoticeHours, setMinNotice] = useState(initial?.minNoticeHours ?? 2);
  const [dateRangeDays, setDateRange] = useState(initial?.dateRangeDays ?? 30);
  const [bufferBefore, setBufBefore] = useState(initial?.bufferBefore ?? 0);
  const [bufferAfter, setBufAfter] = useState(initial?.bufferAfter ?? 0);
  const [dailyCap, setDailyCap] = useState(initial?.dailyCap ?? 0);
  const [assignMode, setAssignMode] = useState(initial?.assignMode || 'round_robin');
  const [agents, setAgents] = useState((initial?.agents || []).map((a) => String(a)));
  const [active, setActive] = useState(initial?.active !== false);
  const [branding, setBranding] = useState({ logoUrl: initial?.branding?.logoUrl || '', coverUrl: initial?.branding?.coverUrl || '', accentColor: initial?.branding?.accentColor || '', headline: initial?.branding?.headline || '' });
  const [err, setErr] = useState('');

  // Weekly hours editor state: { [day]: { enabled, start, end } }
  const initHours = useMemo(() => {
    const map = {};
    for (let d = 0; d < 7; d += 1) map[d] = { enabled: false, start: '09:00', end: '17:00' };
    for (const w of initial?.weeklyHours || []) map[w.dayOfWeek] = { enabled: true, start: w.start, end: w.end };
    if (!initial) [1, 2, 3, 4, 5].forEach((d) => { map[d] = { enabled: true, start: '09:00', end: '17:00' }; });
    return map;
  }, [initial]);
  const [hours, setHours] = useState(initHours);
  const dayNames = DAY_NAMES(lang);

  const setDay = (d, patch) => setHours((h) => ({ ...h, [d]: { ...h[d], ...patch } }));

  const submit = () => {
    setErr('');
    if (!title.trim()) return setErr(t('booking.errTitle'));
    if (!groupId) return setErr(t('booking.errGroup'));
    const weeklyHours = Object.entries(hours).filter(([, v]) => v.enabled).map(([d, v]) => ({ dayOfWeek: Number(d), start: v.start, end: v.end }));
    if (weeklyHours.length === 0) return setErr(t('booking.errHours'));
    onSubmit({
      title: title.trim(), location, group: groupId, dateColumnId: dateColumnId || null,
      durationMinutes: Number(durationMinutes), timezone, minNoticeHours: Number(minNoticeHours),
      dateRangeDays: Number(dateRangeDays), bufferBefore: Number(bufferBefore), bufferAfter: Number(bufferAfter),
      dailyCap: Number(dailyCap), assignMode, agents, active, weeklyHours, branding,
    });
  };

  return (
    <Modal isOpen onClose={onClose} title={initial ? t('booking.editLink') : t('booking.newLink')} maxWidth={620}
      footer={<><Button variant="secondary" size="sm" onClick={onClose}>{t('booking.cancel')}</Button><Button variant="primary" size="sm" onClick={submit}>{initial ? t('booking.save') : t('booking.create')}</Button></>}>
      <div className="flex flex-col" style={{ maxHeight: '66vh', overflowY: 'auto', paddingRight: 4 }}>
        <Section title={t('booking.secDetails')}>
          <Input label={t('booking.fTitle')} placeholder={t('booking.fTitlePlaceholder')} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          <Input label={t('booking.fLocation')} placeholder={t('booking.fLocationPlaceholder')} value={location} onChange={(e) => setLocation(e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('booking.fGroup')}><Select value={groupId} onChange={setGroupId} options={groups.map((g) => ({ value: String(g._id), label: g.name }))} /></Field>
            <Field label={t('booking.fDuration')}><input type="number" value={durationMinutes} onChange={(e) => setDuration(e.target.value)} style={selectStyle} /></Field>
          </div>
          <Field label={t('booking.fDateColumn')}>
            <Select value={dateColumnId} onChange={setDateColumnId} options={[{ value: '', label: t('booking.noDateColumn') }, ...dateCols.map((c) => ({ value: String(c._id), label: c.name }))]} />
          </Field>
          <p className="font-body" style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: -4 }}>{t('booking.dateColumnHint')}</p>
        </Section>

        <Section title={t('booking.secAvailability')}>
          <Field label={t('booking.fTimezone')}><input value={timezone} onChange={(e) => setTimezone(e.target.value)} style={selectStyle} /></Field>
          <div className="flex flex-col gap-1.5">
            {[0, 1, 2, 3, 4, 5, 6].map((d) => (
              <div key={d} className="flex items-center gap-3" style={{ padding: '4px 0' }}>
                <button
                  type="button"
                  onClick={() => setDay(d, { enabled: !hours[d].enabled })}
                  className="font-body"
                  style={{ width: 56, height: 30, fontSize: 12.5, fontWeight: 700, borderRadius: 999, cursor: 'pointer', border: `1.5px solid ${hours[d].enabled ? 'var(--color-accent)' : 'var(--color-border-strong)'}`, background: hours[d].enabled ? 'var(--color-accent)' : 'transparent', color: hours[d].enabled ? '#fff' : 'var(--color-text-muted)' }}
                >
                  {dayNames[d]}
                </button>
                {hours[d].enabled ? (
                  <div className="flex items-center gap-2">
                    <input type="time" value={hours[d].start} onChange={(e) => setDay(d, { start: e.target.value })} style={timeStyle} />
                    <span style={{ color: 'var(--color-text-muted)' }}>–</span>
                    <input type="time" value={hours[d].end} onChange={(e) => setDay(d, { end: e.target.value })} style={timeStyle} />
                  </div>
                ) : <span className="font-body" style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>{t('booking.unavailable')}</span>}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-3" style={{ marginTop: 6 }}>
            <Input label={t('booking.fMinNotice')} type="number" value={minNoticeHours} onChange={(e) => setMinNotice(e.target.value)} />
            <Input label={t('booking.fDateRange')} type="number" value={dateRangeDays} onChange={(e) => setDateRange(e.target.value)} />
            <Input label={t('booking.fDailyCap')} type="number" value={dailyCap} onChange={(e) => setDailyCap(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('booking.fBufBefore')} type="number" value={bufferBefore} onChange={(e) => setBufBefore(e.target.value)} />
            <Input label={t('booking.fBufAfter')} type="number" value={bufferAfter} onChange={(e) => setBufAfter(e.target.value)} />
          </div>
        </Section>

        <Section title={t('booking.secAssignment')}>
          <div className="flex gap-2">
            {['round_robin', 'fixed'].map((m) => (
              <button key={m} type="button" onClick={() => setAssignMode(m)} className="font-body" style={{ flex: 1, height: 34, fontSize: 13, fontWeight: 600, borderRadius: 'var(--radius-md)', border: `1.5px solid ${assignMode === m ? 'var(--color-accent)' : 'var(--color-border-strong)'}`, background: assignMode === m ? 'var(--color-accent-light)' : 'transparent', color: assignMode === m ? 'var(--color-accent)' : 'var(--color-text-secondary)', cursor: 'pointer' }}>{t(`booking.assign.${m}`)}</button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {(members || []).map((m) => {
              const on = agents.includes(String(m._id));
              return (
                <button key={m._id} type="button" onClick={() => setAgents((a) => (on ? a.filter((x) => x !== String(m._id)) : [...a, String(m._id)]))} className="font-body" style={{ fontSize: 12.5, fontWeight: 600, padding: '5px 11px', borderRadius: 999, cursor: 'pointer', border: `1.5px solid ${on ? 'var(--color-accent)' : 'var(--color-border-strong)'}`, background: on ? 'var(--color-accent-light)' : 'transparent', color: on ? 'var(--color-accent)' : 'var(--color-text-secondary)' }}>{m.name || m.email}</button>
              );
            })}
          </div>
        </Section>

        <Section title={t('booking.secBranding')} last>
          <input placeholder={t('booking.bHeadline')} value={branding.headline} onChange={(e) => setBranding((b) => ({ ...b, headline: e.target.value }))} style={selectStyle} />
          <input placeholder={t('booking.bLogo')} value={branding.logoUrl} onChange={(e) => setBranding((b) => ({ ...b, logoUrl: e.target.value }))} style={selectStyle} />
          <input placeholder={t('booking.bCover')} value={branding.coverUrl} onChange={(e) => setBranding((b) => ({ ...b, coverUrl: e.target.value }))} style={selectStyle} />
          <div className="flex items-center gap-2">
            <input type="color" value={branding.accentColor || '#4F46E5'} onChange={(e) => setBranding((b) => ({ ...b, accentColor: e.target.value }))} style={{ width: 40, height: 32, border: '1px solid var(--color-border)', borderRadius: 6, cursor: 'pointer' }} />
            <span className="font-body" style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{branding.accentColor || t('booking.bAccent')}</span>
          </div>
          <label className="flex items-center gap-2 font-body" style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> {t('booking.fActive')}
          </label>
          {err && <p className="font-body" style={{ fontSize: 13, color: '#DC2626' }}>{err}</p>}
        </Section>
      </div>
    </Modal>
  );
};

const Section = ({ title, children, last }) => (
  <div style={{ padding: '16px 0', borderBottom: last ? 'none' : '1px solid var(--color-border)' }}>
    <div className="font-body" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)', marginBottom: 12 }}>{title}</div>
    <div className="flex flex-col gap-3">{children}</div>
  </div>
);

const Field = ({ label, children }) => (
  <label className="font-body" style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
    <span style={{ display: 'block', marginBottom: 6 }}>{label}</span>
    {children}
  </label>
);
const Select = ({ value, onChange, options }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)} style={selectStyle}>
    {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
  </select>
);
const selectStyle = { width: '100%', height: 38, padding: '0 10px', fontSize: 14, border: '1.5px solid var(--color-border-strong)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-surface, #fff)', color: 'var(--color-text-primary)' };
const timeStyle = { height: 34, padding: '0 8px', fontSize: 13, border: '1.5px solid var(--color-border-strong)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-surface, #fff)', color: 'var(--color-text-primary)' };

export default BookingLinksPage;
