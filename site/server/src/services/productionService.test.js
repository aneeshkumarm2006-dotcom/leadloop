/**
 * productionService.test.js — unit tests for the Production report builder
 * (GCI / source ROI with revenue / agent leaderboard). Pure, no DB. Run from
 * the server directory:
 *     node --test src/services/productionService.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildProduction } = require('./productionService');

// --- fixtures --------------------------------------------------------------

const SOURCE_COL = { _id: 'c_source', name: 'Source', type: 'text' };
const VALUE_COL = { _id: 'c_value', name: 'Deal Value', type: 'number' };
const AGENT_COL = { _id: 'c_agent', name: 'Agent', type: 'person' };
const COMMISSION_COL = { _id: 'c_comm', name: 'Commission %', type: 'number' };
const STATUS_COL = {
  _id: 'c_status',
  name: 'Status',
  type: 'status',
  settings: {
    options: [
      { id: 's_new', label: 'New' },
      { id: 's_won', label: 'Closed Won' },
      { id: 's_lost', label: 'Lost' },
    ],
  },
};

const lead = ({ source, status, value, agent, commission }) => ({
  columnValues: {
    c_source: source,
    c_status: status,
    ...(value !== undefined ? { c_value: value } : {}),
    ...(agent !== undefined ? { c_agent: agent } : {}),
    ...(commission !== undefined ? { c_comm: commission } : {}),
  },
});

const NAMES = new Map([
  ['u1', 'Jane Doe'],
  ['u2', 'Marc Tremblay'],
]);

const opts = (extra = {}) => ({
  sourceCol: SOURCE_COL,
  statusCol: STATUS_COL,
  valueCol: VALUE_COL,
  agentCol: AGENT_COL,
  // Present on the board, but only deals that actually carry a value in it
  // override the report-wide rate (blank → fall back to `commissionRate`).
  commissionCol: COMMISSION_COL,
  nameById: NAMES,
  commissionRate: 3, // 3%
  ...extra,
});

// --- tests -----------------------------------------------------------------

test('GCI = deal value × commission rate, only for won deals', () => {
  const tasks = [
    lead({ source: 'Zillow', status: 's_won', value: 500000, agent: ['u1'] }),
    lead({ source: 'Zillow', status: 's_lost', value: 400000, agent: ['u1'] }), // not won → no money
  ];
  const { totals } = buildProduction(tasks, opts());
  assert.equal(totals.leads, 2);
  assert.equal(totals.closings, 1);
  assert.equal(totals.volume, 500000);
  assert.equal(totals.gci, 15000); // 500k × 3%
  assert.equal(totals.avgDeal, 500000);
  assert.equal(totals.conversionRate, 50);
});

test('a per-deal commission column overrides the report-wide rate', () => {
  const tasks = [
    lead({ source: 'Referral', status: 's_won', value: 400000, agent: ['u1'], commission: 1.5 }),
  ];
  const { totals } = buildProduction(tasks, opts());
  assert.equal(totals.gci, 6000); // 400k × 1.5% (not the 3% default)
});

test('source ROI uses revenue vs spend — profit and ROI%', () => {
  const tasks = [
    lead({ source: 'Google Ads', status: 's_won', value: 300000, agent: ['u1'] }), // GCI 9000
  ];
  const campaigns = [{ source: 'Google Ads', budget: 3000 }];
  const { sources } = buildProduction(tasks, opts({ campaigns }));
  const row = sources.find((s) => s.source === 'Google Ads');
  assert.equal(row.gci, 9000);
  assert.equal(row.spend, 3000);
  assert.equal(row.profit, 6000);
  assert.equal(row.roi, 200); // (9000-3000)/3000 = 200%
  assert.equal(row.costPerLead, 3000);
});

test('ROI is null (not Infinity) when a source has no spend', () => {
  const tasks = [lead({ source: 'Referral', status: 's_won', value: 100000, agent: ['u1'] })];
  const { sources, totals } = buildProduction(tasks, opts());
  assert.equal(sources[0].roi, null);
  assert.equal(totals.roi, null);
});

test('agent leaderboard ranks by GCI and computes per-agent stats', () => {
  const tasks = [
    lead({ source: 'Zillow', status: 's_won', value: 200000, agent: ['u1'] }), // Jane 6000
    lead({ source: 'Zillow', status: 's_won', value: 900000, agent: ['u2'] }), // Marc 27000
    lead({ source: 'Zillow', status: 's_new', value: 0, agent: ['u2'] }),
  ];
  const { agents } = buildProduction(tasks, opts());
  assert.equal(agents[0].name, 'Marc Tremblay');
  assert.equal(agents[0].rank, 1);
  assert.equal(agents[0].gci, 27000);
  assert.equal(agents[0].leads, 2);
  assert.equal(agents[0].closings, 1);
  assert.equal(agents[0].conversionRate, 50);
  assert.equal(agents[1].name, 'Jane Doe');
  assert.equal(agents[1].rank, 2);
  assert.equal(agents[1].gci, 6000);
});

test('co-listed deal credits both agents but counts once in totals', () => {
  const tasks = [lead({ source: 'Zillow', status: 's_won', value: 600000, agent: ['u1', 'u2'] })];
  const { agents, totals } = buildProduction(tasks, opts());
  assert.equal(agents.length, 2);
  assert.equal(agents[0].gci, 18000);
  assert.equal(agents[1].gci, 18000);
  // Org totals come from deals, so a co-listing doesn't double-count.
  assert.equal(totals.closings, 1);
  assert.equal(totals.gci, 18000);
  assert.equal(totals.volume, 600000);
});

test('leads with no agent fall into an Unassigned bucket', () => {
  const tasks = [lead({ source: 'Web', status: 's_new' })];
  const { agents } = buildProduction(tasks, opts());
  assert.equal(agents.length, 1);
  assert.equal(agents[0].agentId, 'unassigned');
  assert.equal(agents[0].leads, 1);
});

test('falls back to Task.assignedTo when there is no agent column', () => {
  const tasks = [{ columnValues: { c_source: 'Web', c_status: 's_won', c_value: 100000 }, assignedTo: ['u1'] }];
  const { agents } = buildProduction(tasks, opts({ agentCol: null }));
  assert.equal(agents[0].name, 'Jane Doe');
  assert.equal(agents[0].gci, 3000);
});

test('explicit wonStatusId wins over label matching', () => {
  const tasks = [
    lead({ source: 'Web', status: 's_new', value: 100000, agent: ['u1'] }),
    lead({ source: 'Web', status: 's_won', value: 100000, agent: ['u1'] }),
  ];
  // Treat "New" as the won status → only that lead counts.
  const { totals } = buildProduction(tasks, opts({ wonStatusId: 's_new' }));
  assert.equal(totals.closings, 1);
  assert.equal(totals.gci, 3000);
});

test('messy deal values (currency strings, blanks, negatives) coerce safely', () => {
  const tasks = [
    lead({ source: 'Web', status: 's_won', value: '$450,000', agent: ['u1'] }),
    lead({ source: 'Web', status: 's_won', value: '', agent: ['u1'] }),
    lead({ source: 'Web', status: 's_won', value: -5, agent: ['u1'] }),
  ];
  const { totals } = buildProduction(tasks, opts());
  assert.equal(totals.closings, 3);
  assert.equal(totals.volume, 450000); // blank + negative ignored
  assert.equal(totals.gci, 13500);
});

test('empty input yields zeroed totals, not NaN', () => {
  const { totals, agents, sources } = buildProduction([], opts());
  assert.equal(totals.leads, 0);
  assert.equal(totals.gci, 0);
  assert.equal(totals.conversionRate, 0);
  assert.equal(totals.avgDeal, 0);
  assert.equal(totals.roi, null);
  assert.deepEqual(agents, []);
  assert.deepEqual(sources, []);
});

test('leads with no source land in an Unknown source row', () => {
  const tasks = [lead({ status: 's_new' })];
  const { sources } = buildProduction(tasks, opts());
  assert.equal(sources[0].source, 'Unknown');
  assert.equal(sources[0].leads, 1);
});
