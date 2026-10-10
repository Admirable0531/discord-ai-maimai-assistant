// The /memories screen: what the bot remembers about you, with ways to fix it
// in place — pick one to edit or delete it, and merge the duplicates that
// pile up when the same fact gets saved twice in different words. The model
// saves memories on its own, so this is where a person tidies up after it.
//
// Every id is "mem:<action>:<userId>[:<arg>]". The user id in it is checked
// against whoever pressed, so the controls of someone else's screen (which are
// private to them anyway) do nothing.
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    StringSelectMenuBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags,
} = require('discord.js');
const {
    listMemories,
    getMemoryById,
    updateMemoryValue,
    forgetMemoryById,
    findDuplicateGroups,
    mergeDuplicateMemories,
    MAX_VALUE_LENGTH,
} = require('../database/repositories/memoryRepository');
const { hasScope } = require('../permissions/permissionStore');

const PAGE_SIZE = 20; // the select menu holds 25 options at most
const MAX_MEMORIES = 50;
const ID_PREFIX = 'mem';

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const customId = (action, userId, arg) =>
    [ID_PREFIX, action, userId, ...(arg === undefined ? [] : [arg])].join(':');

function button(id, label, style = ButtonStyle.Secondary, disabled = false) {
    return new ButtonBuilder()
        .setCustomId(id)
        .setLabel(label)
        .setStyle(style)
        .setDisabled(disabled);
}

/** The list screen, one page of it. `notice` is a line about what just happened. */
function listView(userId, page = 0, notice = '') {
    const all = listMemories(userId, MAX_MEMORIES);
    if (all.length === 0) {
        return {
            content: `${notice ? `${notice}\n\n` : ''}I don't have any memories saved for you.`,
            components: [],
        };
    }
    const pages = Math.ceil(all.length / PAGE_SIZE);
    const current = Math.min(Math.max(page, 0), pages - 1);
    const shown = all.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

    const lines = shown.map(
        (m) =>
            `• **${clip(m.key, 80)}** — ${clip(m.value.replace(/\s+/g, ' '), 140)}${m.category ? ` _(${m.category})_` : ''}`
    );
    const header = `**What I remember about you** — ${all.length} of ${MAX_MEMORIES}${pages > 1 ? ` · page ${current + 1}/${pages}` : ''}`;
    const content =
        `${notice}${header}\n${lines.join('\n')}\n\nPick one below to edit or delete it.`.slice(
            0,
            2000
        );

    const select = new StringSelectMenuBuilder()
        .setCustomId(customId('pick', userId))
        .setPlaceholder('Edit or delete a memory…')
        .addOptions(
            shown.map((m) => ({
                label: clip(m.key, 100),
                description: clip(m.value.replace(/\s+/g, ' '), 100),
                value: String(m.id),
            }))
        );
    const duplicates = findDuplicateGroups(userId).length;
    const controls = [
        button(customId('list', userId, current - 1), '◀', ButtonStyle.Secondary, current === 0),
        button(
            customId('list', userId, current + 1),
            '▶',
            ButtonStyle.Secondary,
            current >= pages - 1
        ),
        button(
            customId('merge', userId),
            duplicates > 0
                ? `Merge ${duplicates} duplicate${duplicates === 1 ? '' : 's'}`
                : 'No duplicates',
            ButtonStyle.Primary,
            duplicates === 0
        ),
    ];
    return {
        content,
        components: [
            new ActionRowBuilder().addComponents(select),
            new ActionRowBuilder().addComponents(...controls),
        ],
    };
}

/** One memory in full, with Edit / Delete / Back. */
function detailView(userId, memory) {
    const content =
        `**${memory.key}**${memory.category ? ` _(${memory.category})_` : ''}\n` +
        `${memory.value}\n\n_Last updated ${memory.updatedAt}._`;
    return {
        content: content.slice(0, 2000),
        components: [
            new ActionRowBuilder().addComponents(
                button(customId('edit', userId, memory.id), 'Edit', ButtonStyle.Primary),
                button(customId('del', userId, memory.id), 'Delete', ButtonStyle.Danger),
                button(customId('list', userId, 0), 'Back')
            ),
        ],
    };
}

function editModal(userId, memory) {
    return new ModalBuilder()
        .setCustomId(customId('save', userId, memory.id))
        .setTitle(clip(`Edit: ${memory.key}`, 45))
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('value')
                    .setLabel('What to remember')
                    .setStyle(TextInputStyle.Paragraph)
                    .setValue(memory.value.slice(0, 4000))
                    .setMaxLength(MAX_VALUE_LENGTH)
                    .setRequired(true)
            )
        );
}

/** The /memories command. */
async function showMemories(interaction) {
    if (!hasScope(interaction.user.id, interaction.guildId, 'memory')) {
        await interaction.reply({
            content: "You don't have permission to use this bot's memory.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }
    await interaction.reply({
        ...listView(interaction.user.id),
        flags: MessageFlags.Ephemeral,
    });
}

/** Buttons, the select menu and the edit modal of the screen above. */
async function handleMemoriesInteraction(interaction) {
    const [, action, ownerId, arg] = interaction.customId.split(':');
    const userId = interaction.user.id;
    if (ownerId !== userId) {
        await interaction.reply({
            content: 'That screen belongs to someone else — run `/memories` yourself.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }
    if (!hasScope(userId, interaction.guildId, 'memory')) {
        await interaction.reply({
            content: "You don't have permission to use this bot's memory.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    // A screen is redrawn in place: update() for a press on the message, and for a
    // modal opened from it (which also has a message to edit).
    const redraw = (view) => interaction.update(view);
    const gone = () => redraw(listView(userId, 0, '_That memory no longer exists._\n'));

    if (action === 'pick') {
        const memory = getMemoryById(userId, Number(interaction.values[0]));
        return memory ? redraw(detailView(userId, memory)) : gone();
    }
    if (action === 'list') return redraw(listView(userId, Number(arg) || 0));
    if (action === 'merge') {
        const removed = mergeDuplicateMemories(userId);
        return redraw(
            listView(
                userId,
                0,
                removed.length > 0
                    ? `_Merged duplicates — removed ${removed.map((k) => `"${clip(k, 40)}"`).join(', ')} and kept the newest of each._\n`
                    : '_No duplicates to merge._\n'
            )
        );
    }

    const id = Number(arg);
    if (action === 'edit') {
        const memory = getMemoryById(userId, id);
        return memory ? interaction.showModal(editModal(userId, memory)) : gone();
    }
    if (action === 'save') {
        const result = updateMemoryValue(userId, id, interaction.fields.getTextInputValue('value'));
        if (!result.success) {
            return redraw(listView(userId, 0, `_${result.error}_\n`));
        }
        const memory = getMemoryById(userId, id);
        return redraw(
            memory
                ? {
                      ...detailView(userId, memory),
                      content: `_Saved._\n${detailView(userId, memory).content}`.slice(0, 2000),
                  }
                : listView(userId)
        );
    }
    if (action === 'del') {
        const result = forgetMemoryById(userId, id);
        return redraw(
            listView(
                userId,
                0,
                result.success ? `_Forgot "${clip(result.key, 60)}"._\n` : `_${result.error}_\n`
            )
        );
    }
}

module.exports = { showMemories, handleMemoriesInteraction, ID_PREFIX };
