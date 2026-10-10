/** How the speaker appears in Discord, so the model knows who it's talking to (see systemPrompt.describeSpeaker). */
function describeUser(user, member) {
    return {
        username: user.username,
        displayName: member?.displayName || user.globalName || user.username,
    };
}

module.exports = { describeUser };
