import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Save, Workflow } from 'lucide-react';
import Button from '../ui/Button';
import { Toggle, FieldLabel } from './automationFields';
import TemplateVariableMenu from './TemplateVariableMenu';
import * as intakeService from '../../services/intakeService';

/**
 * IntakePolicyForm — the F9 Lead Intake policy editor (admin-only) (F9.5).
 *
 * Four-step config matching the runner: owner assignment (round-robin pool / geo
 * map / fixed), initial stage, welcome email (reuses TemplateVariableMenu for the
 * body), and the follow-up offset. Loads the board's policy + form meta (typed
 * columns, workspace members, seeded templates) and PUTs the full shape on save.
 *
 * Props: { boardId, board }.
 */

const inputStyle = {
  height: 36,
  padding: '0 10px',
  borderRadius: 'var(--radius-md)',
  border: '1.5px solid var(--color-border)',
  background: 'var(--color-bg-input)',
  color: 'var(--color-text-primary)',
  fontSize: 13,
  width: '100%',
};

const cardStyle = {
  border: '1.5px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  padding: '16px 18px',
  background: 'var(--color-bg-surface)',
};

const STRATEGIES = [
  { value: 'round_robin', labelKey: 'strategyRoundRobin', hintKey: 'strategyRoundRobinHint' },
  { value: 'geo', labelKey: 'strategyGeo', hintKey: 'strategyGeoHint' },
  { value: 'fixed', labelKey: 'strategyFixed', hintKey: 'strategyFixedHint' },
];

const Section = ({ step, title, children }) => (
  <section style={cardStyle} className="flex flex-col gap-3">
    <h3 className="font-display font-semibold inline-flex items-center gap-2" style={{ fontSize: 14, color: 'var(--color-text-primary)' }}>
      <span
        style={{
          width: 20, height: 20, borderRadius: '50%', fontSize: 11, fontWeight: 700,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--color-accent-light)', color: 'var(--color-accent-text)',
        }}
      >
        {step}
      </span>
      {title}
    </h3>
    {children}
  </section>
);

const IntakePolicyForm = ({ boardId, board }) => {
  const { t } = useTranslation();
  const [policy, setPolicy] = useState(null);
  const [meta, setMeta] = useState(null);
  const [geoRows, setGeoRows] = useState([]); // [{ city, userId }]
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    intakeService
      .getIntakePolicy(boardId)
      .then(({ policy: p, meta: m }) => {
        setPolicy(p);
        setMeta(m);
        setGeoRows(Object.entries(p.geoMap || {}).map(([city, userId]) => ({ city, userId })));
      })
      .catch((e) => setError(e?.response?.data?.error || t('automation.intakeLoadError')))
      .finally(() => setLoading(false));
  }, [boardId, t]);

  useEffect(() => { if (boardId) reload(); }, [boardId, reload]);

  const patch = (changes) => {
    setSaved(false);
    setPolicy((p) => ({ ...p, ...changes }));
  };

  const members = meta?.members || [];
  const memberName = useMemo(() => {
    const map = {};
    members.forEach((m) => { map[m._id] = m.name || m.email; });
    return map;
  }, [members]);

  const stageColumn = useMemo(
    () => (meta?.statusColumns || []).find((c) => c._id === policy?.initialStageColumnId) || null,
    [meta, policy?.initialStageColumnId]
  );

  const togglePoolMember = (id) => {
    const pool = new Set(policy.ownerPool || []);
    if (pool.has(id)) pool.delete(id);
    else pool.add(id);
    patch({ ownerPool: [...pool] });
  };

  const setGeoRow = (idx, key, value) => {
    setSaved(false);
    setGeoRows((rows) => rows.map((r, i) => (i === idx ? { ...r, [key]: value } : r)));
  };
  const addGeoRow = () => setGeoRows((rows) => [...rows, { city: '', userId: '' }]);
  const removeGeoRow = (idx) => setGeoRows((rows) => rows.filter((_, i) => i !== idx));

  const applyTemplate = (templateId) => {
    const tpl = (meta?.templates || []).find((t) => t._id === templateId);
    if (!tpl) {
      patch({ welcomeEmailTemplateId: null });
      return;
    }
    patch({
      welcomeEmailTemplateId: templateId,
      welcomeEmailSubject: tpl.subject || '',
      welcomeEmailBody: tpl.body || '',
    });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const geoMap = {};
      geoRows.forEach(({ city, userId }) => {
        if (city && city.trim() && userId) geoMap[city.trim()] = userId;
      });
      const payload = { ...policy, geoMap };
      const updated = await intakeService.saveIntakePolicy(boardId, payload);
      setPolicy(updated);
      setGeoRows(Object.entries(updated.geoMap || {}).map(([city, userId]) => ({ city, userId })));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e?.response?.data?.error || t('automation.intakeSaveError'));
    } finally {
      setSaving(false);
    }
  };

  if (loading && !policy) {
    return <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{t('automation.loading')}</p>;
  }
  if (!policy) {
    return <p style={{ fontSize: 13, color: 'var(--color-status-stuck)' }}>{error || t('automation.intakeUnableToLoad')}</p>;
  }

  return (
    <div className="flex flex-col gap-4" style={{ maxWidth: 720 }}>
      {error && <p style={{ fontSize: 12, color: 'var(--color-status-stuck)' }}>{error}</p>}

      {/* Enable */}
      <div style={cardStyle} className="flex items-center justify-between">
        <div>
          <p className="font-display font-semibold" style={{ fontSize: 14, color: 'var(--color-text-primary)' }}>
            {t('automation.intakeTitle')}
          </p>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
            {t('automation.intakeDescription')}
          </p>
        </div>
        <Toggle checked={!!policy.enabled} onChange={(v) => patch({ enabled: v })} label={t('automation.enabled')} />
      </div>

      {/* Step 1 — Owner assignment */}
      <Section step={1} title={t('automation.stepAssignOwner')}>
        <div className="flex flex-col gap-1.5">
          <FieldLabel>{t('automation.strategyLabel')}</FieldLabel>
          <div className="flex gap-2 flex-wrap">
            {STRATEGIES.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => patch({ ownerStrategy: s.value })}
                title={t(`automation.${s.hintKey}`)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 13,
                  cursor: 'pointer',
                  border: '1.5px solid',
                  borderColor: policy.ownerStrategy === s.value ? 'var(--color-accent)' : 'var(--color-border)',
                  background: policy.ownerStrategy === s.value ? 'var(--color-accent-light)' : 'transparent',
                  color: policy.ownerStrategy === s.value ? 'var(--color-accent-text)' : 'var(--color-text-secondary)',
                  fontWeight: policy.ownerStrategy === s.value ? 600 : 400,
                }}
              >
                {t(`automation.${s.labelKey}`)}
              </button>
            ))}
          </div>
        </div>

        {policy.ownerStrategy === 'round_robin' && (
          <div className="flex flex-col gap-1.5">
            <FieldLabel>{t('automation.agentPoolLabel')}</FieldLabel>
            {members.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{t('automation.noWorkspaceMembers')}</p>
            ) : (
              <div className="flex flex-col gap-1" style={{ maxHeight: 180, overflowY: 'auto' }}>
                {members.map((m) => (
                  <label key={m._id} className="flex items-center gap-2" style={{ fontSize: 13, color: 'var(--color-text-primary)', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={(policy.ownerPool || []).includes(m._id)}
                      onChange={() => togglePoolMember(m._id)}
                    />
                    {m.name || m.email}
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {policy.ownerStrategy === 'fixed' && (
          <div className="flex flex-col gap-1.5">
            <FieldLabel>{t('automation.fixedAgentLabel')}</FieldLabel>
            <select
              style={inputStyle}
              value={policy.fixedOwnerId || ''}
              onChange={(e) => patch({ fixedOwnerId: e.target.value || null })}
            >
              <option value="">{t('automation.chooseAgent')}</option>
              {members.map((m) => (
                <option key={m._id} value={m._id}>{m.name || m.email}</option>
              ))}
            </select>
          </div>
        )}

        {policy.ownerStrategy === 'geo' && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-1.5">
              <FieldLabel>{t('automation.geoColumnLabel')}</FieldLabel>
              <select
                style={inputStyle}
                value={policy.geoColumnId || ''}
                onChange={(e) => patch({ geoColumnId: e.target.value || null })}
              >
                <option value="">{t('automation.chooseColumn')}</option>
                {(meta?.geoColumns || []).map((c) => (
                  <option key={c._id} value={c._id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <FieldLabel>{t('automation.cityToAgentLabel')}</FieldLabel>
              {geoRows.map((row, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder={t('automation.cityPlaceholder')}
                    value={row.city}
                    onChange={(e) => setGeoRow(idx, 'city', e.target.value)}
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <select
                    value={row.userId}
                    onChange={(e) => setGeoRow(idx, 'userId', e.target.value)}
                    style={{ ...inputStyle, flex: 1 }}
                  >
                    <option value="">{t('automation.chooseAgentShort')}</option>
                    {members.map((m) => (
                      <option key={m._id} value={m._id}>{m.name || m.email}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => removeGeoRow(idx)}
                    aria-label={t('automation.removeRow')}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#DC2626' }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              <Button variant="ghost" size="sm" icon={Plus} onClick={addGeoRow}>{t('automation.addCity')}</Button>
              <p style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                {t('automation.geoFallbackNote')}
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <FieldLabel>{t('automation.writeOwnerToLabel')}</FieldLabel>
          <select
            style={inputStyle}
            value={policy.ownerColumnId || ''}
            onChange={(e) => patch({ ownerColumnId: e.target.value || null })}
          >
            <option value="">{t('automation.autoAssigneesColumn')}</option>
            {(meta?.personColumns || []).map((c) => (
              <option key={c._id} value={c._id}>{c.name}</option>
            ))}
          </select>
        </div>
      </Section>

      {/* Step 2 — Initial stage */}
      <Section step={2} title={t('automation.stepInitialStage')}>
        <div className="flex gap-2 flex-wrap">
          <div className="flex flex-col gap-1.5" style={{ flex: 1, minWidth: 200 }}>
            <FieldLabel>{t('automation.statusColumnLabel')}</FieldLabel>
            <select
              style={inputStyle}
              value={policy.initialStageColumnId || ''}
              onChange={(e) => patch({ initialStageColumnId: e.target.value || null, initialStageValue: null })}
            >
              <option value="">{t('automation.none')}</option>
              {(meta?.statusColumns || []).map((c) => (
                <option key={c._id} value={c._id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5" style={{ flex: 1, minWidth: 200 }}>
            <FieldLabel>{t('automation.stageLabel')}</FieldLabel>
            <select
              style={inputStyle}
              value={policy.initialStageValue || ''}
              onChange={(e) => patch({ initialStageValue: e.target.value || null })}
              disabled={!stageColumn}
            >
              <option value="">{t('automation.choose')}</option>
              {(stageColumn?.options || []).map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
      </Section>

      {/* Step 3 — Welcome email */}
      <Section step={3} title={t('automation.stepWelcomeEmail')}>
        <div className="flex flex-col gap-1.5">
          <FieldLabel>{t('automation.startFromTemplate')}</FieldLabel>
          <select
            style={inputStyle}
            value={policy.welcomeEmailTemplateId || ''}
            onChange={(e) => applyTemplate(e.target.value)}
          >
            <option value="">{t('automation.customWriteBelow')}</option>
            {(meta?.templates || []).map((t) => (
              <option key={t._id} value={t._id}>
                {t.name}{t.region ? ` · ${t.region}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel>{t('automation.subjectLabel')}</FieldLabel>
          <TemplateVariableMenu
            value={policy.welcomeEmailSubject || ''}
            onChange={(v) => patch({ welcomeEmailSubject: v, welcomeEmailTemplateId: null })}
            board={board}
            multiline={false}
            placeholder="Welcome, {{Lead Name}}!"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel>{t('automation.bodyLabel')}</FieldLabel>
          <TemplateVariableMenu
            value={policy.welcomeEmailBody || ''}
            onChange={(v) => patch({ welcomeEmailBody: v, welcomeEmailTemplateId: null })}
            board={board}
            rows={6}
            placeholder="Hi {{Lead Name}}, thanks for reaching out…"
          />
        </div>
        <p style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          {t('automation.welcomeMailboxNote')}
        </p>
      </Section>

      {/* Step 4 — Follow-up */}
      <Section step={4} title={t('automation.stepFollowup')}>
        <div className="flex items-center gap-2 flex-wrap">
          <span style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>{t('automation.followupPrefix')}</span>
          <input
            type="number"
            min={0}
            value={policy.followupOffsetHours ?? 24}
            onChange={(e) => patch({ followupOffsetHours: e.target.value })}
            style={{ ...inputStyle, width: 90 }}
          />
          <span style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>{t('automation.followupSuffix')}</span>
        </div>
      </Section>

      {/* Save */}
      <div className="flex items-center gap-3">
        <Button variant="primary" icon={Save} onClick={save} disabled={saving}>
          {saving ? t('automation.saving') : t('automation.savePolicy')}
        </Button>
        {saved && (
          <span className="inline-flex items-center gap-1.5" style={{ fontSize: 13, color: 'var(--color-status-done)' }}>
            <Workflow size={14} /> {t('automation.saved')}
          </span>
        )}
      </div>
    </div>
  );
};

export default IntakePolicyForm;
