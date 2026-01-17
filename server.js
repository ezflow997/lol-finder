require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const { scoutPlayers, CONFIG, fromTotalLP, playerCache } = require('./scout.js');

// Set API key from environment variable
CONFIG.apiKey = process.env.RIOT_API_KEY || '';
if (!CONFIG.apiKey) {
    console.warn('Warning: RIOT_API_KEY not set in environment variables');
} else {
    console.log('API key loaded:', CONFIG.apiKey.substring(0, 10) + '...');
}

// Port from command line arg or environment variable, default 3000
const PORT = process.argv[2] || process.env.PORT || 3000;

// Store active SSE connections
let sseResponse = null;

// Override console.log to send to SSE
const originalLog = console.log;
console.log = (...args) => {
    originalLog(...args);
    if (sseResponse) {
        const message = args.join(' ');
        sseResponse.write(`data: ${JSON.stringify({ type: 'log', message })}\n\n`);
    }
};

// Function to send player found event
function sendPlayerFound(player) {
    if (sseResponse) {
        sseResponse.write(`data: ${JSON.stringify({ type: 'player', player })}\n\n`);
    }
}

// Function to send rate limit status
function sendRateLimit(isLimited, seconds) {
    originalLog(`[RateLimit] isLimited=${isLimited}, seconds=${seconds}, hasResponse=${!!sseResponse}`);
    if (sseResponse && !sseResponse.writableEnded) {
        try {
            const msg = `data: ${JSON.stringify({ type: 'ratelimit', isLimited, seconds })}\n\n`;
            originalLog(`[RateLimit] Sending: ${msg.trim()}`);
            sseResponse.write(msg);
            if (sseResponse.flush) sseResponse.flush();
        } catch (err) {
            originalLog('[RateLimit] Error sending:', err.message);
        }
    } else {
        originalLog('[RateLimit] Cannot send - response ended or null');
    }
}

// Export for use in scout.js
global.sendPlayerFound = sendPlayerFound;
global.sendRateLimit = sendRateLimit;

// Request handler
async function handleRequest(req, res) {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    // Serve the HTML UI
    if (url.pathname === '/' || url.pathname === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
        return;
    }

    // API: Set config (region only - API key is from environment)
    if (url.pathname === '/api/config' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            const data = JSON.parse(body);
            if (data.region) CONFIG.region = data.region;
            if (data.regionV5) CONFIG.regionV5 = data.regionV5;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        });
        return;
    }

    // API: Scout with SSE streaming
    if (url.pathname === '/api/scout') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'X-Accel-Buffering': 'no'
        });
        res.flushHeaders();
        if (res.socket) {
            res.socket.setNoDelay(true);
            res.socket.setKeepAlive(true);
        }

        sseResponse = res;

        const params = {
            lpRange: url.searchParams.get('lp') || null,
            tier: url.searchParams.get('tier') || 'GOLD',
            division: url.searchParams.get('division') || 'II',
            maxPlayers: parseInt(url.searchParams.get('max')) || 10,
            activeWithinMinutes: parseInt(url.searchParams.get('active')) || 30,
            queue: url.searchParams.get('queue') || null,
            minWinRate: url.searchParams.get('winrate') ? parseFloat(url.searchParams.get('winrate')) : 0
        };

        const queueParam = url.searchParams.get('queue');
        if (queueParam === 'solo') params.queue = 'RANKED_SOLO_5x5';
        else if (queueParam === 'flex') params.queue = 'RANKED_FLEX_SR';
        else params.queue = null;

        try {
            const results = await scoutPlayers(params);
            res.write(`data: ${JSON.stringify({ type: 'complete', results })}\n\n`);
        } catch (err) {
            res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
        }

        sseResponse = null;
        res.end();
        return;
    }

    // API: Get LP info
    if (url.pathname === '/api/lpinfo') {
        const lp = parseInt(url.searchParams.get('lp')) || 0;
        const info = fromTotalLP(lp);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(info));
        return;
    }

    // API: Test rate limit indicator (for debugging)
    if (url.pathname === '/api/test-ratelimit') {
        const seconds = parseInt(url.searchParams.get('seconds')) || 10;
        if (sseResponse && !sseResponse.writableEnded) {
            sendRateLimit(true, seconds);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: `Sent rate limit event for ${seconds}s` }));
        } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'No active SSE connection. Start a search first.' }));
        }
        return;
    }

    // API: Get cached players
    if (url.pathname === '/api/cache') {
        const cachedPlayers = Object.values(playerCache).map(p => ({
            ...p,
            lastActiveMinutes: p.lastActiveMinutes + Math.floor((Date.now() - p.cachedAt) / 60000),
            fromCache: true
        }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(cachedPlayers));
        return;
    }

    // 404
    res.writeHead(404);
    res.end('Not found');
}

// Create server
const server = http.createServer(handleRequest);

// Start server if running directly (not imported by Vercel)
if (require.main === module) {
    server.listen(PORT, () => {
        console.log(`\nLOL Finder UI running at http://localhost:${PORT}\n`);
    });
}

// Export for Vercel
module.exports = handleRequest;
