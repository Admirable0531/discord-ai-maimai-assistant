// The simai text of a chart split into the lines a player reads: one entry per
// comma-separated step with the time (seconds) it is played at. Used by the
// local-network viewer only, to show the chart text following the timeline.
// Never sent to Discord: chart text is not reposted there.

/** [{t, s}] for every step that holds something. */
function maidataLines(text) {
    const lines = [];
    let tempo = 120;
    let div = 4;
    let t = 0;
    let buf = '';
    const flush = () => {
        const s = buf.replace(/\s+/g, '');
        if (s) lines.push({ t: Math.round(t * 1000) / 1000, s });
        buf = '';
    };
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '(' || ch === '{') {
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
            flush();
            t += 240 / (tempo * div);
        } else if (
            ch === 'E' &&
            buf.replace(/\s+/g, '') === '' &&
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
