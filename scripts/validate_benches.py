#!/usr/bin/env python3
"""Validate first-class bench POIs."""

from __future__ import annotations

import json
import os
import pathlib
from datetime import datetime, timezone

try:
    from .provenance_contract import validate_spatial_entity
except ImportError:
    from provenance_contract import validate_spatial_entity


ROOT = pathlib.Path(__file__).resolve().parents[1]
CANONICAL_DATA = ROOT / "data"
DATA = pathlib.Path(os.environ.get("BERGPARK_OUTPUT_DATA", str(CANONICAL_DATA))).resolve()
REPORT_DATA = pathlib.Path(os.environ.get("BERGPARK_VALIDATION_OUTPUT_DATA", str(DATA))).resolve()


def main() -> int:
    doc = json.loads((DATA / "benches.json").read_text())
    benches = doc["benches"]
    errors = []
    ids = [b["id"] for b in benches]
    if len(benches) != 215:
        errors.append(f"expected 215 benches, got {len(benches)}")
    if len(ids) != len(set(ids)):
        errors.append("duplicate bench ids")
    for bench in benches:
        if bench["id"] != f"bench-{bench['osm_node_id']}":
            errors.append(f"unstable bench id: {bench['id']}")
        if not (51.30 <= bench["lat"] <= 51.33 and 9.38 <= bench["lng"] <= 9.435):
            errors.append(f"bench outside research bbox: {bench['id']}")
        if not isinstance(bench.get("elevation_m"), (int, float)):
            errors.append(f"bench elevation missing: {bench['id']}")
        common_failures = validate_spatial_entity(bench, label=f"bench:{bench['id']}")
        errors.extend(common_failures)
    summary = {
        "benches": len(benches),
        "with_backrest_tag": sum(b.get("backrest") is not None for b in benches),
        "with_direction_tag": sum(b.get("direction_deg") is not None for b in benches),
        "with_access_tag": sum(b.get("access") is not None for b in benches),
        "with_check_date": sum(b.get("check_date") is not None for b in benches),
        "errors": len(errors),
    }
    result = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": "pass" if not errors else "fail",
        "summary": summary,
        "errors": errors,
    }
    REPORT_DATA.mkdir(parents=True, exist_ok=True)
    (REPORT_DATA / "bench_validation.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(summary, ensure_ascii=False))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
