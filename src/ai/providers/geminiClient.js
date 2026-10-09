const { GoogleGenAI } = require('@google/genai');
const { config } = require('../../config/env');

let client = null;

/** Lazily creates a single shared GoogleGenAI client (Gemini Developer API, not Vertex). */
function getGeminiClient() {
    if (client) return client;

    const apiKey = config.ai.gemini.apiKey;
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY is not set; cannot create Gemini client.');
    }

    client = new GoogleGenAI({ apiKey });
    return client;
}

module.exports = { getGeminiClient };
