"""Default cert sets created on first run."""

from pathlib import Path

import certs

DEFAULT_CERT_SETS = [
    dict(id="vectorline-c2pa", name="Vectorline Test Claim Signer", org="Vectorline Test Lab",
         common_name="Vectorline C2PA Test Signer", alg="es256", purpose="c2pa"),
    dict(id="vectorline-cawg", name="Vectorline Test CAWG Identity", org="Vectorline Test Lab",
         common_name="Jordan Example (Test Identity)", alg="es256", purpose="cawg"),
]


def ensure_default_certs(cert_root: Path) -> list[dict]:
    out = []
    for d in DEFAULT_CERT_SETS:
        target = cert_root / d["id"]
        if (target / "certset.json").exists():
            out.append(certs.describe(target))
        else:
            args = {k: v for k, v in d.items() if k != "id"}
            out.append(certs.generate(target, **args))
    return out
