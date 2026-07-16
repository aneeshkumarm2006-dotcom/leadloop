import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronRight, ChevronDown, Folder as FolderIcon, FolderPlus,
  MoreHorizontal, LayoutList, Pencil, Trash2,
} from 'lucide-react';
import * as workspaceService from '../../services/workspaceService';
import useToastStore from '../../store/toastStore';

/**
 * SidebarFolders — Phase 3.1 folder tree for the left sidebar. The server
 * "Workspace" model is the folder layer (Organisation → Folder → Board). Renders
 * collapsible folders, each holding its boards, with admin folder CRUD
 * (create / rename / delete). Expanded state persists per org in localStorage.
 *
 * Props:
 *   orgId, boards, isAdmin, pathname, onNavigate(path), onRefreshBoards()
 */
const SidebarFolders = ({ orgId, boards = [], isAdmin, pathname, onNavigate, onRefreshBoards }) => {
  const { t } = useTranslation();
  const toastError = useToastStore((s) => s.error);
  const [folders, setFolders] = useState([]);
  const [expanded, setExpanded] = useState(() => new Set());
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [menuFor, setMenuFor] = useState(null);
  const createRef = useRef(null);

  const loadFolders = useCallback(async () => {
    if (!orgId) return;
    try {
      const list = await workspaceService.listWorkspaces(orgId);
      const sorted = (list || []).slice().sort(
        (a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0) || (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name)
      );
      setFolders(sorted);
    } catch (err) {
      toastError(err?.response?.data?.error || t('folders.loadError'));
    }
  }, [orgId, toastError, t]);

  useEffect(() => { loadFolders(); }, [loadFolders]);

  // Restore expanded state for this org (default: all expanded).
  useEffect(() => {
    if (!orgId) return;
    try {
      const raw = localStorage.getItem(`macan:folders:${orgId}:expanded`);
      if (raw) setExpanded(new Set(JSON.parse(raw)));
      else setExpanded(new Set(folders.map((f) => f._id)));
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, folders.length]);

  const persistExpanded = (next) => {
    setExpanded(next);
    try { localStorage.setItem(`macan:folders:${orgId}:expanded`, JSON.stringify([...next])); } catch { /* ignore */ }
  };
  const toggle = (id) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    persistExpanded(next);
  };

  // Group boards by folder. Boards whose folder is unknown fall into the default.
  const boardsByFolder = useMemo(() => {
    const map = new Map();
    const defaultId = folders.find((f) => f.isDefault)?._id;
    for (const b of boards) {
      const fid = b.folderId && folders.some((f) => f._id === b.folderId) ? b.folderId : defaultId;
      if (!fid) continue;
      if (!map.has(fid)) map.set(fid, []);
      map.get(fid).push(b);
    }
    return map;
  }, [boards, folders]);

  useEffect(() => {
    if (creating && createRef.current) createRef.current.focus();
  }, [creating]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) { setCreating(false); return; }
    try {
      await workspaceService.createWorkspace(orgId, name);
      setNewName(''); setCreating(false);
      await loadFolders();
    } catch (err) {
      toastError(err?.response?.data?.error || t('folders.createError'));
    }
  };

  const handleRename = async (id) => {
    const name = renameDraft.trim();
    setRenamingId(null);
    if (!name) return;
    try {
      await workspaceService.updateWorkspace(orgId, id, { name });
      await loadFolders();
      onRefreshBoards?.();
    } catch (err) {
      toastError(err?.response?.data?.error || t('folders.renameError'));
    }
  };

  const handleDelete = async (folder) => {
    setMenuFor(null);
    if (!window.confirm(t('folders.deleteConfirm', { name: folder.name }))) return;
    try {
      await workspaceService.deleteWorkspace(orgId, folder._id);
      await loadFolders();
      onRefreshBoards?.(); // boards moved to the default folder server-side
    } catch (err) {
      toastError(err?.response?.data?.error || t('folders.deleteError'));
    }
  };

  return (
    <div className="py-2" style={{ borderTop: '1px solid var(--color-border)' }}>
      <div className="flex items-center justify-between px-4 py-1.5">
        <span className="font-body font-semibold text-[11px] uppercase tracking-wide text-[color:var(--color-text-muted)]">
          {t('folders.title')}
        </span>
        {isAdmin && (
          <button
            type="button"
            aria-label={t('folders.newFolder')}
            title={t('folders.newFolder')}
            onClick={() => { setCreating(true); setNewName(''); }}
            className="flex items-center justify-center rounded hover:bg-[color:var(--color-bg-subtle)]"
            style={{ width: 22, height: 22 }}
          >
            <FolderPlus size={14} color="var(--color-text-muted)" />
          </button>
        )}
      </div>

      {creating && (
        <div className="px-3 pb-1">
          <input
            ref={createRef}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onBlur={handleCreate}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') { setCreating(false); setNewName(''); } }}
            placeholder={t('folders.namePlaceholder')}
            className="w-full font-body focus:outline-none"
            style={{ height: 28, padding: '0 8px', fontSize: 13, border: '1.5px solid var(--color-accent)', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-surface, #fff)', color: 'var(--color-text-primary)' }}
          />
        </div>
      )}

      {folders.length === 0 ? (
        <p className="px-4 py-1 font-body text-[12px] text-[color:var(--color-text-muted)]">{t('workspace.noBoards')}</p>
      ) : (
        folders.map((folder) => {
          const fboards = boardsByFolder.get(folder._id) || [];
          const open = expanded.has(folder._id);
          return (
            <div key={folder._id}>
              {/* Folder row */}
              <div className="group/folder flex items-center px-2" style={{ position: 'relative' }}>
                <button
                  type="button"
                  onClick={() => toggle(folder._id)}
                  className="flex items-center gap-1.5 flex-1 min-w-0 font-body transition-colors hover:bg-[color:var(--color-bg-subtle)]"
                  style={{ height: 30, padding: '0 6px', borderRadius: 'var(--radius-sm)', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                >
                  {open ? <ChevronDown size={13} color="var(--color-text-muted)" /> : <ChevronRight size={13} color="var(--color-text-muted)" />}
                  <FolderIcon size={14} color="var(--color-text-secondary)" />
                  {renamingId === folder._id ? (
                    <input
                      value={renameDraft}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={() => handleRename(folder._id)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleRename(folder._id); if (e.key === 'Escape') setRenamingId(null); }}
                      className="flex-1 min-w-0 font-body focus:outline-none"
                      style={{ fontSize: 13, padding: '1px 4px', border: '1px solid var(--color-accent)', borderRadius: 4, background: 'var(--color-bg-surface, #fff)' }}
                    />
                  ) : (
                    <span className="truncate" style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>{folder.name}</span>
                  )}
                  <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginLeft: 'auto', paddingRight: 2 }}>{fboards.length || ''}</span>
                </button>
                {isAdmin && (
                  <button
                    type="button"
                    aria-label={t('folders.folderActions', { name: folder.name })}
                    onClick={() => setMenuFor(menuFor === folder._id ? null : folder._id)}
                    className="opacity-0 group-hover/folder:opacity-100 flex items-center justify-center rounded hover:bg-[color:var(--color-bg-subtle)]"
                    style={{ width: 22, height: 22, marginLeft: 2 }}
                  >
                    <MoreHorizontal size={14} color="var(--color-text-muted)" />
                  </button>
                )}
                {menuFor === folder._id && (
                  <FolderMenu
                    folder={folder}
                    onRename={() => { setRenamingId(folder._id); setRenameDraft(folder.name); setMenuFor(null); }}
                    onDelete={() => handleDelete(folder)}
                    onClose={() => setMenuFor(null)}
                    t={t}
                  />
                )}
              </div>

              {/* Boards in this folder */}
              {open && fboards.map((b) => {
                const active = pathname === `/boards/${b._id}`;
                return (
                  <button
                    key={b._id}
                    type="button"
                    onClick={() => onNavigate(`/boards/${b._id}`)}
                    className="flex items-center gap-2 w-full font-body transition-colors"
                    style={{
                      height: 30, padding: '0 10px 0 30px', border: 'none', cursor: 'pointer', textAlign: 'left',
                      background: active ? 'var(--color-accent-light)' : 'transparent',
                      color: active ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                      fontWeight: active ? 600 : 500, fontSize: 13,
                    }}
                  >
                    <LayoutList size={14} style={{ flexShrink: 0 }} />
                    <span className="truncate">{b.name}</span>
                  </button>
                );
              })}
            </div>
          );
        })
      )}
    </div>
  );
};

const FolderMenu = ({ folder, onRename, onDelete, onClose, t }) => {
  const ref = useRef(null);
  useEffect(() => {
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);
  return (
    <div
      ref={ref}
      style={{ position: 'absolute', right: 4, top: 28, zIndex: 50, minWidth: 150, background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-md)', padding: 4 }}
    >
      <button type="button" onClick={onRename} className="flex items-center gap-2 w-full font-body hover:bg-[color:var(--color-bg-subtle)]" style={menuItem}>
        <Pencil size={13} color="var(--color-text-muted)" /> {t('folders.rename')}
      </button>
      {!folder.isDefault && (
        <button type="button" onClick={onDelete} className="flex items-center gap-2 w-full font-body hover:bg-[color:var(--color-bg-subtle)]" style={{ ...menuItem, color: '#DC2626' }}>
          <Trash2 size={13} color="#DC2626" /> {t('folders.delete')}
        </button>
      )}
    </div>
  );
};

const menuItem = { padding: '7px 8px', fontSize: 13, color: 'var(--color-text-primary)', background: 'transparent', border: 'none', cursor: 'pointer', borderRadius: 'var(--radius-sm)', textAlign: 'left' };

export default SidebarFolders;
