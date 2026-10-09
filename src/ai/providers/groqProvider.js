// Groq: the plain OpenAI-compatible adapter. llama-3.3-70b-versatile is
// free-tier eligible with solid tool-calling accuracy — the closest match to
// Gemini Flash-Lite among Groq's cheap models; llama-3.1-8b-instant is cheaper
// and faster but noticeably weaker at picking the right tool.
const { createOpenAiCompatibleAdapter } = require('./openAiCompatible');
const { config } = require('../../config/env');

const adapter = createOpenAiCompatibleAdapter({
    name: 'Groq',
    provider: 'groq',
    apiUrl: 'https://api.groq.com/openai/v1/chat/completions',
    settings: config.ai.groq,
});

module.exports = { adapter };
