# LOL Player Scout / Duo Finder

Find recently active League of Legends players for scouting or duo queue.

## Features

- **Scout by Rank** - Find active players in any tier/division
- **Activity Filter** - Only show players who just finished a game
- **Win Rate Filter** - Skip players below your standards
- **Duo Finder** - Find good teammates from your own match history
- **Deep Scout** - Get detailed stats on any player

## Setup

### 1. Get a Riot API Key

1. Go to [developer.riotgames.com](https://developer.riotgames.com/)
2. Sign in with your Riot account
3. Generate a **Development API Key**

> ⚠️ Development keys expire every 24 hours. For a permanent key, apply for a Production key (requires a project/app).

### 2. Configure

Edit `example.js` or `scout.js`:

```javascript
CONFIG.apiKey = 'RGAPI-your-key-here';
CONFIG.region = 'na1';        // Your server
CONFIG.regionV5 = 'americas'; // Match routing
```

**Region Mapping:**

| Platform | Match Routing |
|----------|---------------|
| na1, br1, la1, la2 | americas |
| euw1, eun1, tr1, ru | europe |
| kr, jp1 | asia |
| oc1, ph2, sg2, th2, tw2, vn2 | sea |

### 3. Run

```bash
node example.js
```

## Usage Examples

### Find Active Gold Players

```javascript
const players = await scoutPlayers({
    tier: 'GOLD',
    division: 'II',
    maxPlayers: 100,
    activeWithinMinutes: 15,
    minWinRate: 0.52
});
```

### Find Duos From Your Match History

```javascript
const duos = await findDuosFromHistory('YourName', 'NA1', {
    matchCount: 30,
    minKDA: 2.5,
    onlyWins: true
});
```

### Deep Scout a Player

```javascript
const report = await deepScout('player-puuid', 10);
console.log(report.summary);
// { avgKDA: '3.45', recentWinRate: '60%', positions: ['MIDDLE', 'BOTTOM'], ... }
```

## Rate Limits

Riot enforces strict rate limits:

| Limit | Development Key |
|-------|-----------------|
| Per second | 20 requests |
| Per 2 minutes | 100 requests |

The built-in rate limiter handles this, but scanning many players will be slow. Tips:

- Start with smaller `maxPlayers` values
- Cache results locally if re-running
- Consider storing summoner data in a JSON file

## API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `League-Exp-V4` | Get players by rank |
| `Summoner-V4` | Get PUUID from summoner ID |
| `Account-V1` | Look up by Riot ID |
| `Match-V5` | Get match history & details |

## Potential Improvements

- [ ] Add local caching/storage
- [ ] Filter by role/position
- [ ] Track champion pools
- [ ] Add Discord bot integration
- [ ] Build a simple UI (could be an HTA!)

## License

Do whatever you want with it. 🎮
