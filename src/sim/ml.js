// Small, dependency-free learners used to study the simulation: a classification
// tree (readable as rules), ridge regression, and a seeded random number source.

/** Seeded random numbers (mulberry32). */
function random(seed) {
    let s = seed >>> 0 || 1;
    const next = () => {
        s += 0x6d2b79f5;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
        next,
        uniform: (a, b) => a + (b - a) * next(),
        logUniform: (a, b) => Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * next()),
        int: (a, b) => a + Math.floor(next() * (b - a + 1)),
        pick: (list) => list[Math.floor(next() * list.length)],
    };
}

const gini = (pos, n) => (n === 0 ? 0 : 2 * (pos / n) * (1 - pos / n));

/**
 * Classification tree on numeric features. rows: [{x: number[], y: 0|1, w?: weight}].
 * Returns a tree {leaf, p, n} or {feature, threshold, left, right, gain}.
 */
function fitTree(rows, { depth = 5, minLeaf = 40, features }) {
    const importance = new Array(features.length).fill(0);
    const total = rows.reduce((a, r) => a + (r.w || 1), 0);
    function build(idx, d) {
        let n = 0;
        let pos = 0;
        for (const i of idx) {
            const w = rows[i].w || 1;
            n += w;
            pos += w * rows[i].y;
        }
        const node = { leaf: true, p: n ? pos / n : 0, n: idx.length };
        if (d >= depth || idx.length < 2 * minLeaf || pos === 0 || pos === n) return node;
        let best = null;
        const parent = gini(pos, n);
        for (let f = 0; f < features.length; f++) {
            const sorted = idx.slice().sort((a, b) => rows[a].x[f] - rows[b].x[f]);
            let ln = 0;
            let lp = 0;
            for (let k = 0; k < sorted.length - 1; k++) {
                const r = rows[sorted[k]];
                const w = r.w || 1;
                ln += w;
                lp += w * r.y;
                const a = r.x[f];
                const b = rows[sorted[k + 1]].x[f];
                if (a === b || k + 1 < minLeaf || sorted.length - k - 1 < minLeaf) continue;
                const rn = n - ln;
                const rp = pos - lp;
                const gain = parent - (ln / n) * gini(lp, ln) - (rn / n) * gini(rp, rn);
                if (!best || gain > best.gain) best = { f, t: (a + b) / 2, gain, at: k };
            }
        }
        if (!best || best.gain < 1e-4) return node;
        importance[best.f] += best.gain * (n / total);
        const left = [];
        const right = [];
        for (const i of idx) (rows[i].x[best.f] <= best.t ? left : right).push(i);
        return {
            feature: features[best.f],
            threshold: best.t,
            gain: best.gain,
            p: node.p,
            n: idx.length,
            left: build(left, d + 1),
            right: build(right, d + 1),
        };
    }
    const tree = build(
        rows.map((_, i) => i),
        0
    );
    return { tree, importance: Object.fromEntries(features.map((f, i) => [f, importance[i]])) };
}

/** The leaves of a tree as readable rules: [{when: ['gap > 0.04', ...], p, n}]. */
function treeRules(tree, trail = []) {
    if (tree.leaf) return [{ when: trail, p: tree.p, n: tree.n }];
    const t = Math.round(tree.threshold * 1000) / 1000;
    return [
        ...treeRules(tree.left, [...trail, `${tree.feature} <= ${t}`]),
        ...treeRules(tree.right, [...trail, `${tree.feature} > ${t}`]),
    ];
}

function predict(tree, x, features) {
    let node = tree;
    while (!node.leaf)
        node = x[features.indexOf(node.feature)] <= node.threshold ? node.left : node.right;
    return node.p;
}

/** Ridge regression of y on standardised columns. Returns coefficients per feature and r2. */
function ridge(X, y, names, lambda = 1) {
    const n = X.length;
    const k = names.length;
    const mean = new Array(k).fill(0);
    const sd = new Array(k).fill(0);
    for (const row of X) row.forEach((v, j) => (mean[j] += v / n));
    for (const row of X) row.forEach((v, j) => (sd[j] += (v - mean[j]) ** 2 / n));
    sd.forEach((v, j) => (sd[j] = Math.sqrt(v) || 1));
    const my = y.reduce((a, b) => a + b, 0) / n;
    const Z = X.map((row) => row.map((v, j) => (v - mean[j]) / sd[j]));
    // (Z'Z + lambda I) b = Z'(y - my)
    const A = Array.from({ length: k }, () => new Array(k).fill(0));
    const b = new Array(k).fill(0);
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < k; j++) {
            b[j] += Z[i][j] * (y[i] - my);
            for (let l = 0; l < k; l++) A[j][l] += Z[i][j] * Z[i][l];
        }
    }
    for (let j = 0; j < k; j++) A[j][j] += lambda;
    // Gaussian elimination
    for (let c = 0; c < k; c++) {
        let p = c;
        for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
        [A[c], A[p]] = [A[p], A[c]];
        [b[c], b[p]] = [b[p], b[c]];
        for (let r = c + 1; r < k; r++) {
            const f = A[r][c] / A[c][c];
            for (let l = c; l < k; l++) A[r][l] -= f * A[c][l];
            b[r] -= f * b[c];
        }
    }
    const coef = new Array(k).fill(0);
    for (let c = k - 1; c >= 0; c--) {
        let v = b[c];
        for (let l = c + 1; l < k; l++) v -= A[c][l] * coef[l];
        coef[c] = v / A[c][c];
    }
    let ss = 0;
    let st = 0;
    for (let i = 0; i < n; i++) {
        const pred = my + Z[i].reduce((a, v, j) => a + v * coef[j], 0);
        ss += (y[i] - pred) ** 2;
        st += (y[i] - my) ** 2;
    }
    return {
        coef: Object.fromEntries(names.map((nm, j) => [nm, coef[j]])),
        r2: st ? 1 - ss / st : 0,
    };
}

/** A bag of trees on bootstrap samples: the mean of their probabilities is smoother than one tree's. */
function fitForest(rows, { trees = 15, seed = 7, ...options }) {
    const r = random(seed);
    const out = [];
    for (let i = 0; i < trees; i++) {
        // one tree is fitted on all the data, so it can be read as a list of rules
        if (trees === 1) {
            out.push(fitTree(rows, options).tree);
            break;
        }
        const sample = [];
        for (let k = 0; k < rows.length; k++) sample.push(rows[Math.floor(r.next() * rows.length)]);
        out.push(fitTree(sample, options).tree);
    }
    return out;
}
const predictForest = (forest, x, features) =>
    forest.reduce((a, t) => a + predict(t, x, features), 0) / forest.length;

module.exports = { random, fitTree, treeRules, predict, ridge, fitForest, predictForest };
