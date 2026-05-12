import { google } from 'googleapis';
import { config } from '../config.js';
import db from '../db/init.js';

export function getOAuth2Client(account = null) {
  const client = new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );

  if (account) {
    client.setCredentials({
      access_token: account.access_token,
      refresh_token: account.refresh_token,
      expiry_date: account.token_expiry
    });

    client.on('tokens', (tokens) => {
      const updates = { updated_at: new Date().toISOString() };
      if (tokens.access_token) updates.access_token = tokens.access_token;
      if (tokens.expiry_date) updates.token_expiry = tokens.expiry_date;

      const sets = Object.keys(updates).map(k => `${k} = ?`).join(', ');
      const values = [...Object.values(updates), account.id];
      db.prepare(`UPDATE accounts SET ${sets} WHERE id = ?`).run(...values);
    });
  }

  return client;
}

export function refreshAccountIfNeeded(account) {
  if (Date.now() >= account.token_expiry - 60000) {
    const client = getOAuth2Client(account);
    return client.getAccessToken().then(() => {
      const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(account.id);
      return row;
    });
  }
  return Promise.resolve(account);
}
