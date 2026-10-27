"""End-to-end checks: every bundled profile signs, reads back and validates."""

import io
import json
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))


@pytest.fixture(scope="session")
def client(tmp_path_factory):
    import os

    os.environ["C2PA_STUDIO_DATA"] = str(tmp_path_factory.mktemp("data"))
    import server
    from defaults import ensure_default_certs

    ensure_default_certs(server.CERTS)
    server.app.config["TESTING"] = True
    return server.app.test_client()


@pytest.fixture(scope="session")
def sample(client):
    return client.get("/api/sample.jpg").data


def _profiles(client):
    return client.get("/api/profiles").get_json()


def _active(report):
    store = report["store"]
    return store["manifests"][store["active_manifest"]]


def test_default_certs_follow_c2pa_profile(client):
    sets = {c["id"]: c for c in client.get("/api/certs").get_json()}
    assert {"vectorline-c2pa", "vectorline-cawg"} <= set(sets)
    for c in sets.values():
        signer, intermediate = c["chain"]
        assert "1.3.6.1.5.5.7.3.4" in signer["eku"]  # emailProtection
        assert "1.3.6.1.5.5.7.3.36" in signer["eku"]  # documentSigning
        assert signer["issuer"] == intermediate["subject"]
        assert intermediate["issuer"] == c["root"]["subject"]


@pytest.mark.parametrize("pid", sorted(p.stem for p in (HERE / "profiles").glob("*.json")))
def test_profile_signs_and_validates(client, sample, pid):
    profile = next(p for p in _profiles(client) if p["id"] == pid)
    data = {"profile": json.dumps(profile), "asset": (io.BytesIO(sample), "photo.jpg")}
    needs_parent = any(
        "parent" in (a.get("parameters") or {}).get("ingredientIds", [])
        for asrt in profile["manifest"]["assertions"] if asrt["label"].startswith("c2pa.actions")
        for a in asrt["data"]["actions"])
    if needs_parent:
        data["ingredient"] = [(io.BytesIO(sample), "original.jpg")]
        data["ingredients"] = json.dumps([{"relationship": "parentOf", "label": "parent"}])
    res = client.post("/api/sign", data=data, content_type="multipart/form-data")
    assert res.status_code == 200, res.get_json()
    body = res.get_json()
    report = body["report"]
    assert report["validation_state"] in ("Valid", "Trusted")

    labels = {a["label"] for a in _active(report)["assertions"]}
    for a in profile["manifest"]["assertions"]:
        assert a["label"] in labels
    assert ("cawg.identity" in labels) == profile["signing"]["cawg"]["enabled"]

    failures = report["store"]["validation_results"]["activeManifest"]["failure"]
    # The CAWG credential can't be anchored locally, so it is expected to be untrusted.
    assert [f["code"] for f in failures if f["code"] != "cawg.x509.credential.untrusted"] == []

    signed = client.get(body["download"]).data
    public = client.post("/api/verify", data={"file": (io.BytesIO(signed), body["filename"]),
                                              "trust": "public"},
                         content_type="multipart/form-data").get_json()
    codes = {f["code"] for f in public["store"]["validation_results"]["activeManifest"]["failure"]}
    assert "signingCredential.untrusted" in codes


def test_templates_expand(client, sample):
    profile = next(p for p in _profiles(client) if p["id"] == "newsroom-capture")
    res = client.post("/api/sign", data={"profile": json.dumps(profile),
                                         "asset": (io.BytesIO(sample), "harbor.jpg")},
                      content_type="multipart/form-data").get_json()
    meta = next(a for a in _active(res["report"])["assertions"] if a["label"] == "cawg.metadata")
    assert meta["data"]["dc:title"] == "harbor"
    assert "{{" not in json.dumps(meta)


def test_verify_unsigned_file(client, sample):
    res = client.post("/api/verify", data={"file": (io.BytesIO(sample), "plain.jpg")},
                      content_type="multipart/form-data").get_json()
    assert res["found"] is False


def test_generate_cert_set(client):
    res = client.post("/api/certs", json={"name": "Test ES384", "org": "Example", "alg": "es384",
                                          "purpose": "cawg"})
    assert res.status_code == 201
    assert res.get_json()["id"] == "test-es384"
    assert client.get("/api/certs/test-es384/bundle.zip").status_code == 200
    assert client.delete("/api/certs/test-es384").status_code == 200
