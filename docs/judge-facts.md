# Judging facts used by the simulator

Read from a reimplementation of the game (majdata's note and slide judging code, GPL-3.0) as **facts only**. Nothing is copied; `src/sim/judge.js` is written independently. Frame = 1/60 s.

## Presses and queues
- Each frame the game knows which of the 8 buttons and which sensors are ON, and which just turned ON (a "click" = OFF to ON since the previous frame).
- A click can be used once per frame. A note takes the click of its **button first**, then of its **A sensor** (taps, holds' heads); a touch takes the click of its own sensor (and optionally its lane's button, a setting).
- **Per-lane queue:** a tap or hold head can only be judged once every earlier note in its lane is judged. Touches have the same queue per sensor. So an early press is always taken by the **earliest** unjudged note of that lane.
- A note is judgeable from its window start; a click before that does nothing (the sensor staying ON afterwards makes **no new click**, so the note is not triggered later either).

## Windows
| Note | Judged from | Perfect | Great | Good | Miss after |
|---|---|---|---|---|---|
| Tap, hold head | 9 frames (150 ms) early | ±3 frames (50 ms) | ±6 frames (100 ms) | ±9 frames (150 ms) | 9 frames late |
| Touch, touch hold head | 150 ms early | 150 ms early to 12 frames (200 ms) late | to 15 frames (250 ms) late | to 18 frames (300 ms) late | 18 frames late |
| Slide end | when its last sensor is reached | ±(14 frames + a quarter of the *stay time*, at most 22 extra frames) | to ±29 frames | beyond | 36 frames late |

## Touch groups
Touch notes written on one tick form a group. Once more than half of the group has been judged (not a miss), the others get the same grade.

## Holds
After the head, the button or A sensor must stay pressed. Letting go for about 2 frames at the start of a break is forgiven once. Releases are only counted between 6 frames after the head and 12 frames before the end (touch holds: 15 and 12 frames). The share of the body held decides the grade: all = the head's grade, at least 67% = Great at best, at least 33% = Good at best, less = Miss.

## Slides
- A slide is a queue of areas (the sensor steps already in `slidePaths.js`; an area can offer alternative sensors). It starts being checked 50 ms before the slide start.
- It uses the **ON state**, not clicks, so any contact on the right sensor counts, including another hand.
- A step that is not the last counts when its sensor was ON and then OFF; the last step counts when ON. The step after the current one is always looked at too, so one step can be skipped. Finishing the whole queue judges the slide at that moment: far too early is a Fast Great or Good, not Perfect.
- Wi-Fi slides have three queues and are finished when all three are.

## Slide timing (corrected from MajdataPlay's current code, October 2026)
A slide is not judged against its end but against `start + length x (1 - c)`; the stay time is `length x c`, which also sets the Perfect extension (a quarter of it, at most 22 frames).
c depends on the shape and on how many lanes it spans, e.g. straight lines 0.15 to 0.19, rings from 0.46 (two lanes) down to 0.058 (full circle), v 0.15 to 0.185, curves (p, q) 0.08 to 0.16, edge curves (pp, qq) 0.063 to 0.157, V 0.10, s/z 0.13, wifi 0.163.
`src/sim/slideConst.js` has the table. Before this the simulator judged against the end and used a quarter of the whole length, a window several times too wide on long slides.
The planner now has the finger reach the last sensor at that moment and lift shortly after.

## Touch notes (checked against the same code)
The constants are as above: Perfect up to 12 frames (the first 9 are the best tier), Great to 15, Good to 18; a touch more than 9 frames early is ignored.
A touch group's grade is that of the touches registered before half the group was in.
Contact to sensor, in its phone/mouse emulation: the finger is a circle sampled at 128 angles and several radii; any sample inside a sensor's area turns it ON (an A sensor spans about 14.5 degrees either side of its lane, D about 8). That is an emulation, not the real panel.

## Not modelled
Touch panel lag and offset settings, ghost touches, the game's separate "classic" judge mode, EX notes, connected slides.
