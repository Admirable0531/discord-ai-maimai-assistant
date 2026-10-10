const { fetchAccountPage } = require('../web/maimaiAccountSession');
const { parseRecentPlays, groupSessions, groupByDay } = require('../web/maimaiRecentPlays');
const { loadCoverMap } = require('../web/maimaiCovers');
const { fetchUsers, TRACKED_ID } = require('../web/maimaiPlayers');
const { fold } = require('../web/maimaiSongMatch');
const { buildRecentPlaysHtml, WIDTH } = require('../render/recentPlaysCard');
const { drawCard } = require('../render/drawCard');

const declaration = {
    name: 'get_maimai_recent_plays',
    description:
        'The tracked account\'s recent plays — the last 50 the game keeps — from its Game Record page: time, chart (difficulty, level, DX/standard), achievement, rank, DX score and the real clear/sync badges. A run of the same chart is grouped into one session with its attempts oldest-first. For "my recent plays", "what did I play today", "how is my practice going", "did I set a new best" (new_best marks one). `song` narrows it to one song. The tracked account only, and nothing older than 50 plays. as_image: true when they want to SEE it.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            song: {
                type: 'string',
                description:
                    'Only plays of this song (partial title match). Omit for all recent plays.',
            },
            as_image: {
                type: 'boolean',
                description:
                    'Also draw the recent plays as an image and attach it to the reply (see the tool description).',
            },
        },
    },
};

/** A session in the compact shape the model needs; the image gets the full one. */
function compact(s) {
    const b = s.best;
    return {
        date: s.date,
        song: s.title,
        difficulty: s.difficulty,
        level: s.level,
        chart_type: s.chart_type,
        plays: s.count,
        from: s.first_at,
        to: s.last_at,
        attempts: s.attempts,
        best: {
            achievement: b.achievement,
            rank: b.rank,
            clear: b.clear,
            sync: b.sync,
            dx_score: b.dx_score,
            dx_stars: b.dx_stars,
        },
        new_best: s.new_best,
    };
}

async function execute(args, context) {
    try {
        const { html } = await fetchAccountPage('/maimai-mobile/record/');
        let plays = parseRecentPlays(html);
        if (plays.length === 0) {
            return {
                success: false,
                error: 'The Game Record page had no plays on it (nothing played recently, or the session hiccupped) — try again.',
            };
        }
        const song = typeof args?.song === 'string' ? fold(args.song) : '';
        if (song) {
            plays = plays.filter((p) => fold(p.title).includes(song));
            if (plays.length === 0) {
                return {
                    success: false,
                    error: `No plays of "${args.song}" among the last 50 plays.`,
                };
            }
        }

        const sessions = groupSessions(plays);
        const days = groupByDay(sessions);
        const result = {
            success: true,
            play_count: plays.length,
            session_count: sessions.length,
            song_count: new Set(plays.map((p) => p.title)).size,
            from: plays[plays.length - 1].played_at,
            to: plays[0].played_at,
            sessions: sessions.map(compact),
        };

        if (args?.as_image === true) {
            let playerName = 'Tracked account';
            try {
                playerName =
                    (await fetchUsers()).find((u) => u.user === TRACKED_ID)?.name || playerName;
            } catch {
                // The header can do without the name.
            }
            const drawn = await drawCard(context, {
                html: buildRecentPlaysHtml({
                    playerName,
                    totalPlays: result.play_count,
                    totalSessions: result.session_count,
                    totalSongs: result.song_count,
                    days,
                    covers: await loadCoverMap(sessions.map((s) => s.title)),
                }),
                width: WIDTH,
                filename: 'recent-plays.png',
            });
            if (drawn.ok) {
                result.image_attached = true;
                result.note =
                    "The image is attached to your reply automatically and you can't see it — add a short comment from the data, and don't re-list the sessions.";
            } else {
                result.image_error = drawn.error;
            }
        }
        return result;
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = { declaration, execute };
