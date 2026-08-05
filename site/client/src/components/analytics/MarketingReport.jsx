import { useCallback, useEffect, useMemo, useState } from 'react';
import { Megaphone, Plus, Pencil, Trash2, RefreshCw } from 'lucide-react';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Dropdown from '../ui/Dropdown';
import DatePickerPopover from '../ui/DatePickerPopover';
import Button from '../ui/Button';
import BarChart from './BarChart';
import { getBoards } from '../../services/boardService';
import * as marketingService from '../../services/marketingService';
import useToastStore from '../../store/toastStore';

/**
 * MarketingReport — Phase 2.3 dedicated Marketing/ROI section on the Analytics
 * page (admin-only). Manage campaigns (ad spend per source) and read a per-source
 * ROI table: leads, won, conversion, spend, cost-per-lead, cost-per-acquisition.
 */

// Columns that can hold a "source" value.
const SOURCE_COL_TYPES = ['dropdown', 'status', 'text', 'tags'];
const SOURCE_PALETTE = ['#3E6B4E', '#00C875', '#FDAB3D', '#A25DDC', '#FF642E', '#E2445C', '#66CCFF', '#037F4C'];

const money = (n) => (n == null ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: 2 }));
const num = (n) => (n == null ? '—' : n.toLocaleString());

const MarketingReport = ({ orgId }) => {
  const toastError = useToastStore((s) => s.error);
  const toastSuccess = useToastStore((s) => s.success);

  const [boards, setBoards] = useState([]);
  const [boardId, setBoardId] = useState('');
  const [sourceColumnId, setSourceColumnId] = useState('');
  const [roi, setRoi] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const activeBoard = useMemo(() => boards.find((b) => String(b._id) === String(boardId)) || null, [boards, boardId]);
  const sourceColOptions = useMemo(
    () => (activeBoard?.columns || [])
      .filter((c) => SOURCE_COL_TYPES.includes(c.type))
      .map((c) => ({ value: String(c._id), label: c.name })),
    [activeBoard]
  );

  // Load boards (with columns) once.
  useEffect(() => {
    if (!orgId) return;
    getBoards(orgId)
      .then((list) => {
        setBoards(list || []);
        if (list && list.length > 0) setBoardId(String(list[0]._id));
      })
      .catch((err) => toastError(err?.response?.data?.error || 'Could not load boards'));
  }, [orgId, toastError]);

  // When the board changes, default the source column to one that looks like a source.
  useEffect(() => {
    if (!activeBoard) return;
    const cols = (activeBoard.columns || []).filter((c) => SOURCE_COL_TYPES.includes(c.type));
    const guess = cols.find((c) => /source|channel|origin|provenance|canal/i.test(c.name || c.key || ''));
    setSourceColumnId(String((guess || cols[0])?._id || ''));
  }, [activeBoard]);

  const loadCampaigns = useCallback(async () => {
    if (!orgId) return;
    try {
      setCampaigns(await marketingService.listCampaigns(orgId, boardId || undefined));
    } catch (err) {
      toastError(err?.response?.data?.error || 'Could not load campaigns');
    }
  }, [orgId, boardId, toastError]);

  useEffect(() => { loadCampaigns(); }, [loadCampaigns]);

  const loadRoi = useCallback(async () => {
    if (!orgId || !boardId || !sourceColumnId) { setRoi(null); return; }
    setLoading(true);
    try {
      setRoi(await marketingService.getRoi(orgId, { boardId, sourceColumnId }));
    } catch (err) {
      toastError(err?.response?.data?.error || 'Could not load the ROI report');
      setRoi(null);
    } finally {
      setLoading(false);
    }
  }, [orgId, boardId, sourceColumnId, toastError]);

  useEffect(() => { loadRoi(); }, [loadRoi]);

  const handleSaveCampaign = async (payload) => {
    try {
      if (editing) await marketingService.updateCampaign(orgId, editing._id, payload);
      else await marketingService.createCampaign(orgId, { ...payload, boardId: boardId || null });
      setFormOpen(false);
      setEditing(null);
      toastSuccess(editing ? 'Campaign updated' : 'Campaign created');
      await loadCampaigns();
      await loadRoi();
    } catch (err) {
      toastError(err?.response?.data?.error || 'Could not save campaign');
    }
  };

  const handleDeleteCampaign = async (c) => {
    if (!window.confirm(`Delete campaign "${c.name}"?`)) return;
    try {
      await marketingService.deleteCampaign(orgId, c._id);
      await loadCampaigns();
      await loadRoi();
    } catch (err) {
      toastError(err?.response?.data?.error || 'Could not delete campaign');
    }
  };

  const leadsBars = useMemo(
    () => (roi?.rows || []).map((r, i) => ({ key: r.source, label: r.source, count: r.leads, color: SOURCE_PALETTE[i % SOURCE_PALETTE.length] })),
    [roi]
  );
  const spendBars = useMemo(
    () => (roi?.rows || []).filter((r) => r.spend > 0).map((r, i) => ({ key: r.source, label: r.source, count: r.spend, color: SOURCE_PALETTE[i % SOURCE_PALETTE.length] })),
    [roi]
  );

  return (
    <section className="mt-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Megaphone size={20} color="var(--color-accent)" aria-hidden="true" />
          <h2 className="font-display" style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text-primary)' }}>Marketing & ROI</h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div style={{ width: 200 }}>
            <Dropdown size="sm" options={boards.map((b) => ({ value: String(b._id), label: b.name }))} value={boardId} onChange={setBoardId} placeholder="Board" />
          </div>
          <div style={{ width: 200 }}>
            <Dropdown size="sm" options={sourceColOptions} value={sourceColumnId} onChange={setSourceColumnId} placeholder="Source column" />
          </div>
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={loadRoi}>Refresh</Button>
        </div>
      </div>

      {sourceColOptions.length === 0 ? (
        <div className="bg-surface" style={{ borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: 24, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          This board has no text/dropdown column to use as a lead source. Add a "Source" column to the board, then it will show up here.
        </div>
      ) : (
        <>
          {/* Campaigns */}
          <div className="bg-surface" style={{ borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: 16, marginBottom: 16 }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-body" style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>Campaigns ({campaigns.length})</h3>
              <Button variant="primary" size="sm" icon={Plus} onClick={() => { setEditing(null); setFormOpen(true); }}>New campaign</Button>
            </div>
            {campaigns.length === 0 ? (
              <p className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No campaigns yet. Add one with its source label + ad spend to compute cost-per-lead.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--color-text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      <th style={thStyle}>Campaign</th><th style={thStyle}>Source</th><th style={{ ...thStyle, textAlign: 'right' }}>Budget</th><th style={thStyle}>Dates</th><th style={thStyle} />
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.map((c) => (
                      <tr key={c._id} style={{ borderTop: '1px solid var(--color-border)' }}>
                        <td style={tdStyle}>{c.name}{!c.active && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--color-text-muted)' }}>(paused)</span>}</td>
                        <td style={tdStyle}>{c.source}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{money(c.budget)}</td>
                        <td style={{ ...tdStyle, color: 'var(--color-text-muted)' }}>{fmtRange(c.startDate, c.endDate)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button type="button" onClick={() => { setEditing(c); setFormOpen(true); }} aria-label="Edit" style={iconBtn}><Pencil size={13} color="var(--color-text-muted)" /></button>
                          <button type="button" onClick={() => handleDeleteCampaign(c)} aria-label="Delete" style={iconBtn}><Trash2 size={13} color="#DC2626" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ROI table */}
          <div className="bg-surface" style={{ borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: 16, marginBottom: 16 }}>
            <h3 className="font-body" style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 10 }}>
              ROI by source {roi?.sourceColumnName ? `· ${roi.sourceColumnName}` : ''}
            </h3>
            {loading && !roi ? (
              <p className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Loading…</p>
            ) : !roi || roi.rows.length === 0 ? (
              <p className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No leads or campaigns to report yet.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--color-text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      <th style={thStyle}>Source</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Leads</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Won</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Conv.</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Spend</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Cost / lead</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Cost / won</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roi.rows.map((r) => (
                      <tr key={r.source} style={{ borderTop: '1px solid var(--color-border)' }}>
                        <td style={tdStyle}>{r.source}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{num(r.leads)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{num(r.won)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{r.conversionRate}%</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{money(r.spend)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{money(r.costPerLead)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{money(r.costPerWon)}</td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: '2px solid var(--color-border-strong)', fontWeight: 700 }}>
                      <td style={tdStyle}>Total</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{num(roi.totals.leads)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{num(roi.totals.won)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{roi.totals.conversionRate}%</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{money(roi.totals.spend)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{money(roi.totals.costPerLead)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{money(roi.totals.costPerWon)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Charts */}
          {roi && roi.rows.length > 0 && (
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
              <BarChart title="Leads by source" data={leadsBars} />
              {spendBars.length > 0 && <BarChart title="Ad spend by source" data={spendBars} />}
            </div>
          )}
        </>
      )}

      {formOpen && (
        <CampaignForm
          initial={editing}
          onClose={() => { setFormOpen(false); setEditing(null); }}
          onSubmit={handleSaveCampaign}
        />
      )}
    </section>
  );
};

const CampaignForm = ({ initial, onClose, onSubmit }) => {
  const [name, setName] = useState(initial?.name || '');
  const [source, setSource] = useState(initial?.source || '');
  const [budget, setBudget] = useState(initial?.budget != null ? String(initial.budget) : '');
  const [startDate, setStartDate] = useState(initial?.startDate ? initial.startDate.slice(0, 10) : '');
  const [endDate, setEndDate] = useState(initial?.endDate ? initial.endDate.slice(0, 10) : '');
  const [active, setActive] = useState(initial?.active !== false);
  const [err, setErr] = useState('');

  const submit = () => {
    if (!name.trim()) return setErr('Name is required');
    if (!source.trim()) return setErr('Source is required');
    const b = budget === '' ? 0 : Number(budget);
    if (!Number.isFinite(b) || b < 0) return setErr('Budget must be a non-negative number');
    onSubmit({ name: name.trim(), source: source.trim(), budget: b, startDate: startDate || null, endDate: endDate || null, active });
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={initial ? 'Edit campaign' : 'New campaign'}
      maxWidth={460}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={submit}>{initial ? 'Save' : 'Create'}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input label="Campaign name" placeholder="e.g. Q2 Google Ads" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <Input label="Source label" placeholder="e.g. Google Ads (must match the lead source value)" value={source} onChange={(e) => setSource(e.target.value)} />
        <Input label="Ad spend / budget" type="number" placeholder="0" value={budget} onChange={(e) => setBudget(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block mb-2 font-body font-medium text-[color:var(--color-text-secondary)] text-xs uppercase tracking-wide">Start date</label>
            <DatePickerPopover value={startDate} onChange={setStartDate} placeholder="Start date" />
          </div>
          <div>
            <label className="block mb-2 font-body font-medium text-[color:var(--color-text-secondary)] text-xs uppercase tracking-wide">End date</label>
            <DatePickerPopover value={endDate} onChange={setEndDate} placeholder="End date" />
          </div>
        </div>
        <label className="flex items-center gap-2 font-body" style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Active
        </label>
        {err && <p className="font-body" style={{ fontSize: 13, color: 'var(--color-status-stuck)' }}>{err}</p>}
      </div>
    </Modal>
  );
};

const thStyle = { padding: '6px 10px', fontWeight: 600 };
const tdStyle = { padding: '8px 10px', color: 'var(--color-text-primary)' };
const iconBtn = { width: 26, height: 26, background: 'transparent', border: 'none', cursor: 'pointer', borderRadius: 'var(--radius-sm)' };

const fmtRange = (s, e) => {
  const f = (d) => (d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' }) : '');
  if (!s && !e) return 'Always';
  return `${f(s) || '…'} – ${f(e) || '…'}`;
};

export default MarketingReport;
