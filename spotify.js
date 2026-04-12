const axios = require('axios');
const express = require('express');
const { shell, app } = require('electron');
const fs = require('fs');
const path = require('path');


const CLIENT_ID = 'CLIENT_ID'; // Loaded from .env
const CLIENT_SECRET = 'SECRET_CLIENT_ID'; // Loaded from .env
const REDIRECT_URI = 'http://127.0.0.1:8888/callback';
const SCOPES = 'user-read-currently-playing user-read-playback-state';
const TOKEN_FILE = path.join(app.getPath('userData'), 'spotify-tokens.json');

class SpotifyPoller {
  constructor() {
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiresAt = 0;
    this.lastTrackId = null;
    this.loadTokens();
  }

  /**
   * Load tokens from local file if they exist
   */
  loadTokens() {
    try {
      if (fs.existsSync(TOKEN_FILE)) {
        const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
        this.accessToken = data.accessToken;
        this.refreshToken = data.refreshToken;
        this.tokenExpiresAt = data.tokenExpiresAt;
        console.log('[Spotify] Loaded saved tokens');
      }
    } catch (err) {
      console.error('[Spotify] Failed to load tokens:', err.message);
    }
  }

  /**
   * Save tokens to local file
   */
  saveTokens() {
    try {
      const data = {
        accessToken: this.accessToken,
        refreshToken: this.refreshToken,
        tokenExpiresAt: this.tokenExpiresAt,
      };
      fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2));
      console.log('[Spotify] Tokens saved');
    } catch (err) {
      console.error('[Spotify] Failed to save tokens:', err.message);
    }
  }

  /**
   * Opens the Spotify OAuth login page in the user's browser and
   * spins up a temporary Express server to catch the callback.
   * Resolves once the access token is stored.
   */
  authenticate() {
    return new Promise((resolve, reject) => {
      const app = express();
      let server;

      app.get('/callback', async (req, res) => {
        const { code, error } = req.query;

        if (error) {
          res.send('Authorization denied. You can close this tab.');
          server.close();
          return reject(new Error(error));
        }

        try {
          const { data } = await axios.post(
            'https://accounts.spotify.com/api/token',
            new URLSearchParams({
              grant_type: 'authorization_code',
              code,
              redirect_uri: REDIRECT_URI,
            }).toString(),
            {
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Authorization:
                  'Basic ' +
                  Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'),
              },
            }
          );

          this.accessToken = data.access_token;
          this.refreshToken = data.refresh_token;
          this.tokenExpiresAt = Date.now() + data.expires_in * 1000;
          this.saveTokens();

          res.send(
            '<h2 style="font-family:sans-serif;color:#1db954">✓ Logged in! You can close this tab.</h2>'
          );
          server.close();
          resolve();
        } catch (err) {
          res.send('Token exchange failed. Check the console.');
          server.close();
          reject(err);
        }
      });

      server = app.listen(8888, () => {
        const authUrl =
          'https://accounts.spotify.com/authorize?' +
          new URLSearchParams({
            response_type: 'code',
            client_id: CLIENT_ID,
            scope: SCOPES,
            redirect_uri: REDIRECT_URI,
          }).toString();

        shell.openExternal(authUrl);
      });
    });
  }

  /**
   * Refreshes the access token if it expires within the next 30 seconds.
   */
  async refreshAccessToken() {
    if (Date.now() < this.tokenExpiresAt - 30_000) return;

    const { data } = await axios.post(
      'https://accounts.spotify.com/api/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken,
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization:
            'Basic ' +
            Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'),
        },
      }
    );

    this.accessToken = data.access_token;
    if (data.refresh_token) this.refreshToken = data.refresh_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000;
    this.saveTokens();
  }

  /**
   * Returns { title, artist, progressMs, durationMs, trackId, isPlaying, albumCover } or null.
   */
  async getCurrentTrack() {
    try {
      await this.refreshAccessToken();

      const { data, status } = await axios.get(
        'https://api.spotify.com/v1/me/player/currently-playing',
        {
          headers: { Authorization: `Bearer ${this.accessToken}` },
          validateStatus: (s) => s < 500,
        }
      );

      if (status === 204 || !data || !data.item) return null;

      // Get album cover (prefer 300x300 size, fallback to first available)
      const images = data.item.album?.images || [];
      const albumCover = images.find(img => img.width === 300)?.url 
        || images[0]?.url 
        || null;

      return {
        title: data.item.name,
        artist: data.item.artists.map((a) => a.name).join(', '),
        progressMs: data.progress_ms,
        durationMs: data.item.duration_ms,
        trackId: data.item.id,
        isPlaying: data.is_playing,
        albumCover,
      };
    } catch (err) {
      console.error('[Spotify] API error:', err.message);
      return null;
    }
  }
}

module.exports = SpotifyPoller;
