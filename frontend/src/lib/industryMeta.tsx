import {
  Building2, Cpu, Factory, FlaskConical, Flame, Leaf, Recycle, Sprout, Warehouse, Wheat, Wine, Wrench, Zap, Newspaper,
  type LucideIcon,
} from "lucide-react";

export const INDUSTRY_META: Record<string, { color: string; icon: LucideIcon; label: string }> = {
  steel: { color: "#475569", icon: Factory, label: "Steel" },
  cement: { color: "#78716C", icon: Building2, label: "Cement" },
  thermal_power: { color: "#D97706", icon: Zap, label: "Thermal Power" },
  sugar_mill: { color: "#65A30D", icon: Wheat, label: "Sugar Mill" },
  distillery: { color: "#7C3AED", icon: Wine, label: "Distillery" },
  paper_mill: { color: "#0E7490", icon: Newspaper, label: "Paper Mill" },
  brick_kiln: { color: "#EA580C", icon: Flame, label: "Brick Kiln" },
  fertilizer_phosphate: { color: "#14B8A6", icon: Sprout, label: "Fertilizer" },
  chemical: { color: "#DB2777", icon: FlaskConical, label: "Chemical" },
  data_centre: { color: "#0284C7", icon: Cpu, label: "Data Centre" },
  food_processing: { color: "#CA8A04", icon: Warehouse, label: "Food Processing" },
  auto_components: { color: "#2563EB", icon: Wrench, label: "Auto Components" },
  greenhouse: { color: "#16A34A", icon: Leaf, label: "Greenhouse" },
  biogas_plant: { color: "#15803D", icon: Recycle, label: "Biogas Plant" },
};

export const metaFor = (t: string) => INDUSTRY_META[t] ?? { color: "#475569", icon: Factory, label: t };
