// Render an HTML card to a PNG and attach it to the reply. Never throws: the
// tools that draw their results still have the data worth returning when the
// image can't be made, so a failure comes back as a message instead.
const { renderHtmlToPng } = require('./browserRenderer');
const { COVER_HOST } = require('./theme');
const { attachFile } = require('../utils/outputs');

/** @returns {Promise<{ok: true} | {ok: false, error: string}>} */
async function drawCard(context, { html, width, filename, scale }) {
    try {
        const data = await renderHtmlToPng(html, { width, scale, allowedHosts: [COVER_HOST] });
        const attached = attachFile(context, { name: filename, data });
        return attached.ok ? { ok: true } : { ok: false, error: attached.reason };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

module.exports = { drawCard };
