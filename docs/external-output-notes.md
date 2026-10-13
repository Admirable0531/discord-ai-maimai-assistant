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

## 21 SSS runs: what the Greats have in common

21 J.Deacon SSS clears (the videos whose alignment score was 80 or more, plus LiftOff and Paradisoda), 14,472 judged notes, 52 Greats matched to a note (0.36%).
Scripts: `run.js` (reads a list of videos), `analyse.js` (table below), `calibrate.js`, `a16.js`.

| | Great rate |
|---|---|
| 4 or fewer moments within +-0.5 s | 0.22% |
| 4 to 6 | 0.23% |
| 6 to 8 | 0.43% |
| 8 or more | 1.11% |
| less than 0.1 s after the previous note | 0.78% (0.2 to 0.4 s: 0.17%) |
| taps / holds / slides | 0.39% / 0.12% / 0.16% |
| touches | 1.07% (5 of 467) |
| yellow doubles (two at once) | 0.21% (single notes: 0.48%) |
| change of direction, distance from the previous note, slide nearby | no clear effect |

So Greats follow how crowded the music is, not the shape of the pattern. Two simultaneous notes are not riskier.

**Taps on a slide's start lane shortly after the slide sets off (rule A16): 1 Great in 373 (0.27%), as often as any other tap (0.39%).**
The simulation's expert got 11.6% there. The slide finger sat on the start sensor and caught the tap early. Skilled players do not set the slide off
while that tap is due; the planner now has `slideAware` (waits until the tap is done, the slide timing is generous) for intermediate players and up, which gives 0.19%.
Beginner and casual players stay unaware, so the A16 warning still stands for them. (The earlier finding that this is the dominant splash holds for ordinary players; the evidence here is from SSS players.)

**Timing noise now follows the crowd.** `stressNoise` multiplies timing noise by up to 1 + stressNoise when 8 or more moments fall in a one-second window,
and `lapse` is the chance per note of a plain 55 to 105 ms slip (70% late). Fitted so the top player matches the SSS runs: Greats 0.38% (real 0.36%);
by crowd 0.18 / 0.30 / 0.48 / 1.09% (real 0.22 / 0.23 / 0.43 / 1.11%). Other levels use the same stress factor with larger lapses (beginner 2%, top 0.3%).

**Not explained:** touches. Real touches got Greats 1.07% of the time; the simulation's touches never do (its touch window is very wide: early 150 ms, Perfect up to 200 ms late).
Either the real touch window is narrower than assumed, or touch groups are graded differently. The judging code of MajdataPlay would settle it.

Eight to 52 events is still a small sample; the fit only constrains one number per crowd bin.

## What the other maimai repositories added (read as public code, October 2026)
- **MajdataPlay** (the source of the judging facts): slides are judged `length x c` before their end with a Perfect extension of a quarter of that, not a quarter of the whole length. Fixed in the simulator (see `docs/judge-facts.md`). Touch windows and the group rule matched what the simulator already had, so the missing touch Greats are not a window problem; a likely reason is a finger resting on the sensor (no new edge), which the simulation does not do.
- **MaiSense**: its sensor polygons are a rough 1000 x 1000 approximation (A as big corner-to-ring quadrilaterals, B and an octagon for C), no D/E. Not usable to check my shapes. Majdata's phone emulation uses an A half-width of 14.5 degrees and D of 8, close to what the simulator has (15 and 7.5).
- **Sentakki** (osu! recreation): its own judging, no sensor model; nothing to use.
After the slide fix the top simulated player's slides had Great 0.06% (real 0.16%) but Good/Miss 1.0%. Cause: every wifi slide failed. The simulated player drew one line along the middle track with a 0.25 contact, which cannot cover the two outer tracks. A wifi slide is now played with three fingers, one per track (three strokes from one hand); slide Good/Miss fell to 0.15%.
Touches: real SSS runs had Greats on about 1% of touches (5 of 467), the simulation none, because a touch's Perfect window runs 200 ms late. Touch lapses are now late ones of 210 to 250 ms at three times the lapse rate of other notes; the simulated top player gets 0.4% (weak evidence, 5 events).

## 62 more runs: Greats by rank (Blanc's videos, game screen beside a hand camera)

Blanc's channel posts runs at every rank from S to SSS+ on 12 to 14+ charts, with the game screen on the left and a hand camera on the right. The ring is not at the screen centre, so `labels.js` takes the ring position (`RING="cx,cy,R"`; 301.5, 269.5, 240.5 on a 960 px wide frame) and `events.js` ignores labels outside it. A first batch was captured with the ring assumed at the centre; the cell data were still valid, and `applyRing` fixes the position afterwards (alignment score went from 28-88 to 134-246).
Alignment is judged by how strongly yellow, orange and salmon labels follow the taps (`contrast` at least 1.4, label score at least 120), which kept 61 videos.

Great labels per note, by rank (`rank.js`):

| Rank | Videos | Notes | Greats |
|---|---|---|---|
| S | 5 | 5,877 | 3.11% |
| S+ | 2 | 2,015 | 2.13% |
| SS | 10 | 10,398 | 1.88% |
| SS+ | 13 | 14,567 | 1.30% |
| SSS | 27 | 21,640 | 0.51% |
| SSS+ | 4 | 3,718 | 0.22% |

The ladder is clean, so rank mostly means "how often a note is off by more than 50 ms". The simulated skill ladder was far worse than any of these ranks (the old "advanced" gets 15% Greats on the same charts, "intermediate" 22% with 20% Good/Miss): real players in videos are strong. Players below S were not observed.

**Rank players** (`rankS`, `rankSp`, `rankSS`, `rankSSp`, `rankSSS`, `rankSSSp`, hidden among the extra styles): the top player with timing noise and lapse rate scaled by 1.45, 1.3, 1.25, 1.1, 0.78 and 0.45 (`fitrank.js`). On the same charts they get Greats 3.16 / 2.17 / 1.91 / 1.25 / 0.48 / 0.17% against 3.11 / 2.13 / 1.88 / 1.30 / 0.51 / 0.22% real. About 0.4% of Greats in the simulation come from splash and slips whatever the timing, so SSS+ lands a little under the floor.
Check against the rank itself (`achievement.js`, Great 0.75, Good 0.5, weights tap 1, hold 2, slide 3, touch 1): the simulated achievement median is 98.2 (S, real 97 to 98), 99.2 (S+, 98 to 99), 99.1 (SS, 99 to 99.5), 99.2 (SS+, 99.5 to 100), 99.9 (SSS, 100 to 100.5; no break bonus counted). Within about 1%, so the Good and Miss counts are about right too.
