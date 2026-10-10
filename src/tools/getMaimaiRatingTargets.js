// Where a player's next rating points are — the chat side of /target and
// /recommend (same logic, maimaiRatingTargets.js).
const { loadSnapshot } = require('../web/maimaiPlayerSnapshot');
const { loadSongData } = require('../web/maimaiSongData');
const { nextPointTargets, findCandidates } = require('../web/maimaiRatingTargets');

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
const DEFAULT_TARGET = 100.0;

const declaration = {
    name: 'get_maimai_rating_targets',
    description:
        "Where a player's next DX Rating points are, worked out from their best-50 snapshot with the real " +
        'rating formula. mode "improve_existing" (default): charts already in their best 50, each with the ' +
        'achievement that would add +1 rating to it and how far that is from their score now, cheapest first — ' +
        'for "how do I gain rating", "easiest +1", "which B50 songs can I push". mode "new_charts": charts NOT in ' +
        'their best 50 that would beat the lowest B15 / B35 entry at a score of target_achievement or less — ' +
        'for "what should I play to raise my rating", "songs to add to my B50". The player\'s own score on a ' +
        'new_charts entry is unknown (only the best 50 is stored), so call them worth trying, not unplayed. Leave ' +
        "player_name out for the tracked account (the bot owner's own); pass a friend's name otherwise.",
    parametersJsonSchema: {
        type: 'object',
        properties: {
            mode: { type: 'string', enum: ['improve_existing', 'new_charts'] },
            player_name: {
                type: 'string',
                description: "A friend's name; omit for the tracked account.",
            },
            target_achievement: {
                type: 'number',
                description: `new_charts: the best achievement % they'd realistically hit (97–100.5, default ${DEFAULT_TARGET}).`,
            },
            section: {
                type: 'string',
                enum: ['both', 'new', 'old'],
                description: 'new = B15 (current version), old = B35. Default both.',
            },
            sort: {
                type: 'string',
                enum: ['easiest', 'gain'],
                description: 'new_charts: lowest constant first (default) or biggest gain first.',
            },
            limit: {
                type: 'integer',
                description: `Rows per section (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).`,
            },
        },
    },
};

const round4 = (n) => Math.round(n * 10000) / 10000;

async function execute(args) {
    const mode = args?.mode === 'new_charts' ? 'new_charts' : 'improve_existing';
    const section = ['new', 'old'].includes(args?.section) ? args.section : 'both';
    const limit = Math.min(Math.max(Number(args?.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);

    const snapshot = await loadSnapshot(args?.player_name);
    if (!snapshot.success) return snapshot;
    const base = {
        success: true,
        player: snapshot.player.name,
        rating: snapshot.rating,
        snapshot_date: snapshot.snapshotDate,
        snapshot_age_days: snapshot.ageDays,
        stale: snapshot.stale,
        mode,
    };

    if (mode === 'improve_existing') {
        const plays = [
            ...(section !== 'old' ? nextPointTargets(snapshot.newPlays, 'B15') : []),
            ...(section !== 'new' ? nextPointTargets(snapshot.oldPlays, 'B35') : []),
        ].sort((a, b) => a.gap - b.gap);
        return {
            ...base,
            note: 'Each chart in the best 50 counts straight into the total, so every row is +1 rating overall.',
            charts_that_can_still_gain: plays.length,
            targets: plays.slice(0, limit).map((t) => ({
                song: t.play.song,
                chart_type: t.play.chartType,
                difficulty: t.play.difficulty,
                constant: t.play.level,
                in: t.section,
                achievement_now: t.play.achievement,
                achievement_for_next_point: t.needed,
                gap: round4(t.gap),
                rating_now: t.now,
            })),
        };
    }

    const target = Math.min(
        Math.max(Number(args?.target_achievement) || DEFAULT_TARGET, 97),
        100.5
    );
    let songs;
    try {
        songs = (await loadSongData()).songs;
    } catch (err) {
        return { success: false, error: `Could not load the song list: ${err.message}` };
    }
    const { found, cutoffs } = findCandidates(songs, snapshot, target);
    const order =
        args?.sort === 'gain'
            ? (a, b) => b.gain - a.gain || a.level - b.level
            : (a, b) => a.level - b.level || a.needed - b.needed;
    const pick = (key) =>
        found[key]
            .sort(order)
            .slice(0, limit)
            .map((c) => ({
                song: c.title,
                chart_type: c.type,
                difficulty: c.difficulty,
                constant: c.level,
                achievement_needed: c.needed,
                gain_at_target: c.gain,
            }));
    const empty =
        (section === 'old' || found.new.length === 0) &&
        (section === 'new' || found.old.length === 0);
    return {
        ...base,
        target_achievement: target,
        ...(empty
            ? {
                  hint:
                      target < 100.5
                          ? `Nothing beats the cutoff at ${target}% or less. Their best 50 is already strong; try target_achievement 100.5, or mode "improve_existing".`
                          : 'Nothing beats the cutoff even at 100.5% — every chart that could enter is already in their best 50 or out of reach. Say so; mode "improve_existing" may still find points.',
              }
            : {}),
        ...(section !== 'old'
            ? {
                  b15: {
                      rating_to_beat: cutoffs.new,
                      total_found: found.new.length,
                      charts: pick('new'),
                  },
              }
            : {}),
        ...(section !== 'new'
            ? {
                  b35: {
                      rating_to_beat: cutoffs.old,
                      total_found: found.old.length,
                      charts: pick('old'),
                  },
              }
            : {}),
    };
}

module.exports = { declaration, execute };
