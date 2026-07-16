/**
 * automationDraftAI.js — draft a CRM automation from a plain-language request,
 * using the Anthropic Messages API with a forced tool call (structured output).
 * Returns the design's { trigger, cond, action } draft shape the Sentence
 * Builder consumes. The caller falls back to the local heuristic when there's no
 * ANTHROPIC_API_KEY or the call fails — this is best-effort, never required.
 */

const TOOL = {
  name: 'draft_automation',
  description: 'Draft a single real-estate CRM automation from the user request.',
  input_schema: {
    type: 'object',
    properties: {
      trigger: {
        type: 'object',
        properties: {
          key: { type: 'string', enum: ['status', 'new', 'noreply', 'visit', 'form'] },
          val: { type: ['string', 'null'] },
        },
        required: ['key'],
      },
      condition: {
        type: ['object', 'null'],
        properties: {
          key: { type: 'string', enum: ['budget', 'source', 'statusis'] },
          val: { type: 'string' },
        },
      },
      action: {
        type: 'object',
        properties: {
          key: { type: 'string', enum: ['sms', 'email', 'notify', 'assign', 'move', 'task'] },
          val: { type: ['string', 'null'] },
        },
        required: ['key'],
      },
    },
    required: ['trigger', 'action'],
  },
};

const SYSTEM = `You turn a plain-language request into ONE real-estate CRM automation by calling draft_automation. Pick the single best trigger, an optional condition, and the single best action.

TRIGGERS (key → meaning; val):
- status — a lead's status becomes val. val ∈ [New Lead, Contacted, Interested, Follow-up, Visit Booked, Won, Lost]
- new — a new lead is created (val: null)
- noreply — a lead hasn't replied in val (e.g. "2 days", "3 days", "1 week")
- visit — a visit/tour is booked (val: null)
- form — a form is submitted (val: null)

CONDITIONS (optional; key → val):
- budget — budget over val (e.g. "$1M", "$500K")
- source — lead source is val (e.g. "Referral", "Website Form", "Google Ads")
- statusis — status equals a label

ACTIONS (key → val):
- sms — send an SMS; val = a short friendly message
- email — send an email; val = a short message
- notify — notify an agent; val = "the assigned agent" (default) or a name
- assign — assign to an agent; val = an agent name
- move — move to a board; val = a board name
- task — create a follow-up task; val: null

Keep val concise. Always call the tool exactly once.`;

// Coerce a model's raw tool input into the { trigger, cond, action } draft shape
// the Sentence Builder consumes, applying the same defensive defaults for both
// providers.
const normalizeDraft = (inp) => ({
  trigger:
    inp.trigger && inp.trigger.key
      ? { key: inp.trigger.key, val: inp.trigger.val ?? null }
      : { key: 'new', val: null },
  cond:
    inp.condition && inp.condition.key
      ? { key: inp.condition.key, val: inp.condition.val }
      : null,
  action:
    inp.action && inp.action.key
      ? { key: inp.action.key, val: inp.action.val ?? null }
      : { key: 'notify', val: 'the assigned agent' },
});

const draftWithClaude = async (text, apiKey, model) => {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model || process.env.ANTHROPIC_DRAFT_MODEL || 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'draft_automation' },
      messages: [{ role: 'user', content: String(text).slice(0, 2000) }],
    }),
  });
  if (!resp.ok) throw new Error(`anthropic ${resp.status}`);
  const data = await resp.json();
  const block = (data.content || []).find((b) => b.type === 'tool_use');
  if (!block || !block.input) throw new Error('no tool_use in response');
  return normalizeDraft(block.input);
};

// OpenAI (ChatGPT) drafter — mirrors draftWithClaude using the Chat Completions
// API with a forced function call for the same structured output.
const draftWithOpenAI = async (text, apiKey, model) => {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || process.env.OPENAI_DRAFT_MODEL || 'gpt-4o-mini',
      max_tokens: 512,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: String(text).slice(0, 2000) },
      ],
      tools: [{ type: 'function', function: { name: TOOL.name, description: TOOL.description, parameters: TOOL.input_schema } }],
      tool_choice: { type: 'function', function: { name: TOOL.name } },
    }),
  });
  if (!resp.ok) throw new Error(`openai ${resp.status}`);
  const data = await resp.json();
  const call = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!call?.function?.arguments) throw new Error('no tool_call in response');
  let inp;
  try {
    inp = JSON.parse(call.function.arguments);
  } catch {
    throw new Error('malformed tool_call arguments');
  }
  return normalizeDraft(inp);
};

module.exports = { draftWithClaude, draftWithOpenAI };
