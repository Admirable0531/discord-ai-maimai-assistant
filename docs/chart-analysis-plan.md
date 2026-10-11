# Chart analysis: plan and rules (draft 1)

Goal: for a song and difficulty, list the parts a player should prepare for — where the
sensors can **splash** (trigger the wrong note), where the **rhythm or speed changes**, and
where a chart is **hard to read or easy to misaim** — each with a time, the notes involved
and a short tip.

Status legend used below: **[have]** verified in this repo or against live data,
**[need you]** needs your knowledge to be correct, **[risk]** known unknown.

---

## 1. Principles

1. **Code finds the spots, the model only words them.** Every finding comes from a rule
   below working on parsed chart data. The model never decides that something is a risk and
   never invents a tip: it rephrases findings and the tip text from the advice table.
2. **Every rule is data, not prose.** Each rule has an id, a definition, a threshold in one
   config file, and a severity, so you can change "within 120 ms" to "within 90 ms" without
   touching code.
3. **Report fewer, better.** Adjacent notes that never cause trouble are everywhere. Each
   finding gets a severity (1–3) and the output is capped (default: top 8 per chart, by
   severity, with the rest summarised as a count).
4. **Say what was not checked.** A chart missing from the source, a slide shape the
   geometry table doesn't cover, or a parse failure is reported, never silently skipped.

## 2. Data

| Piece | Source | State |
|---|---|---|
| Chart text (simai) per song and difficulty | simai wiki song page, e.g. `/simai/pages/1066.html` (MASTER / Re:MASTER / EXPERT… sections in the page HTML) | **[have]** read live; index page lists songs and which charts have data |
| Song metadata, constants, note counts | existing arcade-songs data in the bot | **[have]** |
| Parser | `simai.js` (npm) | **[risk]** parses each token I tried, but rejected one full chart with `ScopeMismatchException` (cause not yet found: my text extraction may have cut it). Fallback: our own tolerant tokenizer for the subset we need. |
| Sensor geometry | derived from coordinates (see §3) | **[need you]** to confirm |

Fetch rules: one wiki page per request, cached for a day, descriptive User-Agent, never
mirrored in bulk, and **chart text is never reposted in Discord** (fan transcriptions of
official charts: copyright grey area).

## 3. Chart model

Parsing turns the text into a time-ordered list of events:

- `t` seconds, `bar`, `beat` — from `(bpm)` and `{n}` (time per tick = 240 / (bpm × n) s).
  BPM changes mid-chart are applied.
- `kind`: tap, break, hold, touch, touch-hold, slide (star + path), each with ex/firework flags.
- `button` 1–8 for button notes; `area` (A1–A8, B1–B8, C, D1–D8, E1–E8) for touch notes.
- `duration` for holds and slides; slides also carry their **shape** (`-`, `^`, `<`, `>`, `v`,
  `p`, `q`, `pp`, `qq`, `s`, `z`, `V`, `w`), delay and travel time.
- Notes written on one tick (`/`, or digits written together like `17`) are simultaneous.

### Geometry

Facts below are from the Bilibili 判定全解 series (part 1 and 2, read in full) unless marked.

- The screen is divided into sensors **A, B, C, D, E**. A and B are aligned with the 8 outer
  buttons; **D and E sit one step counter-clockwise** of the same-numbered button direction; C is the
  centre. A sensor is either ON or OFF and the game does not care where in it you touch.
- An **activation** is OFF → ON. Touching a sensor from the air or sliding onto it from the
  side are the same event. Judged in 60 fps frames (16.67 ms).
- **Outer buttons and the screen are independent.** Pressing a button sends nothing to the
  screen's A sensor. A tap, hold or slide start can be hit by either the button or the screen's
  A sensor. (This matches what you said: a button press does not reach D or E.)
- **A sensor that is already ON cannot activate again** until it goes OFF. A resting finger on
  A1 means a second hand's tap on A1 does nothing.
- Slide paths are sequences of sensors (e.g. slide 1-5 passes A1, B1, C, B5, A5). Wifi (`w`)
  slides use D sensors for some of their end points.

Unresolved, to settle against a real cabinet or a screenshot (see questions):
- the article says the screen has 29 sensors, but its own description adds to 33, and another
  source counts 34 (C split in two in DX);
- "counter-clockwise of button N" does not obviously give your example (E5 just above A6).
  The geometry will come from measured coordinates, not hand-written adjacency.

---

## 4. Rules

Each rule: **what it flags**, **how it is detected**, **default thresholds** (all tunable),
**severity**. Unless noted, "near in time" means within `splash_window` (default 0.15 s,
**[need you]**).

### A. Splash risks (a sensor triggers something it shouldn't)

| Id | Rule | Detection | Severity |
|---|---|---|---|
| A1 | **Touch beside a button note** | a touch note on area X and a tap/break/hold-head on button n, near in time, with X within `touch_reach` of button n. Your example: `E5` against `A6` (button 6). Flagged in both directions: tapping the button too high triggers the touch, reaching for the touch triggers the button. | 3 if the same tick, 2 if within the window |
| A2 | **Touch beside a held button** | a hold on button n active while a touch lands within `touch_reach` of n (the resting finger can trigger it) | 2–3 |
| A3 | **Touch beside a touch** | two touch notes on areas within `touch_pair_reach` near in time; second one can be caught by the first finger | 2 |
| A4 | **Slide passing a note (slide → note)** | during a slide's travel, a tap/touch/hold-head appears on a sensor the slide path covers, or adjacent to it | 2–3 |
| A5 | **Note passing a slide (note → slide)** — the reverse of A4 | a tap or touch near a sensor that is the *next* arrow of an active slide, so hitting the note advances or ends the slide early | 2–3 |
| A6 | **Slide splashing slide** | two slides active together whose paths share or touch sensors (crossing, parallel and close, same destination) | 3 when paths cross within the window |
| A7 | **Slide end beside a note** | the slide's last sensors coincide with a note on the end button within the window | 2 |
| A8 | **Hold release beside a note** | a hold ending near in time to a note within `touch_reach` of its button (releasing can trigger it) | 1–2 |
| A9 | **Button-to-panel makikomi: adjacent-button trills and streams** | alternating or running notes on neighbouring buttons (4-5-4-5, 3-4-5-6) faster than `brush_speed` notes/s; the finger brushes the neighbour | 1–3 by speed and length |

**Revised after your correction and the new research** (these replace A1–A3 where they conflict):

| Id | Rule | Notes |
|---|---|---|
| A1 (revised) | **Touch on D / E / B next to a tap, hold-head or slide start on a button position within `splash_window`.** The hand reaching the touch can switch on the A sensor of the neighbouring position, and the tap is hit early (FAST GOOD). Your E5 / A6 case. | Direction: **touch zone → A sensor**, not button → D/E. Affects the screen hand for everyone, including button players, because the A sensor is also a way to hit a tap. |
| A13 | **Blocked activation.** A note on a sensor that a previous note left ON (a slide's last sensor, a held finger) within the window: the tap cannot activate until the sensor releases, so it is missed. | Documented mechanism: OFF → ON only |
| A14 | **Touch-group effects.** Simultaneous adjacent touches form a group; once more than half are judged, the rest take the same judgement. A group of 2 gets no benefit. | By design, so it is reported as information, not as a risk |
| A15 | **Touch cannot be early**, so touching a touch note's area before it appears is safe: used to *discount* A-direction findings where only a touch is involved | Documented |

**Pattern rules from player videos** (a pattern the player must recognise, not a mistake):

| Id | Pattern | Detection |
|---|---|---|
| C9 | **巻き込みスライド**: a tap lands on the same position as a slide start one beat after it (the guide star waits one beat before moving), so one hand takes the slide and the tap together | tap at position P at t + 1 beat, slide start at P at t |
| C10 | **Consecutive 巻き込みスライド**: this repeating, with slide starts replacing the taps; **alternating tap/slide** variants | C9 chained, with spacing of one beat |
| C11 | **Slide handoff needed (持ち替え)**: taking the slide start and then sliding with the same hand leaves the arms crossed for the next notes | needs a hand model (left/right assignment); phase 3 |
| C12 | **Slide end beside the next start**: a slide whose track passes close to the next slide's start or the next tap, so touching the track catches it | same idea as A10/A12, using track sensors |
| C13 | **End left uncleared / start caught** (the AP-only problems): sloppy tracing leaves the last sensor off or catches a nearby start | reported at lower severity unless the chart is being checked for AP |


### B. Rhythm and speed

| Id | Rule | Detection | Severity |
|---|---|---|---|
| B1 | **Subdivision change** | the note spacing changes by a non-trivial ratio between consecutive groups: 1/8 → 1/16, straight → triplet, 1/4 → 1/12; reports the bar where it changes and the ratio | 2 for any change, 3 for odd ratios (triplets against straight) |
| B2 | **BPM change** | any `(bpm)` change, with the new speed and whether notes are on grid after it | 1–2 |
| B3 | **Rest breaks** | a long gap inside a dense passage followed by an off-beat entry | 1–2 |
| B4 | **Burst** | local density above `burst_nps` over a short window (1.5 s, like simai-radar's density) | 1–3 by nps |
| B5 | **Jack** | the same button repeated faster than `jack_nps` | 2–3 |
| B6 | **Hand overload** | more than two simultaneous presses that cannot be split between two hands comfortably, or three-plus notes spread beyond one hand's reach | 2–3 |
| B7 | **Travel** | consecutive notes far apart in the ring in very little time (button 1 → 5 in 0.1 s), computed from sensor distance / time | 2 |
| B8 | **Sweep** | long runs across 5+ consecutive buttons at speed | 1–2 |

### C. Hard to read and easy to misaim

| Id | Rule | Detection | Severity |
|---|---|---|---|
| C1 | **Slide star hidden under notes** | a slide's star start shares a button with a tap/hold, or is drawn over other notes in the same window | 2 |
| C2 | **Overlapping slides** | two slides with overlapping on-screen paths and similar timing, hard to tell apart | 2–3 |
| C3 | **Delayed or uneven slide timing** | slide with a long delay or unusual travel fraction (`[8:1]` vs `[160#8:3]`), or two slides in a group with different timings | 2 |
| C4 | **Wifi and chained slides** | `w` fans and `*` chains, where the player has to read several tracks at once | 2 |
| C5 | **Touch lookalike positions** | consecutive touches on areas that are visually close (B vs E vs D) | 2 |
| C6 | **Touch while on buttons** | a touch note requiring the hand to leave the buttons with a tap within `leave_window` before or after | 2 |
| C7 | **Break among taps** | a break note within `break_window` of taps on neighbouring buttons (easy to hit the wrong one) | 1–2 |
| C8 | **Visual stack** | three or more different note types on the same or adjacent positions in one window | 1–2 |

---

## 5. What a finding looks like

```
MASTER  bar 31  00:52.4   A1 · severity 3
E5 touch lands 0.06 s after the tap on button 6.
Tapping button 6 too high also reaches E5 and splashes it.
Tip: <from the advice table>
```

- Every finding: rule id, time and bar, the notes involved (positions), severity, a plain
  sentence generated from the rule, and the tip.
- **Advice table**: one line per rule, in your words. Until you write one, the finding has
  no tip rather than a made-up one.
- Image: a card with the sensor map highlighting the areas involved, plus a timeline strip
  of the chart with severity markers (same renderer as the other cards, phone-width).

## 5b. All player types

The tool serves button players, screen players and mixed players, so **each finding carries
who it affects** and the tip says what to do for each:

| Style | What changes |
|---|---|
| Button | Buttons never reach the screen's sensors, so button → panel splash only happens when a hand rests on the panel. The risk is the *other* hand (touch notes, slides). Taps can often be moved to buttons to avoid A sensors. |
| Screen | Taps, holds and slide starts all use A sensors, so every neighbouring-sensor case applies; and slide-start / track overlap matters more. |
| Mixed | Both lists; the tip names which hand does what. |

Findings are risks ("could"), not certainties: technique such as 押しスライド changes which
sensors are actually touched.

## 6. Delivery

- `/chartcheck song difficulty` and a chat tool `analyze_chart` (same code).
- Sections: **Splash risks**, **Rhythm and speed**, **Reading and aim**, each capped.
- Source and "fan transcription, may differ from the game" line in the footer.
- If the song has no chart text on the wiki: say so, and fall back to note counts only.

## 7. Phases

| Phase | Work | Done when |
|---|---|---|
| 0 | Fetch and cache a wiki song page; parse it; settle the `simai.js` failure (or write our tokenizer) | "Straight into the lights" MASTER parses end to end with correct times |
| 1 | Chart model, geometry (note-only), rules A1–A3, A8–A9, B1–B8, C5–C8 | your `E5` / `A6` example is flagged as A1 |
| 2 | Calibration with you: 3–5 charts, you mark real tricky spots; I report what the rules caught and missed; tune thresholds and severities | rules catch the spots you marked, and the false-positive rate is tolerable |
| 3 | Slide geometry (13 shapes), rules A4–A7, C1–C4 | slide cases verified against charts you know |
| 4 | Output: command, tool, card, advice table | usable in Discord |
| 5 | Hardening: cache, rate limits, error messages, tests for the parser and every rule | |

Phases 2 and 3 are where your knowledge decides the result; I can build the rest.

## 8. What other players have documented (research, Oct 2026)

Sources are linked at the end. **Confirmed** = stated in a source I read in full;
**unconfirmed** = a search summary said it, but I could not find it on the page.
Video explanations (YouTube, Bilibili) are the part I could not read: the Bilibili
judgment series is behind a captcha for my tools, and I have no way to read video content.

**The community term is 巻き込み (makikomi, "getting caught in")**, defined in the Gamerch
glossary as: "when you hit one note, other notes' judgment also happens". It is described as
one of maimai's biggest sources of unwanted GOOD judgments. What I'd call "splash" is this.

Types and mechanics that are **confirmed**:

1. **Button → panel makikomi.** Pressing a button while the hand touches the panel sensors
   gives extra inputs. Most likely in fast vertical trills and "axis" patterns, and where
   the hand reaches outward. Fix players use: bend the wrist and press with upright fingers.
2. **Slide end → tap soon after.** If a tap comes shortly after a slide's endpoint, a slow
   release from the sensor catches the tap. Fix: finish the slide fast and lift off.
3. **Consecutive slides sharing a sensor (the Paranoia case).** One slide ends on sensor A2
   and the next slide starts on A2 within about 0.4 s. Touching A2 for the first slide's
   last sensor also hits the second slide's start early: a FAST GOOD. Fixes: skip a sensor on
   the first slide, hold the first start longer, or clear sensors a beat earlier.
4. **Chains of slide starts (button players).** Tapping the third slide start while sliding
   makes the adjacent sensor (A5) react and turns the fourth slide start into a GOOD. Fix:
   press third and later starts on the panel, not the button.
5. **Start and end points catching neighbouring slides.** Both ends of a slide can catch the
   slide next to them. Fix: use fingertips, not a flat hand.
6. **Rotation/flow catching nearby notes**: excessive sweeping during consecutive flows.
7. **Some patterns are unavoidable** for screen players because they were designed for
   buttons.

Slide judgment rules that are **confirmed** (they set the thresholds):

- The game watches sensors in 60 fps frames (16.67 ms).
- Slides move after one quarter-note beat from the star; they are cleared by touching the
  sensors on the path **in order**. **One skipped sensor is allowed, two in a row is not.**
  The last sensor disappears the instant it is touched; the earlier ones disappear when
  the finger leaves them.
- Base slide Critical Perfect window is ±233.33 ms, widened by an amount that depends on how long
  the star stays on the last sensor.
- 押しスライド (push slide): clear a slide by pressing sensors with the palm instead of tracing,
  using the skip rule. Players use it for reliability; it also means "which sensors
  does the player actually touch" depends on technique, so a rule can only say *could*.

**Unconfirmed**: that pressing B1 also activates E1 and E2 (and A with D). A search summary said
so; neither RemyWiki ("E sensors are added between A and B sensors") nor the Australian
guide states it. I would not encode it until you confirm it. Also unconfirmed for DX specifically:
exactly which sensors a button press reaches. Players describe the layout as C (split into C1 and C2
in DX), 8 A, 8 B, 8 D (between the A sensors) and 8 E (between the A and B layers); the game has an
option that draws the sensor borders during play (design settings → judgment line design →
"sensor"), which would be a way to check the geometry on a real cabinet.

### Update (after Bilibili articles and YouTube transcripts)

What I can read: **Bilibili articles** (yes: the full 判定全解 parts 1 and 2), **YouTube
transcripts** (yes, the spoken audio as auto-captions, noisy and without the screen), **Bilibili
videos** (no: its video and subtitle APIs are blocked for me). So a spoken tip ("watch the end
of this slide") reaches me, but "this part here" without a timestamp does not.

From the videos (a series on 巻き込みスライド, and a 超神 player's avoid-the-makikomi guide):

- **The one-beat rule is the key to 巻き込みスライド.** The guide star waits one beat before it
  moves, so a tap that arrives on the slide's start position one beat later can be taken by the
  same hand while sliding. Keep the rhythm: slides are done on one-beat spacing.
- Technique advice that recurs: don't trace outside the slide, take care with the end point, finish
  tracing the slide properly, and use 持ち替え (let go after the start, finish with the other hand)
  to avoid crossed arms; choose it by what comes **next**, not by the slide itself.
- For non-AP play, watch slide **end points**; for AP, also watch not catching the next **start
  points** (視点を巻き込む). The slide before the last may skip one sensor.
- Practice charts players name for each pattern are listed in the transcripts (useful later for
  "see also").

### Changes to the rules this research suggests

| Change | Why |
|---|---|
| **New A10: consecutive slides sharing a sensor** (end of one = start of next within ~0.4 s) | The clearest documented case, with real numbers (Paranoia, A2) |
| **New A11: slide end → tap shortly after** | Documented; needs the slide's last sensors and a short window |
| **New A12: slide start chain next to an active slide's sensor** | Documented for button players (A5 example) |
| A9 renamed **button → panel makikomi**; severity weighted toward fast trills and axis patterns, outward reach | Documented |
| A4–A6 (slides touching notes and slides) implemented from the sensor sequence, using the skip rule so "one skipped sensor" alternatives are shown in the tip | Documented |
| Each finding says **who it affects**: button players, screen players, both | Several documented cases are for one style only |
| Use ±233 ms as the slide scale, and ~0.4 s as the first slide-to-slide window, instead of a blanket 0.15 s | From the sources |
| Tips can cite the community fixes above as defaults (skip a sensor, lift off fast, press starts on the panel) but you decide which to show | Written by players, not invented |

### What the sources do not cover

- **Touch notes beside buttons** (your E5 / A6 case). I found no write-up of it. The community
  words for it are 巻き込み and 画面→ボタン, but the written sources describe tap/tap,
  button/panel and slide cases. So A1 rests on your experience and on measuring the sensors,
  not on a source.
- **Rhythm-change and "hard to read" sections.** Nothing structured; the terms are 縦連 (same
  button, short intervals), 乱打 (continuous taps that fit no other pattern), ウミユリ配置
  (requires hand independence; not defined in what I read). These stay as my own rules (B and C)
  for you to calibrate.

Sources: [Gamerch glossary](https://gamerch.com/maimai/533406) ·
[maimaiメモ② 巻き込み その1](https://watashiharobotdewaarimasen.hatenablog.com/entry/2020/10/09/153826) ·
[Paranoia and slide makikomi (kougen)](https://note.com/kougen_gl/n/n15ac26fd410f) ·
[How MaiMai DX judges slides (donmai)](https://listed.to/@donmai/44545/how-maimai-dx-judges-slides) ·
[押しスライド概論](https://welldefined99.hatenablog.com/entry/maimai-advent-2020) ·
[画面勢の上達方法 (yoshika)](https://note.com/yoshika19/n/n0e4845d1c638) ·
[RemyWiki: DX changes (sensors)](https://silentblue.remywiki.com/maimai_DX:1st/Changes) ·
[Maimai DX Guide (Australia)](https://docs.google.com/document/d/1gQlxtxOj-E3H2SClJH5PNxLnG6eBufDFrw2yLsffbp0/mobilebasic)

---

## 8b. Rules from your experience (not found in any source)

These come from you. The sources I read document the mechanism behind some of them but not the
cases themselves, so they are marked **[you]** and need chart examples to calibrate.

| Id | Rule | Detection | Backed by |
|---|---|---|---|
| A16 | **Swipe (流し) catching the other input.** A run of consecutive adjacent taps sweeping around the ring: with the screen, the hand can catch a button edge (GOOD); with buttons, the hand can touch the A sensors (GOOD). Also any tap or slide start **right after** the sweep on a position the hand just passed. | ≥ `swipe_len` taps on neighbouring positions at ≥ `swipe_nps`; then notes within one beat on positions covered by the sweep | **[you]**; the sources only document flow catching nearby notes in general, and the button → panel direction |
| A17 | **Slide speed and the note behind it.** The longer a slide stays active, the longer a neighbouring note can splash it or be splashed; a very fast slide invites overshooting. | slide duration from `[n:m]`; list the notes on or beside its track sensors while it is active | **[you]** (the timing window itself is documented) |
| A18 | **Overshoot: only the end left, then a screen note beside it.** The last sensor clears the instant it is touched, so a screen touch (a tap, a touch note) next to the end sensor while the slide is still unfinished can clear it early (FAST). | a screen note within `touch_reach` of the slide's last sensor, in the last part of the slide | mechanism documented (last sensor clears when touched); the case is **[you]** |
| C3 (expanded) | **Slide timing changes.** A slide with a long delay, a different duration from the slides beside it, or timing that changes mid-chart. | `[n:m]`, `[bpm#n:m]` and delays compared between simultaneous slides and with the surrounding notes | partly documented (the star waits one beat; some charts delay it a long time) |

### Worked example: Titania MASTER ending (from the simai wiki page)

```
{32}8b,7,6,5,4,3,2,1,8,7,6,5,4,3,2,1,{4}4v1[8:1]/8v5[8:1],
{16}4bp2[4:11]/8bp6[4:11],Cf,...
```

- The sweep is **16 taps around the ring (8 → 1, twice) at 1/32 notes**. At the chart's only BPM
  mark (212) that is a tap every **35 ms, about 28 a second**.
- Straight after it, slides start on **positions 4 and 8**, both positions the sweep has just
  passed. That is A16: the swiping hand is still near them. Whether the sweep is done with the
  screen or the buttons decides which splash applies.
- It becomes the first test case for A16 alongside E5 / A6 for A1.

## 9. Questions for you (these set the rules)

1. Your correction is recorded (touch D/E/B → A, not button → D/E). Can you screenshot the in-game **sensor display** (design settings → judgment line design → "sensor") with a touch note showing? That settles the geometry (E5 / A6, the 29-vs-33-vs-34 count) from a real picture. Start with E5 / A6 — which others do you
   know are dangerous (D? B? C?), and in which direction (tap-high triggers touch, or the
   reverse)?
2. How close in time is a touch/button splash? The slide cases have numbers (about 0.4 s for slide-to-slide); the touch/button case has none, so 0.15 s is still a guess.
3. Does a **resting finger on a hold** count the same as a tap for A2?
4. For slides: which pairs do you know splash (slide → note, note → slide, slide ↔ slide)?
   Any shapes that are always dangerous (`w`, `V`, `pp`/`qq`)?
5. What counts as "hard to read" for you — slides only, or also dense taps with breaks?
6. Do you want Re:MASTER and EXPERT too, or MASTER and Re:MASTER only?
7. STD charts have no touch notes: skip A1–A3, C5–C6 there?
8. Who writes the advice table — you, in your words, or me drafting for you to correct?
9. Can you give 3–5 charts where you already know the tricky spots, including "Straight
   into the lights" MASTER?

---

## 9. Cross-check against majdata (Oct 2026)

I read MajdataPlay's slide judging tables (`SlideTables.cs`) as a reference. It is GPL-3.0,
so nothing was copied: only facts (which sensors each shape passes, geometry constants) were
used, and the code here is independently written.

- **Sensor path table verified.** Every shape in `slidePaths.js` (straight `-`, centre `v`,
  reflect `V`, zigzag `s`/`z`, inner loop `p`/`q` including the long way round, outer loop
  `pp`/`qq`) matches majdata's judge queue row for row, once mirrored for direction. This
  closes the "check the TRG transcription" item.
- **Geometry constants** used by the viewer: inner-loop circle radius = R·cos(3π/8) ≈ 0.383R,
  entered and left along tangents from the buttons; outer-loop circles radius ≈ 0.462R.
- **Slide arrow fade is the game's own behaviour**: arrows fade in to 50% opacity over about
  0.2 s, then jump to full opacity 50 ms before the star lands. The viewer now does the same.
