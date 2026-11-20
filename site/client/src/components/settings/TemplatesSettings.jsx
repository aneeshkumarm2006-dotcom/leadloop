import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { LayoutTemplate } from 'lucide-react';
import { PageBody } from '../layout/PageHeader';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Modal from '../ui/Modal';
import { SkeletonBlock } from '../ui/Skeleton';
import * as columnService from '../../services/columnService';
import useBoardStore from '../../store/boardStore';
import useToastStore from '../../store/toastStore';
import { SettingsHeader, SettingsCard, CardText } from './SettingsLayout';

/**
 * Settings → Board templates (admin-only). A full-width gallery of the
 * built-in templates from GET /api/boards/templates. "Use template" asks for
 * a board name, then POST /api/boards?template=<id> and opens the new board.
 *
 * No filter chips: every template currently shares one category, so a filter
 * would have nothing to separate.
 */

// Decorative preview tints (tint, ink) — cycled by position.
const PREVIEW_TINTS = [
  ['#DDE8DA', '#3E6B4E'],
  ['#E6EEF7', '#3E6B9A'],
  ['#F6E9D4', '#B07A18'],
  ['#EFE4F0', '#96578A'],
  ['#E2EFEC', '#4E9088'],
  ['#F7E3DA', '#C4632B'],
  ['#E7ECDF', '#6E8B3D'],
  ['#F3E6D8', '#8F4519'],
  ['#E3E7EE', '#4A5A78'],
];
const PREVIEW_WIDTHS = [
  ['70%', '52%', '61%'],
  ['58%', '74%', '45%'],
  ['66%', '48%', '57%'],
];

const TemplatePreview = ({ index }) => {
  const [tint, ink] = PREVIEW_TINTS[index % PREVIEW_TINTS.length];
  return (
    <div aria-hidden="true" className="flex flex-col" style={{ height: 112, background: tint, padding: 16, gap: 7, boxSizing: 'border-box' }}>
      {PREVIEW_WIDTHS[index % PREVIEW_WIDTHS.length].map((w) => (
        <div key={w} className="flex items-center" style={{ gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 3, background: ink }} />
          <span style={{ height: 9, borderRadius: 5, background: 'rgba(255,255,255,.85)', width: w }} />
        </div>
      ))}
    </div>
  );
};

const GRID = { gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))' };

const TemplatesSettings = ({ orgId, isAdmin }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(null); // template id
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const addBoardLocal = useBoardStore((s) => s.addBoardLocal);
  const toastError = useToastStore((s) => s.error);
  const toastSuccess = useToastStore((s) => s.success);

  useEffect(() => {
    let alive = true;
    columnService
      .listBoardTemplates()
      .then((list) => {
        if (alive) setTemplates(Array.isArray(list) ? list.filter((tpl) => tpl && tpl.id) : []);
      })
      .catch((err) => toastError(err?.response?.data?.error || t('pages.couldNotLoadTemplates')))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [toastError, t]);

  const closeCreate = () => {
    if (busy) return;
    setCreateOpen(null);
    setName('');
  };

  const handleCreate = async (templateId) => {
    if (!orgId) {
      toastError(t('pages.selectWorkspaceFirst'));
      return;
    }
    if (!name.trim()) return;
    setBusy(true);
    try {
      const board = await columnService.createBoardFromTemplate(templateId, {
        name: name.trim(),
        organisation: orgId,
      });
      addBoardLocal(board);
      toastSuccess?.(t('pages.boardCreatedFromTemplate', { name: board.name }));
      setCreateOpen(null);
      setName('');
      navigate(`/boards/${board._id}`);
    } catch (err) {
      toastError(err?.response?.data?.error || t('pages.couldNotCreateBoard'));
    } finally {
      setBusy(false);
    }
  };

  let body;
  if (!isAdmin) {
    body = (
      <SettingsCard>
        <CardText>{t('pages.onlyAdminsCreateBoards')}</CardText>
      </SettingsCard>
    );
  } else if (loading) {
    body = (
      <div role="status" aria-live="polite" className="grid gap-[18px]" style={GRID}>
        <span className="sr-only">{t('pages.loadingTemplates')}</span>
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonBlock key={i} height={250} borderRadius={18} />
        ))}
      </div>
    );
  } else if (templates.length === 0) {
    body = (
      <SettingsCard className="items-center text-center" style={{ padding: '40px 24px' }}>
        <LayoutTemplate size={28} aria-hidden="true" style={{ color: 'var(--color-text-muted)' }} />
        <CardText>{t('pages.noTemplatesAvailable')}</CardText>
      </SettingsCard>
    );
  } else {
    body = (
      <ul className="grid gap-[18px] m-0 p-0 list-none" style={GRID}>
        {templates.map((tpl, i) => {
          const groups = Array.isArray(tpl.groups) ? tpl.groups : [];
          const columns = Array.isArray(tpl.columns) ? tpl.columns : [];
          const meta = groups.length
            ? t('settings.templates.stages', { count: groups.length })
            : t('settings.templates.columns', { count: columns.length });
          const titleId = `tpl-${tpl.id}`;
          return (
            <li key={tpl.id} className="flex">
              <article
                aria-labelledby={titleId}
                className="flex flex-col w-full overflow-hidden"
                style={{ background: 'var(--color-bg-surface)', borderRadius: 18, boxShadow: 'var(--shadow-card)' }}
              >
                <TemplatePreview index={i} />
                <div className="flex flex-col flex-1 font-body" style={{ padding: 18, gap: 8 }}>
                  <h2 id={titleId} className="font-display font-bold" style={{ margin: 0, fontSize: 17 }}>
                    {tpl.name}
                  </h2>
                  <p className="flex-1" style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: 'var(--color-text-secondary)' }}>
                    {tpl.description}
                  </p>
                  <div className="flex items-center justify-between gap-3 flex-wrap" style={{ marginTop: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{meta}</span>
                    <Button
                      variant="primary"
                      aria-label={t('settings.templates.useTemplateAria', { name: tpl.name })}
                      onClick={() => {
                        setCreateOpen(tpl.id);
                        setName(tpl.name || '');
                      }}
                    >
                      {t('settings.templates.useTemplate')}
                    </Button>
                  </div>
                </div>
              </article>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <>
      <SettingsHeader tab="templates" title={t('settings.tabs.templates')} subtitle={t('settings.templates.subtitle')} />
      <PageBody>{body}</PageBody>

      {createOpen && (
        <Modal isOpen onClose={closeCreate} title={t('pages.nameYourNewBoard')} closeOnOverlayClick={!busy}>
          <form
            style={{ padding: 16 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy) handleCreate(createOpen);
            }}
          >
            <Input
              autoFocus
              label={t('pages.boardNamePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('pages.boardNamePlaceholder')}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <Button variant="secondary" onClick={closeCreate} disabled={busy}>
                {t('pages.cancel')}
              </Button>
              <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
                {busy ? t('pages.creating') : t('pages.create')}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
};

export default TemplatesSettings;
