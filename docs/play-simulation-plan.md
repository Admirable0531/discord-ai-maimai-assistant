# Play simulation plan (draft 1, for review before any code)

Goal: instead of guessing where splashes happen with fixed thresholds (rules A1 to A16), **play the chart in a simulator** with virtual hands, run it through a copy of the game's judging, and see which notes come out wrong and why. Run it with different play styles (full buttons, full screen, big palm slides, fingertips...) and many random variations, so each spot gets a **probability per style** instead of a yes/no.

What it is not: a claim about what the real game does at a given spot. It is a model with stated assumptions; it gets calibrated against the spots you mark and against known facts, and it says how sure it is.

---

## 1. What the simulation answers

1. For a chart and a play style: which notes are hit early, blocked, double-counted or missed because of a *neighbouring* input, and with what chance.
2. Which style avoids a spot ("button players are fine here, palm sliders splash 70%").
3. Whether the chart can be played at all with two hands (this also finds 無理押し and cheese: spots that need a third hand or an unusual hold).
4. Which of my current rules agree with the simulation and which are noise (the rules stay as the fast path; the simulation checks them).

## 2. Pieces

```
chart events ──► player planner ──► input trace ──► judge engine ──► outcomes
 (chartModel)    (who touches what,   (which sensors    (game rules,     (per note: clean /
                  where, when)         are ON each       60 fps)          early / blocked /
                                       frame)                              missed, caused by what)
                      ▲ style + noise (random seed)                              │
                      └──────────────── Monte Carlo, N runs ◄───────────────────┘
                                         aggregate → findings + replay
```

### 2.1 Judge engine (`src/sim/judge.js`)
A reimplementation of the game's judging at 60 frames per second (16.67 ms), from facts only (majdata's judging code is GPL, so I read it for facts and write my own, as done for the slide tables):
- **Inputs it consumes:** a per-frame set of ON sensors (34: A1-8, B1-8, C, D1-8, E1-8) plus per-frame button state (8 physical buttons).
- **Tap / break:** a press (OFF to ON edge) of the button or its A sensor inside the window; windows from the constants already in `rules.js` (Perfect ±50 ms, Great ±100 ms, Good ±150 ms). Early presses outside the Good window do nothing.
- **Hold:** head like a tap, then must stay ON; release handling and the end window.
- **Touch and touch hold:** sensor edge, 150 ms early / 200 ms late for Perfect; groups need more than half (n/2 + 1).
- **Slide:** an ordered queue of sensor steps (tables already in `slidePaths.js`, verified against the game); a step is satisfied while its sensor is ON, steps are consumed in order, judged at the end.
- **Conflict rules (the important part):** when one press could belong to several notes (two taps on the same lane, a tap and a slide step on the same sensor, the earliest unjudged note in the window wins?). I do **not** know the exact rule yet; this is the first research item (read the game-side judging order from majdata, cross-check with the guides, and test with micro-charts). Everything depends on this, so it is built and verified first.

### 2.2 Hand and finger model (`src/sim/hands.js`)
- **Footprint:** a hand contact is a shape on the screen (circle for a fingertip, a larger ellipse for a finger pad, a big blob for a palm side). A sensor is ON when the overlap between the footprint and the sensor polygon passes a threshold (the sensor polygons are the measured ones from the viewer: A, B, D, E, C).
- **Movement:** a hand moves between targets at a limited speed along a straight or curved path. A hand that **stays down** while moving drags its footprint across every sensor on the way (the main source of splashes); a hand that **lifts** between notes touches only where it lands.
- **Noise:** position error (Gaussian), timing error (Gaussian, ms), occasional landing slop. Seeded, so a run can be replayed exactly.
- Two hands (left, right); optional extra "support" contacts (for example a resting palm).

### 2.3 Player styles (`src/sim/styles.js`) — editable presets
| Style | Taps and holds | Touch | Slides | Notes |
|---|---|---|---|---|
| **Full buttons** | the 8 physical buttons (no screen contact) | screen, one hand | screen, other hand or same | button taps cannot splash screen sensors; touch and slides can still catch each other |
| **Full screen, fingertips** | A sensors with fingertips, lifted between notes | fingertips | fingertip follows the path exactly | the "clean" reference |
| **Full screen, dragging** | fingertips that stay down between notes | same | same | the sloppy case: shows how much a drag costs |
| **Palm / side-of-hand slides** | buttons or fingertips | fingertips | large contact swept along the path | big footprint covers neighbouring sensors, so it shows which slides are unsafe for palms |
| **Big-hand touch** | any | one whole-hand press covers a touch group | any | tests the "more than half" group rule |
| **Mixed** | buttons for the left half, screen for the right, etc. | | | a user-defined mix (each style is a small config object, so new ones are cheap to add) |

### 2.4 Planner (`src/sim/planner.js`)
Turns chart events into hand actions:
1. **Assignment:** which hand takes which note. Greedy with lookahead: prefer the hand nearest the target and the hand that is free (not holding), alternate otherwise, same-time notes split by side. A small search (beam of a few options) for hard passages. Also reports "unplayable" when two hands cannot cover simultaneous notes plus a hold (3 or more spread inputs).
2. **Trajectory:** for each hand, a timeline of positions and down/up states, built from the assignment: land on the note's sensor at its time, hold, then travel to the next target; slides follow the slide's drawn path at the slide's pace (the viewer already has the path geometry).
3. **Style options** decide lift vs drag, footprint, and noise.

### 2.5 Monte Carlo and aggregation (`src/sim/run.js`)
- N runs per style (default 200; a chart is a few thousand frames, so this should take seconds, to be measured), with a different seed each.
- Per note: counts of clean, early-by-other, blocked, double-counted, missed, and the **cause** (which other note or hand's footprint, which sensor).
- Findings: a spot is a finding when the splash chance in a style passes a threshold; text says which style and how likely ("palm slide: 80%, fingertips: 5%").
- Output compares with rules: each rule finding is marked confirmed (simulation agrees), unconfirmed (never happens in simulation, so likely noise) and the simulation's own new spots are listed as "found only by simulation".

### 2.6 Viewer integration
- A **Simulate** panel: choose style(s), run, see the splash heat on the timeline (one lane per style) next to the rule findings.
- **Replay:** the sensor ring shows the hand footprints as translucent circles, the sensors that are ON lit, and notes coloured by outcome; scrub or play as now. The deterministic replay of one seed runs in the browser (the same module); Monte Carlo runs on the server (`/chart/sim`, rate limited, off or capped on the public port).
- The bot tool/command gets a one-line summary only ("simulation: palm slides splash at 0:50, 1:59").

## 3. Verification (what I test myself)
1. **Judge engine:** unit tests with micro-charts for every conflict case, taken from facts in the guides: tap and touch together, E5 grabbing A4 and A5, slide passing a tap, slide end then tap, two taps on a lane, touch group over half. Each test states the expected outcome and where it comes from.
2. **Sanity:** with zero noise, a lifted fingertip style on a two-hand-playable chart must clear everything as Perfect, and the planner must say "unplayable" on a chart written with three simultaneous far-apart inputs plus a hold. Failures here mean my model is wrong, not the chart.
3. **Known spots:** the places the guides name (Titania ending, E5/4, slide start then next star) must come out as splash-prone; places they call safe must not.
4. **Agreement report** on 20 charts rated 14+: how many rule findings the simulation confirms per rule; rules with a low confirmation rate get demoted or removed (A15 and A16 are the first suspects).
5. **Headless-browser check** of the viewer panel and replay (screenshots, console errors) as I did for the count-in.
6. **Your marked spots** (when you have them) are the real calibration target: parameters (footprint size, hand speed, noise) are tuned until the simulation catches the spots you know without flooding everything else. Until then, every parameter is labelled "guess".

## 4. Risks and honest limits
- **Judge conflict rules** are the biggest unknown (see 2.1). If they cannot be established from available facts, results on "blocked" and "early" cases are plausible but unproven, and the report says so.
- **Real hand data does not exist here.** Footprint sizes, hand speed and noise are estimates. The simulation is good at *ranking* spots and comparing styles, not at stating a true percentage.
- The touch screen's own behaviour (ghost touches, sensitivity per cabinet, lag) is not modelled.
- Palm and multi-finger techniques vary a lot between people; presets are starting points you can edit.
- Compute: should be fine on the OptiPlex (seconds per chart); measured before the server route is enabled, with a cap on runs.

## 5. Phases
| Phase | Work | Done when |
|---|---|---|
| 0 | Research the judge order and conflict handling (facts from majdata and the guides) | a written table of rules with sources, open questions listed |
| 1 | Judge engine plus micro-chart tests | tests for every case pass; engine replays a perfect input trace to all-Perfect on 3 real charts |
| 2 | Footprint and sensor-overlap model | a fingertip at A5 turns on A5 only; a palm at A5 turns on A4, A5, B5 etc. |
| 3 | Planner and hands for taps, holds, touches (two hands, lift or drag) | clean style clears real charts; unplayable detection works |
| 4 | Slides: path following, big footprints, slide-start and slide-end handling | slide charts clear in the clean style; palm style shows splashes |
| 5 | Monte Carlo, aggregation, causes, agreement with the rules | report on 20 charts rated 14+, rules demoted where unconfirmed |
| 6 | Viewer panel and replay, `/chart/sim` route, caps | works on phone width, no console errors |
| 7 | Calibration with your marked spots, tool and command summary, docs | spots you marked are caught; threshold notes written down |

## 6. Questions for you
1. Which styles matter most to you? My default set is above (full buttons, fingertips lifted, fingertips dragging, palm slides, big-hand touch, mixed). Add or remove any.
2. For button players: do the **buttons count as the only input for taps and holds** (screen never touched for those), or do you also rest fingers on the screen?
3. Hand count: two hands only, or should I allow modelling a foot or elbow press (no, I assume), a third finger holding a button while both hands play, etc.?
4. Should the public (tunnel) page get the simulator, or only your local-network page? (Server cost and rate limits.)
5. Is "probability per style" the right output, or do you want a single "worst realistic style" answer per spot?
6. Can you mark 3 to 5 splash spots you are sure of (song, difficulty, time or bar, and what you do there)? That is what the calibration in phase 7 needs.

---

## Status (all phases built)

Built in `src/sim`: `sensors.js` (sensor shapes and a raster for contact overlap), `judge.js` (the game's judging, see [judge-facts.md](judge-facts.md)), `planner.js` (two hands with a few fingers each), `styles.js` (six styles), `run.js` (one run, Monte Carlo, replay data), `report.js` (spots and agreement with the rules), `service.js` and `worker.js` (a worker thread with a queue and cache). The viewer has a "Play simulation" panel with the spot list, timeline marks and a hands overlay on the sensor ring; `POST /chart/sim` serves it (rate limited on the public port); `analyze_maimai_chart` has `simulate: true`.

Answers used from the review: styles all of them, including mixing (button players also sweep on the screen: `touchButtons`, `lift`/dragging, palm sizes), the public page gets it too, results show a chance per style and the worst one, calibration waits for your marked spots.

### What I checked
- 32 tests, 14 for the simulator: every press/window/queue/group/hold/slide case in the judge, sensor geometry (a fingertip on A5 turns on only A5, a palm covers 4 or more sensors), zero-error play clears a chart in every style, seven simultaneous presses are reported as unreachable by two hands, and a wide touch on E5 just before a tap on button 4 splashes it (93% for big-hand touch, 38% palm, 0% fingertips and buttons) while touches never splash touches.
- Speed: about 50 to 150 ms per run of a full chart, so 6 styles x 24 runs takes several seconds; it runs in a worker thread so the bot stays responsive.
- **Agreement with the rules** on 18 charts rated 14+ (12 runs, 5 styles; "chance" = the same count with every finding moved 3.7 s later):

| Rule | Findings | Simulation also finds a splash there | By chance |
|---|---|---|---|
| A15 tap beside a slide route | 361 | 76 | 42 |
| A16 tap beside a slide start | 268 | 46 | 26 |
| A9 adjacent-button run | 229 | 18 | 13 |
| A1 touch beside a tap | 27 | 3 | 1 |
| A4 slide passes a tap | 20 | 2 | 2 |
| A2 touch beside a hold | 22 | 0 | 0 |

So A15 and A16 carry some real signal (about 1.8 times chance) but most of their findings are not reproduced; A9, A4 and A2 are mostly noise by this model. A1 is rare in the simulation because a fingertip on a touch sensor does not reach the neighbouring A sensor; it only splashes for wide contacts.

### Limits to keep in mind
Footprint sizes, hand speed, finger counts, aiming and timing errors are all estimates. A simulated "no splash" means no splash for that model, not for every hand. The planner does not model hand fatigue or deliberate cheese (it will call a chart unreachable where a player uses an unusual technique).
