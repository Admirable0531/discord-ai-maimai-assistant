// Shared look for the image cards. Values are the dark-surface column of the
// dataviz reference palette (Discord is dark, and a bright card in a dark chat
// is glaring): one surface, three ink levels, hairline chrome, and the status
// colours, which are reserved for state and always travel with an icon and a
// label — never colour alone.

const COVER_HOST = 'dp4p6x0xfi5o9.cloudfront.net';
const COVER_PATH = '/maimai/img/cover-m/';

const TOKENS = {
    surface: '#1a1a19',
    raised: '#242422', // tiles: one step off the surface
    ink: '#ffffff',
    inkSecondary: '#c3c2b7',
    inkMuted: '#898781',
    grid: '#2c2c2a',
    axis: '#383835',
    series1: '#3987e5',
    good: '#0ca30c',
    warning: '#fab219',
};

// Covers and the CJK titles need real CJK faces — the container installs
// fonts-noto-cjk — and the stack falls back to system faces elsewhere.
const FONT_STACK =
    '"Noto Sans CJK JP", "Noto Sans JP", "Hiragino Sans", "Yu Gothic", system-ui, -apple-system, "Segoe UI", sans-serif';

const BASE_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: ${TOKENS.surface}; color: ${TOKENS.ink}; font-family: ${FONT_STACK}; -webkit-font-smoothing: antialiased; }
.tabular { font-variant-numeric: tabular-nums; }
`;

/** Escapes text for HTML content and attribute values. Everything from outside goes through this. */
function escapeHtml(value) {
    return String(value ?? '').replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
}

/** 16407 -> "16,407". */
function formatInt(n) {
    return Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '–';
}

function coverUrl(imageName) {
    return imageName ? `https://${COVER_HOST}${COVER_PATH}${encodeURIComponent(imageName)}` : null;
}

module.exports = { TOKENS, FONT_STACK, BASE_CSS, COVER_HOST, escapeHtml, formatInt, coverUrl };
