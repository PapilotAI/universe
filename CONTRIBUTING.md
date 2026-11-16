# Contributing to Papilot Universe

Anyone can add a template or a conference: open a pull request. Every template is compiled in CI and published at [papilot.ai/universe](https://papilot.ai/universe/) once merged.

## Add a template

Theses, conference and journal kits, slides, posters, CVs, books, reports and letters are all welcome, from any field.

1. **Use the official source.** For a conference or journal, the author kit linked from its call for papers or author guidelines; for a thesis, the school's template or the one its graduate school recommends; otherwise the package's CTAN or upstream release. Record it in `[upstream]` (URL plus SHA-256 or commit) and, for a venue kit, the call in `[venue].url`.
2. **Check the license.** We publish only templates we may redistribute. Use the SPDX identifier when there is one. If the kit states no license, use `LicenseRef-<Name>` and quote what the kit or its page says in `license_note`; such templates need a maintainer's review before they are published.
3. **Keep `files/` minimal.** The class and style files, the example `.tex` an author starts from, its `.bib`, and the figures it uses. No built PDFs, logs, `.bbl`, Makefiles, scripts, CI files or instruction booklets. Keep upstream files as they are; if one must change to compile, say what changed in a comment at its top and in `setup.notes`.
4. **Compile with free fonts.** CI uses TeX Live on Linux with the Fandol CJK fonts. Templates that need commercial fonts must have an option that selects free ones by default on Linux (ctex does this automatically).
5. **One template per directory, one version at a time.** Changing anything in a published template means a new `version`.
6. **Pick the category** that fits: `thesis`, `conference`, `journal`, `slides`, `poster`, `cv`, `book`, `report`, `letter` or `article`.

## Add a conference

Most conferences reuse a template that is already here (ACM, IEEE, Springer LNCS, LIPIcs, …). Add an entry to the matching file in `venues/` (or a new file for another field) pointing at the template its latest call for papers asks for; see the README for the fields. Set `confidence = "high"` only when you read the format in that call, and put the call's URL in `cfp`. If the venue ships its own kit, add it as a template first.

## Check and send

Run `npm run validate && npm run compile <id> && npm run build`, look at `build/<id>/preview.pdf` and `npm run serve`, and open a pull request.
