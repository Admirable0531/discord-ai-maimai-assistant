// Song title -> cover image name, from the arcade-songs data the song tools
// already load. A title it doesn't know just gets no cover.
const { loadSongData } = require('./maimaiSongData');
const { findSongByTitle } = require('./maimaiChartLookup');

async function loadCoverMap(titles) {
    const covers = new Map();
    try {
        const { songs } = await loadSongData();
        for (const title of titles) {
            const song = findSongByTitle(songs, title);
            if (song?.imageName) covers.set(title, song.imageName);
        }
    } catch {
        // A card without covers is still worth drawing.
    }
    return covers;
}

module.exports = { loadCoverMap };
