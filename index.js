const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const cfg = require('./lib/config');
const { makeSite } = require('./lib/site');
const { makeSync } = require('./lib/sync');

if (!cfg.token || !cfg.botApiToken) { console.error('Заполните DISCORD_TOKEN и BOT_API_TOKEN в файле .env (см. .env.example)'); process.exit(1); }
const log = (...a) => console.log(new Date().toLocaleString('ru-RU'), ...a);
const site = makeSite(cfg);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });   // no privileged intents needed
const guild = () => client.guilds.cache.get(cfg.guildId);
const sync = makeSync({ cfg, site, getGuild: guild, log });

const IMAGE = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }, MAX = 10 * 1024 * 1024;
const cooldown = new Map();   // userId -> last /post time

const commands = [
  new SlashCommandBuilder().setName('post').setDescription('Предложить своё фото в раздел «Медиа» (необязательно с подписью)')
    .addAttachmentOption(o => o.setName('photo').setNameLocalizations({ ru: 'фото' }).setDescription('Изображение (PNG, JPG, GIF, WEBP до 10 МБ)').setRequired(true))
    .addStringOption(o => o.setName('text').setNameLocalizations({ ru: 'текст' }).setDescription('Подпись или описание (необязательно)').setMaxLength(1000).setRequired(false)),
  new SlashCommandBuilder().setName('link').setDescription('Привязать аккаунт сайта NØRD к этому Discord')
    .addStringOption(o => o.setName('code').setNameLocalizations({ ru: 'код' }).setDescription('Код из профиля на сайте («Привязать Discord»)').setRequired(true).setMaxLength(20))
].map(c => c.toJSON());

const reply = (i, content) => i.reply({ content, flags: MessageFlags.Ephemeral });
const embedOf = (u, text, color, footer) => new EmbedBuilder().setColor(color).setAuthor({ name: u.displayName || u.username, iconURL: u.displayAvatarURL() }).setDescription(text || null).setImage('attachment://photo').setFooter({ text: footer }).setTimestamp();

async function onPost(i) {
  const file = i.options.getAttachment('photo', true), text = (i.options.getString('text') || '').trim();
  const ext = IMAGE[(file.contentType || '').split(';')[0]];
  if (!ext) return reply(i, 'Нужно изображение: PNG, JPG, GIF или WEBP.');
  if (file.size > MAX) return reply(i, 'Файл больше 10 МБ. Сожмите изображение и отправьте снова.');
  const last = cooldown.get(i.user.id) || 0; if (Date.now() - last < 30000) return reply(i, 'Подождите немного перед следующим предложением.');
  const linked = await site.user(i.user.id).catch(() => null);
  if (cfg.postRequireLink && !linked) return reply(i, 'Сначала привяжите аккаунт сайта: в профиле нажмите «Привязать Discord» и отправьте команду /link.');
  const ch = await client.channels.fetch(cfg.suggestChannelId).catch(() => null);
  if (!ch || !ch.isTextBased()) return reply(i, 'Канал для предложений недоступен. Сообщите администрации.');
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const buf = Buffer.from(await (await fetch(file.url, { signal: AbortSignal.timeout(30000) })).arrayBuffer());
    const att = new AttachmentBuilder(buf, { name: 'photo.' + ext });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('post:ok:' + i.user.id).setLabel('Принять в «Медиа»').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('post:no:' + i.user.id).setLabel('Отклонить').setStyle(ButtonStyle.Danger));
    const e = embedOf(i.member || i.user, text, 0x2b2d31, 'Предложение · ' + (linked ? 'аккаунт: ' + linked.callsign : 'аккаунт не привязан'));
    e.setImage('attachment://photo.' + ext);
    await ch.send({ embeds: [e], files: [att], components: [row] });
    cooldown.set(i.user.id, Date.now());
    await i.editReply('Готово: ваше предложение отправлено на рассмотрение.');
  } catch (err) { log('/post:', err.message); await i.editReply('Не удалось отправить предложение. Попробуйте ещё раз позже.'); }
}

async function onLink(i) {
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const r = await site.link(i.options.getString('code', true), i.user.id, i.user.username);
    sync.forget(i.user.id);
    const m = await guild().members.fetch(i.user.id).catch(() => null);
    if (m) await sync.applyTo(m, r.tier, r.callsign).catch(e => log('роли после /link:', e.message));
    await i.editReply('Аккаунт **' + r.login + '** (' + r.callsign + ') привязан. ' + (r.tier === 'user' ? 'Роли появятся автоматически, как только вам выдадут роль на сайте.' : 'Роли синхронизированы.'));
  } catch (e) { await i.editReply(e.status ? e.message : 'Сайт сейчас недоступен. Попробуйте позже.'); }
}

async function canModerate(i) {
  const p = i.memberPermissions;
  if (p && (p.has(PermissionFlagsBits.ManageMessages) || p.has(PermissionFlagsBits.Administrator))) return true;
  if (cfg.modRoleId && i.member.roles.cache.has(cfg.modRoleId)) return true;
  if (cfg.roles.admin && i.member.roles.cache.has(cfg.roles.admin)) return true;
  const u = await site.user(i.user.id).catch(() => null); return !!u && u.tier === 'admin';
}
async function onButton(i) {
  const [, act, authorId] = i.customId.split(':');
  if (!(await canModerate(i))) return reply(i, 'Решать по предложениям могут только модераторы.');
  const msg = i.message, e0 = msg.embeds[0], who = i.member.displayName;
  await i.deferUpdate();
  // Скачиваем картинку заранее и при обновлении карточки загружаем её заново как единственный файл сообщения,
  // а в embed ссылаемся на неё через attachment:// - так Discord показывает ровно одну картинку (внутри карточки), без дубля.
  const urlOf = m => { if (!m) return null; const a = m.attachments && m.attachments.first(); if (a) return a.url; const em = m.embeds && m.embeds[0]; const im = em && em.image; return im ? (im.url || im.proxyURL) : null; };
  const byExt = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
  let img = null, imgErr = null;
  try {
    const url = urlOf(msg) || urlOf(await msg.channel.messages.fetch(msg.id).catch(() => null));
    if (!url) throw new Error('Нет изображения');
    const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!resp.ok) throw new Error('Не удалось скачать картинку (' + resp.status + ')');
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > MAX) throw new Error('Файл больше 10 МБ');
    const extOf = (url.split('?')[0].match(/\.(png|jpe?g|gif|webp)$/i) || [])[1];
    let mime = (resp.headers.get('content-type') || '').split(';')[0].trim();
    if (!/^image\/(png|jpeg|gif|webp)$/.test(mime)) mime = byExt[(extOf || '').toLowerCase()] || 'image/png';
    img = { buf, mime, name: 'photo.' + (extOf || mime.split('/')[1].replace('jpeg', 'jpg')) };
  } catch (err) { imgErr = err; }
  const update = (color, text) => {
    const e = EmbedBuilder.from(e0).setColor(color).setFooter({ text });
    if (!img) return msg.edit({ embeds: [e], components: [] });
    e.setImage('attachment://' + img.name);
    return msg.edit({ embeds: [e], files: [new AttachmentBuilder(img.buf, { name: img.name })], attachments: [], components: [] });
  };
  if (act === 'no') {
    await update(0xe5534b, 'Отклонено · ' + who);
    return notify(authorId, 'Ваше предложение в «Медиа» отклонено.');
  }
  try {
    if (!img) throw imgErr;
    const author = (await site.user(authorId).catch(() => null)), name = (e0.author && e0.author.name) || 'Участник';
    const text = e0.description || '';
    await site.media({ title: text ? text.split('\n')[0].slice(0, 80) : 'Фото от ' + name, description: text, author: author ? author.callsign : name, mime: img.mime, name: img.name, data: img.buf.toString('base64') });
    await update(0x6fbf73, 'Принято в «Медиа» · ' + who);
    notify(authorId, 'Ваше предложение принято: фото опубликовано в разделе «Медиа» на сайте. Спасибо!');
  } catch (err) { log('принять предложение:', err.message); i.followUp({ content: 'Не удалось добавить фото на сайт: ' + err.message, flags: MessageFlags.Ephemeral }); }
}
async function notify(userId, text) { try { const u = await client.users.fetch(userId); await u.send(text); } catch (e) { /* DMs closed */ } }

client.on('interactionCreate', i => {
  const h = i.isChatInputCommand() ? (i.commandName === 'post' ? onPost : i.commandName === 'link' ? onLink : null) : i.isButton() && i.customId.startsWith('post:') ? onButton : null;
  if (h) h(i).catch(e => { log('ошибка:', e.message); if (!i.replied && !i.deferred) reply(i, 'Произошла ошибка. Попробуйте позже.').catch(() => {}); });
});

let started = false;
async function onReady() {
  if (started) return; started = true;
  log('бот запущен как', client.user.tag);
  const g = guild(); if (!g) { console.error('Бота нет на сервере ' + cfg.guildId + '. Пригласите его (см. README).'); process.exit(1); }
  await g.commands.set(commands); log('команды /post и /link зарегистрированы');
  sync.run(); setInterval(sync.run, cfg.syncInterval * 1000);
}
client.once('clientReady', onReady); client.once('ready', onReady);   // 'clientReady' in new discord.js 14.x, 'ready' in older ones
client.login(cfg.token);
