export function inr(x: number, digits = 1): string {
  const a = Math.abs(x);
  if (a >= 1e7) return `₹${(x / 1e7).toFixed(digits)} Cr`;
  if (a >= 1e5) return `₹${(x / 1e5).toFixed(digits)} L`;
  return `₹${Math.round(x).toLocaleString("en-IN")}`;
}

export function num(x: number, digits = 0): string {
  const a = Math.abs(x);
  if (a >= 1e7) return `${(x / 1e7).toFixed(1)} Cr`;
  if (a >= 1e5) return `${(x / 1e5).toFixed(1)} L`;
  return x.toLocaleString("en-IN", { maximumFractionDigits: digits });
}

export const pct = (x: number) => `${Math.round(x * 100)}%`;
export const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function scoreColor(score: number): string {
  if (score >= 80) return "#16A34A";
  if (score >= 65) return "#0284C7";
  if (score >= 50) return "#D97706";
  return "#DC2626";
}

export const CATEGORY_COLOR: Record<string, string> = {
  // validated categorical palette (CVD-safe, always shown next to a text label)
  mineral: "#2a78d6", energy: "#eb6834", water: "#1baf7a", chemical: "#eda100", metal: "#e87ba4", organic: "#008300",
};

export const unitFor = (category: string) => (category === "energy" ? "MWh" : "t");
