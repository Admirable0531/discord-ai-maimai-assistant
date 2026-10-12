# Playing as different kinds of players

Eight "personas" played 8 charts rated 14 and up (Titania, Apollo, Latent Kingdom, raputa, TEmPTaTiON, AMABIE, Aegisfortia, Straight into the lights), 10 runs each, through the simulated judging. Reproduce with the `fullPalm`, `fewFingers` and `offRhythm` presets in the viewer's simulation panel (unchecked by default) or the custom style editor. All numbers are inside the model.

| Persona | Perfect | Great | Good | Miss | Splash | Notes two hands could not reach |
|---|---|---|---|---|---|---|
| Finger pads, on rhythm | 97.2% | 0.6 | 0.4 | 1.9 | 0.8% | 0.7% |
| Whole palm everywhere (1 contact per hand) | 85.6 | 2.1 | 1.3 | 11.0 | 2.0 | 11.2 |
| Two fingers in all (finger pads) | 84.8 | 1.9 | 1.1 | 12.3 | 1.5 | 11.3 |
| One finger per hand on the buttons | 71.8 | 2.1 | 1.6 | 24.5 | 2.2 | 24.6 |
| Off rhythm (45 ms loose, 30 ms lean) | 65.2 | 23.1 | 6.5 | 5.2 | 2.7 | 0.4 |
| Whole palm + off rhythm | 55.1 | 19.6 | 6.4 | 18.9 | 4.0 | 15.2 |
| Two fingers + off rhythm | 54.2 | 19.5 | 6.1 | 20.2 | 3.5 | 15.1 |
| Palm, two fingers, off rhythm, dragging | 43.8 | 20.6 | 14.7 | 21.0 | 10.7 | 22.9 |

## What it shows
1. **Rhythm costs more than splash.** An off-rhythm player with ordinary fingers loses about a third of their Perfects (97% to 65%), almost all of it into Great and Good, because the tap window is only 50 ms for Perfect. Splash there stays at 2.7%.
2. **Few fingers or a palm mostly means missing notes, not splashing them.** About 11% of notes were out of reach of two hands with one contact each, 25% for one finger per hand on the buttons. Those become misses. Chart by chart, Aegisfortia is the hardest for a palm or two fingers (77% and 76% Perfect), AMABIE the easiest (92%).
3. **A big contact adds slide splash, not tap splash.** Counting notes with a 30% or higher chance of being hit early or blocked: slide-path splashes went from 1 (finger pads) to 27 (palm), against 6 for two fingers; touch contacts beside a tap showed up only for the palm and the sloppy dragging persona.
4. **Being off rhythm makes the "slide start lane" splash (A16) about twelve times more common** (20 notes for on-rhythm finger pads, 236 for off rhythm). A precise player who sets the slide off at exactly the right moment has the same overlap, but a loose one lands early and takes the next tap on that lane early. The same-lane jack pattern grows from 53 to 138 notes.
5. **Dragging fingers with a palm and loose timing is the worst case** (10.7% splash, mostly same-lane jacks at 849 notes and 289 slide-start-lane notes).

## Slide start lane in detail (a tap on the star's lane after the slide moves off)
Chance the tap is taken early by the finger that sets the slide off, by how loose the player is and how long after the slide start the tap comes:

| Timing | +0 ms | +30 | +60 | +100 | +150 |
|---|---|---|---|---|---|
| exact | 0% | 100 | 100 | 100 | 18 |
| tight (12 ms) | 0 | 70 | 100 | 100 | 2 |
| loose (45 ms) | 22 | 53 | 70 | 75 | 32 |
| loose with a 30 ms lean | 30 | 48 | 62 | 57 | 32 |

A precise player is always caught from 30 to 100 ms after the slide moves off (the finger lands before the tap's window starts); a loose player is caught less reliably but also at +0.

## Jacks and looseness
The share of two same-lane taps that are not both Perfect, at gaps from 60 to 250 ms: exact 0%, tight 12 ms 0 to 3%, loose 30 ms 3 to 18%, loose 45 ms 16 to 36%, loose 60 ms 36 to 48%. Above about 125 ms apart this is the player's own timing error, not splash; at 100 ms and below the extra comes from the second press being taken by the first note.

## What this suggests for the tips
- Slide-start-lane taps (A16): tell the player to release the star's sensor quickly or to set the slide off from the button side; looser players get it wrong more often, so the tip should not assume precision.
- Tell palm and two-finger players that dense passages are about reach first: the simulation says they cannot reach them rather than splash them.
- Rhythm accuracy, not splash, decides most of the score for a loose player; the finding text about splash should not be mistaken for that.
