const { diff } = require('./roles');
// Polls the site and keeps Discord roles equal to the roles on the site.
function makeSync({ cfg, site, getGuild, log }) {
  const applied = new Map();          // discordId -> tier that was successfully applied (avoids hammering the Discord API)
  let cycle = 0, busy = false;
  async function applyTo(member, tier, callsign) {
    const d = diff([...member.roles.cache.keys()], tier, cfg.roles);
    if (d.add.length) await member.roles.add(d.add, 'Синхронизация с сайтом NØRD');
    if (d.remove.length) await member.roles.remove(d.remove, 'Синхронизация с сайтом NØRD');
    if (cfg.syncNicknames && callsign && member.manageable && member.displayName !== callsign) await member.setNickname(callsign, 'Позывной с сайта NØRD').catch(() => {});
    return d;
  }
  async function member(guild, id) { try { return await guild.members.fetch(id); } catch (e) { return null; } }   // null = not on the server (yet)
  async function run() {
    if (busy) return; busy = true;
    try {
      const guild = getGuild(); if (!guild) return;
      if (++cycle % 40 === 0) applied.clear();   // a full re-check every ~10 minutes also repairs manual changes
      const data = await site.sync();
      for (const u of data.users) {
        if (applied.get(u.discordId) === u.tier) continue;
        const m = await member(guild, u.discordId); if (!m) continue;
        try { const d = await applyTo(m, u.tier, u.callsign); applied.set(u.discordId, u.tier); if (d.add.length || d.remove.length) log('роли', u.login, '→', u.tier, '+' + d.add.length, '-' + d.remove.length); }
        catch (e) { log('не удалось выдать роли для', u.login + ':', e.message); }
      }
      const done = [];
      for (const id of data.revoke || []) {
        const m = await member(guild, id);
        if (m) { try { await applyTo(m, 'user', ''); } catch (e) { log('не удалось снять роли', id, e.message); continue; } }
        applied.delete(id); done.push(id);
      }
      if (done.length) await site.ack(done);
    } catch (e) { log('синхронизация:', e.message); }
    finally { busy = false; }
  }
  return { run, applyTo, forget: id => applied.delete(id), applied };
}
module.exports = { makeSync };
