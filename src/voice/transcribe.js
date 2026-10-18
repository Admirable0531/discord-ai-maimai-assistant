// Speech to text for voice requests: Groq's Whisper when GROQ_API_KEY is set
// (fast, made for this), otherwise Gemini, which takes audio directly and is
// already configured for the chat.
const { config } = require('../config/env');
const { getGeminiClient } = require('../ai/providers/geminiClient');
const { estimateCostUsd } = require('../ai/pricing');
const { logUsage } = require('../database/repositories/usageRepository');
const { Blob } = require('node:buffer');
const logger = require('../utils/logger');

const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const TIMEOUT_MS = 15000;

// Telling the recogniser who it will hear about makes it spell the name and the game's words right.
const HINT = 'Hey Atri. maimai, B50, rating, chart, constant, SSS+, AP, FC, DX, master, re:master.';

const GEMINI_PROMPT =
    'Transcribe this voice clip exactly as spoken, in the language it is spoken in (often English, ' +
    'Chinese or Japanese, sometimes mixed) — never translate: Chinese stays in Chinese characters. The speaker is talking to a Discord bot called Atri ' +
    '(アトリ / 亚托莉) about the rhythm game maimai, so expect words like B50, rating, chart and ' +
    'song titles. Output only the words spoken, with no quotes or notes. If there is no ' +
    'intelligible speech, output nothing.';

async function transcribeWithGroq(wav) {
    const form = new globalThis.FormData();
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'clip.wav');
    form.append('model', config.voice.groqModel);
    form.append('prompt', HINT);
    form.append('response_format', 'json');
    const res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.ai.groq.apiKey}` },
        body: form,
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Groq transcription failed: ${res.status} ${await res.text()}`);
    const body = await res.json();
    return (body.text || '').trim();
}

async function transcribeWithGemini(wav) {
    const model = config.voice.geminiModel || config.ai.gemini.model;
    const response = await getGeminiClient().models.generateContent({
        model,
        contents: [
            {
                role: 'user',
                parts: [
                    { inlineData: { mimeType: 'audio/wav', data: wav.toString('base64') } },
                    { text: GEMINI_PROMPT },
                ],
            },
        ],
        config: {
            temperature: 0,
            maxOutputTokens: 400,
            // The smallest budget the model accepts (0 is rejected, see geminiProvider.js).
            thinkingConfig: { thinkingBudget: 128 },
            abortSignal: AbortSignal.timeout(TIMEOUT_MS),
        },
    });
    const usage = response.usageMetadata;
    if (usage) {
        try {
            const promptTokens = usage.promptTokenCount || 0;
            const completionTokens = usage.candidatesTokenCount || 0;
            logUsage({
                provider: 'gemini',
                model,
                promptTokens,
                completionTokens,
                costUsd: estimateCostUsd('gemini', promptTokens, completionTokens),
            });
        } catch (err) {
            logger.error('voice', 'Failed to log transcription usage', err);
        }
    }
    return (response.text || '').trim();
}

/** The words in a 16 kHz mono WAV clip ('' for none). */
async function transcribe(wav) {
    return config.ai.groq.apiKey ? transcribeWithGroq(wav) : transcribeWithGemini(wav);
}

module.exports = { transcribe };
