"""Pull property values out of lab reports so suppliers don't retype them.
PDF / CSV / TXT: text extraction + label/value patterns (with unit conversion). Images: Claude vision when a key
is configured. Every extracted value is a suggestion the uploader confirms; it is stored as 'document_extracted'."""
import base64
import io
import json
import re
from datetime import datetime

from . import llm

# property key -> label patterns (case-insensitive)
PATTERNS = {
    "CaO": [r"\bCaO\b", r"calcium oxide"], "SiO2": [r"\bSiO\s?2\b", r"\bsilica\b"], "Al2O3": [r"\bAl\s?2\s?O\s?3\b", r"alumina"],
    "Fe2O3": [r"\bFe\s?2\s?O\s?3\b", r"ferric oxide"], "moisture": [r"(?:free\s+)?moisture(?:\s+content)?", r"\bH2O\b", r"water content"],
    "purity_pct": [r"purity", r"CaSO4\s*[.·]?\s*2H2O", r"gypsum content"], "organic_pct": [r"organic (?:matter|carbon|content)"],
    "acid_pct": [r"acid (?:strength|content|concentration)", r"\bH2SO4\b", r"\bHCl\b"], "K2O_pct": [r"\bK\s?2\s?O\b", r"potash"],
    "CO2_pct": [r"\bCO2\b(?: concentration)?"], "Fe_pct": [r"total iron", r"\bFe\s*\(total\)", r"\bFe\s*%"],
    "calorific_value_MJkg": [r"(?:gross |net )?calorific value", r"\bGCV\b", r"\bNCV\b"], "temperature_C": [r"temperature"],
}
NUM = r"[:=|\s]*(?:is\s+)?(?:about\s+)?([<>≤≥]?\s*\d{1,5}(?:[.,]\d+)?)\s*(%|wt\s*%|kcal\s*/\s*kg|mj\s*/\s*kg|°\s*c|deg\s*c)?"
META = {
    "issue_date": [r"(?:date of (?:issue|report|testing|test)|report date|issue date|tested on)\s*[:\-]?\s*([0-9]{1,4}[./-][0-9]{1,2}[./-][0-9]{2,4})"],
    "issuer": [r"(?:issued by|laboratory|lab name|testing laboratory)\s*[:\-]\s*([^\n]{3,80})"],
    "batch_code": [r"(?:batch|lot|sample)\s*(?:no\.?|id|number|code)\s*[:\-]?\s*([A-Za-z0-9\-/]{2,30})"],
    "test_method": [r"(?:test method|method)\s*[:\-]\s*([^\n]{3,80})"],
}


def text_of(data: bytes, ext: str) -> str:
    if ext == ".pdf":
        from pypdf import PdfReader
        try:
            return "\n".join((p.extract_text() or "") for p in PdfReader(io.BytesIO(data)).pages[:10])
        except Exception:
            return ""
    if ext in (".csv", ".txt"):
        return data.decode("utf-8", errors="ignore")[:200_000]
    return ""


def _date(s: str) -> str | None:
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d.%m.%Y", "%Y/%m/%d", "%d-%m-%y", "%d/%m/%y"):
        try:
            return datetime.strptime(s.strip(), fmt).date().isoformat()
        except ValueError:
            continue
    return None


def parse_text(text: str) -> dict:
    values, snippets = {}, {}
    flat = text.replace("\r", "")
    for key, pats in PATTERNS.items():
        for pat in pats:
            m = re.search(pat + r"(?:\s*\([^)]{0,40}\))?" + NUM, flat, re.IGNORECASE)
            if not m:
                continue
            raw, unit = m.group(1), (m.group(2) or "").lower().replace(" ", "")
            try:
                v = float(raw.replace(",", ".").lstrip("<>≤≥ "))
            except ValueError:
                continue
            if key == "calorific_value_MJkg" and "kcal" in unit:
                v = round(v * 0.004184, 2)  # unit conversion before any specification comparison
            if key not in ("calorific_value_MJkg", "temperature_C") and v > 100:
                continue  # not a percentage: ignore rather than guess
            values[key] = v
            snippets[key] = m.group(0).strip()[:60]
            break
    meta = {}
    for k, pats in META.items():
        for pat in pats:
            m = re.search(pat, flat, re.IGNORECASE)
            if m:
                meta[k] = _date(m.group(1)) if k == "issue_date" else m.group(1).strip()[:120]
                if meta[k]:
                    break
    return {"values": values, "snippets": snippets, **meta}


def extract(data: bytes, ext: str) -> dict:
    ext = ext.lower()
    text = text_of(data, ext)
    out = parse_text(text) if text else {"values": {}, "snippets": {}}
    method = {".pdf": "pdf_text", ".csv": "csv", ".txt": "text"}.get(ext)
    if (not out["values"]) and llm.available():  # scanned PDF or photo of a report
        via = _llm_extract(data, ext, text)
        if via.get("values"):
            out, method = via, "llm"
    return {**out, "method": method if out.get("values") else None, "found": len(out.get("values", {})),
            "note": "Extracted values are suggestions. Check them against the document before submitting."}


def _llm_extract(data: bytes, ext: str, text: str) -> dict:
    keys = ", ".join(PATTERNS)
    system = ("You read laboratory test reports for industrial materials. Return ONLY JSON: {\"values\": {key: number}, "
              "\"issuer\": str|null, \"issue_date\": \"YYYY-MM-DD\"|null, \"batch_code\": str|null, \"test_method\": str|null}. "
              f"Allowed keys: {keys}. Percentages as numbers. Convert kcal/kg to MJ/kg. Never guess a value that is not printed.")
    try:
        client = llm._get_client()
        if ext in (".png", ".jpg", ".jpeg"):
            media = "image/png" if ext == ".png" else "image/jpeg"
            content = [{"type": "image", "source": {"type": "base64", "media_type": media, "data": base64.b64encode(data).decode()}},
                       {"type": "text", "text": "Extract the values."}]
        else:
            content = [{"type": "text", "text": text[:20_000] or "(empty)"}]
        resp = client.messages.create(model=llm.config.LLM_MODEL, max_tokens=800, system=system, messages=[{"role": "user", "content": content}])
        raw = llm.strip_fences("".join(b.text for b in resp.content if getattr(b, "type", "") == "text"))
        d = json.loads(raw)
        vals = {k: float(v) for k, v in (d.get("values") or {}).items() if k in PATTERNS and isinstance(v, (int, float))}
        return {"values": vals, "snippets": {}, **{k: d.get(k) for k in ("issuer", "issue_date", "batch_code", "test_method") if d.get(k)}}
    except Exception:
        return {"values": {}}
