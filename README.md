# Papilot Universe

LaTeX templates for starting a new document in [Papilot](https://papilot.ai): official conference and journal author kits, the right template for more than 400 conferences, university theses, slides, posters, CVs, books and letters, each compiled in CI and published with a preview.

Browse them at **[papilot.ai/universe](https://papilot.ai/universe/)**, or pick one in Papilot under **New paper…**. Papilot downloads the template, checks its SHA-256, creates the folder with Git history, and opens it with the template's main file and engine already set.

## How it works

```
templates/<id>/
  papilot.toml     what the template is, where it came from, how to compile it
  files/           exactly what a new paper starts with
```

CI compiles every template with TeX Live (free fonts only) and publishes a static site:

| Path | Contents |
| --- | --- |
| `/universe/` | the gallery, one page per template under `t/<id>/` |
| `/universe/v1/index.json` | every template, with its archive URL, size and SHA-256 |
| `/universe/v1/templates/<id>/<version>.zip` | the files, immutable once published |
| `/universe/v1/templates/<id>/<version>/` | `thumbnail.png` and `preview.pdf` |

The Papilot app reads only `v1/index.json` and the archives. Published versions never change: editing a template means bumping its `version`, and CI refuses a changed archive under a published version.

## `papilot.toml`

```toml
id = "neurips"                 # the directory name, lowercase kebab-case
version = "2026"               # 2026, 7.6 or 1.2.3; bump on every change
name = "NeurIPS 2026"
description = "Official LaTeX style for NeurIPS 2026 submissions."
category = "conference"        # thesis, conference, journal, article, report, cv, slides, letter
tags = ["machine learning"]
languages = ["en"]
license = "LPPL-1.3c"          # SPDX, or LicenseRef-… with license_note
main = "neurips_2026.tex"      # inside files/
engine = "pdflatex"            # pdflatex, xelatex or lualatex
organization = "…"             # a university, publisher or society (optional)

[venue]                        # conferences and journals (optional)
name = "NeurIPS"
year = 2026
url = "https://neurips.cc/Conferences/2026/CallForPapers"

[upstream]                     # where files/ came from
url = "https://…/Styles.zip"
homepage = "https://…"         # optional
version = "…"                  # optional upstream tag or date
sha256 = "…"                   # optional, of the downloaded archive
commit = "…"                   # optional, for Git sources

[zh-CN]                        # optional translations
name = "…"
description = "…"

[setup]                        # optional hints for the agent that sets up a new paper
notes = "Fill in the title and authors in …"
```

## Conferences (`venues/*.toml`)

Many conferences share one template: hundreds of ACM venues use `acm-sigconf`, theory venues use `lipics`, and so on. `venues/` lists conferences, each pointing at the template its latest call for papers asks for. The first set covers the CCF 2026 (7th edition) list, which spans computer science, plus programming-language venues outside it (`pl.toml`); venues from other fields go in their own files. The gallery lists venues alphabetically; CCF data is metadata, not an ordering.

```toml
[[venues]]
id = "pldi"
abbr = "PLDI"
name = "ACM SIGPLAN Conference on Programming Language Design and Implementation"
template = "acm-pacmpl"        # an existing templates/<id>
ccf = "A"                      # A, B or C; omit when not in the CCF list
area = "se"                    # CCF area (arch, net, sec, se, db, tcs, cg, ai, hci, mx) or pl
topics = ["pl"]                # optional extra areas
year = 2027                    # the edition whose call was read
cfp = "https://pldi27.sigplan.org/track/pldi-2027-papers"
confidence = "high"            # high: read in that call; medium: a past call or the publisher; low: inferred
note = "…"                     # optional, e.g. when the venue ships its own kit not yet in the gallery
```

Each venue becomes its own entry in `v1/index.json` and its own page, reusing the template's archive and preview. A venue whose template is its own kit (`id` equals `template`, as for NeurIPS) only adds its CCF data to that template.

## Working locally

Node 22 and TeX Live with `latexmk` and `pdftoppm` (Poppler):

```sh
npm ci
npm run validate          # manifests and file lists
npm run compile [id…]     # PDFs and thumbnails into build/, skipping unchanged templates
npm run build             # dist/universe/
npm run serve             # http://127.0.0.1:4410/universe/
```

Point a development Papilot at the local site with `PAPILOT_UNIVERSE_URL=http://127.0.0.1:4410/universe/`.

## Publishing

Pushes to `main` build in CI and deploy `dist/` as the `papilot-universe` Cloudflare Worker on the route `papilot.ai/universe*` (see `wrangler.toml`); the rest of papilot.ai is unaffected. Deployment needs the repository secrets `CLOUDFLARE_API_TOKEN` (Workers Scripts and Workers Routes edit permissions for the papilot.ai zone) and `CLOUDFLARE_ACCOUNT_ID`. Without them, CI still builds and uploads the site as an artifact.

## Licenses

The tooling in this repository is MIT licensed. Each template keeps its own license, stated in its `papilot.toml` and the files themselves. See [CONTRIBUTING.md](CONTRIBUTING.md) before adding one.
