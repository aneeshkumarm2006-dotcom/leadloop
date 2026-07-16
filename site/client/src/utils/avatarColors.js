/**
 * avatarColors — the single warm-editorial avatar palette + hash helper.
 * One source of truth (previously duplicated across Navbar / PageWrapper /
 * Members / Settings / WorkspaceHome with an off-brand rainbow).
 */
export const AVATAR_COLORS = [
  '#3E6B4E', // forest
  '#6E8B3D', // olive
  '#B08A3C', // gold
  '#C4632B', // terracotta
  '#7A5A44', // walnut
  '#4E7A70', // spruce
];

export const getAvatarColor = (seed = '') => {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) & 0xffffffff;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
};

export const getInitial = (name) => {
  if (!name) return '?';
  return name.trim().charAt(0).toUpperCase();
};
