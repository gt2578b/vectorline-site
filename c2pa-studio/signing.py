"""Sign and read C2PA manifests (with optional CAWG identity) via c2pa-python."""

from __future__ import annotations

import copy
import datetime as dt
import io
import json
import re
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import c2pa

TEMPLATE_VAR = re.compile(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}")

EXT_TO_MIME = {
    "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp",
    "gif": "image/gif", "tif": "image/tiff", "tiff": "image/tiff", "avif": "image/avif",
    "heic": "image/heic", "heif": "image/heif", "svg": "image/svg+xml", "dng": "image/x-adobe-dng",
    "mp4": "video/mp4", "mov": "video/quicktime", "m4v": "video/x-m4v", "avi": "video/x-msvideo",
    "mp3": "audio/mpeg", "m4a": "audio/mp4", "wav": "audio/wav", "pdf": "application/pdf",
}


def mime_for(filename: str, fallback: str | None = None) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    mime = EXT_TO_MIME.get(ext) or fallback
    if not mime:
        raise ValueError(f"Can't tell the media type of {filename!r}")
    return mime


def supported_mime_types() -> list[str]:
    return sorted(set(c2pa.Builder.get_supported_mime_types()))


def template_vars(filename: str, mime: str) -> dict[str, str]:
    now = dt.datetime.now(dt.timezone.utc)
    return {
        "filename": filename,
        "basename": filename.rsplit(".", 1)[0],
        "format": mime,
        "now": now.isoformat(timespec="seconds").replace("+00:00", "Z"),
        "date": now.date().isoformat(),
        "year": str(now.year),
        "uuid": str(uuid.uuid4()),
    }


def expand_templates(value, variables: dict[str, str]):
    """Replace {{var}} placeholders in every string of a JSON-like value."""
    if isinstance(value, str):
        return TEMPLATE_VAR.sub(lambda m: variables.get(m.group(1), m.group(0)), value)
    if isinstance(value, list):
        return [expand_templates(v, variables) for v in value]
    if isinstance(value, dict):
        return {k: expand_templates(v, variables) for k, v in value.items()}
    return value


@dataclass
class CertSet:
    alg: str
    chain_pem: str
    key_pem: str
    root_pem: str

    @classmethod
    def load(cls, cert_dir: Path) -> "CertSet":
        meta = json.loads((cert_dir / "certset.json").read_text())
        return cls(alg=meta["alg"],
                   chain_pem=(cert_dir / "signer_chain.pem").read_text(),
                   key_pem=(cert_dir / "signer.key").read_text(),
                   root_pem=(cert_dir / "root_ca.pem").read_text())

    def local_signer(self, tsa_url: str | None = None, **extra) -> dict:
        signer = {"alg": self.alg, "sign_cert": self.chain_pem, "private_key": self.key_pem}
        if tsa_url:
            signer["tsa_url"] = tsa_url
        signer.update(extra)
        return {"local": signer}


@dataclass
class Ingredient:
    filename: str
    data: bytes
    relationship: str = "componentOf"
    label: str | None = None
    title: str | None = None


@dataclass
class SignRequest:
    manifest: dict
    asset_name: str
    asset: bytes
    signer: CertSet
    cawg: CertSet | None = None
    cawg_referenced_assertions: list[str] = field(default_factory=list)
    cawg_roles: list[str] = field(default_factory=list)
    tsa_url: str | None = None
    ingredients: list[Ingredient] = field(default_factory=list)
    trust_anchors: list[str] = field(default_factory=list)


def _context(settings: dict) -> c2pa.Context:
    return c2pa.Context(settings=c2pa.Settings.from_dict(settings))


def _trust_settings(anchors: list[str]) -> dict:
    settings: dict = {"verify": {"verify_trust": True}}
    if anchors:
        settings["trust"] = {"user_anchors": "\n".join(a.strip() for a in anchors) + "\n"}
    return settings


def prepare_manifest(manifest: dict, filename: str, mime: str) -> dict:
    m = expand_templates(copy.deepcopy(manifest), template_vars(filename, mime))
    m.setdefault("title", filename)
    m["format"] = mime
    m.pop("ingredients", None)  # ingredients come from uploaded files
    return m


def sign(req: SignRequest) -> tuple[bytes, dict]:
    """Return (signed asset bytes, reader report) for a sign request."""
    mime = mime_for(req.asset_name)
    manifest = prepare_manifest(req.manifest, req.asset_name, mime)

    settings = _trust_settings(req.trust_anchors)
    settings["signer"] = req.signer.local_signer(req.tsa_url)
    if req.cawg:
        settings["cawg_x509_signer"] = req.cawg.local_signer(
            req.tsa_url,
            referenced_assertions=req.cawg_referenced_assertions,
            roles=req.cawg_roles)

    ctx = _context(settings)
    builder = c2pa.Builder(manifest, ctx)
    # The signer is defined in settings (the only way to attach the CAWG
    # identity signer), which c2pa-python doesn't count as a context signer.
    builder._has_context_signer = True
    for ing in req.ingredients:
        ing_json = {"title": ing.title or ing.filename, "relationship": ing.relationship}
        if ing.label:
            ing_json["label"] = ing.label
        builder.add_ingredient(ing_json, mime_for(ing.filename), io.BytesIO(ing.data))

    out = io.BytesIO()
    builder.sign(mime, io.BytesIO(req.asset), out)
    signed = out.getvalue()
    return signed, read(signed, req.asset_name, req.trust_anchors)


def read(data: bytes, filename: str, trust_anchors: list[str] | None = None) -> dict:
    """Read and validate the manifest store in an asset."""
    mime = mime_for(filename)
    ctx = _context(_trust_settings(trust_anchors or []))
    try:
        reader = c2pa.Reader(mime, io.BytesIO(data), context=ctx)
    except c2pa.C2paError as e:
        if "ManifestNotFound" in type(e).__name__ or "not found" in str(e).lower():
            return {"found": False, "error": "No Content Credentials found in this file."}
        raise
    with reader:
        store = json.loads(reader.json())
        return {
            "found": True,
            "validation_state": reader.get_validation_state(),
            "store": store,
            "detailed": json.loads(reader.detailed_json()),
        }
