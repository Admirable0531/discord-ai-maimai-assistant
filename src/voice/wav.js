// Discord hands us 48 kHz stereo 16-bit PCM once the Opus is decoded; speech
// recognisers want 16 kHz mono, and a third of the samples is a third of the
// upload. Averaging each group of three stereo frames is a crude low-pass,
// but speech sits well under the 8 kHz that 16 kHz keeps, so it's enough.

const SOURCE_RATE = 48000;
const TARGET_RATE = 16000;
const STEP = SOURCE_RATE / TARGET_RATE;

/** 48 kHz stereo s16le -> 16 kHz mono s16le. */
function downsampleToMono16k(pcm) {
    const frames = Math.floor(pcm.length / 4);
    const outFrames = Math.floor(frames / STEP);
    const out = Buffer.alloc(outFrames * 2);
    for (let i = 0; i < outFrames; i++) {
        let sum = 0;
        for (let j = 0; j < STEP; j++) {
            const offset = (i * STEP + j) * 4;
            sum += pcm.readInt16LE(offset) + pcm.readInt16LE(offset + 2);
        }
        out.writeInt16LE(Math.round(sum / (STEP * 2)), i * 2);
    }
    return out;
}

/** Seconds of audio in a 48 kHz stereo s16le buffer. */
function durationSeconds(pcm) {
    return pcm.length / (SOURCE_RATE * 4);
}

/** Root-mean-square level of 16-bit samples, 0..1 — to drop clips that are just breathing or fan noise. */
function rmsLevel(mono) {
    const samples = Math.floor(mono.length / 2);
    if (samples === 0) return 0;
    let sum = 0;
    for (let i = 0; i < samples; i++) {
        const s = mono.readInt16LE(i * 2) / 32768;
        sum += s * s;
    }
    return Math.sqrt(sum / samples);
}

/** Wraps 16 kHz mono s16le in a WAV header. */
function toWav(mono, sampleRate = TARGET_RATE) {
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + mono.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // fmt chunk size
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(1, 22); // mono
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * 2, 28); // byte rate
    header.writeUInt16LE(2, 32); // block align
    header.writeUInt16LE(16, 34); // bits per sample
    header.write('data', 36);
    header.writeUInt32LE(mono.length, 40);
    return Buffer.concat([header, mono]);
}

module.exports = { downsampleToMono16k, durationSeconds, rmsLevel, toWav };
