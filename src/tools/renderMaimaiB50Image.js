const { findPlayer } = require('../web/maimaiPlayers');
const getOwnTopScores = require('./getMaimaiOwnTopScores');
const getFriendTopScores = require('./getMaimaiFriendTopScores');
const { loadSongData } = require('../web/maimaiSongData');
const { findSongByTitle } = require('../web/maimaiChartLookup');
const { buildB50Html, WIDTH, sumRatings } = require('../render/b50Card');
const { renderHtmlToPng } = require('../render/browserRenderer');
const { COVER_HOST } = require('../render/theme');
const { attachFile } = require('../utils/outputs');
const { isStale, parseSnapshotDate } = require('../utils/snapshotAge');

const declaration = {
    name: 'render_maimai_b50_image',
    description:
        "Draw a player's Best 50 (best 15 new-version + best 35 old-version charts) as an IMAGE card — " +
        "covers, difficulty, constant, achievement, rank and rating per chart, with the player's rating and " +
        'how fresh the data is — and attach it to your reply. Use it when someone asks to see / show / send / ' +
        'post a B50 (or "b50 image/card"). Leave player_name out for the tracked account (the bot owner\'s own ' +
        'maimai account); pass a name for one of its friends. The image is attached automatically and you ' +
        "can't see it: reply with a short comment at most, never re-list the charts (the summary below has " +
        "the totals and each list's lowest chart). If stale is true the snapshot is old — the image says so " +
        'too, but say it in your reply as well. For questions that need the actual chart data in text ' +
        '(a specific song, the highest rated play) use get_maimai_own_top_scores / ' +
        'get_maimai_friend_top_scores instead.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            player_name: {
                type: 'string',
                description:
                    "A friend's name (partial match; full-width or plain ASCII). Omit for the tracked account.",
            },
        },
    },
};

/** "09/10/2026 22:45:10" (day-first, ambiguous to a reader) -> "2026-10-09 22:45". */
function readableStamp(raw) {
    const d = parseSnapshotDate(raw);
    if (!d) return raw || null;
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function lowest(plays) {
    if (plays.length === 0) return null;
    const p = plays.reduce((min, cur) =>
        parseInt(cur.Rating, 10) < parseInt(min.Rating, 10) ? cur : min
    );
    return {
        song: p.Song,
        chart: p.Chart,
        difficulty: p.Diff,
        level: p.Level,
        achievement: p.Achv,
        rating: p.Rating,
    };
}

/** song title -> cover image name, from arcade-songs; missing songs just get no cover. */
async function loadCovers(plays) {
    const covers = new Map();
    try {
        const { songs } = await loadSongData();
        for (const play of plays) {
            const song = findSongByTitle(songs, play.Song);
            if (song?.imageName) covers.set(play.Song, song.imageName);
        }
    } catch {
        // The card is still worth drawing without covers.
    }
    return covers;
}

async function execute(args, context) {
    const found = await findPlayer(args?.player_name).catch((err) => ({
        error: `Could not reach the maimai stats API: ${err.message}`,
    }));
    if (found.error)
        return {
            success: false,
            error: found.error,
            ...(found.matches ? { matches: found.matches } : {}),
        };
    const { player } = found;

    const data = player.isTracked
        ? await getOwnTopScores.execute()
        : await getFriendTopScores.execute({ friend_name: player.name });
    if (!data.success) return data;

    const newPlays = data.new_version_top_plays || [];
    const oldPlays = data.old_version_top_plays || [];
    if (newPlays.length + oldPlays.length === 0) {
        return { success: false, error: `${player.name} has no top-score snapshot to draw.` };
    }

    const stale = isStale(data.snapshot_date);
    const html = buildB50Html({
        playerName: player.name,
        rating: data.snapshot_rating,
        segaRating: data.sega_rating ?? null,
        snapshotDate: readableStamp(data.snapshot_date),
        ageDays: data.snapshot_age_days,
        stale,
        newPlays,
        oldPlays,
        covers: await loadCovers([...newPlays, ...oldPlays]),
    });

    let png;
    try {
        // 1.5x: still sharp, and ~40% smaller than 2x (a 50-cover PNG is several MB).
        png = await renderHtmlToPng(html, { width: WIDTH, scale: 1.5, allowedHosts: [COVER_HOST] });
    } catch (err) {
        return { success: false, error: err.message };
    }
    const attached = attachFile(context, {
        name: `b50-${player.isTracked ? 'tracked' : player.id}.png`,
        data: png,
    });
    if (!attached.ok) return { success: false, error: attached.reason };

    return {
        success: true,
        image_attached: true,
        note:
            "The B50 image is attached to your reply automatically — you can't see it. Add a short comment " +
            "at most; don't list the charts.",
        player: player.name,
        rating: data.snapshot_rating,
        sega_rating: data.sega_rating ?? null,
        best_15_total: sumRatings(newPlays),
        best_35_total: sumRatings(oldPlays),
        lowest_new_chart: lowest(newPlays),
        lowest_old_chart: lowest(oldPlays),
        snapshot_date: data.snapshot_date,
        snapshot_age_days: data.snapshot_age_days,
        stale,
        ...(data.current_rating != null ? { current_rating: data.current_rating } : {}),
    };
}

module.exports = { declaration, execute };
