// The simai text of a chart split the way a player reads it: by source line,
// each with the time it starts at and the time of every comma-separated step
// inside it (so the page can mark the step being played). Used by the
// local-network viewer only. Never sent to Discord: chart text is not
// reposted there.

/** [{t, s, steps: [{t, from, to}]}] — one entry per source line that holds anything. */
function maidataLines(text) {
    const lines = [];
    let tempo = 120;
    let div = 4;
    let t = 0;
    let buf = '';
    let steps = [];
    let stepStart = 0;
    let stepT = 0;
    let lineT = 0;
    const round = (n) => Math.round(n * 1000) / 1000;
    const flush = () => {
        if (buf.replace(/\s+/g, '')) {
            // a step left open at the end of the line (no comma yet) still counts
            if (stepStart < buf.length && buf.slice(stepStart).replace(/\s+/g, '')) {
                steps.push({ t: round(stepT), from: stepStart, to: buf.length });
            }
            lines.push({ t: round(lineT), s: buf, steps });
        }
        buf = '';
        steps = [];
        stepStart = 0;
        stepT = t;
        lineT = t;
    };
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '\r') continue;
        if (ch === '\n') {
            flush();
        } else if (ch === '(' || ch === '{') {
            const close = ch === '(' ? ')' : '}';
            const end = text.indexOf(close, i);
            if (end === -1) break;
            const value = parseFloat(text.slice(i + 1, end).replace('#', ''));
            if (value > 0) {
                if (ch === '(') tempo = value;
                else div = value;
            }
            buf += text.slice(i, end + 1);
            i = end;
        } else if (ch === '[') {
            const end = text.indexOf(']', i);
            if (end === -1) break;
            buf += text.slice(i, end + 1);
            i = end;
        } else if (ch === ',') {
            buf += ch;
            if (buf.slice(stepStart).replace(/[\s,]+/g, '')) {
                steps.push({ t: round(stepT), from: stepStart, to: buf.length });
            }
            stepStart = buf.length;
            t += 240 / (tempo * div);
            stepT = t;
        } else if (
            ch === 'E' &&
            buf.slice(stepStart).replace(/\s+/g, '') === '' &&
            !/[1-8]/.test(text[i + 1] || '')
        ) {
            break; // the end marker, not a touch note such as E3
        } else {
            buf += ch;
        }
    }
    flush();
    return lines;
}

module.exports = { maidataLines };
