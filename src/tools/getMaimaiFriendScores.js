const { fetchAccountPage } = require('../web/maimaiAccountSession');
const { loadSongData } = require('../web/maimaiSongData');
const { resolveChart } = require('../web/maimaiChartLookup');
const {
    normalizeName,
    parseFriendListPage,
    parseLevelVsEntries,
    constantToLevelBucket,
} = require('../web/maimaiFriendLookup');
const { maimaiAccountCache } = require('../web/cache');

const FRIEND_LIST_CACHE_KEY = 'maimai-friend-list';
const MAX_PAGES = 8; // 41+ friends at ~10/page, with headroom

const declaration = {
    name: 'get_maimai_friend_scores',
    description:
        "Get one of this tracked account's friends' actual scores (achievement %%) on every Master/Re:Master " +
        'chart at one exact difficulty constant (e.g. 14.3) — this is the "maimai bookmarklet"-style friend ' +
        'comparison the /constant command in Discord_Bot uses, via the friend-versus-level page. Use this for ' +
        '"what are Y\'s scores on 14.7" or similar per-friend-per-constant questions — get_maimai_song_ranking ' +
        "answers the opposite direction (who's best on one song), and get_friend_leaderboard only has DX Rating, " +
        'no per-song data at all. Only covers Master/Re:Master charts (constants roughly 1.0-15.0) — there is no ' +
        'lower-difficulty equivalent on the site. A friend with no score on a chart shows friend_achievement: ' +
        'null (unplayed), not zero. Each chart also carries the real clear badges read off the page: ' +
        "friend_ap_fc / own_ap_fc (\"AP+\", \"AP\", \"FC+\", \"FC\", or null for none) and friend_rank / own_rank. " +
        'Use friend_ap_fc — and ONLY friend_ap_fc — to say whether a friend AP\'d something: achievement %% never ' +
        'proves AP, since a non-AP play can land in the same range as a true AP (confirmed live). Never call a ' +
        'score AP because of its percentage, and never describe a score as being "in AP range" or similar — if ' +
        'ap_fc is null, the play is simply not AP or FC, so say that or say nothing about its clear type.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            friend_name: {
                type: 'string',
                description:
                    "The friend's name (partial match is fine, full-width or plain ASCII both work).",
            },
            target_constant: {
                type: 'number',
                description: 'The exact difficulty constant to check, e.g. 14.3.',
            },
        },
        required: ['friend_name', 'target_constant'],
    },
};

async function findFriend(friendName) {
    let friends = maimaiAccountCache.get(FRIEND_LIST_CACHE_KEY);
    if (!friends) {
        friends = [];
        let prevPageNames = null;
        for (let page = 1; page <= MAX_PAGES; page++) {
            const { html } = await fetchAccountPage(`/maimai-mobile/friend/pages/?idx=${page}`);
            const pageFriends = parseFriendListPage(html);
            if (pageFriends.length === 0) break;
            const pageNames = pageFriends.map((f) => f.idx).join(',');
            if (pageNames === prevPageNames) break; // pagination looped back onto the last real page
            prevPageNames = pageNames;
            friends.push(...pageFriends);
        }
        maimaiAccountCache.set(FRIEND_LIST_CACHE_KEY, friends);
    }

    const target = normalizeName(friendName);
    const exact = friends.find((f) => normalizeName(f.name) === target);
    if (exact) return exact;
    const substring = friends.filter((f) => normalizeName(f.name).includes(target));
    if (substring.length === 1) return substring[0];
    if (substring.length > 1) return { ambiguous: substring.map((f) => f.name) };
    return null;
}

async function execute(args) {
    const friendName = typeof args?.friend_name === 'string' ? args.friend_name.trim() : '';
    const targetConstant = typeof args?.target_constant === 'number' ? args.target_constant : null;

    if (!friendName) return { success: false, error: 'friend_name is required.' };
    if (targetConstant === null) return { success: false, error: 'target_constant is required.' };

    const bucket = constantToLevelBucket(targetConstant);
    if (!bucket) {
        return {
            success: false,
            error: `target_constant ${targetConstant} is out of the supported range (roughly 1.0-15.0).`,
        };
    }

    try {
        const friend = await findFriend(friendName);
        if (!friend) {
            return {
                success: false,
                error: `No friend matching "${friendName}" found on this account's friend list.`,
            };
        }
        if (friend.ambiguous) {
            return {
                success: false,
                error: `Multiple friends match "${friendName}" — be more specific.`,
                matches: friend.ambiguous,
            };
        }

        const { html } = await fetchAccountPage(
            `/maimai-mobile/friend/friendLevelVs/battleStart/?scoreType=2&level=${bucket}&idx=${friend.idx}`
        );
        const entries = parseLevelVsEntries(html);

        const songData = await loadSongData();
        const songs = [];
        const unresolved = [];
        for (const entry of entries) {
            // Goes through the shared resolver so a 宴会場/UTAGE namesake
            // can't shadow the real song, and std/dx is matched on the row's
            // own chart-type icon rather than guessed — see maimaiChartLookup.js.
            const resolved = resolveChart(
                songData.songs,
                entry.song_name,
                entry.difficulty,
                entry.chart_type
            );
            const level = resolved.level ?? null;
            if (level === null) {
                unresolved.push(`${entry.song_name} (${entry.difficulty})`);
                continue;
            }
            if (Math.abs(level - targetConstant) >= 0.05) continue;
            songs.push({
                song_name: entry.song_name,
                difficulty: entry.difficulty,
                chart_type: entry.chart_type,
                friend_achievement: entry.friend_achievement,
                friend_ap_fc: entry.friend_ap_fc,
                friend_rank: entry.friend_rank,
                own_achievement: entry.own_achievement,
                own_ap_fc: entry.own_ap_fc,
                own_rank: entry.own_rank,
            });
        }

        return {
            success: true,
            friend_name: friend.name,
            target_constant: targetConstant,
            songs,
            song_count: songs.length,
            played_count: songs.filter((s) => s.friend_achievement !== null).length,
            unresolved_chart_count: unresolved.length,
            unresolved_charts: unresolved.slice(0, 10),
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = { declaration, execute };
