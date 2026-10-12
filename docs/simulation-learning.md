# Learning splash from random hands

Instead of choosing hand sizes by hand, `src/sim/learn.js` draws **random hands** (contact radius for taps, touches and slides, aiming and timing error, the overlap needed to trigger a sensor, finger count and reach, hand speed, buttons or screen for taps and touch, lifting or dragging), plays real charts with them through the simulated judging, and fits simple models (`src/sim/ml.js`: a classification tree, ridge regression, a seeded random source) to the outcomes. Run it with `node src/sim/learn.js "Titania,Apollo" 60 5 out.json rows.csv`.

Run recorded here: 6 charts (Titania, Apollo, Latent Kingdom, Straight into the lights, raputa, Aegisfortia), 60 random hands, 5 runs each. 399,133 (victim note, possible source note) pairs, 13,729 of them a splash (the source's press took or blocked the victim in at least a quarter of the runs). Overall 2.7% of notes splashed on average.

## Which hand properties matter (ridge regression on each hand's overall splash rate, r2 = 0.52)
Standardised effect on the splash rate, largest first: lifting fingers between notes lowers it most (-0.011), a bigger tap contact raises it (+0.008), playing taps on the buttons lowers it (-0.007), a longer reach lowers it (-0.005), needing more overlap to trigger a sensor lowers it (-0.004), timing error raises it (+0.003). Aiming error, finger count and touch-on-button barely matter. A larger slide contact came out slightly negative, which I read as noise in this run.

## The learned rule of thumb (classification tree on the pairs)
Almost every splash needs all of:
1. the source's nearest approach is within about 0.10 of the ring radius of the victim's sensor centre (same sensor), **or** its contact radius plus about 0.2 covers the distance;
2. the two presses are within about 140 ms of each other (the tap window is 150 ms);
3. the source comes first (the victim is taken early), apart from jacks (below);
4. the victim is a tap or a hold head: **touches were never splashed by taps or slides** (0 in every gap bin), and the only touch-on-touch case was the same sensor repeated (4.7%).

Distance and contact (touch or slide source, tap victim, gap -0.1 to +0.15 s):

| Contact radius | P(splash) |
|---|---|
| under 0.12 | 0% |
| 0.12 to 0.16 | 11% |
| 0.16 to 0.24 | about 40% |
| 0.24 and more | 100% |

By how much the contact falls short of the distance: when `distance - contact radius` is under about 0.2 the chance is 18 to 29%, above 0.2 it is about 0.5%. Sensor centres to the tap's A sensor: E and D neighbours are about 0.33, B about 0.36, the neighbouring A sensor about 0.64, so a wide finger or the side of the hand reaches E, D and B neighbours and a fingertip or finger pad does not; **no contact in range reaches a neighbouring A sensor**.

Jacks (the same lane twice): the splash peaks when the second note is 0 to 100 ms away (27% at -0.05..0, 18% at -0.10..-0.05, 7% at -0.15..-0.10, about 4% after): the second press is taken by the first note. That matches B5's 9 per second.

Lifting made no difference to a slide's finger on the same sensor as a tap (7.8% flat against 9.8% lifted).

## How the rules compared
Share of random hands that splash at the spot of each finding (the old A15 and A16 are included):

| Rule | Findings | Mean share of hands that splash there | Splash for at least half the hands |
|---|---|---|---|
| A4 / A5 slide and a tap | 6 | 84% | 6 of 6 |
| A1 touch beside a tap | 1 | 47% | 0 |
| A16 tap on a slide's start lane | 257 | 22% | 18 |
| A15 tap beside a slide route (old rule) | 195 | 23% | 24 |
| A9 adjacent-button run | 117 | 18% | 11 |
| A2 touch beside a hold | 4 | 3% | 0 |

## What changed because of it
- **A15 rewritten.** The old rule flagged a tap beside the *neighbouring A sensor*, which no contact in range reaches. It now flags only a slide passing a B, D or E sensor that borders the tap's own sensor, in the 150 ms after the pass, with the wide-contact wording. Findings fell from about 40 per chart to 2 or 3.
- A4/A5 stay as they are (the most reliable rule), A2 stays informational.
- A9 stays informational. Nothing here supports neighbouring-button streams splashing.

## Limits
The random hands vary the parameters I thought of; they cannot say whether real contacts are wider than 0.12, only what happens for each width. The pairs only include (victim, source) combinations within 0.5 s, and negatives are sampled (12%) and reweighted. The tree explains where splashes can occur; it does not give a calibrated probability for a real hand.
