// Images a user attaches to a message (or that are on the message they're
// replying to), downloaded so a vision-capable model can see them. Only
// Discord's own CDN is fetched, the type is checked against the file's actual
// bytes rather than the name, and size and count are capped — an image costs
// real tokens, and a message can carry arbitrary files.
const logger = require('../utils/logger');

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 12 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20000;
// A timeout or dropped connection is usually the CDN having a bad moment; a second try mostly works.
const DOWNLOAD_ATTEMPTS = 2;
const TRUSTED_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);

// What each supported type's file starts with.
const SIGNATURES = {
    'image/png': (b) => b.length > 8 && b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG',
    'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    'image/gif': (b) => b.length > 6 && b.toString('latin1', 0, 4) === 'GIF8',
    'image/webp': (b) =>
        b.length > 12 &&
        b.toString('latin1', 0, 4) === 'RIFF' &&
        b.toString('latin1', 8, 12) === 'WEBP',
};

const TYPE_BY_EXTENSION = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
};

function declaredType(attachment) {
    const fromHeader = (attachment.contentType || '').split(';')[0].trim().toLowerCase();
    if (SIGNATURES[fromHeader]) return fromHeader;
    const ext = (attachment.name || '').split('.').pop().toLowerCase();
    return TYPE_BY_EXTENSION[ext] || null;
}

/** Downloads `url`, retrying once on a timeout, a dropped connection or a 5xx. A 4xx (expired link, no access) is final. */
async function download(url) {
    let lastError;
    for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
            if (response.ok) return Buffer.from(await response.arrayBuffer());
            lastError = new Error(`HTTP ${response.status}`);
            if (response.status < 500) break;
        } catch (err) {
            lastError = err;
        }
        if (attempt < DOWNLOAD_ATTEMPTS)
            logger.warn('discord', `Image download failed, retrying: ${lastError.message}`);
    }
    throw lastError;
}

/**
 * Images from the given Discord messages, oldest source first (null/undefined
 * entries are skipped). Never throws: what couldn't be read comes back in
 * `skipped` with a reason, so the model can tell the user instead of
 * pretending it saw the image.
 *
 * @returns {Promise<{images: {mimeType, data, name}[], skipped: string[]}>}
 */
async function collectImages(messages) {
    const images = [];
    const skipped = [];
    let totalBytes = 0;

    for (const message of messages) {
        if (!message?.attachments) continue;
        for (const attachment of message.attachments.values()) {
            const name = attachment.name || 'attachment';
            const type = declaredType(attachment);
            if (!type) {
                // Non-images (zips, videos, text) aren't this feature's business.
                if ((attachment.contentType || '').startsWith('image/')) {
                    skipped.push(`${name}: unsupported image type`);
                }
                continue;
            }
            if (images.length >= MAX_IMAGES) {
                skipped.push(`${name}: only the first ${MAX_IMAGES} images are read`);
                continue;
            }
            if (attachment.size > MAX_IMAGE_BYTES) {
                skipped.push(`${name}: larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB`);
                continue;
            }
            if (totalBytes + (attachment.size || 0) > MAX_TOTAL_BYTES) {
                skipped.push(`${name}: too much image data in one message`);
                continue;
            }

            try {
                const url = new URL(attachment.url);
                if (url.protocol !== 'https:' || !TRUSTED_HOSTS.has(url.hostname)) {
                    skipped.push(`${name}: not hosted on Discord`);
                    continue;
                }
                const data = await download(url);
                if (data.length > MAX_IMAGE_BYTES) {
                    skipped.push(`${name}: larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB`);
                    continue;
                }
                if (!SIGNATURES[type](data)) {
                    skipped.push(
                        `${name}: the file isn't really a ${type.split('/')[1].toUpperCase()}`
                    );
                    continue;
                }
                totalBytes += data.length;
                images.push({ mimeType: type, data: data.toString('base64'), name });
            } catch (err) {
                logger.warn('discord', `Could not download attachment ${name}`, err);
                skipped.push(`${name}: could not be downloaded`);
            }
        }
    }
    return { images, skipped };
}

/** One bracketed line for the prompt (and history) saying what was attached, or '' for nothing. */
function describeImages({ images, skipped }) {
    const parts = [];
    if (images.length > 0) {
        parts.push(
            `${images.length} image${images.length === 1 ? '' : 's'} attached (${images.map((i) => i.name).join(', ')}) — you can see ${images.length === 1 ? 'it' : 'them'} in this message`
        );
    }
    if (skipped.length > 0) parts.push(`not read: ${skipped.join('; ')}`);
    return parts.length > 0 ? `[${parts.join('. ')}]` : '';
}

/**
 * A reply to send INSTEAD of asking the model, or null. When the user attached
 * images and none could be read, a model that can't see them will still answer
 * the question from what it knows — "what is this plate" got a confident
 * description of the wrong plate. The prompt tells the model to say it can't
 * see the image, but that's a request; this makes it certain.
 */
function unreadableImagesReply({ images, skipped }) {
    if (images.length > 0 || skipped.length === 0) return null;
    return (
        `I couldn't read the image you sent (${skipped.join('; ')}), so I can't tell you what's in it. ` +
        'Please send it again, or ask without it.'
    );
}

module.exports = {
    collectImages,
    unreadableImagesReply,
    describeImages,
    MAX_IMAGES,
    MAX_IMAGE_BYTES,
    MAX_TOTAL_BYTES,
    SIGNATURES,
};
