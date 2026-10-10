const { SlashCommandBuilder } = require('discord.js');
const { showMemories } = require('../../memoriesUi');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('memories')
        .setDescription('See, edit and delete what I remember about you'),

    execute: showMemories,
};
