# web-appsec skill

A Claude Code skill that conducts **authorized** web application and API
security testing using the [OWASP Web Security Testing Guide
(WSTG)](https://owasp.org/www-project-web-security-testing-guide/) as its
methodology.

> Only test applications you own or have **written permission** to test.
> Unauthorized testing may be illegal. See the authorization gate in
> [`SKILL.md`](SKILL.md).

## Setup

The WSTG is not committed to this repo. Fetch it on demand:

```sh
bash scripts/setup.sh
```

This does a shallow, blobless, sparse `git` checkout of only the WSTG
`document/` directory into `./document` (a few MB, not the whole repo), and can
be re-run any time to refresh it. `./document` and the backing `.wstg/`
checkout are git-ignored.

To expose it as a slash command (e.g. `/appsec setup`), wire `scripts/setup.sh`
into a command for your setup — for Claude Code, add a `commands/appsec.md`
that runs it, or load this folder through your plugin configuration.

## How it works

Once `./document` is present, the skill:

1. Confirms the engagement is authorized and in scope.
2. Picks the relevant WSTG categories for the target
   (`document/4-Web_Application_Security_Testing/`).
3. Works each test case, tracking coverage by WSTG test ID (e.g.
   `WSTG-ATHN-03`).
4. Writes findings up against the standard, with evidence and remediation.

See [`SKILL.md`](SKILL.md) for the full methodology.

## Attribution

The OWASP Web Security Testing Guide is © the OWASP Foundation and its
contributors, licensed under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). It is fetched
unmodified by `scripts/setup.sh`; this skill only references it.
