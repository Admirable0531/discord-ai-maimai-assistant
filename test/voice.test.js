const test = require('node:test');
const assert = require('node:assert/strict');
const { parseWakePhrase, tidyTranscript } = require('../src/voice/wakeWord');
const { downsampleToMono16k, durationSeconds, rmsLevel, toWav } = require('../src/voice/wav');

test('wake phrase: the request after the name, in the spellings recognisers produce', () => {
    assert.equal(parseWakePhrase('Hey Atri, show me my B50.'), 'show me my B50.');
    assert.equal(parseWakePhrase('hey atari show me my b50'), 'show me my b50');
    assert.equal(parseWakePhrase('Hey, a tree. What is my rating?'), 'What is my rating?');
    assert.equal(parseWakePhrase('Okay Atri what is PANDORA'), 'what is PANDORA');
    assert.equal(parseWakePhrase('Atri, 我的B50'), '我的B50');
    assert.equal(parseWakePhrase('アトリ、レートを教えて'), 'レートを教えて');
    assert.equal(parseWakePhrase('嘿 亚托莉 给我看B50'), '给我看B50');
    assert.equal(parseWakePhrase('Uh, so hey Atri, my rating?'), 'my rating?');
    assert.equal(parseWakePhrase('呃 亚托莉 我的rating'), '我的rating');
});

test('transcripts: spaced-out Chinese is closed up, spaces between Latin words stay', () => {
    assert.equal(
        tidyTranscript('诶 亚 托 莉 , 给 我 看 一 下 我 的 B 50 。'),
        '诶亚托莉 , 给我看一下我的B 50。'
    );
    assert.equal(parseWakePhrase(tidyTranscript('诶 亚 托 莉 , 给 我 看 B50')), '给我看B50');
    assert.equal(tidyTranscript('show me my B50'), 'show me my B50');
});

test('wake phrase: the bare name means a request is coming', () => {
    assert.equal(parseWakePhrase('Hey Atri.'), '');
    assert.equal(parseWakePhrase('Atri?'), '');
    assert.equal(parseWakePhrase('Ah, hey Atria.'), '');
});

test('wake phrase: talk that is not addressed to Atri is ignored', () => {
    assert.equal(parseWakePhrase('I think atari games are fun'), null);
    assert.equal(parseWakePhrase('that tree is big'), null);
    assert.equal(parseWakePhrase('Atrium is a word'), null);
    assert.equal(parseWakePhrase('Hiatri'), null);
    assert.equal(parseWakePhrase('So I said atri was cool'), null);
    assert.equal(parseWakePhrase(''), null);
    assert.equal(parseWakePhrase(undefined), null);
});

test('audio: 48 kHz stereo becomes 16 kHz mono in a valid WAV', () => {
    // One second of a 440 Hz tone at half volume, same on both channels.
    const frames = 48000;
    const pcm = Buffer.alloc(frames * 4);
    for (let i = 0; i < frames; i++) {
        const s = Math.round(Math.sin((2 * Math.PI * 440 * i) / 48000) * 16000);
        pcm.writeInt16LE(s, i * 4);
        pcm.writeInt16LE(s, i * 4 + 2);
    }
    assert.equal(durationSeconds(pcm), 1);
    const mono = downsampleToMono16k(pcm);
    assert.equal(mono.length, 16000 * 2);
    assert.ok(rmsLevel(mono) > 0.3);
    assert.equal(rmsLevel(Buffer.alloc(3200)), 0);

    const wav = toWav(mono);
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
    assert.equal(wav.readUInt32LE(24), 16000);
    assert.equal(wav.readUInt32LE(40), mono.length);
    assert.equal(wav.length, 44 + mono.length);
});
