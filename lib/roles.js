// which Discord roles a site account should have, and how to bring a guild member to that state
function desiredRoles(tier, roles) {
  const d = new Set();
  if (tier === 'admin') { if (roles.fighter) d.add(roles.fighter); if (roles.admin) d.add(roles.admin); }
  else if (tier === 'fighter') { if (roles.fighter) d.add(roles.fighter); }
  else if (tier === 'approved') { if (roles.approved) d.add(roles.approved); }
  return d;
}
const managed = roles => Object.values(roles).filter(Boolean);
// member: { roles: { cache: Map-like with has(id) }, ... }; returns what has to be added / removed (only managed roles are ever touched)
function diff(memberRoleIds, tier, roles) {
  const want = desiredRoles(tier, roles), have = new Set(memberRoleIds), man = new Set(managed(roles));
  return { add: [...want].filter(r => !have.has(r)), remove: [...man].filter(r => have.has(r) && !want.has(r)) };
}
module.exports = { desiredRoles, managed, diff };
