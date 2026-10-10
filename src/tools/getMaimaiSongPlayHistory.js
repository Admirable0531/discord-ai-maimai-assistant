const cheerio = require('cheerio');
const { fetchAccountPage } = require('../web/maimaiAccountSession');
const { loadSongData } = require('../web/maimaiSongData');
const { findPlayedSongIdx } = require('../web/maimaiSongIndex');
const { lookupSong } = require('../web/songResolver');
const { getRankByAchievement } = require('../web/maimaiRatingMath');
const { buildPlayHistoryHtml, WIDTH } = require('../render/playHistoryCard');
const { drawCard } = require('../render/drawCard');
const { parseRecentPlays } = require('../web/maimaiRecentPlays');
const { fold } = require('../web/maimaiSongMatch');

const declaration = {
    name: 'get_maimai_song_play_history',
    description:
        'The tracked account\'s record on one song, per difficulty: play count, last played, best achievement %, and the real clear badges (is_ap/is_ap_plus, is_fc/is_fc_plus, is_fs/is_fs_plus/is_fsd, is_sync, and the raw badges list). For "my playcount for X", "my history on X", "did I AP X" — the badges are the only reliable way to know an AP. The game keeps only the count and the best score per difficulty, not each play\'s score. Only finds songs the account has played. Pass as_image: true for playcount and history questions (several difficulties read better as a card).',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            song_name: {
                type: 'string',
                description: 'The song title to look up (partial match is fine).',
            },
            as_image: {
                type: 'boolean',
                description:
                    'Also draw the play history as a card and attach it to the reply (see the tool description).',
            },
        },
        required: ['song_name'],
    },
};

// Confirmed live: each difficulty's play, if any, shows a row of badge icons
// (e.g. music_icon_ap.png, music_icon_fc.png, music_icon_sync.png) — these
// are the game's own real clear-type indicators, unlike the achievement %
// alone, which cannot distinguish an AP from a high-percentage non-AP play.
// AP+'s exact icon filename wasn't independently confirmed live this
// session (no AP+ play was available to check against) — inferred from the
// well-known "ap"/"app" naming pattern used by the other tiered badges
// (fc/fcp, fs/fsp, fsd/fsdp) seen live. Raw badge codes are always returned
// too, so this guess doesn't hide the real underlying data if it's wrong.
function parseDifficultyBlocks(html) {
    const $ = cheerio.load(html);
    const blocks = [];
    $('[class*="_score_back"]').each((_, el) => {
        const $block = $(el);
        const badges = $block
            .find('img')
            .toArray()
            .map((img) => {
                const src = $(img).attr('src') || '';
                const file = src.split('/').pop() || '';
                return file.replace(/^music_icon_/, '').replace(/\.png.*$/, '');
            })
            .filter(Boolean);

        const text = $block.text().replace(/\s+/g, ' ').trim();
        const levelMatch = /^([\d.+]+)/.exec(text);
        const dateMatch = /Last played date：\s*([\d/: ]+\d)/.exec(text);
        const playCountMatch = /PLAY COUNT：\s*(\d+)/.exec(text);
        const achvMatch = /([\d]+\.\d+)%/.exec(text);

        // is_ap/is_fc/is_sync are confirmed live (ap, fc, fcp, sync all
        // observed in real play data this session). is_fc_plus and the FS-
        // tier flags (fs/fsp/fsd/fsdp) follow the same naming pattern but
        // weren't independently confirmed live — no false negative either
        // way though, since the raw `badges` array always has every icon
        // this block actually had, whether or not a flag below catches it.
        const has = (code) => badges.includes(code);
        blocks.push({
            difficulty: $block.attr('id') || null,
            level: levelMatch ? levelMatch[1] : null,
            last_played_date: dateMatch ? dateMatch[1].trim() : null,
            play_count: playCountMatch ? Number(playCountMatch[1]) : null,
            achievement_percent: achvMatch ? Number(achvMatch[1]) : null,
            badges,
            is_ap: has('ap') || has('app'),
            is_ap_plus: has('app'),
            is_fc: has('fc') || has('fcp'),
            is_fc_plus: has('fcp'),
            // The international site names the Full Sync DX icons fdx / fdxp (seen live: an
            // expert chart with fdx, an advanced one with fdxp); this used to look only for
            // fsd / fsdp, so is_fsd was always false there.
            is_fs:
                has('fs') || has('fsp') || has('fsd') || has('fsdp') || has('fdx') || has('fdxp'),
            is_fs_plus: has('fsp') || has('fsdp') || has('fdxp'),
            is_fsd: has('fsd') || has('fsdp') || has('fdx') || has('fdxp'),
            dx_stars: Number(/dxstar_detail_(\d)/.exec(badges.join(' '))?.[1]) || 0,
            is_sync: has('sync'),
        });
    });
    return blocks;
}

/**
 * Scores of single plays of `song`, per difficulty, newest first, from the
 * game's log of its last 50 plays. The song page itself only has a play count
 * and the best score, so this is the only place a per-play score exists — and
 * only for plays recent enough to still be in the log. Returns {} (never
 * throws) when the log can't be read.
 */
async function recentScoresByDifficulty(song) {
    try {
        const { html } = await fetchAccountPage('/maimai-mobile/record/');
        const wanted = fold(song.title);
        const byDifficulty = {};
        for (const play of parseRecentPlays(html)) {
            if (fold(play.title) !== wanted || !play.difficulty) continue;
            (byDifficulty[play.difficulty] ||= []).push({
                achievement: play.achievement,
                playedAt: play.played_at.replace(/\//g, '-'),
                newRecord: play.new_record.achievement,
            });
        }
        return byDifficulty;
    } catch {
        return {};
    }
}

async function execute(args, context) {
    const songName = typeof args?.song_name === 'string' ? args.song_name.trim() : '';
    if (!songName) return { success: false, error: 'song_name is required.' };

    try {
        const songData = await loadSongData();
        const found = await lookupSong(songData.songs, songName);
        if (found.failure) return found.failure;
        const { song, matchedVia } = found;

        const idx = await findPlayedSongIdx(song);
        if (!idx) {
            return {
                success: false,
                error: `"${song.title}" doesn't appear in this account's play history — it hasn't been played (on any difficulty).`,
            };
        }

        const { html: detailHtml, finalUrl } = await fetchAccountPage(
            `/maimai-mobile/record/musicDetail/?idx=${encodeURIComponent(idx)}`
        );
        const difficulties = parseDifficultyBlocks(detailHtml);
        if (difficulties.length === 0) {
            return {
                success: false,
                error: `Fetched "${song.title}"'s page but couldn't parse any play data from it — the session may have hiccupped, try again.`,
            };
        }

        const result = {
            success: true,
            song_name: song.title,
            ...(matchedVia ? { matched_via: matchedVia } : {}),
            difficulties,
            url: finalUrl,
        };
        if (args?.as_image === true) {
            const recent = await recentScoresByDifficulty(song);
            const order = ['basic', 'advanced', 'expert', 'master', 'remaster'];
            const drawn = await drawCard(context, {
                html: buildPlayHistoryHtml({
                    title: song.title,
                    artist: song.artist,
                    cover: song.imageName,
                    rows: [...difficulties]
                        .sort((a, b) => order.indexOf(a.difficulty) - order.indexOf(b.difficulty))
                        .map((d) => ({
                            difficulty: d.difficulty,
                            level: d.level,
                            plays: d.play_count,
                            best: d.achievement_percent,
                            rank:
                                d.achievement_percent == null
                                    ? null
                                    : getRankByAchievement(d.achievement_percent)?.title,
                            clear: d.is_ap_plus
                                ? 'AP+'
                                : d.is_ap
                                  ? 'AP'
                                  : d.is_fc_plus
                                    ? 'FC+'
                                    : d.is_fc
                                      ? 'FC'
                                      : null,
                            sync:
                                ['fdxp', 'fdx', 'fsp', 'fs', 'sync'].find((b) =>
                                    d.badges.includes(b)
                                ) ?? null,
                            stars: d.dx_stars,
                            lastPlayed: (d.last_played_date || '').replace(/\//g, '-'),
                            recent: recent[d.difficulty] || [],
                        })),
                }),
                width: WIDTH,
                filename: 'play-history.png',
            });
            if (drawn.ok) {
                result.image_attached = true;
                result.note =
                    "The image is attached to your reply automatically and you can't see it — add a short comment from the data, and don't re-list the rows.";
            } else {
                result.image_error = drawn.error;
            }
        }
        return result;
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = { declaration, execute, parseDifficultyBlocks };
