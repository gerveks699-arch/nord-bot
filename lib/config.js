require('dotenv').config();
const e = process.env, id = v => (v || '').trim();
const cfg = {
  token: id(e.DISCORD_TOKEN),
  guildId: id(e.GUILD_ID) || '1456425642059894807',
  suggestChannelId: id(e.SUGGEST_CHANNEL_ID) || '1554139955528474764',
  siteUrl: (id(e.SITE_URL) || 'http://localhost:3000').replace(/\/+$/, ''),
  botApiToken: id(e.BOT_API_TOKEN),
  roles: { fighter: id(e.ROLE_FIGHTER_ID), admin: id(e.ROLE_ADMIN_ID), approved: id(e.ROLE_APPROVED_ID) },
  modRoleId: id(e.MOD_ROLE_ID),
  postRequireLink: /^(1|true|yes)$/i.test(id(e.POST_REQUIRE_LINK)),
  syncNicknames: /^(1|true|yes)$/i.test(id(e.SYNC_NICKNAMES)),
  syncInterval: Math.max(5, +e.SYNC_INTERVAL || 15)
};
module.exports = cfg;
