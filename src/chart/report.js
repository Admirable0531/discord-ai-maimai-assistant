// Picks the findings worth showing: highest severity first, at most a few per
// rule so one noisy rule cannot fill the list, the rest summarised as counts.
const RULE_NAMES = {
    A1: 'touch beside a button note',
    A2: 'touch beside a held button',
    A3: 'touch beside a touch',
    A4: 'slide passing a note',
    A5: 'note passing a slide',
    A6: 'slide beside a slide',
    A7: 'slide end beside a note',
    A9: 'adjacent-button run',
    A13: 'note blocked by a slide end',
    B1: 'rhythm change',
    B2: 'BPM change',
    B4: 'burst',
    B5: 'jack',
};

const formatTime = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

/** The findings worth showing, by time, with at most `perRule` of each rule. */
function pickFindings(findings, { limit = 10, perRule = 3 } = {}) {
    const taken = {};
    return [...findings]
        .sort((a, b) => b.severity - a.severity || a.time - b.time)
        .filter((f) => {
            taken[f.rule] = (taken[f.rule] || 0) + 1;
            return taken[f.rule] <= perRule;
        })
        .slice(0, limit)
        .sort((a, b) => a.time - b.time);
}

function summarise(findings, options) {
    const counts = {};
    for (const f of findings) counts[f.rule] = (counts[f.rule] || 0) + 1;
    const picked = pickFindings(findings, options);
    return {
        shown: picked.map((f) => ({
            rule: f.rule,
            name: RULE_NAMES[f.rule] || f.rule,
            severity: f.severity,
            bar: f.bar,
            time: formatTime(f.time),
            what: f.text,
        })),
        total_findings: findings.length,
        findings_per_rule: Object.fromEntries(
            Object.entries(counts).map(([rule, n]) => [
                `${rule} ${RULE_NAMES[rule] || ''}`.trim(),
                n,
            ])
        ),
    };
}

module.exports = { summarise, pickFindings, RULE_NAMES, formatTime };
