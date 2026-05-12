import { google } from 'googleapis';
import { getOAuth2Client, refreshAccountIfNeeded } from './token-manager.js';
import db from '../db/init.js';
import { Readable } from 'stream';

const ACTIVITY_TEXT = `GOOGLE ACTIVITY - Keep Alive
This file was automatically created to maintain account activity.
Generated at: ${new Date().toISOString()}

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.`;

async function getDrive(account) {
  account = await refreshAccountIfNeeded(account);
  const auth = getOAuth2Client(account);
  return google.drive({ version: 'v3', auth });
}

export async function runKeepAlive() {
  const accounts = db.prepare('SELECT * FROM accounts').all();
  const results = [];

  for (const account of accounts) {
    try {
      const drive = await getDrive(account);

      const content = ACTIVITY_TEXT.replace(
        /Generated at: .+/,
        `Generated at: ${new Date().toISOString()}`
      );

      const res = await drive.files.create({
        requestBody: {
          name: `.udrive_keepalive_${Date.now()}.txt`,
          parents: ['root']
        },
        media: {
          mimeType: 'text/plain',
          body: Readable.from(content)
        },
        fields: 'id'
      });

      await drive.files.delete({ fileId: res.data.id });

      results.push({ email: account.email, success: true });
    } catch (err) {
      results.push({ email: account.email, success: false, error: err.message });
    }
  }

  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_keepalive', ?)")
    .run(new Date().toISOString());

  return results;
}

let intervalId = null;

export function startKeepAliveScheduler() {
  const setting = db.prepare("SELECT value FROM settings WHERE key = 'keepalive_interval_days'").get();
  const days = setting ? parseInt(setting.value) : 0;

  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }

  if (days > 0) {
    const ms = days * 24 * 60 * 60 * 1000;
    intervalId = setInterval(() => runKeepAlive(), ms);
    console.log(`Keep-alive scheduler started: every ${days} day(s)`);
  }
}

export function stopKeepAliveScheduler() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
