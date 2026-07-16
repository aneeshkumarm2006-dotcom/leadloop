/**
 * marketingRoiService.test.js — unit tests for the ROI row builder (Phase 2.3).
 *     node --test src/services/marketingRoiService.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRoiRows } = require('./marketingRoiService');

const sourceCol = {
  _id: 'cSource',
  type: 'dropdown',
  settings: { options: [{ id: 'g', label: 'Google Ads' }, { id: 'fb', label: 'Facebook' }] },
};
const statusCol = {
  _id: 'cStatus',
  type: 'status',
  settings: { options: [{ id: 'new', label: 'New' }, { id: 'won', label: 'Closed Won' }] },
};

const lead = (source, status) => ({ columnValues: { cSource: source, cStatus: status } });

test('groups leads by source label and counts won via status label regex', () => {
  const tasks = [
    lead('g', 'won'),
    lead('g', 'new'),
    lead('fb', 'won'),
    lead(null, 'new'), // → Unknown
  ];
  const campaigns = [
    { source: 'Google Ads', budget: 1000 },
    { source: 'Facebook', budget: 500 },
  ];
  const { rows, totals } = buildRoiRows(tasks, { sourceCol, statusCol, campaigns });

  const bySource = Object.fromEntries(rows.map((r) => [r.source, r]));
  assert.equal(bySource['Google Ads'].leads, 2);
  assert.equal(bySource['Google Ads'].won, 1);
  assert.equal(bySource['Google Ads'].spend, 1000);
  assert.equal(bySource['Google Ads'].costPerLead, 500); // 1000 / 2
  assert.equal(bySource['Google Ads'].costPerWon, 1000); // 1000 / 1
  assert.equal(bySource['Google Ads'].conversionRate, 50);

  assert.equal(bySource['Facebook'].leads, 1);
  assert.equal(bySource['Facebook'].costPerLead, 500);

  assert.equal(bySource['Unknown'].leads, 1);
  assert.equal(bySource['Unknown'].spend, 0);

  assert.equal(totals.leads, 4);
  assert.equal(totals.won, 2);
  assert.equal(totals.spend, 1500);
});

test('a campaign with spend but no leads still appears (cost/lead null)', () => {
  const { rows } = buildRoiRows([], {
    sourceCol,
    statusCol,
    campaigns: [{ source: 'LinkedIn', budget: 800 }],
  });
  const li = rows.find((r) => r.source === 'LinkedIn');
  assert.equal(li.leads, 0);
  assert.equal(li.spend, 800);
  assert.equal(li.costPerLead, null);
  assert.equal(li.costPerWon, null);
});

test('source label matches campaign case-insensitively', () => {
  const tasks = [lead('g', 'new'), lead('g', 'new')];
  const { rows } = buildRoiRows(tasks, {
    sourceCol,
    statusCol,
    campaigns: [{ source: 'google ads', budget: 200 }], // lower-case
  });
  // one merged row, not two
  assert.equal(rows.length, 1);
  assert.equal(rows[0].leads, 2);
  assert.equal(rows[0].spend, 200);
  assert.equal(rows[0].costPerLead, 100);
});

test('explicit wonStatusId overrides the regex', () => {
  const tasks = [lead('g', 'new'), lead('g', 'won')];
  const { rows } = buildRoiRows(tasks, {
    sourceCol,
    statusCol,
    campaigns: [],
    wonStatusId: 'new', // treat "new" as the won state
  });
  assert.equal(rows[0].won, 1); // only the 'new' lead counts
});
