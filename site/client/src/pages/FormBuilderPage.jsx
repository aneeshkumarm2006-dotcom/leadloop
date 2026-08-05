import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import {
  GripVertical,
  Plus,
  Trash2,
  Copy,
  Check,
  ExternalLink,
  FileText,
} from 'lucide-react';
import PageWrapper from '../components/layout/PageWrapper';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Dropdown from '../components/ui/Dropdown';
import SortableItem from '../components/dnd/SortableItem';
import useAuthStore from '../store/authStore';
import useOrgStore from '../store/orgStore';
import useBoardStore from '../store/boardStore';
import useToastStore from '../store/toastStore';
import * as formService from '../services/formService';
import { getGroups } from '../services/taskService';

/**
 * FormBuilderPage — the column-mapped public-form builder (F13.5). Each form
 * field binds to a board `columnId`; fields reorder via `@dnd-kit/sortable`; a
 * live preview shows the rendered form; after saving, the `/f/:slug` URL is shown
 * with a copy button. New forms read `?boardId=`; editing loads `/forms/:id/edit`.
 */

const FORM_TYPE_OPTION_KEYS = [
  { value: 'text', labelKey: 'pages.fieldTypeText' },
  { value: 'long_text', labelKey: 'pages.fieldTypeLongText' },
  { value: 'email', labelKey: 'pages.fieldTypeEmail' },
  { value: 'phone', labelKey: 'pages.fieldTypePhone' },
  { value: 'number', labelKey: 'pages.fieldTypeNumber' },
  { value: 'date', labelKey: 'pages.fieldTypeDate' },
  { value: 'dropdown', labelKey: 'pages.fieldTypeDropdown' },
  { value: 'checkbox', labelKey: 'pages.fieldTypeCheckbox' },
];

/** Map a board column type → a sensible default form field type. */
const formTypeForColumn = (colType) => {
  switch (colType) {
    case 'email':
      return 'email';
    case 'phone':
      return 'phone';
    case 'number':
    case 'rating':
      return 'number';
    case 'long_text':
      return 'long_text';
    case 'date':
    case 'timeline':
      return 'date';
    case 'status':
    case 'dropdown':
    case 'tags':
      return 'dropdown';
    case 'checkbox':
      return 'checkbox';
    default:
      return 'text';
  }
};

/** Option labels for a status/dropdown/tags column (shown as dropdown choices). */
const optionLabelsForColumn = (col) =>
  col && col.settings && Array.isArray(col.settings.options)
    ? col.settings.options.map((o) => o.label).filter(Boolean)
    : [];

let seq = 0;
const newFieldId = () => `f_${Date.now().toString(36)}_${(seq++).toString(36)}`;

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

const sectionCard = {
  background: 'var(--color-bg-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
  padding: 18,
};

const FormBuilderPage = () => {
  const { t } = useTranslation();
  const { id: formId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isAdmin = useIsCurrentOrgAdmin();
  const toastSuccess = useToastStore((s) => s.success);

  const currentOrg = useOrgStore((s) => s.currentOrg);
  const orgId = currentOrg?._id || null;
  const boards = useBoardStore((s) => s.boards);
  const fetchBoards = useBoardStore((s) => s.fetchBoards);
  const getBoardById = useBoardStore((s) => s.getBoardById);

  const isEdit = !!formId;
  const [boardId, setBoardId] = useState(searchParams.get('boardId') || null);
  const [group, setGroup] = useState(''); // landing stage; '' = board's first stage
  const [groups, setGroups] = useState([]);
  const [name, setName] = useState('');
  const [fields, setFields] = useState([]);
  const [welcomeMessage, setWelcomeMessage] = useState('');
  const [postSubmitRedirectUrl, setPostSubmitRedirectUrl] = useState('');
  const [captchaEnabled, setCaptchaEnabled] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [branding, setBranding] = useState({
    logoUrl: '',
    coverUrl: '',
    accentColor: '',
    headline: '',
  });

  // Phase 2.3 — lead-source auto-fill.
  const [sourceTag, setSourceTag] = useState('');
  const [sourceColumnId, setSourceColumnId] = useState('');

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedForm, setSavedForm] = useState(null); // { publicUrl, slug }
  const [copied, setCopied] = useState(false);
  const [addColumnId, setAddColumnId] = useState('');

  // Hydrate boards (for the board picker + columns).
  useEffect(() => {
    if (orgId && boards.length === 0) fetchBoards(orgId).catch((e) => console.error(e));
  }, [orgId, boards.length, fetchBoards]);

  // Edit mode — load the form, then its board.
  useEffect(() => {
    if (!isEdit) return;
    let cancelled = false;
    formService
      .getForm(formId)
      .then((f) => {
        if (cancelled) return;
        setBoardId(String(f.boardId));
        setGroup(f.group ? String(f.group) : '');
        setName(f.name || '');
        setFields((f.fieldMap || []).map((fm) => ({ ...fm })));
        setWelcomeMessage(f.welcomeMessage || '');
        setPostSubmitRedirectUrl(f.postSubmitRedirectUrl || '');
        setCaptchaEnabled(!!f.captchaEnabled);
        setEnabled(!!f.enabled);
        setBranding({
          logoUrl: f.branding?.logoUrl || '',
          coverUrl: f.branding?.coverUrl || '',
          accentColor: f.branding?.accentColor || '',
          headline: f.branding?.headline || '',
        });
        setSourceTag(f.sourceTag || '');
        setSourceColumnId(f.sourceColumnId ? String(f.sourceColumnId) : '');
        setSavedForm({ publicUrl: f.publicUrl, slug: f.slug });
      })
      .catch(() => setError(t('pages.couldNotLoadForm')))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [isEdit, formId, t]);

  // Load the selected board's stages (groups) for the Landing-stage picker.
  useEffect(() => {
    if (!boardId) {
      setGroups([]);
      return undefined;
    }
    let cancelled = false;
    getGroups(boardId)
      .then((gs) => {
        if (cancelled) return;
        setGroups(gs || []);
        // Drop a stale group that isn't on this board (e.g. after switching boards).
        setGroup((g) => (g && (gs || []).some((x) => String(x._id) === String(g)) ? g : ''));
      })
      .catch(() => !cancelled && setGroups([]));
    return () => {
      cancelled = true;
    };
  }, [boardId]);

  const board = boardId ? getBoardById(boardId) : null;
  const columns = useMemo(() => board?.columns || [], [board]);
  const columnsById = useMemo(() => new Map(columns.map((c) => [String(c._id), c])), [columns]);

  const formTypeOptions = useMemo(
    () => FORM_TYPE_OPTION_KEYS.map((o) => ({ value: o.value, label: t(o.labelKey) })),
    [t]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const addFieldFromColumn = (colId) => {
    const col = columnsById.get(String(colId));
    if (!col) return;
    setFields((prev) => [
      ...prev,
      {
        formFieldId: newFieldId(),
        label: col.name,
        type: formTypeForColumn(col.type),
        required: false,
        columnId: String(col._id),
        options: optionLabelsForColumn(col),
      },
    ]);
    setAddColumnId('');
  };

  const addCustomField = () =>
    setFields((prev) => [
      ...prev,
      { formFieldId: newFieldId(), label: t('pages.newField'), type: 'text', required: false, columnId: null, options: [] },
    ]);

  const updateField = (id, patch) =>
    setFields((prev) => prev.map((f) => (f.formFieldId === id ? { ...f, ...patch } : f)));
  const removeField = (id) => setFields((prev) => prev.filter((f) => f.formFieldId !== id));

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setFields((prev) => {
      const oldIndex = prev.findIndex((f) => f.formFieldId === active.id);
      const newIndex = prev.findIndex((f) => f.formFieldId === over.id);
      if (oldIndex < 0 || newIndex < 0) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  };

  const buildPayload = () => ({
    name: name.trim(),
    group: group || null,
    fieldMap: fields.map((f) => ({
      formFieldId: f.formFieldId,
      label: f.label,
      type: f.type,
      required: !!f.required,
      columnId: f.columnId || null,
      options: Array.isArray(f.options) ? f.options : [],
    })),
    welcomeMessage,
    postSubmitRedirectUrl,
    captchaEnabled,
    enabled,
    branding,
    sourceTag: sourceTag.trim(),
    sourceColumnId: sourceColumnId || null,
  });

  const handleSave = useCallback(async () => {
    setError('');
    if (!boardId) {
      setError(t('pages.pickBoardForForm'));
      return;
    }
    if (!name.trim()) {
      setError(t('pages.giveFormName'));
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        const updated = await formService.updateForm(formId, buildPayload());
        setSavedForm({ publicUrl: updated.publicUrl, slug: updated.slug });
        toastSuccess(t('pages.formSaved'));
      } else {
        const created = await formService.createForm(boardId, buildPayload());
        setSavedForm({ publicUrl: created.publicUrl, slug: created.slug });
        toastSuccess(t('pages.formPublished'));
        navigate(`/forms/${created._id}/edit`, { replace: true });
      }
    } catch (err) {
      setError(err?.response?.data?.error || t('pages.couldNotSaveForm'));
    } finally {
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, group, name, fields, welcomeMessage, postSubmitRedirectUrl, captchaEnabled, enabled, branding, isEdit, formId]);

  const setBrand = (patch) => setBranding((b) => ({ ...b, ...patch }));

  const copyUrl = async () => {
    if (!savedForm?.publicUrl) return;
    try {
      await navigator.clipboard.writeText(savedForm.publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const boardOptions = useMemo(
    () =>
      (boards || [])
        .filter((b) => !orgId || String(b.organisation || '') === String(orgId))
        .map((b) => ({ value: String(b._id), label: b.name })),
    [boards, orgId]
  );
  const columnAddOptions = columns.map((c) => ({ value: String(c._id), label: `${c.name} (${c.type})` }));

  if (!isAdmin) {
    return (
      <PageWrapper>
        <p className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          {t('pages.formBuilderAdminOnly')}
        </p>
      </PageWrapper>
    );
  }

  if (loading) {
    return (
      <PageWrapper>
        <p className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{t('pages.loading')}</p>
      </PageWrapper>
    );
  }

  // Preview mirrors the public /f/:slug page (brand rail + fields + forest CTA).
  const previewAccent = branding.accentColor || '#3E6B4E';
  const previewHeadline = branding.headline || name || t('pages.untitledForm');

  return (
    <PageWrapper>
      <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-bold inline-flex items-center gap-2" style={{ fontSize: 22, color: 'var(--color-text-primary)' }}>
            <FileText size={20} /> {isEdit ? t('pages.editForm') : t('pages.newForm')}
          </h1>
          <p className="font-body mt-1" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            {t('pages.formBuilderIntro')}
          </p>
        </div>
        <Button variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? t('pages.saving') : isEdit ? t('pages.saveChanges') : t('pages.publishForm')}
        </Button>
      </header>

      {error && (
        <div className="mb-4 font-body" style={{ padding: '10px 14px', borderRadius: 'var(--radius-md)', background: 'var(--color-status-stuck-bg)', color: 'var(--color-status-stuck)', fontSize: 13 }}>
          {error}
        </div>
      )}

      {savedForm?.publicUrl && (
        <div className="mb-5 flex items-center gap-3 flex-wrap font-body" style={{ padding: '12px 14px', borderRadius: 'var(--radius-md)', background: 'var(--color-status-done-bg)', color: 'var(--color-status-done)', fontSize: 13 }}>
          <span style={{ fontWeight: 600 }}>{t('pages.publicUrl')}</span>
          <code style={{ wordBreak: 'break-all', color: 'var(--color-text-primary)' }}>{savedForm.publicUrl}</code>
          <button type="button" onClick={copyUrl} className="inline-flex items-center gap-1.5" style={{ fontSize: 12, padding: '4px 8px', borderRadius: 'var(--radius-md)', border: '1.5px solid var(--color-border)', background: '#fff', color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? t('pages.copied') : t('pages.copy')}
          </button>
          <a href={`/f/${savedForm.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5" style={{ fontSize: 12, color: 'var(--color-accent)' }}>
            <ExternalLink size={13} /> {t('pages.open')}
          </a>
        </div>
      )}

      <div className="grid gap-5 grid-cols-1 lg:grid-cols-2">
        {/* --- Builder --- */}
        <div className="flex flex-col gap-5">
          <div style={sectionCard} className="flex flex-col gap-4">
            {!isEdit && (
              <Dropdown
                label={t('pages.board')}
                options={boardOptions}
                value={boardId || ''}
                onChange={(v) => setBoardId(v)}
                placeholder={t('pages.pickABoard')}
              />
            )}
            {boardId && (
              <label className="font-body" style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                {t('pages.landingStage')}
                <div style={{ marginTop: 6 }}>
                  <Dropdown
                    options={[{ value: '', label: t('pages.landingStageDefault') }, ...groups.map((g) => ({ value: String(g._id), label: g.name }))]}
                    value={group}
                    onChange={setGroup}
                  />
                </div>
                <p className="font-body" style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 6, fontWeight: 400 }}>
                  {t('pages.landingStageHint')}
                </p>
              </label>
            )}
            <Input label={t('pages.formName')} required placeholder={t('pages.formNamePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} />
            <Input label={t('pages.thankYouMessage')} multiline rows={2} placeholder={t('pages.thankYouMessagePlaceholder')} value={welcomeMessage} onChange={(e) => setWelcomeMessage(e.target.value)} />
            <Input label={t('pages.redirectUrl')} placeholder={t('pages.redirectUrlPlaceholder')} value={postSubmitRedirectUrl} onChange={(e) => setPostSubmitRedirectUrl(e.target.value)} />
            <div className="flex items-center gap-6">
              <label className="inline-flex items-center gap-2 cursor-pointer font-body" style={{ fontSize: 14 }}>
                <input type="checkbox" checked={captchaEnabled} onChange={(e) => setCaptchaEnabled(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--color-accent)' }} />
                {t('pages.enableCaptcha')}
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer font-body" style={{ fontSize: 14 }}>
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--color-accent)' }} />
                {t('pages.published')}
              </label>
            </div>

            {/* Branding (Phase 1.7) */}
            <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 16, marginTop: 4 }}>
              <p className="font-display" style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 10 }}>
                {t('pages.branding')}
              </p>
              <div className="flex flex-col gap-3">
                <Input label={t('pages.brandHeadline')} placeholder={t('pages.brandHeadlinePlaceholder')} value={branding.headline} onChange={(e) => setBrand({ headline: e.target.value })} />
                <Input label={t('pages.brandLogoUrl')} placeholder={t('pages.brandImageHint')} value={branding.logoUrl} onChange={(e) => setBrand({ logoUrl: e.target.value })} />
                <Input label={t('pages.brandCoverUrl')} placeholder={t('pages.brandImageHint')} value={branding.coverUrl} onChange={(e) => setBrand({ coverUrl: e.target.value })} />
                <label className="font-body" style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                  {t('pages.brandAccentColor')}
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="color"
                      value={branding.accentColor || '#3E6B4E'}
                      onChange={(e) => setBrand({ accentColor: e.target.value })}
                      style={{ width: 40, height: 32, padding: 0, border: '1px solid var(--color-border)', borderRadius: 6, background: 'none', cursor: 'pointer' }}
                      aria-label={t('pages.brandAccentColor')}
                    />
                    <span className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                      {branding.accentColor || '—'}
                    </span>
                    {branding.accentColor && (
                      <button type="button" onClick={() => setBrand({ accentColor: '' })} className="font-body" style={{ fontSize: 12, color: 'var(--color-accent)', background: 'none', border: 'none', cursor: 'pointer' }}>
                        {t('pages.none')}
                      </button>
                    )}
                  </div>
                </label>
              </div>
            </div>

            {/* Lead source auto-fill (Phase 2.3) */}
            <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 16, marginTop: 4 }}>
              <p className="font-display" style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 4 }}>
                {t('pages.leadSourceTitle')}
              </p>
              <p className="font-body" style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 10 }}>
                {t('pages.leadSourceHint')}
              </p>
              <div className="flex flex-col gap-3">
                <Input
                  label={t('pages.sourceTagLabel')}
                  placeholder={t('pages.sourceTagPlaceholder')}
                  value={sourceTag}
                  onChange={(e) => setSourceTag(e.target.value)}
                />
                <label className="font-body" style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                  {t('pages.sourceColumnLabel')}
                  <div style={{ marginTop: 6 }}>
                    <Dropdown
                      options={[{ value: '', label: t('pages.sourceColumnNone') }, ...columns.filter((c) => ['text', 'dropdown', 'status', 'tags'].includes(c.type)).map((c) => ({ value: String(c._id), label: c.name }))]}
                      value={sourceColumnId}
                      onChange={setSourceColumnId}
                    />
                  </div>
                </label>
              </div>
            </div>
          </div>

          <div style={sectionCard} className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h2 className="font-display font-semibold" style={{ fontSize: 15, color: 'var(--color-text-primary)' }}>{t('pages.fields')}</h2>
              <div className="flex items-center gap-2">
                <div style={{ width: 200 }}>
                  <Dropdown size="sm" options={columnAddOptions} value={addColumnId} onChange={addFieldFromColumn} placeholder={t('pages.addFieldFromColumn')} />
                </div>
                <Button variant="secondary" size="sm" icon={Plus} onClick={addCustomField}>{t('pages.custom')}</Button>
              </div>
            </div>

            {!board ? (
              <p className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{t('pages.pickBoardToMapFields')}</p>
            ) : fields.length === 0 ? (
              <p className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{t('pages.noFieldsYet')}</p>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={fields.map((f) => f.formFieldId)} strategy={verticalListSortingStrategy}>
                  <div className="flex flex-col gap-2">
                    {fields.map((field) => (
                      <SortableItem key={field.formFieldId} id={field.formFieldId} data={{ type: 'field' }}>
                        {({ ref, setActivatorNodeRef, style, attributes, listeners }) => (
                          <div ref={ref} style={{ ...style, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 10, background: 'var(--color-bg-surface)' }}>
                            <div className="flex items-center gap-2">
                              <button ref={setActivatorNodeRef} type="button" aria-label={t('pages.dragToReorder')} {...attributes} {...listeners} style={{ cursor: 'grab', touchAction: 'none', background: 'transparent', border: 'none', padding: 2 }}>
                                <GripVertical size={15} color="var(--color-text-muted)" />
                              </button>
                              <div style={{ flex: '1 1 40%' }}>
                                <Input value={field.label} onChange={(e) => updateField(field.formFieldId, { label: e.target.value })} placeholder={t('pages.fieldLabel')} style={{ height: 32 }} />
                              </div>
                              <div style={{ flex: '0 0 130px' }}>
                                <Dropdown size="sm" options={formTypeOptions} value={field.type} onChange={(v) => updateField(field.formFieldId, { type: v })} />
                              </div>
                              <label className="inline-flex items-center gap-1.5 font-body shrink-0" style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                                <input type="checkbox" checked={!!field.required} onChange={(e) => updateField(field.formFieldId, { required: e.target.checked })} style={{ width: 15, height: 15, accentColor: 'var(--color-accent)' }} />
                                {t('pages.required')}
                              </label>
                              <button type="button" aria-label={t('pages.removeField')} onClick={() => removeField(field.formFieldId)} className="flex items-center justify-center rounded-md hover:bg-[color:var(--color-bg-subtle)]" style={{ width: 30, height: 30, flexShrink: 0 }}>
                                <Trash2 size={14} color="var(--color-text-secondary)" />
                              </button>
                            </div>
                            <p className="font-body" style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 6, marginLeft: 26 }}>
                              {field.columnId && columnsById.get(String(field.columnId))
                                ? t('pages.mapsToColumn', { name: columnsById.get(String(field.columnId)).name })
                                : t('pages.notMappedToColumn')}
                              {field.type === 'dropdown' && (field.options || []).length > 0 && t('pages.fieldOptionsSuffix', { options: field.options.join(', ') })}
                            </p>
                          </div>
                        )}
                      </SortableItem>
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>
        </div>

        {/* --- Live preview (mirrors the public /f/:slug page) --- */}
        <div style={{ ...sectionCard, position: 'sticky', top: 16, alignSelf: 'start' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#2F6B47' }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: '#2F6B47', display: 'inline-block' }} />
            {t('pages.livePreview')}
          </span>
          <p className="font-body mb-4 mt-1" style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{t('pages.howVisitorsSeeForm')}</p>

          <div style={{ display: 'grid', gridTemplateColumns: '124px 1fr', border: '1px solid var(--color-border)', borderRadius: 14, overflow: 'hidden', boxShadow: '0 8px 26px -14px rgba(33,30,24,.22)', background: '#fff' }}>
            {/* mini brand rail */}
            <div style={{ background: `linear-gradient(160deg, ${previewAccent}, #284A36)`, color: '#EDF3EC', padding: '16px 13px', display: 'flex', flexDirection: 'column', gap: 9 }}>
              <span style={{ width: 30, height: 30, borderRadius: 9, background: 'rgba(255,255,255,.16)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display, sans-serif)', fontWeight: 800, fontSize: 13, color: '#fff' }}>
                {(previewHeadline || 'F').trim().charAt(0).toUpperCase()}
              </span>
              <div style={{ fontFamily: 'var(--font-display, sans-serif)', fontWeight: 700, fontSize: 14, lineHeight: 1.12, color: '#fff', wordBreak: 'break-word' }}>{previewHeadline}</div>
              <div style={{ fontSize: 9.5, color: '#CBDDCD', marginTop: 2 }}>● Takes about a minute</div>
            </div>
            {/* mini form panel */}
            <div style={{ padding: '16px 16px 14px' }}>
              <div className="flex flex-col" style={{ gap: 11 }}>
                {fields.length === 0 && <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>{t('pages.addFieldsToPreview')}</p>}
                {fields.map((field) => (
                  <div key={field.formFieldId}>
                    <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.03em', fontWeight: 700, color: '#5C554A', marginBottom: 5 }}>
                      {field.label || t('pages.field')}{field.required && <span style={{ color: '#C0392E', marginLeft: 3 }}>*</span>}
                    </div>
                    {field.type === 'checkbox' ? (
                      <input type="checkbox" disabled style={{ width: 16, height: 16, accentColor: previewAccent }} />
                    ) : (
                      <div style={{ height: field.type === 'long_text' ? 44 : 32, borderRadius: 8, border: '1.5px solid #D6CCB6', background: '#FCFAF4' }} />
                    )}
                  </div>
                ))}
                {captchaEnabled && <div style={{ height: 44, border: '1px dashed #D6CCB6', borderRadius: 8, display: 'grid', placeItems: 'center', fontSize: 11, color: '#9A9184' }}>{t('pages.captchaChallenge')}</div>}
                <div style={{ height: 38, borderRadius: 99, background: previewAccent, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12.5, fontWeight: 700, marginTop: 2 }}>{t('pages.submit')}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageWrapper>
  );
};

export default FormBuilderPage;
