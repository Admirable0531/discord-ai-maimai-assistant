// Free-text search shared by the memory and knowledge-base repositories:
// ranked matches from the table's FTS5 index (see database/client.js), then
// substring matches for what the index can't see.
//
// The index uses the trigram tokenizer, which only matches terms of three or
// more characters — fine for English and for most Japanese/Chinese words, but
// a two-character term like 谱面 or "ap" never matches it, so every term is
// also tried as a plain substring. A question is turned into its content
// words first: "what's my main chart" should find a memory about a "main
// chart", where the old whole-sentence LIKE found nothing.

const STOPWORDS = new Set(
    (
        'a an and are as at be but by can could did do does for from had has have how i if in is it its ' +
        'me my of on or our so than that the their them then there these they this to was we were what ' +
        "what's when where which who whose why will with would you your about tell know"
    ).split(' ')
);

/** The words worth searching for in `query`, lowercased and without filler. */
function queryTerms(query) {
    const words = String(query || '')
        .toLowerCase()
        .split(/[\s,.;:!?"'()[\]{}<>、。，！？：；（）「」『』]+/u)
        .filter(Boolean);
    // One Latin letter ("s" from "what's") would substring-match nearly everything; a single
    // CJK character is a whole word, so it stays.
    const meaningful = (w) =>
        !STOPWORDS.has(w) && ([...w].length > 1 || /[\u3040-\u30ff\u3400-\u9fff]/.test(w));
    const terms = [...new Set(words.filter(meaningful))];
    // A question made only of filler ("what do you know") still has to search for something.
    return terms.length > 0 ? terms : [...new Set(words)];
}

/** An FTS5 MATCH expression for the terms the trigram index can hold, or null if there are none. */
function ftsExpression(terms) {
    const usable = terms.filter((t) => [...t].length >= 3);
    if (usable.length === 0) return null;
    return usable.map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ');
}

function likePattern(term) {
    return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Ids of matching rows, best first, at most `limit`.
 *   sqlite   the raw better-sqlite3 handle
 *   table / fts / columns   the content table, its FTS table and the searched columns
 *   scope    an optional {sql, params} condition on the content table (alias `t`),
 *            e.g. {sql: 't.user_id = ?', params: [userId]}
 *   orderBy  how substring-only matches are ordered (default: newest first)
 */
function searchIds(
    sqlite,
    { table, fts, columns, scope, query, limit, orderBy = 't.updated_at DESC, t.id DESC' }
) {
    const terms = queryTerms(query);
    if (terms.length === 0) return [];
    const scopeSql = scope ? ` AND ${scope.sql}` : '';
    const scopeParams = scope ? scope.params : [];

    const ids = [];
    const expression = ftsExpression(terms);
    if (expression) {
        const rows = sqlite
            .prepare(
                `SELECT t.id FROM ${fts} JOIN ${table} t ON t.id = ${fts}.rowid
                 WHERE ${fts} MATCH ?${scopeSql} ORDER BY bm25(${fts}) LIMIT ?`
            )
            .all(expression, ...scopeParams, limit);
        ids.push(...rows.map((r) => r.id));
    }

    if (ids.length < limit) {
        const conditions = terms
            .flatMap(() => columns.map((c) => `t.${c} LIKE ? ESCAPE '\\'`))
            .join(' OR ');
        const params = terms.flatMap((term) => columns.map(() => likePattern(term)));
        const rows = sqlite
            .prepare(
                `SELECT t.id FROM ${table} t WHERE (${conditions})${scopeSql} ORDER BY ${orderBy} LIMIT ?`
            )
            .all(...params, ...scopeParams, limit);
        for (const { id } of rows) if (!ids.includes(id)) ids.push(id);
    }
    return ids.slice(0, limit);
}

module.exports = { searchIds, queryTerms, ftsExpression };
