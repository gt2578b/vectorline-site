"""Generate C2PA/CAWG test certificate chains.

Each "cert set" is a directory holding a root CA, an intermediate CA and an
end-entity signing certificate that follows the C2PA certificate profile
(C2PA spec, "X.509 Certificates"):

* v3 certificates, ECDSA P-256 / P-384 or Ed25519 keys, SHA-256+ signatures
* CA certs: critical basicConstraints CA:TRUE, keyCertSign/cRLSign
* end entity: critical keyUsage digitalSignature, an EKU that includes
  id-kp-emailProtection and id-kp-documentSigning (never anyExtendedKeyUsage),
  subject + authority key identifiers, not self-signed

These are for testing only. They are not on the C2PA trust list, so public
validators will report the signer as untrusted/unknown while still showing
the manifest.
"""

from __future__ import annotations

import datetime as dt
import json
import re
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, ed25519
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID, ObjectIdentifier

DOCUMENT_SIGNING = ObjectIdentifier("1.3.6.1.5.5.7.3.36")

ALGS = {
    "es256": (lambda: ec.generate_private_key(ec.SECP256R1()), hashes.SHA256),
    "es384": (lambda: ec.generate_private_key(ec.SECP384R1()), hashes.SHA384),
    "es512": (lambda: ec.generate_private_key(ec.SECP521R1()), hashes.SHA512),
    "ed25519": (ed25519.Ed25519PrivateKey.generate, None),
}


def _name(cn: str, org: str, country: str, ou: str | None = None) -> x509.Name:
    attrs = [x509.NameAttribute(NameOID.COUNTRY_NAME, country),
             x509.NameAttribute(NameOID.ORGANIZATION_NAME, org)]
    if ou:
        attrs.append(x509.NameAttribute(NameOID.ORGANIZATIONAL_UNIT_NAME, ou))
    attrs.append(x509.NameAttribute(NameOID.COMMON_NAME, cn))
    return x509.Name(attrs)


def _build(subject, issuer, pub, issuer_key, issuer_pub, hash_alg, days, ca, path_len=None):
    now = dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=5)
    b = (x509.CertificateBuilder()
         .subject_name(subject)
         .issuer_name(issuer)
         .public_key(pub)
         .serial_number(x509.random_serial_number())
         .not_valid_before(now)
         .not_valid_after(now + dt.timedelta(days=days))
         .add_extension(x509.SubjectKeyIdentifier.from_public_key(pub), critical=False)
         .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(issuer_pub), critical=False))
    if ca:
        b = (b.add_extension(x509.BasicConstraints(ca=True, path_length=path_len), critical=True)
              .add_extension(x509.KeyUsage(digital_signature=False, content_commitment=False,
                                           key_encipherment=False, data_encipherment=False,
                                           key_agreement=False, key_cert_sign=True, crl_sign=True,
                                           encipher_only=False, decipher_only=False), critical=True))
    else:
        b = (b.add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
              .add_extension(x509.KeyUsage(digital_signature=True, content_commitment=False,
                                           key_encipherment=False, data_encipherment=False,
                                           key_agreement=False, key_cert_sign=False, crl_sign=False,
                                           encipher_only=False, decipher_only=False), critical=True)
              .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.EMAIL_PROTECTION,
                                                    DOCUMENT_SIGNING]), critical=False))
    return b.sign(issuer_key, hash_alg() if hash_alg else None)


def _pem_key(key) -> bytes:
    return key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                             serialization.NoEncryption())


def _pem_cert(cert) -> bytes:
    return cert.public_bytes(serialization.Encoding.PEM)


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "certs"


def generate(out_dir: Path, *, name: str, org: str, common_name: str, country: str = "US",
             alg: str = "es256", purpose: str = "c2pa", days: int = 365) -> dict:
    """Create root -> intermediate -> signer under out_dir and return its info."""
    if alg not in ALGS:
        raise ValueError(f"unsupported alg {alg!r}; choose one of {sorted(ALGS)}")
    new_key, hash_alg = ALGS[alg]
    out_dir.mkdir(parents=True, exist_ok=True)

    root_key = new_key()
    root_name = _name(f"{name} Root CA", org, country, "Testing Only - Not Trusted")
    root = _build(root_name, root_name, root_key.public_key(), root_key, root_key.public_key(),
                  hash_alg, days * 10, ca=True, path_len=1)

    int_key = new_key()
    int_name = _name(f"{name} Intermediate CA", org, country, "Testing Only - Not Trusted")
    inter = _build(int_name, root_name, int_key.public_key(), root_key, root_key.public_key(),
                   hash_alg, days * 5, ca=True, path_len=0)

    ee_key = new_key()
    ee_name = _name(common_name, org, country, "C2PA Claim Signing" if purpose == "c2pa"
                    else "CAWG Identity")
    ee = _build(ee_name, int_name, ee_key.public_key(), int_key, int_key.public_key(),
                hash_alg, days, ca=False)

    (out_dir / "root_ca.pem").write_bytes(_pem_cert(root))
    (out_dir / "root_ca.key").write_bytes(_pem_key(root_key))
    (out_dir / "intermediate_ca.pem").write_bytes(_pem_cert(inter))
    (out_dir / "intermediate_ca.key").write_bytes(_pem_key(int_key))
    (out_dir / "signer.key").write_bytes(_pem_key(ee_key))
    # Signing chain: end entity first, then intermediate. The root is left out,
    # as validators expect to find it in their own trust store.
    (out_dir / "signer_chain.pem").write_bytes(_pem_cert(ee) + _pem_cert(inter))

    meta = {"name": name, "alg": alg, "purpose": purpose,
            "created": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")}
    (out_dir / "certset.json").write_text(json.dumps(meta, indent=2))
    return describe(out_dir)


def _cert_summary(cert: x509.Certificate) -> dict:
    try:
        eku = [o.dotted_string for o in
               cert.extensions.get_extension_for_class(x509.ExtendedKeyUsage).value]
    except x509.ExtensionNotFound:
        eku = []
    return {
        "subject": cert.subject.rfc4514_string(),
        "issuer": cert.issuer.rfc4514_string(),
        "serial": format(cert.serial_number, "x"),
        "not_before": cert.not_valid_before_utc.isoformat(),
        "not_after": cert.not_valid_after_utc.isoformat(),
        "eku": eku,
        "sha256": cert.fingerprint(hashes.SHA256()).hex(":"),
    }


def describe(cert_dir: Path) -> dict:
    meta = json.loads((cert_dir / "certset.json").read_text())
    chain = x509.load_pem_x509_certificates((cert_dir / "signer_chain.pem").read_bytes())
    root = x509.load_pem_x509_certificate((cert_dir / "root_ca.pem").read_bytes())
    return {**meta, "id": cert_dir.name,
            "chain": [_cert_summary(c) for c in chain],
            "root": _cert_summary(root)}


if __name__ == "__main__":
    import argparse

    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--out", default=str(Path(__file__).parent / "data" / "certs"))
    p.add_argument("--defaults", action="store_true", help="create the default C2PA and CAWG sets")
    p.add_argument("--name"), p.add_argument("--org"), p.add_argument("--cn")
    p.add_argument("--alg", default="es256", choices=sorted(ALGS))
    p.add_argument("--purpose", default="c2pa", choices=["c2pa", "cawg"])
    p.add_argument("--days", type=int, default=365)
    a = p.parse_args()
    out = Path(a.out)
    if a.defaults or not a.name:
        from defaults import ensure_default_certs
        for info in ensure_default_certs(out):
            print(f"{info['id']}: {info['chain'][0]['subject']}")
    else:
        info = generate(out / slugify(a.name), name=a.name, org=a.org or a.name,
                        common_name=a.cn or a.name, alg=a.alg, purpose=a.purpose, days=a.days)
        print(json.dumps(info, indent=2))
