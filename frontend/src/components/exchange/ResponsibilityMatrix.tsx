import { titleCase } from "../../lib/format";

const OPTS = ["supplier", "buyer", "shared"];

export default function ResponsibilityMatrix({ value, editable, onChange }: { value: Record<string, string>; editable: boolean; onChange: (topic: string, v: string) => void }) {
  return (
    <div data-demo="responsibilities">
      <table className="table">
        <thead><tr><th>Topic</th><th>Responsible</th></tr></thead>
        <tbody>
          {Object.entries(value).map(([k, v]) => (
            <tr key={k}>
              <td>{titleCase(k.replace(/_/g, " "))}</td>
              <td>{editable ? (
                <select className="input !h-8 !w-36" value={v} onChange={(e) => onChange(k, e.target.value)}>{OPTS.map((o) => <option key={o} value={o}>{titleCase(o)}</option>)}</select>
              ) : <span className="font-medium">{titleCase(v)}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] text-muted mt-2">Changing terms after signing resets signatures. This checklist supports, and does not replace, a legal contract.</p>
    </div>
  );
}
