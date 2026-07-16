import { useTranslation } from 'react-i18next';
import { Paperclip } from 'lucide-react';
import { cellWrapperStyle } from './cellShared';

/**
 * FileCell — read-only badge in v1 (uploads happen via the Files tab on the
 * task detail panel). Shows a count + first filename for context.
 */
const FileCell = ({ value }) => {
  const { t } = useTranslation();
  const files = Array.isArray(value) ? value : [];
  return (
    <div style={{ ...cellWrapperStyle, gap: 6 }}>
      {files.length === 0 ? (
        <span style={{ color: 'var(--color-text-muted)' }}>—</span>
      ) : (
        <>
          <Paperclip size={12} aria-hidden="true" />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {files.length === 1
              ? files[0].name || files[0].url
              : t('boardMisc.fileCount', { count: files.length })}
          </span>
        </>
      )}
    </div>
  );
};

export default FileCell;
