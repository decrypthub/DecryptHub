// Configuration offers wire formats; endpoint brands are ordinary channel names.
export const API_FORMATS = [
  { id: 'chat', label: 'OpenAI Chat Completions', type: 'openai', api: undefined, baseUrl: 'https://api.openai.com/v1' },
  { id: 'responses', label: 'OpenAI Responses', type: 'openai', api: 'openai-responses', baseUrl: 'https://api.openai.com/v1' },
  { id: 'messages', label: 'Anthropic Messages', type: 'anthropic', api: undefined, baseUrl: 'https://api.anthropic.com' },
];
export const apiFormat = route => route?.type === 'anthropic' ? API_FORMATS[2] : route?.api === 'openai-responses' ? API_FORMATS[1] : API_FORMATS[0];
