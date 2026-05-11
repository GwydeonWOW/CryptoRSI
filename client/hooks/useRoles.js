/**
 * Role-based permission helpers
 *
 * Hierarchy: owner > admin > moderator > user
 */

export function isOwner(user) {
  return user?.role === 'owner';
}

export function isAdmin(user) {
  return user?.role === 'owner' || user?.role === 'admin';
}

export function isModerator(user) {
  return user?.role === 'owner' || user?.role === 'admin' || user?.role === 'moderator';
}

export function roleLabel(role) {
  return { owner: 'Owner', admin: 'Admin', moderator: 'Moderador', user: 'Usuario' }[role] || role;
}
