/**
 * csvParse.js — a small, correct CSV reader (RFC 4180).
 *
 * Written rather than pulled in as a dependency because the requirements are
 * narrow and the failure mode matters: a brokerage's entire contact database
 * comes through here once, and a parser that silently mangles one row in a
 * thousand produces corrupted leads nobody notices for months.
 *
 * Handles the things real CRM exports actually contain:
 *   • quoted fields containing commas — "Whitfield, Dana"
 *   • escaped quotes inside quotes    — "She said ""yes"""
 *   • newlines inside quoted fields   — multi-line note columns
 *   • CRLF, LF and CR line endings    — Windows exports
 *   • a UTF-8 BOM                     — Excel's default
 *   • a trailing newline              — almost every file
 */

/** Strip the UTF-8 byte-order mark Excel writes at the start of its exports. */
const stripBom = (text) => (text && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

/**
 * Parse CSV text into an array of row arrays.
 *
 * @param {string} text
 * @param {Object} [opts]
 * @param {string} [opts.delimiter=','] — ',' or ';' (European exports)
 * @param {number} [opts.maxRows=100000] — hard stop, so a malformed giant file
 *        cannot exhaust memory
 * @returns {string[][]}
 */
const parseCsv = (text, { delimiter = ',', maxRows = 100000 } = {}) => {
  const src = stripBom(String(text == null ? '' : text));
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    row.push(field);
    field = '';
    rows.push(row);
    row = [];
  };

  while (i < src.length) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'; // escaped quote
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      endField();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      // CRLF or a lone CR both end the row.
      endRow();
      i += src[i + 1] === '\n' ? 2 : 1;
      if (rows.length >= maxRows) return rows;
      continue;
    }
    if (ch === '\n') {
      endRow();
      i += 1;
      if (rows.length >= maxRows) return rows;
      continue;
    }

    field += ch;
    i += 1;
  }

  // Flush whatever is left, unless the file simply ended with a newline.
  if (field !== '' || row.length > 0) endRow();

  return rows;
};

/**
 * Guess the delimiter by counting candidates in the first line, outside quotes.
 * Comma wins ties — it is overwhelmingly the common case.
 */
const detectDelimiter = (text) => {
  const firstLine = stripBom(String(text || '')).split(/\r?\n/)[0] || '';
  let inQuotes = false;
  const counts = { ',': 0, ';': 0, '\t': 0 };
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && counts[ch] !== undefined) counts[ch] += 1;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : ',';
};

/**
 * Parse into `{ headers, rows }` where each row is an object keyed by header.
 * Blank trailing rows are dropped; duplicate headers are suffixed so no column
 * silently overwrites another.
 */
const parseCsvToObjects = (text, opts = {}) => {
  const delimiter = opts.delimiter || detectDelimiter(text);
  const raw = parseCsv(text, { ...opts, delimiter });
  if (raw.length === 0) return { headers: [], rows: [] };

  const seen = new Map();
  const headers = raw[0].map((h, idx) => {
    const name = String(h || '').trim() || `Column ${idx + 1}`;
    const count = seen.get(name) || 0;
    seen.set(name, count + 1);
    return count === 0 ? name : `${name} (${count + 1})`;
  });

  const rows = [];
  for (let r = 1; r < raw.length; r += 1) {
    const cells = raw[r];
    // Skip rows that are entirely empty (trailing blank lines, separators).
    if (cells.every((c) => String(c || '').trim() === '')) continue;
    const obj = {};
    headers.forEach((h, c) => {
      obj[h] = cells[c] === undefined ? '' : String(cells[c]).trim();
    });
    rows.push(obj);
  }
  return { headers, rows, delimiter };
};

module.exports = { parseCsv, parseCsvToObjects, detectDelimiter, stripBom };
