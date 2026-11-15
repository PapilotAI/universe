# Adding a template

1. **Use the official source.** For a conference, the author kit linked from its call for papers; for a thesis, the school's template or the one its graduate school recommends. Record it in `[upstream]` (URL plus SHA-256 or commit) and, for venues, the CFP in `[venue].url`.
2. **Check the license.** We publish only templates we may redistribute. Use the SPDX identifier when there is one. If the kit states no license, use `LicenseRef-<Name>` and quote what the kit or its page says in `license_note`; such templates need a maintainer's review before they are published.
3. **Keep `files/` minimal.** The class and style files, the example `.tex` an author starts from, its `.bib`, and the figures it uses. No built PDFs, logs, `.bbl`, Makefiles, scripts, CI files or instruction booklets. Keep upstream files byte-for-byte; put changes, if any are needed to compile, in a note.
4. **Compile with free fonts.** CI uses TeX Live on Linux with the Fandol CJK fonts. Templates that need commercial fonts must have an option that selects free ones by default on Linux (ctex does this automatically).
5. **One template per directory, one version at a time.** Changing anything in a published template means a new `version`.

Run `npm run validate && npm run compile <id> && npm run build`, look at `build/<id>/preview.pdf`, and open a pull request.
