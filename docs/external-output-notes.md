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

## Result: where two SSS runs lost accuracy

GREAT detector (`events.js`): salmon-pink text of at least 120 pixels with a red LATE or blue FAST tag beside it, at least 0.6 ring radii from the middle (the combo digits are pink too). Checked by eye on LiftOff: the events with 140+ pixels were real GREAT labels.

| Video | Greats found | Where |
|---|---|---|
| LiftOff (SSS) | 6 | late taps in fast tap streams (L1 at 8.76 s, L4 at 9.71, L7 at 58.39, L1 at 78.39, L2 at 88.9: each had taps 0.07 to 0.3 s before or after on neighbouring lanes), and a slide end on lane 5 at 14.89 s |
| Paradisoda (SSS) | 2 | tap L7 at 16.44 s beside a slide start and a touch; touch C at 57.78 s inside a group of B touches |

`validate.js` compares these notes with the simulation's per-note risk (60 runs). The expert style finds almost no
non-perfect notes anywhere (mean risk 0.9%) and the real Greats sit at the 14th percentile of its risk on average (2 of 8 above zero);
the advanced style has 5% mean risk and the Greats are at the 39th percentile. So the simulation does not predict these Greats.

What it says: the Greats in these SSS runs are mostly LATE hits inside fast tap streams (a timing slip), not splash. The simulation's timing error is the same
independent noise on every note, so it never produces them. Real timing errors cluster in dense or direction-changing streams and are
biased late. That is the correlated timing model (errors depend on density and note pattern) to build next. Eight events is a very small sample.

## Correlated timing: tried, not supported by the data

Added optional timing structure to the planner (`timeDrift`: slow drift carried to the next notes; `stressNoise` / `stressLate`:
more noise and a late shift in fast streams that change direction), all off by default.
- With stress on, an expert style gets 25 to 45 Greats per chart instead of about 5, because stress covers a large share of notes in dense charts.
  At the same time the real Greats' position in the simulation's risk ranking only moved from the 11th to about the 38th percentile.
- None of the pattern features tried separates the 8 real Greats from the other 1,518 notes: gap before/after, distance from the previous note, change of
  direction, local density, needed hand speed (their percentiles among taps are scattered around 0.5; two of them follow a long pause, which could be a cold start).
- The count is fine already: the expert style gets about 5 Greats per run on these two charts; real SSS runs had 6 and 2.
- The one pattern in the data is lateness: 5 of the 6 LiftOff Greats are tagged LATE.
So the independent noise stays; more videos are needed (about 4 Greats per SSS run) before a pattern can be fitted.
