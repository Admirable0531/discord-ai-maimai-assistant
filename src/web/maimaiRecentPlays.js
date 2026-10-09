// The tracked account's recent plays, from the "Game Record" page
// (/maimai-mobile/record/). The site keeps the last 50 plays. Until now the
// model was handed this page as raw text and left to make sense of it, which
// is why "what are my recent plays" came back as walls of text; this reads it
// into structured plays, and groups a run of the same chart into one session
// (practising one song 16 times in a row is one row, not sixteen).
const cheerio = require('cheerio');

// Rank image names on the page -> the rank as the game writes it.
const RANK_BY_ICON = {
    sssplus: 'SSS+',
    sss: 'SSS',
    ssplus: 'SS+',
    ss: 'SS',
    splus: 'S+',
    s: 'S',
    aaa: 'AAA',
    aa: 'AA',
    a: 'A',
    bbb: 'BBB',
    bb: 'BB',
    b: 'B',
    c: 'C',
    d: 'D',
};

// Clear-type badge images, best first. A play has at most one of these.
const CLEAR_LABEL = { app: 'AP+', ap: 'AP', fcp: 'FC+', fc: 'FC' };

const iconName = (src) =>
    ((src || '').split('/').pop() || '').replace(/\?.*$/, '').replace(/\.png$/, '');

/**
 * Plays on the page, newest first (the page's own order).
 * Never throws on a malformed entry: it is skipped, since one odd row
 * shouldn't cost the other forty-nine.
 */
function parseRecentPlays(html) {
    const $ = cheerio.load(html);
    const plays = [];
    $('.playlog_top_container').each((_, top) => {
        try {
            const $entry = $(top).parent();
            const sub = $entry.find('.sub_title');
            const track = parseInt(/TRACK\s*(\d+)/i.exec(sub.find('.red').text())?.[1] ?? '', 10);
            const playedAt = sub.find('span').not('.red').first().text().trim();

            const titleBlock = $entry.find('.basic_block').first().clone();
            titleBlock.find('div').remove();
            const title = titleBlock.text().replace(/\s+/g, ' ').trim();

            const difficulty =
                /diff_([a-z]+)\./.exec($entry.find('img.playlog_diff').attr('src') || '')?.[1] ??
                null;
            const kind = $entry.find('img.playlog_music_kind_icon').attr('src') || '';
            const achievement = parseFloat(
                $entry.find('.playlog_achievement_txt').text().replace('%', '')
            );
            if (!title || !playedAt || Number.isNaN(achievement)) return;

            const dxText = $entry
                .find('.playlog_score_block .white')
                .first()
                .text()
                .replace(/,/g, '');
            const dxMatch = /(\d+)\s*\/\s*(\d+)/.exec(dxText);
            const badges = $entry
                .find('.playlog_result_innerblock img.h_35')
                .toArray()
                .map((img) => iconName($(img).attr('src')));
            const rankIcon = iconName($entry.find('img.playlog_scorerank').attr('src'));

            plays.push({
                track: Number.isNaN(track) ? null : track,
                played_at: playedAt,
                date: playedAt.split(' ')[0],
                title,
                difficulty,
                level: $entry.find('.playlog_level_icon').first().text().trim() || null,
                chart_type: kind.includes('music_dx')
                    ? 'dx'
                    : kind.includes('music_standard')
                      ? 'std'
                      : null,
                achievement,
                rank: RANK_BY_ICON[rankIcon] ?? null,
                dx_score: dxMatch ? { got: Number(dxMatch[1]), max: Number(dxMatch[2]) } : null,
                dx_stars:
                    Number(
                        /dxstar_(\d)/.exec(
                            $entry.find('img.playlog_deluxscore_star').attr('src') || ''
                        )?.[1]
                    ) || 0,
                badges,
                clear:
                    CLEAR_LABEL[Object.keys(CLEAR_LABEL).find((b) => badges.includes(b))] ?? null,
                sync: ['fdxp', 'fdx', 'fsp', 'fs', 'sync'].find((b) => badges.includes(b)) ?? null,
                new_record: {
                    achievement: $entry.find('.playlog_achievement_newrecord').length > 0,
                    dx_score: $entry.find('.playlog_deluxscore_newrecord').length > 0,
                },
                placement:
                    /^(\d)(st|nd|rd|th)$/.exec(
                        iconName($entry.find('img.playlog_matching_icon').attr('src'))
                    )?.[0] ?? null,
            });
        } catch {
            // Skip this entry only.
        }
    });
    return plays;
}

/**
 * Sessions, newest first, each a run of consecutive plays of the same chart on
 * the same day. `attempts` is the achievements oldest-first, for a sparkline.
 * `plays` is newest-first, as given.
 */
function groupSessions(plays) {
    const sessions = [];
    for (const play of plays) {
        const last = sessions[sessions.length - 1];
        if (
            last &&
            last.date === play.date &&
            last.title === play.title &&
            last.difficulty === play.difficulty &&
            last.chart_type === play.chart_type
        ) {
            last.plays.push(play);
        } else {
            sessions.push({
                date: play.date,
                title: play.title,
                difficulty: play.difficulty,
                level: play.level,
                chart_type: play.chart_type,
                plays: [play],
            });
        }
    }
    return sessions.map((s) => {
        const best = s.plays.reduce((b, p) => (p.achievement > b.achievement ? p : b));
        return {
            ...s,
            count: s.plays.length,
            best,
            attempts: s.plays.map((p) => p.achievement).reverse(),
            first_at: s.plays[s.plays.length - 1].played_at,
            last_at: s.plays[0].played_at,
            new_best: s.plays.some((p) => p.new_record.achievement),
        };
    });
}

/** Sessions bucketed by day, newest day first: [{date, plays, songs, sessions}]. */
function groupByDay(sessions) {
    const days = [];
    for (const s of sessions) {
        let day = days[days.length - 1];
        if (!day || day.date !== s.date) {
            day = { date: s.date, plays: 0, songs: new Set(), sessions: [] };
            days.push(day);
        }
        day.plays += s.count;
        day.songs.add(s.title);
        day.sessions.push(s);
    }
    return days.map((d) => ({ ...d, songs: d.songs.size }));
}

module.exports = { parseRecentPlays, groupSessions, groupByDay };
