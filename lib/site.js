// thin client for the NØRD site API (/api/bot/*), authenticated with the shared BOT_API_TOKEN
function makeSite(cfg, fetchImpl) {
  const f = fetchImpl || fetch;
  async function call(path, opts = {}) {
    const res = await f(cfg.siteUrl + path, {
      method: opts.method || 'GET',
      headers: { Authorization: 'Bearer ' + cfg.botApiToken, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(20000)
    });
    let data = null; try { data = await res.json(); } catch (e) {}
    if (!res.ok) { const err = new Error((data && data.error) || 'Сайт ответил ошибкой ' + res.status); err.status = res.status; throw err; }
    return data;
  }
  return {
    sync: () => call('/api/bot/sync'),
    ack: ids => call('/api/bot/ack', { method: 'POST', body: { ids } }),
    link: (code, discordId, discordName) => call('/api/bot/link', { method: 'POST', body: { code, discordId, discordName } }),
    user: discordId => call('/api/bot/user?discordId=' + encodeURIComponent(discordId)).catch(e => { if (e.status === 404) return null; throw e; }),
    media: body => call('/api/bot/media', { method: 'POST', body })
  };
}
module.exports = { makeSite };
