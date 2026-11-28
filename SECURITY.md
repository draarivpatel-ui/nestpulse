# Security Policy

## Supported versions

| Version | Status |
| --- | --- |
| `main` | Supported |

Security fixes are applied to the latest state of `main`.

## Reporting a vulnerability

Report suspected vulnerabilities privately through the repository's [GitHub Security Advisory form](https://github.com/draarivpatel-ui/nestpulse/security/advisories/new).

Do not open a public issue, pull request or discussion with exploit details. Do not include live credentials, personal data or third party secrets in a report. Use synthetic reproduction cases.

Include:

- A description of the vulnerability and its impact.
- The affected file, function or component.
- Steps to reproduce, including the input that triggers the behavior.
- The browser, runtime version or commit used for testing.
- Any suggested mitigation.

## Scope

NestPulse is a static client-side NAS command center dashboard with no runtime package dependencies.

In scope:

- Cross-site scripting or markup injection through sensor data, rule definitions, storage calculations or generated dashboard output.
- Client-side validation or parsing behavior that turns crafted input into unsafe executable behavior.
- Local asset loading or rendering paths that let untrusted input escape the intended sandbox of the static page.

Out of scope:

- Denial of service that only affects the attacker's own browser tab.
- Issues that require a compromised browser, operating system or runtime.
- Missing hardening suggestions without a demonstrable security impact.
- Vulnerabilities in third party services or dependencies outside this repository.

## Response targets

- Acknowledgment within 3 business days.
- Initial triage within 14 calendar days.
- Fix or mitigation plan within 90 calendar days for confirmed reports.

## Coordinated disclosure

Please allow maintainers reasonable time to investigate and release a fix before public disclosure. Reporters are credited when a fix is published unless they ask not to be named.
