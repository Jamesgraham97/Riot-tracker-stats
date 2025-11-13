// index.js
const axios = require("axios");

// === CONFIGURATION ===
const API_KEY = process.env.API_KEY;
const REGION = "europe";
const SPLIT_START_DATE = "2025-08-26";
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const CURRENT_SPLIT_GOAL = 50;
const INCLUDE_REMAKES = false;
const SOLO_QUEUE_ID = 420;

// Players groups
const group1 = [
  ["Glube", "EUW"],
  ["The Moo", "EUW"]
];
const group2 = [
  ["TheCprom", "EUW"],
  ["Diabellstar", "Witch"],
  ["Slinyyy", "sliny"]
];
const allPlayers = [...group1, ...group2];

// Sleep helper
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Retry logic for API calls
async function fetchWithRetry(url) {
  let attempts = 0;
  while (attempts < 12) {
    try {
      const resp = await axios.get(url);
      return resp.data;
    } catch (err) {
      const code = err.response?.status;
      if ([429, 502, 503].includes(code)) {
        const wait = Math.min(10000, 1000 * Math.pow(1.6, attempts));
        console.log(`⚠️ Retry ${attempts + 1} for ${code}... waiting ${wait}ms`);
        await sleep(wait);
        attempts++;
      } else {
        throw err;
      }
    }
  }
  throw new Error("Rate-limit retries exceeded.");
}

// Main processing function
async function processPlayers(players) {
  const splitStartUnix = Math.floor(new Date(SPLIT_START_DATE + "T00:00:00Z").getTime() / 1000);
  const results = [];

  for (const [name, tag] of players) {
    try {
      await sleep(400);

      const accountUrl = `https://${REGION}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(name)}/${encodeURIComponent(tag)}?api_key=${API_KEY}`;
      console.log(`Fetching account: ${accountUrl}`);
      const account = await fetchWithRetry(accountUrl);
      const puuid = account.puuid;
      console.log(`${name} → PUUID: ${puuid}`);

      let totalMatches = 0;
      let firstGame = null;
      let lastGame = null;
      let start = 0;
      const pageSize = 50;
      const maxPages = 8;

      for (let page = 0; page < maxPages; page++) {
        await sleep(400);
        const listUrl = `https://${REGION}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?type=ranked&start=${start}&count=${pageSize}&startTime=${splitStartUnix}&api_key=${API_KEY}`;
        const matchIds = await fetchWithRetry(listUrl);

        if (!Array.isArray(matchIds) || matchIds.length === 0) break;

        for (const id of matchIds) {
          await sleep(400);
          const matchData = await fetchWithRetry(`https://${REGION}.api.riotgames.com/lol/match/v5/matches/${id}?api_key=${API_KEY}`);
          const info = matchData.info;

          if (!info || info.queueId !== SOLO_QUEUE_ID) continue;
          if (!INCLUDE_REMAKES && info.gameDuration <= 300) continue;
          const endSec = Math.floor(info.gameEndTimestamp / 1000);
          if (endSec < splitStartUnix) continue;

          totalMatches++;
          const gameDate = new Date(info.gameEndTimestamp);
          if (!firstGame || gameDate < firstGame) firstGame = gameDate;
          if (!lastGame || gameDate > lastGame) lastGame = gameDate;
        }

        if (matchIds.length < pageSize) break;
        start += matchIds.length;
      }

      const firstStr = firstGame ? firstGame.toISOString().split("T")[0] : "";
      const lastStr = lastGame ? lastGame.toISOString().split("T")[0] : "";
      const status = totalMatches >= CURRENT_SPLIT_GOAL
        ? `✅ Completed ${CURRENT_SPLIT_GOAL}`
        : `❌ ${CURRENT_SPLIT_GOAL - totalMatches} left`;

      console.log(`${name}: ${totalMatches} games logged`);
      results.push({ name, tag, totalMatches, firstStr, lastStr, status });

    } catch (e) {
      console.log(`${name} → Error: ${e.message}`);
      results.push({ name, tag, totalMatches: 0, firstStr: "", lastStr: "", status: "❌ Error" });
    }
  }

  await sendDiscordSummary(results);
}

// Send summary to Discord
async function sendDiscordSummary(results) {
  let summary = "**📊 Ranked Progress Update (All Players)**\n";
  for (const r of results) {
    summary += `**${r.name}** – ${r.totalMatches} games – ${r.status}\n`;
  }

  try {
    await axios.post(WEBHOOK_URL, { content: summary });
    console.log("✅ Discord message sent");
  } catch (err) {
    console.log("Discord webhook failed: " + err.message);
  }
}

// Run
processPlayers(allPlayers);
