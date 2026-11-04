const test = require('node:test');
const assert = require('node:assert/strict');
const { isChannelAllowed } = require('../src/discord/channelLimits');

const limits = { g1: ['c1', 'c2'] };

test('channel limits: only the listed channels work in a limited server', () => {
    assert.equal(isChannelAllowed('g1', { id: 'c1' }, limits), true);
    assert.equal(isChannelAllowed('g1', { id: 'c2' }, limits), true);
    assert.equal(isChannelAllowed('g1', { id: 'c3' }, limits), false);
});

test('channel limits: threads follow their parent; other servers and DMs are unrestricted', () => {
    assert.equal(isChannelAllowed('g1', { id: 't', parentId: 'c1' }, limits), true);
    assert.equal(isChannelAllowed('g1', { id: 't', parentId: 'c3' }, limits), false);
    assert.equal(isChannelAllowed('g2', { id: 'c3' }, limits), true);
    assert.equal(isChannelAllowed(null, { id: 'c3' }, limits), true);
});
