/**
 * League of Legends Player Scout / Duo Finder
 *
 * Finds recently active ranked players within a target rank range.
 * Riot API Docs: https://developer.riotgames.com/apis
 */

const fs = require('fs');
const path = require('path');

const CONFIG = {
    apiKey: process.env.RIOT_API_KEY || '', // Set via environment variable
    region: 'na1',               // Platform: na1, euw1, kr, etc.
    regionV5: 'americas',        // Match-V5 routing: americas, europe, asia
    rateLimit: {
        requestsPerSecond: 20,
        requestsPer2Minutes: 100
    }
};

// ============ PLAYER CACHE SYSTEM ============
const CACHE_FILE = path.join(__dirname, 'player_cache.json');
const CACHE_MAX_AGE = 60 * 60 * 1000; // 1 hour max age for cached data

let playerCache = {};

// Load cache from file
function loadCache() {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const data = fs.readFileSync(CACHE_FILE, 'utf8');
            playerCache = JSON.parse(data);
            console.log(`📦 Loaded ${Object.keys(playerCache).length} cached players`);
        }
    } catch (err) {
        console.error('Error loading cache:', err.message);
        playerCache = {};
    }
}

// Save cache to file
function saveCache() {
    try {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(playerCache, null, 2));
    } catch (err) {
        console.error('Error saving cache:', err.message);
    }
}

// Get cached player data
function getCachedPlayer(puuid) {
    const cached = playerCache[puuid];
    if (!cached) return null;

    // Check if cache is too old (over 1 hour)
    const age = Date.now() - cached.cachedAt;
    if (age > CACHE_MAX_AGE) {
        return null;
    }

    return cached;
}

// Check if cached player meets current search criteria
function cachedPlayerMeetsCriteria(cached, options) {
    const { activeWithinMinutes, minWinRate, minLP, maxLP } = options;

    // Calculate how long ago they were active based on cached time
    const cachedAge = Date.now() - cached.cachedAt;
    const adjustedActiveMinutes = cached.lastActiveMinutes + Math.floor(cachedAge / 60000);

    // Check if still within active time window
    if (adjustedActiveMinutes > activeWithinMinutes) {
        return false;
    }

    // Check win rate
    const winRate = cached.wins / (cached.wins + cached.losses);
    if (winRate < minWinRate) {
        return false;
    }

    // Check LP range if specified
    if (minLP !== null && maxLP !== null) {
        if (cached.totalLP < minLP || cached.totalLP > maxLP) {
            return false;
        }
    }

    return true;
}

// Update cache with player data
function cachePlayer(player) {
    playerCache[player.puuid] = {
        ...player,
        cachedAt: Date.now()
    };
    // Save periodically (every 10 new entries)
    if (Object.keys(playerCache).length % 10 === 0) {
        saveCache();
    }
}

// Initialize cache on load
loadCache();

// Simple rate limiter
class RateLimiter {
    constructor(requestsPerSecond) {
        this.minDelay = 1000 / requestsPerSecond;
        this.lastRequest = 0;
    }

    async wait() {
        const now = Date.now();
        const elapsed = now - this.lastRequest;
        if (elapsed < this.minDelay) {
            await this.sleep(this.minDelay - elapsed);
        }
        this.lastRequest = Date.now();
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

const rateLimiter = new RateLimiter(CONFIG.rateLimit.requestsPerSecond);

// Store current results for display on rate limit
let currentResults = [];

// LP conversion system
// Each tier = 400 LP, each division = 100 LP
const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND'];
const DIVISIONS = ['IV', 'III', 'II', 'I'];

/**
 * Convert tier + division + LP to total LP
 * e.g., SILVER IV 50 LP = 800 + 0 + 50 = 850
 */
function toTotalLP(tier, division, lp = 0) {
    const tierIndex = TIERS.indexOf(tier.toUpperCase());
    if (tierIndex === -1) return null;
    const divIndex = DIVISIONS.indexOf(division.toUpperCase());
    if (divIndex === -1) return null;
    return tierIndex * 400 + divIndex * 100 + lp;
}

/**
 * Convert total LP to tier + division + LP
 * e.g., 850 = { tier: 'SILVER', division: 'IV', lp: 50 }
 */
function fromTotalLP(totalLP) {
    if (totalLP < 0) return { tier: 'IRON', division: 'IV', lp: 0 };
    if (totalLP >= TIERS.length * 400) {
        return { tier: 'MASTER', division: 'I', lp: totalLP - TIERS.length * 400 };
    }
    const tierIndex = Math.floor(totalLP / 400);
    const remainder = totalLP % 400;
    const divIndex = Math.floor(remainder / 100);
    const lp = remainder % 100;
    return {
        tier: TIERS[tierIndex],
        division: DIVISIONS[divIndex],
        lp
    };
}

/**
 * Get all tier/division combinations within an LP range
 */
function getTierDivisionsInRange(minLP, maxLP) {
    const results = [];
    for (let tierIdx = 0; tierIdx < TIERS.length; tierIdx++) {
        for (let divIdx = 0; divIdx < DIVISIONS.length; divIdx++) {
            const tierStart = tierIdx * 400 + divIdx * 100;
            const tierEnd = tierStart + 99;
            // Check if this division overlaps with our range
            if (tierEnd >= minLP && tierStart <= maxLP) {
                results.push({ tier: TIERS[tierIdx], division: DIVISIONS[divIdx] });
            }
        }
    }
    return results;
}

/**
 * Make a rate-limited API request
 */
async function apiRequest(url) {
    await rateLimiter.wait();
    
    const response = await fetch(url, {
        headers: {
            'X-Riot-Token': CONFIG.apiKey
        }
    });

    if (!response.ok) {
        const error = {
            status: response.status,
            statusText: response.statusText,
            url: url
        };

        console.log(`[API Error] Status: ${response.status} - ${response.statusText}`);
        console.log(`[API Error] URL: ${url}`);
        console.log(`[API Error] API Key present: ${!!CONFIG.apiKey}, starts with: ${CONFIG.apiKey ? CONFIG.apiKey.substring(0, 10) : 'none'}`);

        if (response.status === 403) {
            throw new Error('API Key invalid or expired. Please get a new key from developer.riotgames.com');
        }

        if (response.status === 429) {
            console.warn('\n\n⚠️  Rate limited! Waiting 2 minutes...');

            // Notify UI of rate limit
            if (global.sendRateLimit) {
                global.sendRateLimit(true, 120);
            }

            if (currentResults.length > 0) {
                console.log(`\n📋 Results so far (${currentResults.length} players):\n`);
                for (const p of currentResults) {
                    console.log(`  ${p.name} | ${p.queue} ${p.rank} ${p.lp}LP | ${p.winRate} WR | Last seen ${p.lastActiveMinutes}m ago (${p.lastGameMode})`);
                }
                console.log('\n⏳ Resuming search after rate limit...\n');
            }

            await rateLimiter.sleep(120000);

            // Notify UI rate limit ended
            if (global.sendRateLimit) {
                global.sendRateLimit(false, 0);
            }

            return apiRequest(url); // Retry
        }
        
        throw new Error(`API Error: ${JSON.stringify(error)}`);
    }

    return response.json();
}

/**
 * Get ranked players from a specific tier/division
 * Returns array of league entries with summonerId, rank info, etc.
 */
async function getLeagueEntries(queue, tier, division, page = 1) {
    const url = `https://${CONFIG.region}.api.riotgames.com/lol/league-exp/v4/entries/${queue}/${tier}/${division}?page=${page}`;
    return apiRequest(url);
}

/**
 * Get summoner info (including PUUID) from summoner ID
 */
async function getSummonerById(summonerId) {
    const url = `https://${CONFIG.region}.api.riotgames.com/lol/summoner/v4/summoners/${summonerId}`;
    return apiRequest(url);
}

/**
 * Get summoner by Riot ID (gameName + tagLine)
 */
async function getSummonerByRiotId(gameName, tagLine) {
    const url = `https://${CONFIG.regionV5}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
    return apiRequest(url);
}

/**
 * Get Riot ID (gameName + tagLine) from PUUID
 */
async function getRiotIdByPuuid(puuid) {
    const url = `https://${CONFIG.regionV5}.api.riotgames.com/riot/account/v1/accounts/by-puuid/${puuid}`;
    return apiRequest(url);
}

/**
 * Get recent match IDs for a player
 * queue: 420 = Solo/Duo, 440 = Flex, null = any game mode
 */
async function getMatchIds(puuid, count = 5, queue = null) {
    let url = `https://${CONFIG.regionV5}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?count=${count}`;
    if (queue) {
        url += `&queue=${queue}`;
    }
    return apiRequest(url);
}

/**
 * Get full match details
 */
async function getMatchDetails(matchId) {
    const url = `https://${CONFIG.regionV5}.api.riotgames.com/lol/match/v5/matches/${matchId}`;
    return apiRequest(url);
}

/**
 * Check how recently a player was active (any game mode)
 * Returns { minutesAgo, gameMode } or null if no recent games
 */
async function getLastActiveMinutes(puuid) {
    try {
        const matchIds = await getMatchIds(puuid, 1, null); // null = any game mode

        if (!matchIds || matchIds.length === 0) {
            return null;
        }

        const match = await getMatchDetails(matchIds[0]);
        const gameEndTime = match.info.gameEndTimestamp;
        const now = Date.now();
        const minutesAgo = Math.floor((now - gameEndTime) / 60000);
        const gameMode = match.info.gameMode; // CLASSIC, ARAM, TUTORIAL, etc.
        const queueId = match.info.queueId;

        return { minutesAgo, gameMode, queueId };
    } catch (err) {
        console.error(`Error checking activity for ${puuid}:`, err.message);
        return null;
    }
}

/**
 * Extract useful stats from a match for a specific player
 */
function extractPlayerStats(match, puuid) {
    const participant = match.info.participants.find(p => p.puuid === puuid);
    
    if (!participant) return null;

    return {
        win: participant.win,
        kills: participant.kills,
        deaths: participant.deaths,
        assists: participant.assists,
        kda: participant.deaths === 0 
            ? (participant.kills + participant.assists) 
            : ((participant.kills + participant.assists) / participant.deaths).toFixed(2),
        champion: participant.championName,
        position: participant.teamPosition,
        cs: participant.totalMinionsKilled + participant.neutralMinionsKilled,
        gameDuration: Math.floor(match.info.gameDuration / 60),
        gameEndTime: new Date(match.info.gameEndTimestamp).toLocaleString()
    };
}

/**
 * Main scouting function
 * Finds recently active players in a rank range
 *
 * Options:
 *   lpRange: "800-1000" - search by total LP range (overrides tier/division)
 *   tier/division: fallback if lpRange not provided
 *
 * LP Reference:
 *   Iron: 0-399, Bronze: 400-799, Silver: 800-1199
 *   Gold: 1200-1599, Platinum: 1600-1999, Emerald: 2000-2399
 *   Diamond: 2400-2799
 *   Within tier: IV=0-99, III=100-199, II=200-299, I=300-399
 */
async function scoutPlayers(options = {}) {
    const {
        queue = null, // null = search both Solo/Duo and Flex
        tier = 'GOLD',
        division = 'II',
        lpRange = null,
        maxPlayers = 10,
        activeWithinMinutes = 30,
        minWinRate = 0
    } = options;

    // Determine which queues to search
    const queuesToSearch = queue
        ? [queue]
        : ['RANKED_SOLO_5x5', 'RANKED_FLEX_SR'];

    let tierDivisionsToSearch = [];
    let minLP = null;
    let maxLP = null;

    // Parse LP range if provided
    if (lpRange) {
        const match = lpRange.match(/^(\d+)-(\d+)$/);
        if (!match) {
            console.error('Invalid lpRange format. Use "800-1000"');
            return [];
        }
        minLP = parseInt(match[1]);
        maxLP = parseInt(match[2]);
        tierDivisionsToSearch = getTierDivisionsInRange(minLP, maxLP);

        const minRank = fromTotalLP(minLP);
        const maxRank = fromTotalLP(maxLP);
        console.log(`\n🔍 Scouting LP range ${minLP}-${maxLP}`);
        console.log(`   (${minRank.tier} ${minRank.division} ${minRank.lp}LP → ${maxRank.tier} ${maxRank.division} ${maxRank.lp}LP)`);
        console.log(`   Searching ${tierDivisionsToSearch.length} divisions: ${tierDivisionsToSearch.map(t => `${t.tier} ${t.division}`).join(', ')}`);
    } else {
        tierDivisionsToSearch = [{ tier: tier.toUpperCase(), division: division.toUpperCase() }];
        console.log(`\n🔍 Scouting ${tier} ${division} players...`);
    }

    console.log(`   Queues: ${queuesToSearch.join(', ')}`);
    console.log(`   Looking for players active within ${activeWithinMinutes} minutes\n`);

    const results = [];
    currentResults = results; // Allow rate limiter to show partial results
    const seenPuuids = new Set(); // Avoid duplicates across queues

    for (const searchQueue of queuesToSearch) {
        if (results.length >= maxPlayers) break;

        console.log(`\n   === ${searchQueue} ===`);

        for (const { tier: searchTier, division: searchDiv } of tierDivisionsToSearch) {
            if (results.length >= maxPlayers) break;

            console.log(`\n   Searching ${searchTier} ${searchDiv}...`);
            let page = 1;

            while (results.length < maxPlayers) {
                const entries = await getLeagueEntries(searchQueue, searchTier, searchDiv, page);

            if (!entries || entries.length === 0) {
                break;
            }

            for (const entry of entries) {
                if (results.length >= maxPlayers) break;

                // If LP range specified, filter by total LP
                if (minLP !== null && maxLP !== null) {
                    const playerTotalLP = toTotalLP(searchTier, searchDiv, entry.leaguePoints);
                    if (playerTotalLP < minLP || playerTotalLP > maxLP) {
                        continue;
                    }
                }

                // Calculate win rate
                const totalGames = entry.wins + entry.losses;
                const winRate = totalGames > 0 ? entry.wins / totalGames : 0;

                if (winRate < minWinRate) {
                    continue;
                }

                const puuid = entry.puuid;
                if (!puuid) {
                    process.stdout.write('x');
                    continue;
                }

                // Skip if we've already seen this player (from another queue)
                if (seenPuuids.has(puuid)) {
                    continue;
                }

                // Check cache first
                const cached = getCachedPlayer(puuid);
                const cacheOptions = { activeWithinMinutes, minWinRate, minLP, maxLP };

                if (cached && cachedPlayerMeetsCriteria(cached, cacheOptions)) {
                    // Use cached data - adjust active time
                    seenPuuids.add(puuid);
                    const cachedAge = Date.now() - cached.cachedAt;
                    const adjustedActiveMinutes = cached.lastActiveMinutes + Math.floor(cachedAge / 60000);

                    const player = {
                        ...cached,
                        lastActiveMinutes: adjustedActiveMinutes,
                        fromCache: true,
                        updatedAt: cached.cachedAt
                    };

                    results.push(player);

                    // Send to UI in real-time if available
                    if (global.sendPlayerFound) {
                        global.sendPlayerFound(player);
                    }

                    console.log(`  📦 Cache: ${player.name} | ${player.queue} ${player.rank} ${player.lp}LP | Active ${adjustedActiveMinutes}m ago (${player.lastGameMode})`);
                    continue;
                }

                // Not in cache or cache doesn't meet criteria - fetch fresh data
                const activity = await getLastActiveMinutes(puuid);

                if (activity !== null && activity.minutesAgo <= activeWithinMinutes) {
                    seenPuuids.add(puuid);

                    let displayName = 'Unknown';
                    try {
                        const account = await getRiotIdByPuuid(puuid);
                        displayName = `${account.gameName}#${account.tagLine}`;
                    } catch (err) {
                        // Continue with unknown name
                    }

                    const playerTotalLP = toTotalLP(searchTier, searchDiv, entry.leaguePoints);
                    const queueShort = searchQueue === 'RANKED_SOLO_5x5' ? 'Solo/Duo' : 'Flex';
                    const player = {
                        name: displayName,
                        region: CONFIG.region,
                        queue: queueShort,
                        rank: `${searchTier} ${searchDiv}`,
                        lp: entry.leaguePoints,
                        totalLP: playerTotalLP,
                        wins: entry.wins,
                        losses: entry.losses,
                        winRate: (winRate * 100).toFixed(1) + '%',
                        lastActiveMinutes: activity.minutesAgo,
                        lastGameMode: activity.gameMode,
                        hotStreak: entry.hotStreak,
                        veteran: entry.veteran,
                        freshBlood: entry.freshBlood,
                        puuid: puuid,
                        fromCache: false,
                        updatedAt: Date.now()
                    };

                    // Cache the player
                    cachePlayer(player);

                    results.push(player);

                    // Send to UI in real-time if available
                    if (global.sendPlayerFound) {
                        global.sendPlayerFound(player);
                    }

                    console.log(`  ✅ Found: ${player.name} | ${queueShort} ${player.rank} ${player.lp}LP | Active ${activity.minutesAgo}m ago (${activity.gameMode}) ${player.hotStreak ? '🔥' : ''}`);
                } else {
                    process.stdout.write('.');
                }
            }

            page++;
        }
        }
    }

    // Save cache at end of search
    saveCache();

    const fromCache = results.filter(p => p.fromCache).length;
    const fresh = results.length - fromCache;
    console.log(`\n\n📊 Scan complete! Found ${results.length} active players (${fromCache} from cache, ${fresh} fresh).`);
    console.log(`📦 Total cached players: ${Object.keys(playerCache).length}\n`);

    return results;
}

/**
 * Deep scout a specific player - get detailed match history
 */
async function deepScout(puuid, matchCount = 5) {
    console.log(`\n🔬 Deep scouting player...`);
    
    const matchIds = await getMatchIds(puuid, matchCount);
    const stats = [];

    for (const matchId of matchIds) {
        const match = await getMatchDetails(matchId);
        const playerStats = extractPlayerStats(match, puuid);
        if (playerStats) {
            stats.push(playerStats);
        }
    }

    // Calculate averages
    const avgKDA = (stats.reduce((sum, s) => sum + parseFloat(s.kda), 0) / stats.length).toFixed(2);
    const winCount = stats.filter(s => s.win).length;
    const recentWinRate = ((winCount / stats.length) * 100).toFixed(1);
    const positions = [...new Set(stats.map(s => s.position))];
    const champions = [...new Set(stats.map(s => s.champion))];

    return {
        recentMatches: stats,
        summary: {
            avgKDA,
            recentWinRate: recentWinRate + '%',
            positions,
            championPool: champions,
            gamesAnalyzed: stats.length
        }
    };
}

/**
 * Find duo partners from your recent matches
 * Players you've already played with who performed well
 */
async function findDuosFromHistory(yourRiotId, yourTagLine, options = {}) {
    const {
        matchCount = 20,
        minKDA = 2.0,
        onlyWins = false
    } = options;

    console.log(`\n🤝 Finding potential duos from your match history...`);

    // Get your account info
    const account = await getSummonerByRiotId(yourRiotId, yourTagLine);
    const yourPuuid = account.puuid;

    // Get your recent matches
    const matchIds = await getMatchIds(yourPuuid, matchCount);
    
    const candidates = new Map(); // puuid -> stats

    for (const matchId of matchIds) {
        const match = await getMatchDetails(matchId);
        const yourStats = extractPlayerStats(match, yourPuuid);
        
        if (!yourStats) continue;
        if (onlyWins && !yourStats.win) continue;

        // Find teammates (same team)
        const yourTeamId = match.info.participants.find(p => p.puuid === yourPuuid)?.teamId;
        
        for (const participant of match.info.participants) {
            // Skip yourself and enemies
            if (participant.puuid === yourPuuid) continue;
            if (participant.teamId !== yourTeamId) continue;

            const kda = participant.deaths === 0 
                ? (participant.kills + participant.assists)
                : (participant.kills + participant.assists) / participant.deaths;

            if (kda < minKDA) continue;

            // Track this player
            if (!candidates.has(participant.puuid)) {
                candidates.set(participant.puuid, {
                    puuid: participant.puuid,
                    riotIdName: participant.riotIdGameName,
                    riotIdTag: participant.riotIdTagline,
                    gamesPlayed: 0,
                    wins: 0,
                    totalKDA: 0,
                    champions: new Set(),
                    positions: new Set()
                });
            }

            const player = candidates.get(participant.puuid);
            player.gamesPlayed++;
            player.wins += participant.win ? 1 : 0;
            player.totalKDA += kda;
            player.champions.add(participant.championName);
            player.positions.add(participant.teamPosition);
        }
    }

    // Convert to sorted array
    const results = Array.from(candidates.values())
        .map(p => ({
            name: `${p.riotIdName}#${p.riotIdTag}`,
            gamesPlayed: p.gamesPlayed,
            winRate: ((p.wins / p.gamesPlayed) * 100).toFixed(1) + '%',
            avgKDA: (p.totalKDA / p.gamesPlayed).toFixed(2),
            champions: [...p.champions],
            positions: [...p.positions],
            puuid: p.puuid
        }))
        .sort((a, b) => b.gamesPlayed - a.gamesPlayed || parseFloat(b.avgKDA) - parseFloat(a.avgKDA));

    console.log(`\n📋 Found ${results.length} potential duo partners:\n`);
    
    for (const player of results.slice(0, 10)) {
        console.log(`  ${player.name}`);
        console.log(`    Games together: ${player.gamesPlayed} | WR: ${player.winRate} | Avg KDA: ${player.avgKDA}`);
        console.log(`    Plays: ${player.positions.join(', ')} | Champs: ${player.champions.slice(0, 5).join(', ')}`);
        console.log('');
    }

    return results;
}


// ============ USAGE EXAMPLES ============

/*
// Example 1: Scout for active Gold players
scoutPlayers({
    tier: 'GOLD',
    division: 'II',
    maxPlayers: 100,
    activeWithinMinutes: 15,
    minWinRate: 0.52
}).then(players => {
    console.log('Active players:', players);
});

// Example 2: Find duos from your own match history
findDuosFromHistory('YourName', 'NA1', {
    matchCount: 30,
    minKDA: 2.5,
    onlyWins: true
}).then(duos => {
    console.log('Potential duos:', duos);
});

// Example 3: Deep scout a specific player
deepScout('player-puuid-here', 10).then(report => {
    console.log('Player report:', report);
});
*/

// Export for module use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        scoutPlayers,
        deepScout,
        findDuosFromHistory,
        getLeagueEntries,
        getSummonerById,
        getSummonerByRiotId,
        getRiotIdByPuuid,
        getMatchIds,
        getMatchDetails,
        toTotalLP,
        fromTotalLP,
        getTierDivisionsInRange,
        loadCache,
        saveCache,
        getCachedPlayer,
        cachePlayer,
        playerCache,
        TIERS,
        DIVISIONS,
        CONFIG
    };
}
