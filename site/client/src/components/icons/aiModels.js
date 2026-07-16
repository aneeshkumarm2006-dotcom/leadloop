/**
 * Shared AI model catalog for the automation drafter. The first entry in each
 * provider's list is its default model. Kept separate from the brand-icon
 * components so the icon module only exports components (Fast Refresh-friendly).
 */
export const AI_MODELS = {
  claude: [
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
  ],
  openai: [
    { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
    { id: 'gpt-4o', label: 'GPT-4o' },
    { id: 'gpt-4.1', label: 'GPT-4.1' },
  ],
};

export const defaultModelFor = (provider) => AI_MODELS[provider]?.[0]?.id || null;
