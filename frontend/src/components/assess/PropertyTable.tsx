import type { AssessedProperty } from "../../types";
import { PropStatusBadge, SourceTag } from "../cards/Badges";

const u = (p: string) => (p === "temperature_C" ? "°C" : p === "calorific_value_MJkg" ? " MJ/kg" : "%");

export default function PropertyTable({ rows }: { rows: AssessedProperty[] }) {
  if (!rows.length) return <p className="text-sm text-muted">The buyer has no property specification for this input.</p>;
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-[11px] uppercase tracking-wider text-muted"><tr><th className="py-2 font-medium">Property</th><th className="font-medium">Actual</th><th className="font-medium">Required</th><th className="font-medium">Result</th><th className="font-medium text-right">Source</th></tr></thead>
      <tbody className="divide-y divide-border">
        {rows.map((r) => (
          <tr key={r.property}>
            <td className="py-2.5 font-medium">{r.label}</td>
            <td className="tabular-nums">{r.actual == null ? <span className="text-muted">Unknown</span> : `${r.actual}${u(r.property)}`}</td>
            <td className="text-muted tabular-nums">{r.min}-{r.max}{u(r.property)}</td>
            <td><PropStatusBadge status={r.status} />{r.note && <div className="text-[11px] text-sky mt-0.5">{r.note}</div>}</td>
            <td className="text-right"><SourceTag source={r.source} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
