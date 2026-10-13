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
13. **Skilled players do not suffer finding 7.** In 21 SSS external-output runs, taps on a slide's start lane shortly after the slide set off got a Great 1 time in 373 (0.27%), like any other tap. Players hold the slide back until that tap is done (the slide's timing is generous). The simulation does the same for intermediate players and up (`slideAware`); beginners and casual players still get the 100% of finding 7 (see docs/external-output-notes.md).
14. **Slide judging was off.** The game judges a slide `length x c` before its end, with `c` per shape, and a Perfect window that grows by a quarter of that, not a quarter of the whole length (docs/judge-facts.md). The simulator now does the same; a wifi slide is played with three fingers.
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

## Checked online (Oct 2026)
Searches in English, Japanese and Chinese, plus the sega.bsnk.me maimai touchscreen page. What was found and not found:
- **Found:** the original (pre-DX) touchscreen is read through an 838-15221 board over a serial text protocol that reports one bit per sensor (A1-A8, B1-B8, C) and lets the game set a **threshold per sensor**, so sensitivity can differ between cabinets. A community description says maimai has "fewer and individually larger touch areas" than other games, which causes more splashing, "especially when sliding over" a held note. The judging facts in `judge-facts.md` (60 fps, per-frame sensor state) match the Chinese 判定全解 summaries.
- **Not found:** the sensor technology (infrared or capacitive), the physical sensor layout, whether neighbouring sensors react together, how wide a normal finger's effective contact is, and which note takes a press that two notes could use. The Bilibili 判定全解 articles block automated reading, and the pages that came back were general.
- So the open questions below (contact size, shared-press order) stay open until someone marks real splash spots or reads the game's code; the contact-size results in the simulation remain estimates.

## Overshooting slides and touches (Oct 2026)
The simulated hands got an `overshoot` setting (in ring radii): a slide's finger keeps travelling that far past its last sensor in the direction it was going before lifting, and a finger landing on a touch or screen tap lands that far past it in the direction it came from. Beginner 0.15, casual 0.10, intermediate 0.06, advanced 0.03, expert 0.015, top 0.01.

- **Slide overshoot only prolongs the end collision.** A tap on the slide's end lane 100 ms after the slide ends went from 0% to 12 to 17% for 0.2 to 0.3 overshoot (65% to 77% at +50 ms). The lane next to the end, and the one after it, were never affected, even at 0.3: the A sensors are 0.64 apart. A13's window was widened from +100 to +150 ms (severity 1 for the extra 50 ms).
- **Touch overshoot hits what lies beyond the touch from the player.** A finger that arrives from the player's side runs on up the screen. A touch on E3 followed 100 ms later by a tap on lane 2 was taken early 2% of the time with no overshoot, 15% at 0.05, 47% at 0.1, 73% at 0.2, 85% at 0.3 (finger pads; 33% to 92% for a wider pad). The tap on the touch's own lane drops instead (the finger left). B2 then lane 1 only reached 23% at 0.3. The new rule A17 flags a touch 30 to 150 ms before a tap whose sensor lies about 0.2 beyond it as seen from the player's side.
- **On real charts the effect is small.** With each skill level's overshoot against none, splash cost barely moves (beginner 1.44 against 1.39 points, advanced 0.37 against 0.35, expert 0.17 against 0.14). What overshoot adds is mostly taps on a slide's start lane and some end-lane collisions. A17 did not fire on 20 charts rated 14 and up: a touch followed within 150 ms by a tap in that geometry is rare.
- The direction assumes the hands rest at the bottom of the screen. A player who stands differently, or reaches from above, overshoots toward different sensors.

## Slides that are not drawn straight, and slide ends beside other notes (Oct 2026)
Two more hand settings: `wander` (a slow sideways drift of the slide finger off the drawn path, in ring radii) and `endSigma` (how far the last point lands off the end sensor). Skill ladder: beginner 0.12 down to top 0.015 for both.

Ring slide 1 to 5 with finger pads, a tap or hold head next to the end (lane 4 before, lane 6 after) at 0 to 150 ms after the slide ends, and a tap on lane 2 while the slide passes lane 3, for a straight path, an end that lands 0.08, 0.15 or 0.25 off, and a drift of 0.1 or 0.2:
- **No splash on the neighbouring lane**: 0% for every setting except 2 to 5% for the biggest end error (0.25) on the tap or hold on lane 6 and 5% on a hold on lane 4. The cost lands on the slide itself: its end is missed 8% of the time at 0.15 and 22% at 0.25, drift alone changes nothing.
- **Wide contacts with a sloppy path (drift 0.15, end 0.15)**: a slide finger of radius 0.09, 0.15, 0.2, 0.25, 0.3 splashes a tap on lane 6 0, 0, 2, 3, 7% of the time; a hold head on lane 6 the same; lane 4 0 to 5%; a tap beside the path while it passes 0%. With a perfect path all of these are 0.
- **A hold pressed anywhere else on the screen does not change a slide's grade.** A slide of one second is Perfect up to about 480 ms either way, so a hold finger finishing the last step a step early still gives Perfect.
- The reason is geometry: neighbouring A sensors are 0.64 of the ring radius apart (a D sensor sits between them), so a finger that is 0.15 off still falls on its own sensor or the gap.

Caveat that matters: this uses the sensor shapes as drawn (A wedges 30 degrees wide, D 15, tiled round the rim). If the game's real detection zones are wider than the drawn ones, or the panel reacts to a finger a little before it touches, a slide end beside a tap or hold would splash far more than shown here. The simulation cannot tell which; spots marked from the real game can.
