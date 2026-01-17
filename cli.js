#!/usr/bin/env node
/**
 * CLI wrapper for scout.js
 *
 * Usage:
 *   node cli.js scout --tier GOLD --division II
 *   node cli.js duos --name YourName --tag NA1
 *   node cli.js deep --puuid <puuid>
 */

const {
    scoutPlayers,
    deepScout,
    findDuosFromHistory,
    CONFIG
} = require('./scout.js');

// Parse command line arguments
function parseArgs() {
    const args = process.argv.slice(2);
    const command = args[0];
    const options = {};

    for (let i = 1; i < args.length; i++) {
        if (args[i].startsWith('--')) {
            const key = args[i].slice(2);
            const value = args[i + 1];
            if (value && !value.startsWith('--')) {
                options[key] = value;
                i++;
            } else {
                options[key] = true;
            }
        }
    }

    return { command, options };
}

function showHelp() {
    console.log(`
League of Legends Player Scout CLI

For the web UI, run: node server.js

Commands:
  scout    Find active ranked players in a tier/division or LP range
  duos     Find duo partners from your match history
  deep     Deep scout a specific player by PUUID

Options for 'scout':
  --lp          LP range "min-max" (e.g., "800-1000") - overrides tier/division
  --tier        Rank tier (IRON, BRONZE, SILVER, GOLD, PLATINUM, EMERALD, DIAMOND)
  --division    Division (I, II, III, IV)
  --queue       Queue: solo, flex, or both (default: both)
  --max         Max active players to find (default: 50)
  --active      Active within X minutes (default: 30)
  --winrate     Minimum win rate 0-1 (default: 0, no filter)

LP Reference (total LP = tier base + division offset + current LP):
  Iron: 0-399      Bronze: 400-799    Silver: 800-1199
  Gold: 1200-1599  Platinum: 1600-1999  Emerald: 2000-2399
  Diamond: 2400-2799
  Division offsets: IV=0, III=100, II=200, I=300

  Examples: Silver IV 50LP = 850, Gold I 75LP = 1575

Options for 'duos':
  --name        Your Riot game name
  --tag         Your tag line (e.g., NA1)
  --matches     Number of matches to analyze (default: 20)
  --kda         Minimum KDA filter (default: 2.0)
  --wins        Only analyze wins (flag)

Options for 'deep':
  --puuid       Player's PUUID
  --matches     Number of matches to analyze (default: 5)

Global:
  --key         Riot API key (or set RIOT_API_KEY env var)
  --region      Platform region (default: na1)
  --routing     Match routing (default: americas)

Examples:
  node cli.js scout --lp 800-1000           # Silver IV to Silver II
  node cli.js scout --tier GOLD --division II --active 15
  node cli.js duos --name MyName --tag NA1 --matches 30
  node cli.js deep --puuid abc123... --matches 10
`);
}

async function main() {
    const { command, options } = parseArgs();

    // Set API key from arg or env
    if (options.key) {
        CONFIG.apiKey = options.key;
    } else if (process.env.RIOT_API_KEY) {
        CONFIG.apiKey = process.env.RIOT_API_KEY;
    }

    // Set region options
    if (options.region) CONFIG.region = options.region;
    if (options.routing) CONFIG.regionV5 = options.routing;

    if (!command || command === 'help' || command === '--help' || command === '-h') {
        showHelp();
        return;
    }

    try {
        switch (command) {
            case 'scout': {
                const scoutOptions = {
                    maxPlayers: parseInt(options.max) || 50,
                    activeWithinMinutes: parseInt(options.active) || 30,
                    minWinRate: options.winrate !== undefined ? parseFloat(options.winrate) : 0
                };

                if (options.lp) {
                    scoutOptions.lpRange = options.lp;
                } else {
                    scoutOptions.tier = (options.tier || 'GOLD').toUpperCase();
                    scoutOptions.division = (options.division || 'II').toUpperCase();
                }

                // Queue: solo, flex, or both (default)
                if (options.queue) {
                    const q = options.queue.toLowerCase();
                    if (q === 'solo') scoutOptions.queue = 'RANKED_SOLO_5x5';
                    else if (q === 'flex') scoutOptions.queue = 'RANKED_FLEX_SR';
                    // else null = both
                }

                const result = await scoutPlayers(scoutOptions);
                console.log('\nResults:', JSON.stringify(result, null, 2));
                break;
            }

            case 'duos': {
                if (!options.name || !options.tag) {
                    console.error('Error: --name and --tag are required for duos command');
                    console.log('Example: node cli.js duos --name MyName --tag NA1');
                    process.exit(1);
                }
                const result = await findDuosFromHistory(options.name, options.tag, {
                    matchCount: parseInt(options.matches) || 20,
                    minKDA: parseFloat(options.kda) || 2.0,
                    onlyWins: !!options.wins
                });
                break;
            }

            case 'deep': {
                if (!options.puuid) {
                    console.error('Error: --puuid is required for deep command');
                    process.exit(1);
                }
                const result = await deepScout(options.puuid, parseInt(options.matches) || 5);
                console.log('\nDeep Scout Report:', JSON.stringify(result, null, 2));
                break;
            }

            default:
                console.error(`Unknown command: ${command}`);
                showHelp();
                process.exit(1);
        }
    } catch (err) {
        console.error('\nError:', err.message);
        process.exit(1);
    }
}

main();
