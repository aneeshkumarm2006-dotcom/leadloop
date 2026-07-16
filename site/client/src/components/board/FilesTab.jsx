import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Paperclip,
  UploadCloud,
  Download,
  Trash2,
  File as FileIcon,
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  FileArchive,
} from 'lucide-react';
import * as taskAttachmentService from '../../services/taskAttachmentService';
import { downloadFile } from '../../utils/fileUrl';
import useToastStore from '../../store/toastStore';
import useAuthStore from '../../store/authStore';
import { timeAgo } from '../../utils/dateUtils';

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB — matches server limit

/**
 * Pick a Lucide icon based on the file's MIME type. Falls back to a generic
 * file icon when the mime is missing or unrecognised.
 */
const iconForMime = (mime = '') => {
  if (mime.startsWith('image/')) return FileImage;
  if (mime.startsWith('video/')) return FileVideo;
  if (mime.startsWith('audio/')) return FileAudio;
  if (mime === 'application/pdf') return FileText;
  if (
    mime.includes('zip') ||
    mime.includes('rar') ||
    mime.includes('tar') ||
    mime.includes('7z')
  ) {
    return FileArchive;
  }
  if (mime.startsWith('text/') || mime.includes('document') || mime.includes('word'))
    return FileText;
  return FileIcon;
};


const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

/**
 * FilesTab — list, upload, and delete files attached to a task. Mounted under
 * the "Files" tab in CommentPanel. Uploads go to Cloudinary via the server's
 * multer middleware; the resulting URL is persisted on the task document.
 */
const FilesTab = ({ task, onCountChange }) => {
  const { t } = useTranslation();
  const taskId = task?._id || null;
  const toast = useToastStore.getState();
  const currentUser = useAuthStore((s) => s.user);

  const [attachments, setAttachments] = useState([]);

  // Keep parent tab count in sync
  useEffect(() => {
    onCountChange?.(attachments.length);
  }, [attachments.length, onCountChange]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const fileInputRef = useRef(null);

  // Initial load + refetch when the task switches
  useEffect(() => {
    if (!taskId) {
      setAttachments([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    taskAttachmentService
      .getAttachments(taskId)
      .then((list) => {
        if (!cancelled) setAttachments(list || []);
      })
      .catch((err) => {
        console.error('Failed to load attachments:', err);
        if (!cancelled) {
          setError(
            err?.response?.data?.error || t('itemTabs.filesLoadError')
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, t]);

  const uploadFiles = useCallback(
    async (files) => {
      if (!taskId || !files.length) return;
      setUploading(true);
      for (const f of files) {
        if (f.size > MAX_FILE_SIZE) {
          toast.error(t('itemTabs.fileTooLarge', { name: f.name }));
          continue;
        }
        try {
          const attachment = await taskAttachmentService.uploadAttachment(taskId, f);
          setAttachments((prev) => [...prev, attachment]);
        } catch (err) {
          console.error('Upload failed:', err);
          toast.error(
            err?.response?.data?.error || t('itemTabs.uploadFailed', { name: f.name })
          );
        }
      }
      setUploading(false);
    },
    [taskId, toast, t]
  );

  const handleFilesSelected = useCallback(
    async (e) => {
      const files = Array.from(e.target.files || []);
      await uploadFiles(files);
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [uploadFiles]
  );

  const handleDelete = useCallback(
    async (attachmentId) => {
      if (!taskId) return;
      const prev = attachments;
      // Optimistic remove
      setAttachments((cur) => cur.filter((a) => a._id !== attachmentId));
      try {
        await taskAttachmentService.deleteAttachment(taskId, attachmentId);
      } catch (err) {
        console.error('Failed to delete attachment:', err);
        toast.error(
          err?.response?.data?.error || t('itemTabs.fileDeleteError')
        );
        setAttachments(prev);
      }
    },
    [taskId, attachments, toast, t]
  );

  const handleDrop = useCallback(
    async (e) => {
      e.preventDefault();
      setDragOver(false);
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length) await uploadFiles(files);
    },
    [uploadFiles]
  );

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  return (
    <div className="flex flex-col h-full" style={{ minHeight: 0 }}>
      {/* Upload dropzone */}
      <div
        onClick={() => fileInputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        role="button"
        tabIndex={0}
        aria-label={t('itemTabs.uploadFiles')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        className="flex flex-col items-center justify-center font-body transition-colors duration-150"
        style={{
          margin: '16px 24px 0 24px',
          padding: '20px 16px',
          border: `1.5px dashed ${
            dragOver
              ? 'var(--color-accent)'
              : 'var(--color-border-strong)'
          }`,
          borderRadius: 'var(--radius-md)',
          background: dragOver
            ? 'var(--color-accent-light, rgba(37,99,235,0.06))'
            : 'var(--color-bg-subtle, #F9FAFB)',
          cursor: uploading ? 'wait' : 'pointer',
          color: 'var(--color-text-secondary)',
          textAlign: 'center',
        }}
      >
        <UploadCloud
          size={22}
          aria-hidden="true"
          style={{
            color: dragOver
              ? 'var(--color-accent)'
              : 'var(--color-text-muted)',
            marginBottom: 6,
          }}
        />
        <p style={{ fontSize: 13, fontWeight: 600, margin: 0, color: 'var(--color-text-primary)' }}>
          {uploading ? t('itemTabs.uploading') : t('itemTabs.dropFilesHere')}
        </p>
        <p style={{ fontSize: 11, margin: '4px 0 0 0', color: 'var(--color-text-muted)' }}>
          {t('itemTabs.upTo25Mb')}
        </p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFilesSelected}
          style={{ display: 'none' }}
          aria-hidden="true"
          tabIndex={-1}
        />
      </div>

      {/* Files list */}
      <div className="flex-1 overflow-y-auto" style={{ padding: '12px 24px 24px 24px', minHeight: 0 }}>
        {loading ? (
          <p
            className="font-body text-center"
            style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: '24px 0' }}
          >
            {t('itemTabs.loadingFiles')}
          </p>
        ) : error ? (
          <p
            className="font-body text-center"
            role="alert"
            style={{ fontSize: 13, color: 'var(--color-status-stuck)', padding: '24px 0' }}
          >
            {error}
          </p>
        ) : attachments.length === 0 ? (
          <p
            className="font-body text-center"
            style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: '24px 0' }}
          >
            {t('itemTabs.noFilesAttached')}
          </p>
        ) : (
          <ul
            className="flex flex-col"
            style={{ listStyle: 'none', padding: 0, margin: 0, gap: 8 }}
          >
            {attachments.map((a) => (
              <li key={a._id || a.url}>
                <AttachmentRow
                  attachment={a}
                  canDelete={
                    !a.uploadedBy ||
                    a.uploadedBy._id === currentUser?._id ||
                    a.uploadedBy === currentUser?._id
                  }
                  onDelete={() => handleDelete(a._id)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

const AttachmentRow = ({ attachment, canDelete, onDelete }) => {
  const { t } = useTranslation();
  const Icon = iconForMime(attachment.mime || '');
  const uploader = attachment.uploadedBy;
  const uploaderName =
    (uploader && typeof uploader === 'object' && uploader.name) || '';
  const [hovered, setHovered] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const isImage = (attachment.mime || '').startsWith('image/');
  const handleDownload = () =>
    downloadFile(attachment.url, attachment.mime || '', attachment.name || 'file');

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setConfirmOpen(false);
      }}
      className="flex items-center gap-3"
      style={{
        padding: '10px 12px',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--color-bg-surface, #FFFFFF)',
        transition: 'background 150ms',
      }}
    >
      {/* Thumbnail / icon */}
      {isImage ? (
        <a
          href={attachment.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ flexShrink: 0, lineHeight: 0 }}
        >
          <img
            src={attachment.url}
            alt={attachment.name || t('itemTabs.attachment')}
            style={{
              width: 40,
              height: 40,
              objectFit: 'cover',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-border)',
              display: 'block',
            }}
          />
        </a>
      ) : (
        <span
          aria-hidden="true"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 40,
            height: 40,
            borderRadius: 'var(--radius-sm)',
            background: 'var(--color-bg-subtle, #F3F4F6)',
            color: 'var(--color-text-secondary)',
            flexShrink: 0,
          }}
        >
          <Icon size={18} />
        </span>
      )}

      {/* Name + meta */}
      <div className="min-w-0 flex-1">
        {isImage ? (
          <a
            href={attachment.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-body transition-colors hover:text-[color:var(--color-accent)]"
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--color-text-primary)',
              textDecoration: 'none',
              display: 'block',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={attachment.name || t('itemTabs.attachment')}
          >
            {attachment.name || t('itemTabs.attachment')}
          </a>
        ) : (
          <button
            type="button"
            onClick={handleDownload}
            className="font-body transition-colors hover:text-[color:var(--color-accent)] text-left"
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--color-text-primary)',
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              display: 'block',
              width: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={attachment.name || t('itemTabs.attachment')}
          >
            {attachment.name || t('itemTabs.attachment')}
          </button>
        )}
        <div
          className="font-body flex items-center gap-2 flex-wrap"
          style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}
        >
          {attachment.size > 0 && <span>{formatBytes(attachment.size)}</span>}
          {uploaderName && (
            <>
              <span aria-hidden="true">•</span>
              <span>{t('itemTabs.byUploader', { name: uploaderName })}</span>
            </>
          )}
          {attachment.createdAt && (
            <>
              <span aria-hidden="true">•</span>
              <span title={attachment.createdAt}>{timeAgo(attachment.createdAt)}</span>
            </>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1" style={{ flexShrink: 0 }}>
        <button
          type="button"
          onClick={handleDownload}
          aria-label={t('itemTabs.downloadFile')}
          title={t('itemTabs.download')}
          className="inline-flex items-center justify-center rounded transition-colors hover:bg-[color:var(--color-bg-subtle)]"
          style={{
            width: 28,
            height: 28,
            background: 'transparent',
            border: 'none',
            color: 'var(--color-text-secondary)',
            cursor: 'pointer',
          }}
        >
          <Download size={14} aria-hidden="true" />
        </button>
        {canDelete && (
          confirmOpen ? (
            <>
              <button
                type="button"
                onClick={onDelete}
                className="font-body"
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  height: 28,
                  padding: '0 8px',
                  background: 'var(--color-status-stuck, #DC2626)',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                }}
              >
                {t('itemTabs.delete')}
              </button>
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="font-body"
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  height: 28,
                  padding: '0 6px',
                  background: 'transparent',
                  color: 'var(--color-text-muted)',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                {t('itemTabs.cancel')}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              aria-label={t('itemTabs.deleteFile')}
              title={t('itemTabs.delete')}
              className="inline-flex items-center justify-center rounded transition-colors hover:bg-[color:var(--color-bg-subtle)]"
              style={{
                width: 28,
                height: 28,
                background: 'transparent',
                border: 'none',
                color: 'var(--color-text-secondary)',
                cursor: 'pointer',
                opacity: hovered ? 1 : 0.4,
                transition: 'opacity 150ms',
              }}
            >
              <Trash2 size={14} aria-hidden="true" />
            </button>
          )
        )}
      </div>
    </div>
  );
};

export default FilesTab;
