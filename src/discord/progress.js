// The "what is it doing" line shown while a reply is being worked on. A
// message that needs tools (a web search, a score lookup, a card to draw) can
// take many seconds, and the typing indicator alone looks like the bot gave
// up. The first time the model asks for a tool a short status message is
// posted; each later round edits it, and the final answer is edited into the
// same message (see replyDelivery.js). A reply that needs no tools never
// shows one.
const logger = require('../utils/logger');

const LABELS = {
    search_memory: '🧠 Checking what I remember',
    save_memory: '🧠 Saving a memory',
    search_knowledge_base: '📚 Checking the knowledge base',
    save_knowledge_base: '📚 Updating the knowledge base',
    search_web: '🔍 Searching the web',
    read_webpage: '📖 Reading a page',
    read_webpage_sections: '📖 Reading a page',
    search_maimai_songs: '🎵 Looking up songs',
    get_friend_leaderboard: '🏆 Loading the leaderboard',
    get_circle_rankings: '🏆 Loading circle rankings',
    list_maimai_fandom_wiki_pages: '📖 Searching the wiki',
    list_maimai_remywiki_pages: '📖 Searching the wiki',
    list_maimai_account_pages: '📊 Opening the account pages',
    get_maimai_song_play_history: '📊 Loading play history',
    get_maimai_score_breakdown: '🧮 Working out the score breakdown',
    get_maimai_song_rating: '🧮 Working out the rating',
    get_maimai_song_ranking: '📊 Loading the song ranking',
    get_maimai_friend_scores: '📊 Comparing scores with friends',
    get_maimai_friend_top_scores: '📊 Loading a friend’s best scores',
    get_maimai_own_top_scores: '📊 Loading the best scores',
    get_maimai_scores_by_level: '📊 Loading scores by level',
    render_maimai_b50_image: '🖼️ Drawing the B50',
    render_maimai_rating_history: '🖼️ Drawing the rating history',
    get_maimai_chart_preview: '🖼️ Fetching the chart preview',
    get_maimai_recent_plays: '📊 Loading recent plays',
    get_maimai_rating_targets: '🧮 Working out rating targets',
    get_maimai_b50_changes: '📊 Comparing B50 snapshots',
    get_maimai_score_impact: '🧮 Working out what the score is worth',
    get_maimai_plate_progress: '🏅 Checking plate progress',
};
const FALLBACK_LABEL = '⚙️ Working on it';

/** One line for a round of tool calls; null when it is only the budget request (nothing to say). */
function describeTools(toolNames) {
    const labels = [
        ...new Set(
            toolNames
                .filter((name) => name !== 'request_more_tool_calls')
                .map((name) => LABELS[name] || FALLBACK_LABEL)
        ),
    ];
    return labels.length > 0 ? `_${labels.join(' · ')}…_` : null;
}

/**
 * A reporter to pass as the request's `onProgress`. `show(text)` puts the
 * line on screen (post or edit); calls are chained so edits never overlap
 * and never reorder, and a failing one is logged, not fatal.
 */
function createProgress(show) {
    let queue = Promise.resolve();
    let closed = false;
    let last = null;
    return {
        onProgress(toolNames) {
            const text = describeTools(toolNames);
            if (closed || !text || text === last) return;
            last = text;
            queue = queue
                .then(() => (closed ? undefined : show(text)))
                .catch((err) => logger.warn('discord', 'Could not show progress', err));
        },
        /** Stops further updates and waits for the in-flight one, so the caller can safely replace the line. */
        async finish() {
            closed = true;
            await queue;
        },
    };
}

/** Progress for a reply to a message: a status reply that the final answer is later edited into. */
function createMessageProgress(message) {
    let statusMessage = null;
    const progress = createProgress(async (text) => {
        if (statusMessage) await statusMessage.edit({ content: text });
        else {
            statusMessage = await message.reply({
                content: text,
                allowedMentions: { repliedUser: false },
            });
        }
    });
    return {
        onProgress: progress.onProgress,
        /** The status message to edit the answer into, or null if none was posted. */
        async take() {
            await progress.finish();
            return statusMessage;
        },
    };
}

/** Progress for a slash command that has already deferred: edits the "thinking…" reply. */
function createInteractionProgress(interaction) {
    return createProgress((text) => interaction.editReply({ content: text }));
}

module.exports = { createMessageProgress, createInteractionProgress, describeTools };
