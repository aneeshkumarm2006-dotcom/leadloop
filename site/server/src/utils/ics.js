/**
 * ics.js — minimal RFC-5545 VEVENT generator for booking confirmations (Phase 4b).
 * No external deps. Produces a single-event calendar a visitor can "Add to
 * calendar" from the confirmation email.
 */

const pad = (n) => String(n).padStart(2, '0');

// Date → UTC basic format "YYYYMMDDTHHMMSSZ".
const toIcsUtc = (d) => {
  const dt = d instanceof Date ? d : new Date(d);
  return (
    dt.getUTCFullYear() +
    pad(dt.getUTCMonth() + 1) +
    pad(dt.getUTCDate()) +
    'T' +
    pad(dt.getUTCHours()) +
    pad(dt.getUTCMinutes()) +
    pad(dt.getUTCSeconds()) +
    'Z'
  );
};

const esc = (s) =>
  String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');

/**
 * buildIcs({ uid, start, end, title, description, location, organizerEmail,
 * attendeeEmail, status }) → string (text/calendar).
 */
const buildIcs = ({ uid, start, end, title, description, location, organizerEmail, attendeeEmail, status = 'CONFIRMED' }) => {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Macan CRM//Visit Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${toIcsUtc(new Date())}`,
    `DTSTART:${toIcsUtc(start)}`,
    `DTEND:${toIcsUtc(end)}`,
    `SUMMARY:${esc(title)}`,
    description ? `DESCRIPTION:${esc(description)}` : null,
    location ? `LOCATION:${esc(location)}` : null,
    organizerEmail ? `ORGANIZER:mailto:${organizerEmail}` : null,
    attendeeEmail ? `ATTENDEE;RSVP=TRUE:mailto:${attendeeEmail}` : null,
    `STATUS:${status}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  // RFC 5545 wants CRLF line endings.
  return lines.join('\r\n') + '\r\n';
};

module.exports = { buildIcs };
