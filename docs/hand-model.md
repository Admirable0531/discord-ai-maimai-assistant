# Which hand takes a note: learned from real players

The simulated hands used to share notes by habits and dice (a habit mix, a hand-off tie-break, a chance of holding with the right hand). They now ask a model trained on how a real player split charts between hands.

## The data
The playlist "maimai手順分解 / おすすめ運指 / L.R. Breakdowns" (KT Sauna Room) has 21 videos, each the chart played in MajdataView with every note coloured by the hand that plays it (cyan the left hand, pink the right). `scripts/lr/` reads them:
- `capture.js` plays a video in a headless browser and records, for every frame, how much of each colour sits along each lane and on each touch sensor. YouTube only lets this player run about 45 seconds from a given start, so a video is read in stretches of 38 seconds, each loaded with its own start offset.
- `align.js` finds the offset between video and chart, then gives every tap, break, hold, touch and slide a hand colour from the colours seen where and when the note passes.
- `run.js` does this for the whole playlist and keeps only the per-note result in `data/lr/` (which is not in git). Nothing from the videos is kept besides that.
- `summary.js` prints how the hands share the work; `train.js`, `dagger.js` and `agree.js` train and check the model.

Result: 21 videos, 21,683 notes with a clear hand colour.

## What real play looks like (this player's breakdowns)
- Taps 48% left, 52% right; holds **80% right**; slides 49% left; touches 50% left.
- 21% of taps and touches are played by the hand on the other side of the screen (it varies from 12% to 36% by chart).
- A slide is set off by a different hand than the one that tapped its star 22% of the time, from 0% to 39% depending on the chart: it is decided by the situation, not by chance.
- 15% to 23% of taps during a slide still come from the sliding hand.
- Simultaneous notes are split between the hands 90% of the time, and when split the left note goes to the left hand 94% of the time.
- Consecutive taps within 0.6 s are on different hands 54% of the time.
- Share of each lane played by the left hand: lane 1 23%, 2 9%, 3 10%, 4 33%, 5 60%, 6 88%, 7 89%, 8 73%: the bottom lanes (4 and 5) are the shared ones.

## The model
For each note the inputs are what a player sees (`src/sim/handFeatures.js`): the kind of note and where it is, how long it lasts, for each hand how long since it last played, how far it has to travel and whether it is holding or sliding, which hand played the previous two notes, the gap to the previous note, how many notes arrive at once and this one's place left to right, which hand tapped a slide's star, and the share of the last eight notes played by the right hand. The answer is the hand. A forest of 12 bootstrap decision trees (depth 8) gives a probability, and the planner takes the more likely hand.

- **Held-out video, human situations**: 88.4% right across the 21 videos (each held out in turn), against 78.1% for "right half of the screen is the right hand" and 55.8% for alternating hands every note.
- **When it plays itself** the situations it reaches are not a person's any more (after one wrong hand its "what each hand did last" inputs are off), and its closed-loop agreement dropped to 77% on four held-out videos (PANDORA, Moon of Noon, 氷滅の135小節, World's end loneliness), where the rule-based habits get 76.1% and the simple side rule 76.6%.
- **DAgger** fixes that: the planner plays each training chart with the current model, the situations it reaches are labelled with the human's hand and added, and the forest is trained again. After 1, 2 and 3 rounds the held-out closed-loop agreement is 83.6%, 83.3% and 84.4%. The final model on all 21 videos (86,792 rows after 3 rounds) agrees with the human on 85.2% of notes when it plays (in-sample).
- Simulated players with the learned choice now match the videos on crossing (19% against 21%), hand-off (20% against 22%), simultaneous splits (84% against 90%), alternation (54% against 54%) and slide hand (50% against 51%). Holds on the right stay at 64% against 80%: the model does not capture how consistently this player holds with the right hand.

## Also changed because of the videos
Taking the video players' hand choices as feasible, the movement limits had to be loosened: with the old expert limits 14% of their choices looked unreachable. Expert is now 5 fingers, reach 2.0, speed 20, top 5 fingers, reach 2.2, speed 25, and a sliding hand has 1 (expert) or 2 (top) fingers free to tap (`slideFree`). With these, under 1% of the human choices are unreachable.

## Limits
- This is one player's suggested breakdowns on 21 hard charts (mostly Master 13 to Re:Master); other players, and easier charts, split differently. The model reproduces one habit; it is not the average of players.
- Only the hand is learned. Timing, aiming and overshoot are still set by hand; the videos do not show them.
- The colour to hand mapping assumes the colour that mostly plays the left side is the left hand.
- The hand model keeps whatever the planner's physical limits allow: if the model's choice looks late the note becomes late, and the learned choice is not overridden (`policy: 'rules'` in a custom style brings the old habits back).

## Readable rules instead of a forest (default)
A forest of 12 trees is accurate but cannot be read. The default policy, `logic`, uses **one** decision tree of five levels (about 30 if-then rules, listed in plain words in [hand-rules.md](hand-rules.md), regenerated by `node scripts/lr/rules.js`), trained the same way (including the correction rounds). Nothing in it is chance: a note's situation follows one path of explicit conditions (which side of the screen the note is on, how far each hand is from it, how long since each hand played, its place among notes at the same moment, what the last two notes did) to a hand. The percentage beside each rule is only how often the human used that hand in the situations that reached it.

| Choice | Held-out videos, human's own situations | Held-out videos, simulated player playing itself |
|---|---|---|
| Written rules (one tree, `logic`, default) | 84.4% (depth 4) to 86.6% (depth 5) | 81.5% |
| Forest of 12 trees (`learned`) | 88.4% | 84.4% |
| Earlier rule-based habits (`rules`) | n/a | 76.1% |
| "Right half of the screen is the right hand" | 78.1% | 76.6% |

A hand-written rule list (a busy hand cannot take anything, the left note of a pair goes left, a slide goes to the hand with fewer notes coming, fast runs alternate; `src/sim/handLogic.js`, checked by `scripts/lr/logic.js`) only reproduced the player's hand on 74.7% of notes: a hand holding or sliding still takes about 45% of notes near it (a hold uses one finger; a slide leaves 1 to 2 free), and "fast runs alternate" was right only 42% of the time. The rules learned from the data capture that better than I wrote them by hand, which is why the default uses them. The custom editor lets you choose `logic`, `learned` or the old `rules`.
