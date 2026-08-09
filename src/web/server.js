const express = require('express');
const logger = require('../utils/logger');
const { getUsageSummary } = require('../database/repositories/usageRepository');

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

    const server = app.listen(port, () => {
        logger.info('web', `HTTP server listening on port ${port}`);
    });

    return server;
}

module.exports = { startServer };
