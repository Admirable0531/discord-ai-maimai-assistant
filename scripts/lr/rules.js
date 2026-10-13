// Prints the readable tree (src/sim/handRules.json) as if-then rules in plain words.
//   node scripts/lr/rules.js > docs/hand-rules.md
const { treeRules } = require('../../src/sim/ml');
const model = require('../../src/sim/handRules.json');

const WORDS = {
    isTap: ['it is not a tap', 'it is a tap'],
    isHold: ['it is not a hold', 'it is a hold'],
    isTouch: ['it is not a touch note', 'it is a touch note'],
    isSlide: ['it is not a slide', 'it is a slide'],
    x: (op, v) =>
        `the note is ${op === '<=' ? 'left' : 'right'} of the screen centre (x ${op} ${v})`,
    y: (op, v) =>
        `the note is ${op === '<=' ? 'in the upper part' : 'in the lower part'} of the screen (y ${op} ${v})`,
    length: (op, v) => `it lasts ${op === '<=' ? 'at most' : 'more than'} ${v} s`,
    leftSince: (op, v) =>
        `the left hand last played ${op === '<=' ? 'within' : 'more than'} ${v} s ago`,
    rightSince: (op, v) =>
        `the right hand last played ${op === '<=' ? 'within' : 'more than'} ${v} s ago`,
    leftDist: (op, v) =>
        `the left hand is ${op === '<=' ? 'within' : 'more than'} ${v} ring radii from the note`,
    rightDist: (op, v) =>
        `the right hand is ${op === '<=' ? 'within' : 'more than'} ${v} ring radii from the note`,
    leftBusy: ['the left hand is free', 'the left hand is holding or sliding'],
    rightBusy: ['the right hand is free', 'the right hand is holding or sliding'],
    prevHand: (op, v) =>
        `the previous note was played by the ${op === '<=' ? 'left' : 'right'} hand (value ${v}; 0 left, 1 right)`,
    prev2Hand: (op, v) =>
        `the note two back was played by the ${op === '<=' ? 'left' : 'right'} hand (value ${v}; 0 left, 1 right)`,
    prevGap: (op, v) =>
        `the previous note was ${op === '<=' ? 'less than' : 'more than'} ${v} s earlier`,
    groupSize: (op, v) => `${op === '<=' ? 'at most' : 'more than'} ${Math.floor(v)} notes at once`,
    groupRank: (op, v) =>
        `its left-to-right position among notes at the same moment (0 leftmost, 1 rightmost) is ${op === '<=' ? 'at most' : 'more than'} ${v}`,
    starHand: (op, v) =>
        `the slide's star was tapped with the ${op === '<=' ? 'left' : 'right'} hand (${v})`,
    recentRight: (op, v) =>
        `the right hand played ${op === '<=' ? 'less' : 'more'} than ${Math.round(v * 100)}% of the last eight notes`,
};
const say = (c) => {
    const m = /^(\w+) (<=|>) (-?[\d.]+)$/.exec(c);
    const w = WORDS[m[1]];
    if (Array.isArray(w)) return w[m[2] === '<=' ? 0 : 1];
    return w(m[2], m[3]);
};

const rules = treeRules(model.forest[0]).sort((a, b) => b.n - a.n);
console.log('# The written hand rules\n');
console.log(
    `One decision tree distilled from the L. R. breakdown videos (${model.videos} videos, ${model.notes} training rows after correction rounds). Read each rule top to bottom: when every condition holds, the simulated player uses the hand named. "In ${'N'} situations" is how many training situations ended in that rule and the percentage is how often the human used that hand there.\n`
);
let i = 1;
for (const r of rules) {
    const hand = r.p > 0.5 ? 'RIGHT' : 'LEFT';
    const share = r.p > 0.5 ? r.p : 1 - r.p;
    console.log(
        `${i++}. **${hand} hand** (${Math.round(share * 100)}% of ${r.n} situations)\n   - ${r.when.map(say).join('\n   - ')}`
    );
}
