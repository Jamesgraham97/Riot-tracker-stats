import axios from "axios";

// ================= CONFIG =================
const API_KEY = process.env.API_KEY;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

const REGION = "europe";
const SOLO_QUEUE_ID = 420;
const INCLUDE_REMAKES = false;

// --- Season Dates (UTC) ---
const SEASON_25_START = "2025-08-26";   // adjust if needed
const SEASON_26_START = "2026-01-08";

// --- Requirements ---
const SEASON_25_REQUIRED = 55;
const SEASON_26_REQUIRED = 15;
const TOTAL_REQUIRED = 70;

// ================= PLAYERS =================
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

// ================= HELPERS =================
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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
        console.log(`⚠️ Retry ${attempts + 1} (${code}) – waiting ${wait}ms`);
        await sleep(wait);
        attempts++;
      } else {
        throw err;
      }
    }
  }
  throw new Error("Rate-limit retries exceeded.");
}

// ================= MAIN =================
async function processPlayers(players) {
  const season25StartUnix = Date.parse(SEASON_25_START + "T00:00:00Z") / 1000;
  const season26StartUnix = Date.parse(SEASON_26_START + "T00:00:00Z") / 1000;

  const results = [];

  for (const [name, tag] of players) {
    try {
      await sleep(400);

      // ---- Account lookup ----
      const accountUrl =
        `https://${REGION}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/` +
        `${encodeURIComponent(name)}/${encodeURIComponent(tag)}?api_key=${API_KEY}`;

      const account = await fetchWithRetry(accountUrl);
      const puuid = account.puuid;

      console.log(`${name} → PUUID resolved`);

      let season25Matches = 0;
      let season26Matches = 0;

      let start = 0;
      const pageSize = 50;
      const maxPages = 8;

      for (let page = 0; page < maxPages; page++) {
        await sleep(400);

        const listUrl =
          `https://${REGION}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids` +
          `?type=ranked&start=${start}&count=${pageSize}&api_key=${API_KEY}`;

        const matchIds = await fetchWithRetry(listUrl);
        if (!matchIds?.length) break;

        for (const id of matchIds) {
          await sleep(400);

          const match = await fetchWithRetry(
            `https://${REGION}.api.riotgames.com/lol/match/v5/matches/${id}?api_key=${API_KEY}`
          );

          const info = match.info;
          if (!info) continue;
          if (info.queueId !== SOLO_QUEUE_ID) continue;
          if (!INCLUDE_REMAKES && info.gameDuration <= 300) continue;

          const endSec = Math.floor(info.gameEndTimestamp / 1000);
          if (endSec < season25StartUnix) continue;

          if (endSec >= season26StartUnix) {
            season26Matches++;
          } else {
            season25Matches++;
          }
        }

        if (matchIds.length < pageSize) break;
        start += matchIds.length;
      }

      const totalGames = season25Matches + season26Matches;

      const season25Ok = season25Matches >= SEASON_25_REQUIRED;
      const season26Ok = season26Matches >= SEASON_26_REQUIRED;
      const totalOk = totalGames >= TOTAL_REQUIRED;

      let status;
      if (season25Ok && season26Ok && totalOk) {
        status = "🏆 TOURNAMENT COMPLETE";
      } else {
        const miss25 = Math.max(0, SEASON_25_REQUIRED - season25Matches);
        const miss26 = Math.max(0, SEASON_26_REQUIRED - season26Matches);
        const missTotal = Math.max(0, TOTAL_REQUIRED - totalGames);
        status = `❌ Missing ${miss25} S25 / ${miss26} S26 / ${missTotal} total`;
      }

      console.log(
        `${name}: S25=${season25Matches}, S26=${season26Matches}, Total=${totalGames}`
      );

      results.push({
        name,
        tag,
        season25Matches,
        season26Matches,
        totalGames,
        status
      });

    } catch (err) {
      console.error(`${name} → ERROR: ${err.message}`);
      results.push({
        name,
        tag,
        season25Matches: 0,
        season26Matches: 0,
        totalGames: 0,
        status: "❌ Error fetching data"
      });
    }
  }

  await sendDiscordSummary(results);
}

// ================= DISCORD =================
async function sendDiscordSummary(results) {
  let msg = "**📊 Tournament Ranked Progress**\n";
  msg += "_Requirement: 55 (Season 25) + 15 (Season 26) = **70 total**_\n\n";

  for (const r of results) {
    msg += `**${r.name}**\n`;
    msg += `• Season 25: ${r.season25Matches}/55 ${r.season25Matches >= 55 ? "✅" : "❌"}\n`;
    msg += `• Season 26: ${r.season26Matches}/15 ${r.season26Matches >= 15 ? "✅" : "❌"}\n`;
    msg += `• Total: ${r.totalGames}/70 → ${r.status}\n\n`;
  }

  try {
    await axios.post(WEBHOOK_URL, { content: msg });
    console.log("✅ Discord message sent");
  } catch (err) {
    console.error("❌ Discord webhook failed:", err.message);
  }
}

// ================= RUN =================
processPlayers(allPlayers);
