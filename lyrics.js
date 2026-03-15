const axios = require('axios');

const LRCLIB_BASE = 'https://lrclib.net/api';

/**
 * Fetches synced (timestamped) lyrics from LRCLIB for the given track.
 * Returns the raw LRC string or null if nothing is found.
 */
async function fetchLyrics(title, artist) {
  try {
    const { data } = await axios.get(`${LRCLIB_BASE}/get`, {
      params: {
        track_name: title,
        artist_name: artist,
      },
    });

    if (data && data.syncedLyrics) return data.syncedLyrics;
    return null;
  } catch (err) {
    if (err.response && err.response.status === 404) return null;
    console.error('[Lyrics] Fetch error:', err.message);
    return null;
  }
}

/**
 * Parses an LRC string into a sorted array of { time, text }.
 * time is in milliseconds.
 *
 * Example LRC line:  [01:23.45]Some lyric text
 */
function parseLRC(lrcString) {
  const lines = lrcString.split('\n');
  const result = [];

  const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;

  for (const line of lines) {
    const match = line.match(timeRegex);
    if (!match) continue;

    const minutes = parseInt(match[1], 10);
    const seconds = parseInt(match[2], 10);
    let millis = parseInt(match[3], 10);
    // Handle both [mm:ss.xx] and [mm:ss.xxx]
    if (match[3].length === 2) millis *= 10;

    const time = minutes * 60_000 + seconds * 1000 + millis;
    const text = line.replace(timeRegex, '').trim();

    if (text.length > 0) {
      result.push({ time, text });
    }
  }

  result.sort((a, b) => a.time - b.time);
  return result;
}

module.exports = { fetchLyrics, parseLRC };
