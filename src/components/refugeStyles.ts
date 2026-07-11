// Refuge category colours & labels — plain constants, no Leaflet import
// (so they can be imported by pages without pulling `window`-dependent code).
export const REFUGE_COLORS: Record<string, string> = {
  refuge: "#1B9E4B", libre: "#1E7FE0", cabane: "#F07316", ruine: "#6B7280",
};
export const REFUGE_LABELS: Record<string, string> = {
  refuge: "Refuge gardé", libre: "Cabane ouverte", cabane: "Cabane / abri", ruine: "Ruine",
};
