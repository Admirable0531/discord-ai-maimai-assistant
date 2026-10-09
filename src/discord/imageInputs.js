// Images a user attaches to a message (or that are on the message they're
// replying to), downloaded so a vision-capable model can see them. Only
// Discord's own CDN is fetched, the type is checked against the file's actual
// bytes rather than the name, and size and count are capped — an image costs
// real tokens, and a message can carry arbitrary files.
const logger = require('../utils/logger');

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 12 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15000;
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
                const response = await fetch(url, {
                    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = Buffer.from(await response.arrayBuffer());
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

module.exports = {
    collectImages,
    describeImages,
    MAX_IMAGES,
    MAX_IMAGE_BYTES,
    MAX_TOTAL_BYTES,
    SIGNATURES,
};
