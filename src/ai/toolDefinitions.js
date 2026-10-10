const searchMemoryTool = require('../tools/searchMemory');
const saveMemoryTool = require('../tools/saveMemory');
const searchKnowledgeBaseTool = require('../tools/searchKnowledgeBase');
const saveKnowledgeBaseTool = require('../tools/saveKnowledgeBase');
const searchWebTool = require('../tools/searchWeb');
const readWebpageTool = require('../tools/readWebpage');
const readWebpageSectionsTool = require('../tools/readWebpageSections');
const searchMaimaiSongsTool = require('../tools/searchMaimaiSongs');
const getFriendLeaderboardTool = require('../tools/getFriendLeaderboard');
const getCircleRankingsTool = require('../tools/getCircleRankings');
const listMaimaiFandomWikiPagesTool = require('../tools/listMaimaiFandomWikiPages');
const listMaimaiRemywikiPagesTool = require('../tools/listMaimaiRemywikiPages');
const listMaimaiAccountPagesTool = require('../tools/listMaimaiAccountPages');
const getMaimaiSongPlayHistoryTool = require('../tools/getMaimaiSongPlayHistory');
const getMaimaiScoreBreakdownTool = require('../tools/getMaimaiScoreBreakdown');
const getMaimaiSongRatingTool = require('../tools/getMaimaiSongRating');
const getMaimaiSongRankingTool = require('../tools/getMaimaiSongRanking');
const getMaimaiFriendScoresTool = require('../tools/getMaimaiFriendScores');
const getMaimaiFriendTopScoresTool = require('../tools/getMaimaiFriendTopScores');
const getMaimaiOwnTopScoresTool = require('../tools/getMaimaiOwnTopScores');
const getMaimaiScoresByLevelTool = require('../tools/getMaimaiScoresByLevel');
const renderMaimaiB50ImageTool = require('../tools/renderMaimaiB50Image');
const renderMaimaiRatingHistoryTool = require('../tools/renderMaimaiRatingHistory');
const getMaimaiChartPreviewTool = require('../tools/getMaimaiChartPreview');
const getMaimaiRecentPlaysTool = require('../tools/getMaimaiRecentPlays');
const getMaimaiRatingTargetsTool = require('../tools/getMaimaiRatingTargets');
const getMaimaiB50ChangesTool = require('../tools/getMaimaiB50Changes');
const getMaimaiScoreImpactTool = require('../tools/getMaimaiScoreImpact');
const { getAllowedScopes } = require('../permissions/permissionStore');

const TOOLS = [
    searchMemoryTool,
    saveMemoryTool,
    searchKnowledgeBaseTool,
    saveKnowledgeBaseTool,
    searchWebTool,
    readWebpageTool,
    readWebpageSectionsTool,
    searchMaimaiSongsTool,
    getFriendLeaderboardTool,
    getCircleRankingsTool,
    listMaimaiFandomWikiPagesTool,
    listMaimaiRemywikiPagesTool,
    listMaimaiAccountPagesTool,
    getMaimaiSongPlayHistoryTool,
    getMaimaiScoreBreakdownTool,
    getMaimaiSongRatingTool,
    getMaimaiSongRankingTool,
    getMaimaiFriendScoresTool,
    getMaimaiFriendTopScoresTool,
    getMaimaiOwnTopScoresTool,
    getMaimaiScoresByLevelTool,
    renderMaimaiB50ImageTool,
    renderMaimaiRatingHistoryTool,
    getMaimaiChartPreviewTool,
    getMaimaiRecentPlaysTool,
    getMaimaiRatingTargetsTool,
    getMaimaiB50ChangesTool,
    getMaimaiScoreImpactTool,
];

/**
 * Which scope (see permissionStore.js's VALID_SCOPES) each tool requires.
 * read_webpage/read_webpage_sections are dynamic — see requiredScope()
 * below — since the SAME tool serves both generic pages (web) and this
 * tracked account's maimaidx-eng.com pages (account), depending on the url
 * argument, not the tool name.
 */
const TOOL_SCOPES = {
    search_web: 'web',
    search_maimai_songs: 'web',
    get_maimai_score_breakdown: 'web',
    get_maimai_song_rating: 'web',
    list_maimai_fandom_wiki_pages: 'web',
    list_maimai_remywiki_pages: 'web',
    list_maimai_account_pages: 'account',
    get_maimai_song_play_history: 'account',
    get_maimai_recent_plays: 'account',
    get_maimai_song_ranking: 'account',
    get_maimai_friend_scores: 'account',
    get_maimai_scores_by_level: 'account',
    get_friend_leaderboard: 'leaderboard',
    get_circle_rankings: 'leaderboard',
    get_maimai_friend_top_scores: 'leaderboard',
    get_maimai_own_top_scores: 'leaderboard',
    get_maimai_rating_targets: 'leaderboard',
    get_maimai_b50_changes: 'leaderboard',
    get_maimai_score_impact: 'leaderboard',
    // The image cards show the same data as the tools they wrap, so they need
    // the same access; chart previews only use public song data.
    render_maimai_b50_image: 'leaderboard',
    render_maimai_rating_history: 'leaderboard',
    get_maimai_chart_preview: 'web',
    search_memory: 'memory',
    save_memory: 'memory',
    save_knowledge_base: 'knowledge',
    // search_knowledge_base is intentionally absent -> requiredScope() returns
    // null for it, so reading it is available to anyone allowed to talk to
    // the bot at all, same tier as the 'web' baseline. Writing (save_knowledge_base,
    // and the /knowledge slash command) requires the 'knowledge' scope, which
    // the owner has by default (like every scope) and can grant to trusted
    // members the same way as 'account'/'leaderboard' — keeps a random
    // allowed user from poisoning shared knowledge via a crafted chat message.
};

/** Tool names gated by `scope`, for telling the model up front what a user can't use. */
function toolsRequiringScope(scope) {
    const names = Object.keys(TOOL_SCOPES).filter((name) => TOOL_SCOPES[name] === scope);
    if (scope === 'account') names.push('read_webpage/read_webpage_sections on maimaidx-eng.com');
    return names;
}

function requiredScope(toolName, args) {
    if (toolName === 'read_webpage' || toolName === 'read_webpage_sections') {
        const url = typeof args?.url === 'string' ? args.url : '';
        try {
            if (new URL(url).hostname.toLowerCase() === 'maimaidx-eng.com') return 'account';
        } catch {
            // not a parseable URL -> falls through to the generic 'web' scope;
            // the tool's own validation will reject it either way
        }
        return 'web';
    }
    return TOOL_SCOPES[toolName] || null;
}

/**
 * Binds every tool's execute() to this request's real Discord context
 * (userId/guildId), gated by that user's granted scopes (permissionStore.js)
 * — resolved once per message, not per call, so a scope change mid-
 * conversation doesn't retroactively affect calls already in flight. That
 * binding, not any argument the model supplies, is also what scopes memory
 * access to the calling user; see searchMemory.js / saveMemory.js.
 */
function createToolExecutors(context) {
    const scopes = getAllowedScopes(context.userId, context.guildId); // 'all' | string[]
    const executors = {};
    for (const tool of TOOLS) {
        const name = tool.declaration.name;
        executors[name] = (args) => {
            const scope = requiredScope(name, args);
            if (scope && scopes !== 'all' && !scopes.includes(scope)) {
                return {
                    success: false,
                    error: `You don't have permission to use this — it requires "${scope}" access. Ask the bot owner to grant it.`,
                };
            }
            return tool.execute(args, context);
        };
    }
    return executors;
}

/**
 * The tool declarations ({name, description, parametersJsonSchema}) to offer
 * this user: only those their scopes allow. Tools they couldn't use used to
 * be offered anyway and refused when called, so the model spent a round trip
 * (and the user an answer) finding that out; the prompt then had to tell it
 * not to try them. Now they simply aren't there. read_webpage stays in for
 * everyone, since its scope depends on the url (see requiredScope) and the
 * executor still checks that per call.
 */
function toolDeclarationsFor(context) {
    const scopes = getAllowedScopes(context.userId, context.guildId);
    return TOOLS.map((tool) => tool.declaration).filter((decl) => {
        const scope = TOOL_SCOPES[decl.name];
        return !scope || scopes === 'all' || scopes.includes(scope);
    });
}

module.exports = { toolDeclarationsFor, createToolExecutors, toolsRequiringScope };
