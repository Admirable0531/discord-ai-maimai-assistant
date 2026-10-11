const express = require('express');
const logger = require('../utils/logger');
const { getUsageSummary } = require('../database/repositories/usageRepository');
const { getChartText } = require('../chart/simaiWiki');
const { buildChart } = require('../chart/chartModel');
const { analyse } = require('../chart/rules');
const { buildViewerHtml } = require('../chart/viewerPage');

const DIFFICULTIES = ['basic', 'advanced', 'expert', 'master', 'remaster'];
const escapeHtml = (v) =>
    String(v).replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );

function chartForm(message = '', values = {}) {
    const options = DIFFICULTIES.map(
        (d) =>
            `<option value="${d}"${d === (values.difficulty || 'master') ? ' selected' : ''}>${d}</option>`
    ).join('');
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chart check</title>
<style>body{font:16px system-ui,sans-serif;margin:0;padding:16px;max-width:520px;margin:auto}input,select,button{font:inherit;padding:10px;width:100%;margin-top:8px;box-sizing:border-box}.msg{color:#b3261e;margin-top:12px}</style></head>
<body><h2>Chart check</h2><form action="/chart" method="get">
<input name="song" placeholder="Exact song title, e.g. Titania" value="${escapeHtml(values.song || '')}" required>
<select name="difficulty">${options}</select>
<select name="type"><option value="dx">DX</option><option value="std"${values.type === 'std' ? ' selected' : ''}>Standard</option></select>
<button>Open chart</button></form><div class="msg">${escapeHtml(message)}</div></body></html>`;
}

function startServer(port) {
    const app = express();

    app.get('/health', (req, res) => {
        res.json({ status: 'ok' });
    });

    app.get('/api/ai-usage', (req, res) => {
        try {
            const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
            res.json(getUsageSummary(days));
        } catch (err) {
            logger.error('web', 'GET /api/ai-usage failed', err);
            res.status(500).json({ error: String(err) });
        }
    });

    // Chart viewer for the local network: /chart?song=Titania&difficulty=master&type=dx
    app.get('/chart', async (req, res) => {
        const song = String(req.query.song || '')
            .trim()
            .slice(0, 120);
        const difficulty = DIFFICULTIES.includes(req.query.difficulty)
            ? req.query.difficulty
            : 'master';
        const type = req.query.type === 'std' ? 'std' : 'dx';
        if (!song) return res.type('html').send(chartForm());
        try {
            const found = await getChartText(song, difficulty, type);
            if (!found.success) {
                const hint = found.available?.length
                    ? ` Charts the wiki has: ${found.available.join(', ')}.`
                    : '';
                return res
                    .status(404)
                    .type('html')
                    .send(chartForm(found.error + hint, { song, difficulty, type }));
            }
            const chart = buildChart(found.text);
            res.type('html').send(
                buildViewerHtml({
                    title: found.title,
                    difficulty,
                    events: chart.events,
                    finish: chart.finish,
                    findings: analyse(chart),
                })
            );
        } catch (err) {
            logger.error('web', 'GET /chart failed', err);
            res.status(500)
                .type('html')
                .send(
                    chartForm(`Could not build that chart (${err.message}).`, {
                        song,
                        difficulty,
                        type,
                    })
                );
        }
    });

    const server = app.listen(port, () => {
        logger.info('web', `HTTP server listening on port ${port}`);
    });

    return server;
}

module.exports = { startServer };
