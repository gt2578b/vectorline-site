"""C2PA Studio: author C2PA/CAWG manifest profiles, sign assets, and verify them.

Run with:  python server.py   (then open http://127.0.0.1:5178)
"""

from __future__ import annotations

import functools
import io
import json
import os
import re
import shutil
import uuid
import zipfile
from pathlib import Path

import c2pa
from flask import Flask, abort, jsonify, request, send_file, send_from_directory

import certs
import signing
from defaults import ensure_default_certs

HERE = Path(__file__).resolve().parent
DATA = Path(os.environ.get("C2PA_STUDIO_DATA", HERE / "data"))
PROFILES = Path(os.environ.get("C2PA_STUDIO_PROFILES", HERE / "profiles"))
CERTS = DATA / "certs"
OUTPUT = DATA / "output"

ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
CERT_DOWNLOADS = {
    "root_ca.pem": "application/x-pem-file",
    "signer_chain.pem": "application/x-pem-file",
    "signer.key": "application/x-pem-file",
    "intermediate_ca.pem": "application/x-pem-file",
}

app = Flask(__name__, static_folder=str(HERE / "static"), static_url_path="/static")
app.config["MAX_CONTENT_LENGTH"] = 512 * 1024 * 1024
app.json.sort_keys = False  # keep manifest keys in the author's order


def _check_id(value: str) -> str:
    if not ID_RE.match(value or ""):
        abort(400, description=f"Invalid id {value!r}: use lowercase letters, digits and dashes.")
    return value


def _cert_dir(cert_id: str) -> Path:
    path = CERTS / _check_id(cert_id)
    if not (path / "certset.json").exists():
        abort(404, description=f"Unknown certificate set {cert_id!r}")
    return path


def _all_root_pems() -> list[str]:
    return [(d / "root_ca.pem").read_text() for d in sorted(CERTS.iterdir())
            if (d / "root_ca.pem").exists()] if CERTS.exists() else []


@app.errorhandler(400)
@app.errorhandler(404)
@app.errorhandler(413)
def _http_error(err):
    return jsonify(error=getattr(err, "description", str(err))), err.code


@app.errorhandler(c2pa.C2paError)
def _c2pa_error(err):
    return jsonify(error=f"{type(err).__name__.lstrip('_')}: {err}"), 422


@app.errorhandler(ValueError)
def _value_error(err):
    return jsonify(error=str(err)), 400


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/api/meta")
def meta():
    return jsonify(sdk_version=c2pa.sdk_version(), supported=signing.supported_mime_types(),
                   template_vars=sorted(signing.template_vars("example.jpg", "image/jpeg")))


# --- Profiles ---------------------------------------------------------------

@app.get("/api/profiles")
def list_profiles():
    out = []
    for p in sorted(PROFILES.glob("*.json")):
        try:
            prof = json.loads(p.read_text())
        except json.JSONDecodeError as e:
            prof = {"name": p.stem, "error": f"Invalid JSON: {e}"}
        prof["id"] = p.stem
        out.append(prof)
    return jsonify(out)


@app.put("/api/profiles/<pid>")
def save_profile(pid):
    _check_id(pid)
    prof = request.get_json(force=True)
    if not isinstance(prof, dict) or not isinstance(prof.get("manifest"), dict):
        abort(400, description="A profile needs a 'manifest' object.")
    prof["id"] = pid
    PROFILES.mkdir(parents=True, exist_ok=True)
    (PROFILES / f"{pid}.json").write_text(json.dumps(prof, indent=2, ensure_ascii=False) + "\n")
    return jsonify(prof)


@app.delete("/api/profiles/<pid>")
def delete_profile(pid):
    path = PROFILES / f"{_check_id(pid)}.json"
    if path.exists():
        path.unlink()
    return jsonify(ok=True)


# --- Certificates -------------------------------------------------------------

@app.get("/api/certs")
def list_certs():
    CERTS.mkdir(parents=True, exist_ok=True)
    return jsonify([certs.describe(d) for d in sorted(CERTS.iterdir())
                    if (d / "certset.json").exists()])


@app.post("/api/certs")
def create_certs():
    body = request.get_json(force=True)
    name = (body.get("name") or "").strip()
    if not name:
        abort(400, description="Name is required.")
    cid = certs.slugify(name)
    if (CERTS / cid).exists():
        abort(400, description=f"A certificate set named {cid!r} already exists.")
    info = certs.generate(CERTS / cid, name=name,
                          org=(body.get("org") or name).strip(),
                          common_name=(body.get("commonName") or name).strip(),
                          country=(body.get("country") or "US").strip()[:2].upper(),
                          alg=body.get("alg", "es256"),
                          purpose=body.get("purpose", "c2pa"),
                          days=int(body.get("days") or 365))
    return jsonify(info), 201


@app.delete("/api/certs/<cid>")
def delete_certs(cid):
    shutil.rmtree(_cert_dir(cid))
    return jsonify(ok=True)


@app.get("/api/certs/<cid>/<filename>")
def download_cert(cid, filename):
    d = _cert_dir(cid)
    if filename == "bundle.zip":
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            for f in sorted(d.iterdir()):
                z.write(f, f"{cid}/{f.name}")
        buf.seek(0)
        return send_file(buf, mimetype="application/zip", as_attachment=True,
                         download_name=f"{cid}.zip")
    if filename not in CERT_DOWNLOADS:
        abort(404)
    return send_file(d / filename, mimetype=CERT_DOWNLOADS[filename], as_attachment=True,
                     download_name=f"{cid}-{filename}")


# --- Signing and verification ---------------------------------------------------

def _form_json(name: str, default=None):
    raw = request.form.get(name)
    if raw is None:
        return default
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        abort(400, description=f"Field {name!r} is not valid JSON: {e}")


@app.post("/api/sign")
def sign():
    profile = _form_json("profile")
    asset = request.files.get("asset")
    if not profile or not asset:
        abort(400, description="Send a profile and an asset to sign.")
    sig = profile.get("signing") or {}
    signer = signing.CertSet.load(_cert_dir(sig.get("certSet") or ""))
    cawg_cfg = sig.get("cawg") or {}
    cawg = signing.CertSet.load(_cert_dir(cawg_cfg["certSet"])) if cawg_cfg.get("enabled") else None

    ing_meta = _form_json("ingredients", [])
    ing_files = request.files.getlist("ingredient")
    if len(ing_meta) != len(ing_files):
        abort(400, description="Ingredient files and metadata don't line up.")
    ingredients = [signing.Ingredient(filename=f.filename, data=f.read(),
                                      relationship=m.get("relationship", "componentOf"),
                                      label=m.get("label") or None, title=m.get("title") or None)
                   for f, m in zip(ing_files, ing_meta)]

    filename = Path(asset.filename or "asset").name
    signed, report = signing.sign(signing.SignRequest(
        manifest=profile["manifest"], asset_name=filename, asset=asset.read(),
        signer=signer, cawg=cawg,
        cawg_referenced_assertions=cawg_cfg.get("referencedAssertions") or [],
        cawg_roles=cawg_cfg.get("roles") or [],
        tsa_url=(sig.get("tsaUrl") or "").strip() or None,
        ingredients=ingredients,
        trust_anchors=_all_root_pems()))

    out_id = uuid.uuid4().hex[:12]
    stem, _, ext = filename.rpartition(".")
    out_name = f"{stem or filename}-signed.{ext}" if stem else f"{filename}-signed"
    out_dir = OUTPUT / out_id
    out_dir.mkdir(parents=True)
    (out_dir / out_name).write_bytes(signed)
    (out_dir / "manifest-store.json").write_text(json.dumps(report["store"], indent=2))
    return jsonify(id=out_id, filename=out_name, size=len(signed),
                   download=f"/api/outputs/{out_id}/{out_name}",
                   manifest=f"/api/outputs/{out_id}/manifest-store.json",
                   report=report)


@app.get("/api/outputs/<oid>/<filename>")
def download_output(oid, filename):
    if not re.fullmatch(r"[0-9a-f]{12}", oid):
        abort(404)
    return send_from_directory(OUTPUT / oid, filename, as_attachment=True)


@app.post("/api/verify")
def verify():
    f = request.files.get("file")
    if not f:
        abort(400, description="Send a file to verify.")
    anchors = _all_root_pems() if request.form.get("trust", "local") == "local" else []
    return jsonify(signing.read(f.read(), Path(f.filename or "asset").name, anchors))


@app.get("/api/sample.jpg")
def sample_image():
    return send_file(io.BytesIO(_sample_jpeg()), mimetype="image/jpeg", download_name="sample.jpg")


@functools.cache
def _sample_jpeg() -> bytes:
    from PIL import Image, ImageDraw

    w, h = 1200, 800
    img = Image.linear_gradient("L").resize((w, h)).convert("RGB")
    img = Image.merge("RGB", [band.point(lambda v, lo=lo, hi=hi: lo + (hi - lo) * v // 255)
                              for band, (lo, hi) in zip(img.split(), [(13, 53), (17, 47), (83, 23)])])
    d = ImageDraw.Draw(img)
    for i in range(14):
        r = 40 + i * 38
        d.ellipse((w * 0.62 - r, h * 0.45 - r, w * 0.62 + r, h * 0.45 + r),
                  outline=(176, 141, 87), width=2)
    d.text((60, h - 90), "C2PA Studio sample asset", fill=(245, 243, 239))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=90)
    return buf.getvalue()


def main():
    import argparse

    p = argparse.ArgumentParser(description="C2PA Studio")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=5178)
    p.add_argument("--debug", action="store_true")
    a = p.parse_args()
    ensure_default_certs(CERTS)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    print(f"C2PA Studio (c2pa-rs {c2pa.sdk_version()}) on http://{a.host}:{a.port}")
    app.run(host=a.host, port=a.port, debug=a.debug)


if __name__ == "__main__":
    main()
