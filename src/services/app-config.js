// App-level configuration that can live either in the environment (.env) or
// in the settings table (editable from the Settings page).
//
// Settings keys win over environment variables. Empty settings values are
// ignored so an empty field falls back to the environment value.

export const CONFIG_KEYS = {
  google_client_id: 'GOOGLE_CLIENT_ID',
  google_client_secret: 'GOOGLE_CLIENT_SECRET',
  google_redirect_uri: 'GOOGLE_REDIRECT_URI',
  turnstile_site_key: 'TURNSTILE_SITE_KEY',
  turnstile_secret_key: 'TURNSTILE_SECRET_KEY'
};

const KEY_LIST = Object.keys(CONFIG_KEYS).map(k => `'${k}'`).join(', ');

let cache = null;

// Read the config keys from the settings table (only non-empty values).
export async function loadAppConfig(db) {
  const { results } = await db.prepare(`SELECT key, value FROM settings WHERE key IN (${KEY_LIST})`).all();
  const cfg = {};
  for (const row of results) {
    const envName = CONFIG_KEYS[row.key];
    if (envName && row.value !== '' && row.value != null) {
      cfg[envName] = row.value;
    }
  }
  return cfg;
}

// Cached accessor used by the request middleware. The cache is invalidated
// whenever the settings are saved via PUT /api/settings, so changes take
// effect immediately without a server restart.
export async function getAppConfig(db) {
  if (!cache) cache = await loadAppConfig(db);
  return cache;
}

export function invalidateAppConfig() {
  cache = null;
}

// Resolve a single env value: settings table first, then environment.
export async function getConfigValue(db, settingsKey, envFallback) {
  const cfg = await getAppConfig(db);
  const envName = CONFIG_KEYS[settingsKey];
  return cfg[envName] ?? envFallback;
}

// Build a minimal env object (Google OAuth pair) for schedulers/background
// jobs, always reading fresh from the DB so changes apply without restart.
export async function getGoogleOAuthEnv(db) {
  const cfg = await loadAppConfig(db); // fresh, not cached
  return {
    GOOGLE_CLIENT_ID: cfg.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: cfg.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET
  };
}
