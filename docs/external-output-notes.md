# Reading judgement labels from external-output videos (work in progress)

Goal: find where real players lose accuracy (non-perfect notes in SSS / SSS+ clears) to check the splash simulation.
Videos tried: J.Deacon's SSS runs (Paradisoda `lkmt2q25WJg`, LiftOff `tfSN2a3WlpM`); "Round Round Spinning Around" has no chart on the simai wiki.

What the screen shows (1080p, the game's own output):
- CRITICAL PERFECT: yellow, big "CRITICAL" over small "PERFECT" (a smaller version when notes come quickly), on the lane just outside the ring.
- PERFECT: orange text with a red LATE / blue FAST tag.
- GREAT: salmon pink text (about RGB 240,112,160) with the red LATE / blue FAST tag, seen *inside* the ring (about 0.8 ring radii), not at the edge.
- The combo counter is big and readable (resets on Miss); the achievement percentage is too small and blurred to read.
- Tap note rings are pink as well (RGB 240,16-32,112-128, inner 240,112,192), so a colour match alone gives many false hits.

Scripts (`scripts/ext/`): `capture.js` (lane/sensor colour counts), `align.js` (video clock to chart, per-note label colours; Paradisoda: 770 of 771 judged notes show yellow, shift 15.03 s; LiftOff: shift 14.23 s), `labels.js` (sparse colour cells for yellow / orange / salmon pink per frame), `events.js` (turns salmon-pink clusters into events matched to chart notes).

State: yellow detection and the alignment work. The GREAT detector is too loose (about 100 candidate events per video, most of them note highlights), so no splash list has been produced yet. Next: require the LATE/FAST tag next to the text, or match the label shape, and check a handful by eye.
