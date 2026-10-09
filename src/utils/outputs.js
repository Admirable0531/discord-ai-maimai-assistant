// Files a tool wants delivered with the reply (an image card, a cover). The
// message handler creates one `outputs` object per reply, passes it down in
// the request context, and attaches whatever ends up in it when it sends the
// answer. A tool can't return an image to the model through its JSON result,
// so this is the side channel: the model gets a summary and a note that the
// image is attached.

const MAX_FILES = 4;
// Discord's default upload limit is 10 MB; stay clear of it.
const MAX_FILE_BYTES = 8 * 1024 * 1024;

function createOutputs() {
    return { files: [] };
}

/**
 * Adds a file to the reply. Returns { ok: true } or { ok: false, reason },
 * where the reason is something the model can pass on to the user.
 */
function attachFile(context, { name, data }) {
    const outputs = context?.outputs;
    if (!outputs) return { ok: false, reason: "Images can't be attached in this context." };
    if (outputs.files.length >= MAX_FILES) {
        return { ok: false, reason: `Only ${MAX_FILES} images can go in one reply.` };
    }
    if (data.length > MAX_FILE_BYTES) {
        return { ok: false, reason: 'The image came out too large to upload to Discord.' };
    }
    outputs.files.push({ name, data });
    return { ok: true };
}

module.exports = { createOutputs, attachFile, MAX_FILES, MAX_FILE_BYTES };
