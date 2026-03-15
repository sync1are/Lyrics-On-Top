const axios = require('axios');
const express = require('express');
const { shell } = require('electron');

const CLIENT_ID = 'YOURE_SECRET_ID_HERE'; /**get froim spotify developers portal make sure to add the same redirect url in the spotify developer page as shown here*/
const CLIENT_SECRET = 'YOUR_SECRET_ID_HERE';
const REDIRECT_URI = 'http://127.0.0.1:8888/callback';
const SCOPES = 'user-read-currently-playing user-read-playback-state';

class SpotifyPoller {
  constructor() {
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiresAt = 0;
    this.lastTrackId = null;
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
  }

  /**
   * Returns { title, artist, progressMs, trackId, isPlaying } or null.
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

      return {
        title: data.item.name,
        artist: data.item.artists.map((a) => a.name).join(', '),
        progressMs: data.progress_ms,
        trackId: data.item.id,
        isPlaying: data.is_playing,
      };
    } catch (err) {
      console.error('[Spotify] API error:', err.message);
      return null;
    }
  }
}

module.exports = SpotifyPoller;
