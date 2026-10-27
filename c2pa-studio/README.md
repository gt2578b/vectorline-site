# C2PA Studio

A local app for writing C2PA and CAWG manifests as reusable **profiles**, signing assets with them using test certificates, and checking the results.

- **Profiles editor**: a form for each assertion type (actions, CAWG metadata, training and data mining, schema.org CreativeWork, custom). Every form can also be edited as raw JSON. It has undo/redo, a live manifest preview and spec checks.
- **Signing**: C2PA claim signing plus an optional CAWG X.509 identity assertion. You choose which assertions the identity vouches for. Ingredient files (`parentOf`, `componentOf`) can be attached and are linked to actions by id.
- **Verify**: reads and validates any supported file, either against your local test roots or with no extra anchors (the view a public validator has). You can turn any manifest into a new profile.
- **Certificates**: generates test PKI chains (root → intermediate → end entity) that follow the C2PA certificate profile.

Built on [`c2pa-python`](https://github.com/contentauth/c2pa-python) (c2pa-rs 0.91), Flask, and a front end written in plain JavaScript with no build step.

## Run it

```bash
cd c2pa-studio
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python server.py          # http://127.0.0.1:5178
```

On first run the app creates two certificate sets in `data/certs/`: `vectorline-c2pa` for claim signing and `vectorline-cawg` for a CAWG identity. `data/` holds private keys and signed outputs, so it is git-ignored.

To run the tests: `.venv/bin/pip install pytest && .venv/bin/python -m pytest tests`. They sign a sample image with every bundled profile and check that each one validates.

## Profiles

Each profile is one JSON file in `profiles/`. Saving in the app writes the file, so you can commit profiles alongside the code.

```jsonc
{
  "name": "Newsroom · In-camera capture",
  "description": "…",
  "color": "#2F6FB0",
  "tags": ["news", "capture"],
  "signing": {
    "certSet": "vectorline-c2pa",          // claim signer (data/certs/<id>)
    "tsaUrl": "",                          // optional RFC 3161 timestamp authority
    "cawg": {
      "enabled": true,
      "certSet": "vectorline-cawg",        // identity credential
      "roles": ["cawg.creator"],
      "referencedAssertions": ["c2pa.actions.v2", "cawg.metadata"]
    }
  },
  "manifest": {                            // a c2pa-rs manifest definition
    "claim_generator_info": [{ "name": "Vectorline C2PA Studio", "version": "0.1.0" }],
    "title": "{{filename}}",
    "assertions": [ … ]
  }
}
```

Any string in the manifest can use template variables, which are filled in when signing: `{{filename}}`, `{{basename}}`, `{{format}}`, `{{now}}`, `{{date}}`, `{{year}}`, `{{uuid}}`.

The bundled examples are invented workflows meant to show how different profiles look once signed:

| Profile | Shows |
| --- | --- |
| Newsroom · In-camera capture | `digitalCapture`, IPTC/Dublin Core metadata, AI use reserved, photographer identity |
| Newsroom · Desk edit | `c2pa.opened` linked to a `parentOf` ingredient, edit actions, editor identity |
| Generative AI · Text-to-image | `trainedAlgorithmicMedia`, model as `softwareAgent`, custom assertion, no human identity |
| AI-assisted edit · Generative fill | `compositeWithTrainedAlgorithmicMedia` on an edit action |
| Independent creator · Rights reserved | Training/mining choices covered by the creator's identity signature |
| Brand · Campaign asset | Vendor-specific `com.vectorline.campaign` assertion signed by a producer |
| Minimal baseline | A single `c2pa.created` action, as a control |

For profiles that use ingredients (Desk edit, AI-assisted edit), attach the original file in the sign dialog. Its id (`parent`) must match the id in the `c2pa.opened` action.

## Test certificates and validators

`certs.py` builds each set as root CA → intermediate CA → end-entity signer:

- ECDSA P-256/P-384/P-521 or Ed25519 keys, with SHA-2 signatures
- CA certs: critical `basicConstraints CA:TRUE`, `keyCertSign` + `cRLSign`
- End entity: critical `digitalSignature` key usage, EKU `emailProtection` + `documentSigning`, subject/authority key identifiers, not self-signed
- The signing chain sent in the manifest is the end entity plus the intermediate; the root stays out

You can generate more sets from the Certificates page, or from the command line:

```bash
.venv/bin/python certs.py --name "Example Wire Newsroom" --org "Example Wire" --cn "Example Wire Photo Desk" --purpose c2pa
```

**What validators will show.** These roots are not on the C2PA trust list, so public validators such as [contentcredentials.org/verify](https://contentcredentials.org/verify) will display the manifest but report the signer as unrecognized or untrusted (`signingCredential.untrusted`). Everything else (hashes, claim signature, CAWG identity signature) still validates. The Verify page shows both views. Tools that accept custom trust anchors, such as `c2patool` with trust settings, can use `root_ca.pem` from the Certificates page.

**CAWG identity trust.** c2pa-rs 0.91, as exposed through c2pa-python, has no setting for custom CAWG trust anchors. The CAWG identity signature validates (`cawg.x509.signature.validated`, `cawg.identity.well-formed`), but its credential always reports `cawg.x509.credential.untrusted`, including in local checks. The report explains this next to the code.

**Timestamps.** Without a timestamp authority, the signature is valid only while the signing certificate is (365 days by default). Choose a TSA on the Signing tab to add an RFC 3161 timestamp. Signing then needs network access.

## Layout

```
server.py        Flask API + static files
signing.py       c2pa-python wrapper: templates, signer/CAWG settings, sign, read
certs.py         test PKI generator (also a CLI)
defaults.py      default certificate sets
profiles/        profile JSON files (committed)
static/          front end (index.html, css/, js/)
tests/           end-to-end tests
data/            generated certs and signed outputs (git-ignored)
```
