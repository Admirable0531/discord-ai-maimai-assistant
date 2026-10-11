# What the play simulation taught about splashing

Experiments run with `src/sim` (virtual hands, the game's judging copied from facts, Monte Carlo with small aiming and timing errors) and the rule changes they led to. Everything is "within the model": hand sizes and speeds are estimates until calibrated with spots a player has marked.

## Findings

1. **The same sensor is what splashes, for everyone.** A touch on A4, a slide's finger on A4, a tap on lane 4: whichever press comes first takes the tap if it falls inside the tap's window (150 ms early). Fingertip, palm and button players are all hit by this. It is deterministic, not about hand size.
2. **Neighbouring sensors splash only with a wide contact.** A touch on E4, E5, D4, D5 or B4 reaches the A4 sensor only when the contact radius is roughly 0.12 to 0.15 of the ring radius or more (about 2.5 to 3 cm): a wide finger pad, the side of the hand, a palm. Fingertips (0.055) and pads (0.09) stay clear; aiming error alone (even 0.06 of the radius) gives about 3%. B sensors need 0.15 to 0.2. A neighbouring *A* sensor (A3 or A5 for a tap on lane 4) is never reached by a touch: the A wedges are 15 degrees apart.
3. **Touch against touch never splashes** (E4 then E5, every style, every gap). Touches are judged from 150 ms early to 200 ms late, so the presses never conflict. A tap does not splash a later touch either, apart from the same sensor.
4. **A touch pressed at the same time as the tap is fine** (0% at 0 to 30 ms apart). The splash is the touch coming 40 to 150 ms *before* the tap, so its press is taken first. With a wide contact that is 40 to 97%.
5. **Slides: the window around a pass depends on slide speed.** A finger stays on a sensor for about half the sensor's width divided by its speed, on both sides of its middle. A tap on that sensor is taken early when it arrives 50 to 150 ms after the finger first touched the sensor, and gets no fresh press while the finger is still sitting on it. For a 0.5 s ring slide that is 0 to +100 ms after the middle of the pass, for a 1 s slide about 0 to +50, for a 2 s slide about -160 to +160 ms. The rule (A4/A5) now computes this per step.
7. **Next tap on the slide's own start lane (A16).** The finger that sets a slide off lands on the star's sensor. A tap on that lane from roughly 20 to 110 ms after the slide moves off is taken early about 100% of the time (every style); a tap exactly when the slide starts, 25 to 45%. This matches the Japanese guides (button players take the star, then touch the screen to slide and catch the next star as an early Good). A *neighbouring* lane's tap next to the slide start: 0% in every style, so the old A16 was wrong.
8. **Slide ends:** a tap on the slide's end lane from 50 ms before to about 100 ms after the slide ends is a collision (up to 95%); a tap on the neighbouring lane never is (0%). A7 (slide ends beside a note) was dropped and A13 narrowed to that window.
9. **Neighbouring-button streams do not splash** (stairs, trills at 6 to 20 notes a second, every style). They stop being playable at about 20 a second because of finger speed, not splash. A9 is now informational.
10. **Jacks at about 10 a second** (the same button 100 ms apart): a press that is a little late gets taken by the earlier note and the next note then has no press. 25% in the model. B5's threshold moved from 12 to 9 a second.
11. **A hold is not broken by a touch beside it**, for any contact size tried (0 to 0.2). A2 is informational.
12. **Real charts:** across 12 charts rated 14+ the simulation's splash spots were dominated by (a) a tap on the same lane exactly as a slide starts, (b) jacks around 100 ms, (c) a few slide-route clips with palms. Touch-related splashes were rare.

## Other things found along the way
- simai.js misreads a slide length written with its own BPM, `[BPM#x:y]` (Apollo has two), giving slides 6 to 36 seconds long. `buildChart` now rewrites those to `[1000:n]` before parsing and drops any slide still longer than 12 s (counted in `droppedSlides`).
- Assumption that matters: when a touch on an A sensor and a tap on the same lane both want the same press, the simulation lets the tap take it first. The game's real update order was not found; results for "A touch then tap on the same sensor" depend on it.
- Pressing for 70 ms made fast jacks impossible in the model; presses now last at most half the gap to the next one on the same button.

## Rule changes made
| Rule | Change | Reason |
|---|---|---|
| A1 touch beside a tap | only when the touch is 40 to 150 ms before the tap; together is not flagged; text says "wide finger or side of the hand" | findings 2 and 4 |
| A2 touch beside a hold | severity 1, wording | finding 11 |
| A3 touch beside a touch | removed earlier | finding 3 |
| A4/A5 slide and a tap | window computed from the slide's speed | finding 5 |
| A6 slide beside slide | only judged ends 30 to 100 ms apart | earlier review |
| A7 slide end beside a note | removed | finding 8 |
| A9 adjacent-button run | severity 1, informational | finding 9 |
| A13 tap on the slide's end sensor | window -50 to +100 ms | finding 8 |
| A15 tap beside a slide route | wording: wide contacts only | finding 2 |
| A16 | now the slide's own start lane, -60 to +140 ms | finding 7 |
| B5 jack | from 9 a second; text about the stolen press | finding 10 |

## Open questions
- Is a normal finger really as small as the model's 0.055 to 0.09 ring radii? The Japanese guide's "touching 5 drags in 4" on E5 with ordinary play suggests real contacts (or the hand above the glass) are wider than the model's fingertips. Marked splash spots would settle it.
- Which note takes a press shared by a touch and a tap on the same sensor?
