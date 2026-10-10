// How far the tracked account is from a version plate (将 / 極 / 神 / 舞舞):
// every BASIC–MASTER chart of that version, read off maimai NET's per-version
// score pages, checked against the plate's requirement. Re:MASTER doesn't count
// toward plates.
const { VERSIONS, fetchVersionScores } = require('../web/maimaiVersionScores');

// Version kanji -> the version indices the plate covers (the plate list on
// maimai.shiftpsh.com/en/plate-difficulty; 真 spans maimai and maimai PLUS).
const PLATE_VERSIONS = {
    真: [0, 1],
    超: [2],
    檄: [3],
    橙: [4],
    暁: [5],
    桃: [6],
    櫻: [7],
    紫: [8],
    菫: [9],
    白: [10],
    雪: [11],
    輝: [12],
    熊: [13],
    華: [14],
    爽: [15],
    煌: [16],
    宙: [17],
    星: [18],
    祭: [19],
    祝: [20],
    双: [21],
    宴: [22],
    鏡: [23],
    彩: [24],
    丸: [25],
};
// Simplified / variant forms people type.
const KANJI_ALIASES = {
    华: '華',
    极: '極',
    將: '将',
    晓: '暁',
    樱: '櫻',
    辉: '輝',
    雙: '双',
    镜: '鏡',
};

const TYPES = {
    将: { label: 'SSS or better', done: (c) => c.achievement != null && c.achievement >= 100 },
    極: { label: 'FC or better', done: (c) => ['FC', 'FC+', 'AP', 'AP+'].includes(c.clear) },
    神: { label: 'AP or better', done: (c) => ['AP', 'AP+'].includes(c.clear) },
    舞舞: { label: 'Full Sync DX (FDX) or better', done: (c) => ['FDX', 'FDX+'].includes(c.sync) },
};
const PLATE_DIFFICULTIES = ['basic', 'advanced', 'expert', 'master'];
const MAX_LISTED = 40;

const declaration = {
    name: 'get_maimai_plate_progress',
    description:
        "The tracked account's progress toward a version plate — 将 (SSS), 極 (FC), 神 (AP) or 舞舞 (Full Sync DX) " +
        'on every BASIC–MASTER chart of that version (Re:MASTER does not count) — read live off its per-version ' +
        'score pages with the real badges: how many charts are done per difficulty, and the charts still missing ' +
        'with their current score and badges. Pass the plate as written ("華舞舞", "鏡将", "祭極"), or `version` ' +
        '(e.g. "PRiSM", "でらっくす PLUS") with `type`. Several plates at once: call once per plate. The tracked ' +
        'account only.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            plate: { type: 'string', description: 'The plate name, e.g. "華舞舞", "超将".' },
            version: { type: 'string', description: 'Or the version name, with type.' },
            type: { type: 'string', enum: ['将', '極', '神', '舞舞'] },
        },
    },
};

const norm = (s) =>
    String(s || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/\+/g, ' plus')
        .replace(/\s+/g, ' ')
        .trim();
const ENGLISH_NAMES = {
    でらっくす: 'dx',
    'でらっくす plus': 'dx plus',
    スプラッシュ: 'splash',
    'スプラッシュ plus': 'splash plus',
};

/** {versions: [index], kanji|null, type} from the arguments, or {error}. */
function resolvePlate(args) {
    const text = String(args?.plate || '')
        .trim()
        .replace(/./g, (c) => KANJI_ALIASES[c] || c);
    let type = TYPES[args?.type] ? args.type : null;
    if (text) {
        type = text.endsWith('舞舞')
            ? '舞舞'
            : ['将', '極', '神'].find((t) => text.endsWith(t)) || type;
        const kanji = text[0];
        if (kanji === '舞' && !text.slice(1).startsWith('舞')) {
            return {
                error: 'The 舞 plates (all standard charts through FiNALE) are not supported here.',
            };
        }
        if (PLATE_VERSIONS[kanji] && type) return { versions: PLATE_VERSIONS[kanji], kanji, type };
    }
    if (args?.version && type) {
        const wanted = norm(args.version);
        const index = VERSIONS.findIndex(
            (v) => norm(v) === wanted || ENGLISH_NAMES[norm(v)] === wanted
        );
        if (index >= 0) {
            const kanji =
                Object.keys(PLATE_VERSIONS).find((k) => PLATE_VERSIONS[k].includes(index)) || null;
            return { versions: kanji ? PLATE_VERSIONS[kanji] : [index], kanji, type };
        }
        return { error: `Unknown version "${args.version}".`, known_versions: VERSIONS };
    }
    return {
        error: 'Pass a plate like "華舞舞" or "鏡将", or a version with a type (将 / 極 / 神 / 舞舞).',
        known_version_kanji: Object.keys(PLATE_VERSIONS).join(''),
    };
}

async function execute(args) {
    const plate = resolvePlate(args);
    if (plate.error) return { success: false, ...plate };
    const rule = TYPES[plate.type];

    const missing = [];
    const byDifficulty = {};
    try {
        for (const version of plate.versions) {
            for (const difficulty of PLATE_DIFFICULTIES) {
                const charts = await fetchVersionScores(version, difficulty);
                const tally = (byDifficulty[difficulty] ||= { total: 0, done: 0 });
                for (const chart of charts) {
                    tally.total += 1;
                    if (rule.done(chart)) tally.done += 1;
                    else missing.push({ difficulty, ...chart });
                }
            }
        }
    } catch (err) {
        return { success: false, error: `Could not read the score pages: ${err.message}` };
    }

    const total = Object.values(byDifficulty).reduce((n, d) => n + d.total, 0);
    if (total === 0) {
        return {
            success: false,
            error: 'The score pages listed no charts — the session may have hiccupped; try again.',
        };
    }
    const order = PLATE_DIFFICULTIES;
    missing.sort((a, b) => order.indexOf(b.difficulty) - order.indexOf(a.difficulty));

    return {
        success: true,
        plate: plate.kanji
            ? `${plate.kanji}${plate.type}`
            : `${VERSIONS[plate.versions[0]]} ${plate.type} (no plate known for this version)`,
        versions: plate.versions.map((v) => VERSIONS[v]),
        requirement: `${rule.label} on every BASIC–MASTER chart`,
        done: total - missing.length,
        total,
        complete: missing.length === 0,
        by_difficulty: byDifficulty,
        remaining: missing.slice(0, MAX_LISTED).map((c) => ({
            song: c.title,
            difficulty: c.difficulty,
            chart_type: c.chartType,
            level: c.level,
            achievement: c.achievement,
            clear: c.clear,
            sync: c.sync,
            ...(c.achievement == null ? { unplayed: true } : {}),
        })),
        ...(missing.length > MAX_LISTED
            ? { remaining_not_listed: missing.length - MAX_LISTED }
            : {}),
    };
}

module.exports = { declaration, execute, resolvePlate };
