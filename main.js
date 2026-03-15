const { app, BrowserWindow, ipcMain, screen, globalShortcut } = require('electron');
const SpotifyPoller = require('./spotify');
const { fetchLyrics, parseLRC } = require('./lyrics');

let win;
let poller;
let pollingInterval;

// Current state
let currentLyrics = [];   // [{ time, text }]
let currentTrackId = null;
let hasLyrics = false;
let isClickThrough = false;
let isPinned = true;

function setClickThrough(enabled, skipNotify = false) {
  isClickThrough = enabled;
  if (!win) return;
  win.setIgnoreMouseEvents(enabled, { forward: true });
  if (!skipNotify) {
    win.webContents.send('clickthrough-changed', isClickThrough);
  }
}

function setAlwaysOnTop(enabled, skipNotify = false) {
  isPinned = enabled;
  if (!win) return;
  win.setAlwaysOnTop(isPinned, 'screen-saver');
  if (!skipNotify) {
    win.webContents.send('always-on-top-changed', isPinned);
  }
}

function toggleClickThrough() {
  setClickThrough(!isClickThrough);
}

function toggleAlwaysOnTop() {
  setAlwaysOnTop(!isPinned);
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  win = new BrowserWindow({
    width: 800,
    height: 260,
    x: Math.round((width - 800) / 2),
    y: height - 300,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  win.loadFile('renderer.html');
  setClickThrough(false, true);
  setAlwaysOnTop(true, true);

  win.webContents.once('did-finish-load', () => {
    win.webContents.send('clickthrough-changed', isClickThrough);
    win.webContents.send('always-on-top-changed', isPinned);
  });
}

ipcMain.on('toggle-clickthrough', () => {
  toggleClickThrough();
});

ipcMain.on('toggle-always-on-top', () => {
  toggleAlwaysOnTop();
});

/**
 * Finds the current lyric line index for the given playback position.
 */
function findLineIndex(progressMs) {
  let idx = 0;
  for (let i = 0; i < currentLyrics.length; i++) {
    if (currentLyrics[i].time <= progressMs) {
      idx = i;
    } else {
      break;
    }
  }
  return idx;
}

/**
 * Main polling loop — runs every 1 second.
 */
async function pollSpotify() {
  const track = await poller.getCurrentTrack();

  if (!track || !track.isPlaying) {
    win.webContents.send('no-track');
    return;
  }

  // Track changed — fetch new lyrics
  if (track.trackId !== currentTrackId) {
    currentTrackId = track.trackId;
    win.webContents.send('track-change', {
      title: track.title,
      artist: track.artist,
    });

    const lrcString = await fetchLyrics(track.title, track.artist);
    if (lrcString) {
      currentLyrics = parseLRC(lrcString);
      hasLyrics = true;
    } else {
      currentLyrics = [];
      hasLyrics = false;
      win.webContents.send('no-lyrics');
      return;
    }
  }

  if (!hasLyrics || currentLyrics.length === 0) return;

  const idx = findLineIndex(track.progressMs);
  const prev = idx > 0 ? currentLyrics[idx - 1].text : '';
  const current = currentLyrics[idx].text;
  const next = idx < currentLyrics.length - 1 ? currentLyrics[idx + 1].text : '';

  win.webContents.send('lyric-update', { prev, current, next });
}

app.whenReady().then(async () => {
  createWindow();

  if (!globalShortcut.register('CommandOrControl+Shift+L', () => toggleClickThrough())) {
    console.warn('[Main] Unable to register Ctrl+Shift+L shortcut for the overlay lock.');
  }

  poller = new SpotifyPoller();

  try {
    await poller.authenticate();
    console.log('[Main] Spotify authenticated ✓');
    pollingInterval = setInterval(pollSpotify, 1000);
  } catch (err) {
    console.error('[Main] Auth failed:', err.message);
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  clearInterval(pollingInterval);
  app.quit();
});
