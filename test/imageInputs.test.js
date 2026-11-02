const test = require('node:test');
const assert = require('node:assert/strict');
const { collectImages, sniffType } = require('../src/discord/imageInputs');

const PNG = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(32),
]);

function messageWith(attachment) {
    return {
        attachments: new Map([
            ['1', { url: 'https://cdn.discordapp.com/a/image.png', size: 100, ...attachment }],
        ]),
    };
}

test("images: the bytes decide the type, not Discord's label", async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response(PNG));
    // Seen live: a PNG that Discord labelled image/webp was turned away.
    const { images, skipped } = await collectImages([
        messageWith({ name: 'image.png', contentType: 'image/webp' }),
    ]);
    assert.deepEqual(skipped, []);
    assert.equal(images[0].mimeType, 'image/png');
    assert.equal(sniffType(PNG), 'image/png');
});

test('images: a file that is no image at all is still refused', async (t) => {
    t.mock.method(
        globalThis,
        'fetch',
        async () => new Response(Buffer.from('<html>not an image</html>'))
    );
    const { images, skipped } = await collectImages([
        messageWith({ name: 'image.png', contentType: 'image/png' }),
    ]);
    assert.equal(images.length, 0);
    assert.match(skipped[0], /isn't really a PNG/);
});
