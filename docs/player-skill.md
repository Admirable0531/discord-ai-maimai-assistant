# What makes good players good and bad players bad (inside the model)

Six player levels, from a first-weeks beginner to a top player (`beginner`, `casual`, `intermediate`, `advanced`, `expert`, `top` in `src/sim/styles.js`, unchecked by default in the simulation panel). All use the buttons for taps and the screen for touches and slides; they differ in how loose their timing is, how steady a lean they have, aiming, finger count, reach, hand speed, contact size, and whether they lift their fingers. **Every number is a guess made to put them in a believable order**; the point is the comparison, not the absolute scores. Score here is a simple weighted achievement (tap 1, hold 2, slide 3, touch 1; Perfect 100%, Great 80%, Good 50%, Miss 0) over 26 charts from Expert 9 to Master 14+ (3 per level), 5 runs each.

## Score by player and chart level
| | E9 | E10+ | M11+ | M12 | M12+ | M13 | M13+ | M14 | M14+ |
|---|---|---|---|---|---|---|---|---|---|
| beginner | 84.7 | 79.0 | 81.1 | 75.2 | 75.2 | 76.9 | 70.6 | 63.7 | 61.0 |
| casual | 92.9 | 91.0 | 90.6 | 88.2 | 88.6 | 88.5 | 85.4 | 81.9 | 80.5 |
| intermediate | 97.6 | 97.1 | 96.1 | 94.3 | 94.2 | 94.6 | 91.5 | 88.4 | 87.3 |
| advanced | 99.5 | 99.4 | 98.8 | 97.9 | 96.8 | 97.6 | 94.8 | 91.9 | 91.1 |
| expert | 99.9 | 99.8 | 99.7 | 99.2 | 99.3 | 99.4 | 98.5 | 97.2 | 97.5 |
| top | 100.0 | 99.8 | 99.9 | 99.5 | 99.3 | 99.6 | 99.0 | 97.6 | 98.0 |

Perfect share: beginner 58 to 37%, casual 72 to 58%, intermediate 89 to 74%, advanced 98 to 85%, expert and top 96 to 100%.

## Where the points go (average over all charts, % of the full score lost)
| | not reached in time | splash | aiming | own timing | missed (other) |
|---|---|---|---|---|---|
| beginner | 12.7 | 0.6 | 0.0 | 6.2 | 6.4 |
| casual | 4.6 | 0.5 | 0.0 | 4.9 | 2.6 |
| intermediate | 3.0 | 0.4 | 0.0 | 1.9 | 1.4 |
| advanced | 1.9 | 0.3 | 0.0 | 0.4 | 1.1 |
| expert | 0.5 | 0.1 | 0.0 | 0.0 | 0.5 |
| top | 0.4 | 0.04 | 0.0 | 0.0 | 0.4 |

How it changes with the chart: a beginner loses 15% on an Expert 9 chart (9 of them to timing) and 39% on a Master 14+ (24 to notes they could not get to in time). An advanced player loses about 0.5% on Expert 9 and 9% on Master 14+ (5.6 to reach). Splash is never more than about 1 point for anyone and is about 7% of what an advanced player loses.

## One skill at a time
Eight charts rated 13 to 14+. Expert baseline 98.6 score, 97.8% Perfect; beginner baseline 67.4, 45.0%.

Expert made worse in one thing (to the beginner's value):
| Change | Score lost | Perfect points lost |
|---|---|---|
| timing looseness | 9.4 | 31.9 |
| reach | 8.5 | 11.2 |
| early or late lean | 3.0 | 17.2 |
| hand speed | 0.6 | 0.8 |
| number of fingers | 0.5 | 0.5 |
| aiming | 0.4 | 0.4 |
| contact size, lifting fingers | 0.0 | 0.0 |

Beginner improved in one thing (to the expert's value):
| Change | Score gained | Perfect points gained |
|---|---|---|
| reach | 17.1 | 14.0 |
| hand speed | 12.3 | 10.0 |
| timing looseness | 6.8 | 11.9 |
| number of fingers | 0.2 | 0.2 |
| aiming, lifting, contact size, lean | about 0 | about 0 |

Bundles: a beginner with the expert's rhythm (timing and lean) reaches 71.7 score, 63.5% Perfect; with the expert's reach, finger count and hand speed 85.7 score but only 60.1% Perfect. An expert with the beginner's rhythm drops to 85.6 score and 60.1% Perfect; with the beginner's reach 71.1 score and 62.9% Perfect; with the beginner's aiming, contact size and lifting habit 98.5 and 97.6% (no change).

## What it suggests
1. **Good players are good because of two things: steady rhythm and being able to reach everything in time.** Rhythm decides the Perfect share (a 45 ms looseness alone turns 98% Perfect into about 65%). Reach and hand speed decide how many notes are lost outright, and that grows with chart difficulty. Neither can be replaced by the other: a beginner with perfect reach still gets only 60% Perfect, a beginner with perfect rhythm still loses 28% of the score on hard charts.
2. **Bad players are bad mostly because they miss notes, not because they splash them.** At every level splash is the smallest loss; for a beginner it is 0.6 points against 12.7 for notes they could not reach.
3. **Splash matters only once the rest is fixed.** For an expert about 10% of the little they lose is splash (0.1 of 1.1 points); for a top player, 5%.
4. **Aiming, contact size and lifting fingers do almost nothing to the score in this model.** They would show up only in spots where a splash is possible; that is why the splash advice should be reserved for advanced players and pointed at specific spots.
5. **Level by level, harder charts hurt weak players through reach first** (beginner's reach loss goes from 2.8 on Expert 9 to 23.8 on Master 14+) while timing loss stays roughly constant (9 to 4).

## Limits
- "Reach" and "hand speed" are the planner's way of saying a player cannot get a finger to a note in time. In real life that is also pattern reading and finger independence, which the model does not separate.
- The ladder is made up; real players of a given level are more varied (a fast but loose player, a precise but slow one).
- Score here is a simplified weighted achievement, not the game's formula, and chart level does not enter the model except through the notes.
- The scale for timing looseness (60 ms for a beginner to 9 ms for a top player) is a guess; the Perfect window of ±50 ms makes the Perfect share very sensitive to it.

## Left and right hand habits (Oct 2026)
The simulated hands are now a left hand (blue, "L") and a right hand (orange, "R") in the replay, and each run picks how the player shares the work (`habit` on a style, a selector in the custom editor; `mixed` draws one per run, 40% free, 30% by side, 30% by role):
- **free**: the nearest free finger takes the note, so a hand often reaches across the screen;
- **side**: each hand keeps its own half (notes left of centre to the left hand, right of centre to the right) and crosses only when it has to;
- **role**: one hand slides and holds while the other taps and touches (which hand is chosen per run);
- simultaneous notes always go left to the left hand and right to the right when the habit does not decide.

Eight charts rated 13 to 14+, 8 runs each, share of presses made by a hand on the other side of the screen ("crossing"), score, notes out of reach, splash points:

| Player | Habit | Score | Out of reach | Splash | Crossing |
|---|---|---|---|---|---|
| intermediate | free | 89.9 | 7.5% | 0.58 | 35% |
| | side | 90.5 | 6.9% | 0.55 | 19% |
| | role | 90.1 | 7.4% | 0.56 | 47% |
| advanced | free | 93.8 | 5.0% | 0.34 | 34% |
| | side | 94.8 | 4.0% | 0.33 | 15% |
| | role | 94.1 | 5.0% | 0.32 | 47% |
| expert | free | 98.5 | 0.9% | 0.14 | 31% |
| | side | 98.9 | 0.5% | 0.13 | 7% |
| | role | 98.7 | 1.0% | 0.12 | 47% |

What it shows: the habit changes how much a player crosses over, not how much they splash. Keeping each hand to its own side is the most reliable (about 1 point better for an advanced player, 4.0% against 5.0% out of reach), the one-hand-slides habit crosses the screen most (47%) and is no better than the nearest-finger default. Splash differs by 0.02 points at most, so in this model the hand choice is not what causes splashing; the contact, the timing and the notes are. The planner's hand choices are a model of habits, not measured behaviour; real players switch habits within a song and by chart, and the three habits here are simplifications.
