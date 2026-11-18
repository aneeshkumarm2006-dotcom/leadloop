/**
 * websiteBuilderSteps.js — how to install the LeadLoop website tag on each
 * site builder. ONE source of truth on the server: used by the
 * "Email them the steps" endpoint (the client keeps its own copy for display).
 *
 * Menu names are the builders' current UI labels. Keep each step short and
 * imperative; `{tag}` is never interpolated here — the email shows the tag
 * separately so it can be copied exactly.
 *
 * PURE — no I/O.
 */

const BUILDERS = {
  gtm: {
    name: 'Google Tag Manager',
    intro: 'Add the LeadLoop tag as a Custom HTML tag that fires on every page.',
    steps: [
      'Open tagmanager.google.com and choose the container used on the website.',
      'Go to Tags → New, and name the tag "LeadLoop".',
      'Click Tag Configuration → Custom HTML, and paste the LeadLoop tag.',
      'Click Triggering → All Pages.',
      'Click Save, then Submit → Publish.',
    ],
    notes: ['LeadLoop can also do this for you in one click from the dashboard (Website → Google Tag Manager).'],
  },
  wordpress: {
    name: 'WordPress',
    intro: 'Install the LeadLoop plugin — it already contains the site key.',
    steps: [
      'Download the LeadLoop plugin (leadloop.zip) from LeadLoop → Settings → Ads & tracking → Website → WordPress.',
      'In WordPress, go to Plugins → Add New Plugin → Upload Plugin.',
      'Choose leadloop.zip and click Install Now.',
      'Click Activate Plugin.',
      'Check it under Settings → LeadLoop — it should say "Active".',
    ],
    notes: [
      'No plugin uploads allowed (e.g. WordPress.com on a lower plan)? Paste the tag with a header/footer code plugin such as WPCode → Code Snippets → Header & Footer → Header.',
    ],
  },
  wix: {
    name: 'Wix',
    intro: 'Add the tag as Custom Code in the site’s settings.',
    steps: [
      'In the Wix dashboard, go to Settings → Custom Code (under "Development & integrations").',
      'Click + Add Custom Code and paste the LeadLoop tag.',
      'Name it "LeadLoop", choose Add Code to Pages → All pages → Load code once.',
      'Under Place Code in, choose Head, then click Apply.',
      'Publish the site.',
    ],
    notes: ['Custom Code needs a Premium plan with a connected domain.'],
  },
  squarespace: {
    name: 'Squarespace',
    intro: 'Paste the tag into the site-wide header code injection.',
    steps: [
      'In Squarespace, open Website → Pages, scroll down to Website Tools and click Code Injection (also under Settings → Developer Tools → Code Injection).',
      'Paste the LeadLoop tag into the Header box.',
      'Click Save.',
    ],
    notes: ['Code Injection needs a Core plan or higher (Business on older plans).'],
  },
  webflow: {
    name: 'Webflow',
    intro: 'Paste the tag into the site’s custom head code, then publish.',
    steps: [
      'In Webflow, open the site’s Site settings → Custom code.',
      'Paste the LeadLoop tag into Head code.',
      'Click Save changes.',
      'Publish the site (custom code only runs on the published site).',
    ],
    notes: ['Site-wide custom code needs a paid Site plan.'],
  },
  shopify: {
    name: 'Shopify',
    intro: 'Paste the tag into the theme layout so it runs on every page.',
    steps: [
      'In Shopify admin, go to Online Store → Themes.',
      'Next to the current theme, click … → Edit code.',
      'Open layout/theme.liquid.',
      'Paste the LeadLoop tag just before </head>.',
      'Click Save.',
    ],
    notes: [
      'Don’t use Settings → Customer events for this tag — custom pixels run in a sandbox and can’t see your forms.',
      'If you switch themes later, add the tag to the new theme too.',
    ],
  },
  other: {
    name: 'Any other website',
    intro: 'Paste the tag once into the part of the site shared by every page.',
    steps: [
      'Open the template, layout or header file used by every page (or your site builder’s "custom code / header code" setting).',
      'Paste the LeadLoop tag inside <head> (or just before </body>).',
      'Save and publish/deploy the site.',
    ],
    notes: ['Single-page apps (React, Vue…): add it to index.html — it also picks up forms that render later.'],
  },
};

const BUILDER_IDS = Object.keys(BUILDERS);

const isBuilder = (id) => Object.prototype.hasOwnProperty.call(BUILDERS, String(id || ''));

/** { id, name, intro, steps[], notes[] } for a builder, or null. Copies, so callers can't mutate the table. */
const getBuilderSteps = (id) => {
  if (!isBuilder(id)) return null;
  const b = BUILDERS[id];
  return { id, name: b.name, intro: b.intro, steps: [...b.steps], notes: [...b.notes] };
};

const escapeHtml = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Plain-text rendering (email text part). */
const renderStepsText = (id, snippetTag) => {
  const b = getBuilderSteps(id);
  if (!b) return '';
  const lines = [`${b.name}: ${b.intro}`, '', 'The tag:', snippetTag || '', ''];
  b.steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  if (b.notes.length) {
    lines.push('');
    b.notes.forEach((n) => lines.push(`Note: ${n}`));
  }
  return lines.join('\n');
};

/** HTML fragment (every value escaped). */
const renderStepsHtml = (id, snippetTag) => {
  const b = getBuilderSteps(id);
  if (!b) return '';
  return [
    `<p style="margin:0 0 12px"><strong>${escapeHtml(b.name)}:</strong> ${escapeHtml(b.intro)}</p>`,
    '<p style="margin:0 0 6px">The tag:</p>',
    `<pre style="white-space:pre-wrap;word-break:break-all;background:#F6F1E7;border-radius:8px;padding:12px;font-size:13px;margin:0 0 16px">${escapeHtml(snippetTag)}</pre>`,
    `<ol style="margin:0 0 16px;padding-left:20px">${b.steps.map((s) => `<li style="margin:0 0 6px">${escapeHtml(s)}</li>`).join('')}</ol>`,
    b.notes.map((n) => `<p style="margin:0 0 8px;color:#5C554A;font-size:13px">${escapeHtml(n)}</p>`).join(''),
  ].join('');
};

module.exports = { BUILDERS, BUILDER_IDS, isBuilder, getBuilderSteps, renderStepsText, renderStepsHtml, escapeHtml };
