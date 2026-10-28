// Logic tests with fakes: role diff, the sync loop, and the HTTP client (no real Discord needed)
const assert = require('assert'), http = require('http');
const { desiredRoles, diff } = require('../lib/roles'), { makeSync } = require('../lib/sync'), { makeSite } = require('../lib/site');
const R = { fighter: 'F', admin: 'A', approved: 'P' };
assert.deepStrictEqual([...desiredRoles('admin', R)].sort(), ['A', 'F']); assert.deepStrictEqual([...desiredRoles('fighter', R)], ['F']); assert.deepStrictEqual([...desiredRoles('approved', R)], ['P']); assert.strictEqual(desiredRoles('user', R).size, 0);
assert.deepStrictEqual(diff(['x', 'P'], 'fighter', R), { add: ['F'], remove: ['P'] });   // promoted: gets F, loses P, unmanaged role x untouched
assert.deepStrictEqual(diff(['x', 'F', 'A'], 'user', R), { add: [], remove: ['F', 'A'] });
assert.deepStrictEqual(diff(['F'], 'fighter', R), { add: [], remove: [] });
assert.deepStrictEqual(diff([], 'fighter', { fighter: '', admin: '', approved: '' }), { add: [], remove: [] });   // unconfigured roles are ignored

(async () => {
  const members = { 1: { id: '1', roles: { cache: new Map([['x', 1]]), add: async function (r) { r.forEach(i => this.cache.set(i, 1)); }, remove: async function (r) { r.forEach(i => this.cache.delete(i)); } }, manageable: true, displayName: 'a' } };
  members[1].roles.cache = Object.assign(new Map([['x', 1]]), {});
  let payload = { users: [{ discordId: '1', login: 'u', callsign: 'Wolf', tier: 'fighter' }, { discordId: '2', login: 'ghost', callsign: 'G', tier: 'fighter' }], revoke: [] }, acked = [];
  const site = { sync: async () => payload, ack: async ids => { acked.push(...ids); } };
  const guild = { members: { fetch: async id => { if (!members[id]) throw new Error('Unknown Member'); return members[id]; } } };
  const s = makeSync({ cfg: { roles: R, syncNicknames: false }, site, getGuild: () => guild, log: () => {} });
  await s.run(); assert.ok(members[1].roles.cache.has('F') && members[1].roles.cache.has('x'), 'fighter role granted, other roles kept');
  payload = { users: [{ discordId: '1', login: 'u', callsign: 'Wolf', tier: 'admin' }], revoke: [] }; await s.run(); assert.ok(members[1].roles.cache.has('A') && members[1].roles.cache.has('F'));
  payload = { users: [{ discordId: '1', login: 'u', callsign: 'Wolf', tier: 'user' }], revoke: [] }; await s.run(); assert.ok(!members[1].roles.cache.has('A') && !members[1].roles.cache.has('F') && members[1].roles.cache.has('x'), 'role removed on the site => removed in Discord');
  payload = { users: [{ discordId: '1', login: 'u', callsign: 'Wolf', tier: 'fighter' }], revoke: [] }; await s.run(); assert.ok(members[1].roles.cache.has('F'));
  payload = { users: [], revoke: ['1', '9'] }; await s.run(); assert.ok(!members[1].roles.cache.has('F') && members[1].roles.cache.has('x')); assert.deepStrictEqual(acked.sort(), ['1', '9'], 'unlink => roles removed and acknowledged');
  // HTTP client: auth header, errors
  const srv = http.createServer((q, r) => { r.setHeader('Content-Type', 'application/json'); if (q.headers.authorization !== 'Bearer T') { r.statusCode = 401; return r.end('{"error":"no"}'); } if (q.url.startsWith('/api/bot/user')) { r.statusCode = 404; return r.end('{"error":"x"}'); } r.end('{"ok":1}'); }).listen(0);
  const url = 'http://127.0.0.1:' + srv.address().port; const good = makeSite({ siteUrl: url, botApiToken: 'T' }), bad = makeSite({ siteUrl: url, botApiToken: 'X' });
  assert.deepStrictEqual(await good.sync(), { ok: 1 }); assert.strictEqual(await good.user('5'), null); await assert.rejects(bad.sync(), e => e.status === 401); srv.close();
  console.log('Все тесты пройдены');
})().catch(e => { console.error(e); process.exit(1); });
