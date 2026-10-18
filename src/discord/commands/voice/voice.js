const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { join, stopListening, getSession } = require('../../../voice/voiceSession');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('voice')
        .setDescription('Talk to me in a voice channel — say "hey Atri" and ask')
        .setDMPermission(false)
        .addSubcommand((sub) =>
            sub
                .setName('join')
                .setDescription('Join your voice channel and listen for "hey Atri" from you')
        )
        .addSubcommand((sub) =>
            sub
                .setName('leave')
                .setDescription('Stop listening to you (I leave once nobody wants me there)')
        ),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guildId;
        const userId = interaction.user.id;

        if (sub === 'leave') {
            const session = getSession(guildId);
            if (!session?.listeners.has(userId)) {
                await interaction.reply({
                    content: "I'm not listening to you.",
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            stopListening(guildId, userId);
            const stillThere = getSession(guildId);
            await interaction.reply({
                content: stillThere
                    ? "Okay, I've stopped listening to you."
                    : 'Okay, I left the voice channel.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const member = await interaction.guild.members.fetch(userId);
        const channel = member.voice.channel;
        if (!channel) {
            await interaction.reply({
                content: 'Join a voice channel first, then run this again.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const me = interaction.guild.members.me;
        const perms = channel.permissionsFor(me);
        if (
            !perms?.has(PermissionFlagsBits.Connect) ||
            !perms.has(PermissionFlagsBits.SendMessages)
        ) {
            await interaction.reply({
                content: `I need permission to connect to ${channel.name} and post in its chat.`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        await interaction.deferReply();
        const result = await join(channel, member);
        if (!result.ok) {
            await interaction.editReply(result.error);
            return;
        }
        await interaction.editReply(
            `🎙️ Listening to **${member.displayName}** in ${channel.name}. Say **"hey Atri"** and ` +
                `your question — e.g. "hey Atri, show me my B50". Answers go in ${channel.name}'s chat. ` +
                'Only people who run `/voice join` are listened to, and nothing is recorded or kept. ' +
                '`/voice leave` to stop.'
        );
    },
};
