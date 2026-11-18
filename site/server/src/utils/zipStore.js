/**
 * zipStore.js — build a small .zip in memory with Node built-ins only.
 *
 * Entries are STORED (no compression): the WordPress plugin is a few KB, and
 * stored entries keep the writer tiny and obviously correct. CRC-32 comes from
 * `zlib.crc32` (Node ≥ 22.2 / 20.15). File names are UTF-8 (general-purpose
 * flag bit 11). No ZIP64 — every entry and the archive must stay < 4 GB, and
 * fewer than 65 535 entries (asserted).
 *
 * PURE — no I/O.
 */

const zlib = require('zlib');

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const FLAG_UTF8 = 0x0800;
const VERSION = 20; // 2.0 — directories + stored entries
const MADE_BY_UNIX = (3 << 8) | VERSION;

/** JS Date → MS-DOS { time, date } (local time, 2-second resolution). */
const dosDateTime = (d) => {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | (Math.floor(d.getSeconds() / 2) & 31),
    date: (((year - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31),
  };
};

/** Reject names that could escape the extraction directory. */
const safeName = (name) => {
  const n = String(name || '');
  if (!n || n.startsWith('/') || n.includes('\\') || n.split('/').some((p) => p === '..') || /[\0]/.test(n)) {
    throw new Error(`zipStore: unsafe entry name "${n}"`);
  }
  return n;
};

/**
 * @param {Array<{ name: string, data?: string|Buffer }>} entries
 *   A name ending in '/' is a directory (no data).
 * @param {{ date?: Date }} [opts]
 * @returns {Buffer} the zip archive
 */
const createZip = (entries, opts = {}) => {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('zipStore: no entries');
  if (entries.length >= 0xffff) throw new Error('zipStore: too many entries');
  const { time, date } = dosDateTime(opts.date || new Date());
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(safeName(entry.name), 'utf8');
    const isDir = entry.name.endsWith('/');
    const data = isDir ? Buffer.alloc(0) : Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data ?? ''), 'utf8');
    if (data.length >= 0xffffffff || offset >= 0xffffffff) throw new Error('zipStore: entry too large');
    const crc = isDir ? 0 : zlib.crc32(data) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(VERSION, 4); // version needed
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); // compressed size
    local.writeUInt32LE(data.length, 22); // uncompressed size
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(SIG_CENTRAL, 0);
    central.writeUInt16LE(MADE_BY_UNIX, 4);
    central.writeUInt16LE(VERSION, 6);
    central.writeUInt16LE(FLAG_UTF8, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attrs
    // External attrs: unix mode in the high 16 bits (+ MS-DOS dir bit).
    const mode = isDir ? 0o40755 : 0o100644;
    central.writeUInt32LE(((mode << 16) | (isDir ? 0x10 : 0)) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(SIG_END, 0);
  end.writeUInt16LE(0, 4); // this disk
  end.writeUInt16LE(0, 6); // disk with central dir
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment length
  return Buffer.concat([...locals, centralBuf, end]);
};

module.exports = { createZip, dosDateTime };
