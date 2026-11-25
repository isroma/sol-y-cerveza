// Map layer ids that code outside the map chunk needs. Kept apart from the
// modules that add the layers: those import MapLibre itself, and importing
// one from the entry chunk (App.tsx via night.ts) would pull all of MapLibre
// into it, ahead of first paint.

/** The tree crowns' source and layer (treeCrowns.ts). */
export const TREES = 'tree-crowns'
