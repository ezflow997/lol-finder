/**
 * LOL Scout - Example Runner
 * 
 * Quick examples of how to use the scout module.
 * Run with: node example.js
 */

const {
    scoutPlayers,
    deepScout,
    findDuosFromHistory,
    CONFIG
} = require('./scout.js');

// ⚠️ SET YOUR API KEY FIRST
CONFIG.apiKey = 'RGAPI-b95f7cb9-ae10-428e-b225-7d04cd8ab381';
CONFIG.region = 'na1';        // na1, euw1, eun1, kr, br1, etc.
CONFIG.regionV5 = 'americas'; // americas, europe, asia (for match-v5)

async function main() {
    console.log('='.repeat(50));
    console.log('  LOL Player Scout / Duo Finder');
    console.log('='.repeat(50));

    // --------------------------------------------------------
    // OPTION 1: Find active players in your target rank
    // --------------------------------------------------------
    
    const activePlayers = await scoutPlayers({
        queue: 'RANKED_SOLO_5x5',  // or 'RANKED_FLEX_SR'
        tier: 'GOLD',              // IRON, BRONZE, SILVER, GOLD, PLATINUM, EMERALD, DIAMOND
        division: 'II',            // I, II, III, IV
        maxPlayers: 50,            // How many to scan (more = slower)
        activeWithinMinutes: 30,   // Only players active in last X minutes
        minWinRate: 0.50           // 50% minimum win rate
    });

    console.log('\n--- Active Players Found ---');
    console.table(activePlayers.map(p => ({
        Name: p.name,
        Rank: p.rank,
        LP: p.lp,
        'Win Rate': p.winRate,
        'Last Active': `${p.lastActiveMinutes}m ago`,
        'Hot Streak': p.hotStreak ? '🔥' : ''
    })));

    // --------------------------------------------------------
    // OPTION 2: Find duos from YOUR match history
    // --------------------------------------------------------
    
    /*
    const myDuos = await findDuosFromHistory('YourGameName', 'NA1', {
        matchCount: 20,      // Check last 20 games
        minKDA: 2.0,         // Teammates with at least 2.0 KDA
        onlyWins: false      // Include losses too
    });

    console.log('\n--- Potential Duo Partners ---');
    for (const duo of myDuos.slice(0, 5)) {
        console.log(`${duo.name} - ${duo.gamesPlayed} games, ${duo.winRate} WR, ${duo.avgKDA} KDA`);
    }
    */

    // --------------------------------------------------------
    // OPTION 3: Deep scout a specific player
    // --------------------------------------------------------
    
    /*
    if (activePlayers.length > 0) {
        const firstPlayer = activePlayers[0];
        console.log(`\nDeep scouting: ${firstPlayer.name}`);
        
        const report = await deepScout(firstPlayer.puuid, 5);
        
        console.log('\n--- Player Summary ---');
        console.log(report.summary);
        
        console.log('\n--- Recent Matches ---');
        console.table(report.recentMatches);
    }
    */
}

main().catch(err => {
    console.error('Error:', err.message);
});
