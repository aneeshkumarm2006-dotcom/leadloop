import { Check, CheckCheck, Clock, AlertTriangle, ArrowDownLeft } from 'lucide-react';
import { timeAgo, formatDate } from '../../utils/dateUtils';

/**
 * ChatBubble — a single message bubble for SMS / WhatsApp threads (F10.5).
 *
 * Factored out as a shared subcomponent so F11 (WhatsApp) reuses the exact same
 * chat presentation. Outbound messages sit right (accent), inbound left
 * (subtle); outbound rows surface a delivery-status icon + label (AC4).
 *
 * Props:
 *   message — { direction:'in'|'out', body, status, sentAt, from, to, error }
 *   meta    — optional trailing node (e.g. a media thumbnail for WhatsApp)
 */
const STATUS_META = {
  queued: { label: 'Queued', icon: Clock, color: 'var(--color-text-muted)' },
  sent: { label: 'Sent', icon: Check, color: 'var(--color-text-muted)' },
  delivered: { label: 'Delivered', icon: CheckCheck, color: 'var(--color-status-done)' },
  failed: { label: 'Failed', icon: AlertTriangle, color: 'var(--color-status-stuck)' },
  received: { label: 'Received', icon: ArrowDownLeft, color: 'var(--color-accent)' },
};

const ChatBubble = ({ message, meta = null }) => {
  const isOut = message.direction === 'out';
  const status = STATUS_META[message.status] || STATUS_META.queued;
  const StatusIcon = status.icon;

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isOut ? 'flex-end' : 'flex-start',
        padding: '3px 0',
      }}
    >
      <div
        style={{
          maxWidth: '78%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: isOut ? 'flex-end' : 'flex-start',
        }}
      >
        <div
          className="font-body"
          style={{
            padding: '8px 12px',
            borderRadius: 14,
            borderBottomRightRadius: isOut ? 4 : 14,
            borderBottomLeftRadius: isOut ? 14 : 4,
            background: isOut ? 'var(--color-accent)' : 'var(--color-bg-subtle)',
            color: isOut ? '#FFFFFF' : 'var(--color-text-primary)',
            fontSize: 13,
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {message.body}
        </div>
        {meta}
        <span
          className="font-body"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            marginTop: 3,
            fontSize: 10,
            color: isOut ? status.color : 'var(--color-text-muted)',
          }}
        >
          {isOut && <StatusIcon size={11} aria-hidden="true" />}
          {isOut ? status.label : message.from || 'Lead'}
          <span style={{ color: 'var(--color-text-muted)' }} title={formatDate(message.sentAt)}>
            · {timeAgo(message.sentAt)}
          </span>
        </span>
        {isOut && message.status === 'failed' && message.error && (
          <span
            className="font-body"
            style={{ fontSize: 10, color: 'var(--color-status-stuck)', marginTop: 2, maxWidth: 240, textAlign: 'right' }}
          >
            {message.error}
          </span>
        )}
      </div>
    </div>
  );
};

export default ChatBubble;
