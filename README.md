# Hacking resources

Evolving resource kit for hacking which are authorized engagements.

## Table of contents

### Tools

- [autofrida (TaskForce)](tools/autofrida/README.md) — security automation and instrumentation: network scanning, Android instrumentation via Frida, web recon.
- [bugbounty](tools/bugbounty/README.md) — shell toolkit to map attack surface (subdomains, DNS, TLS certs) per target.
- [killchain](tools/killchain/README.md) — multithreaded C network scanner that hand-crafts raw IP/TCP packets for SYN scanning and host discovery.
- [localghost](tools/localghost/README.md) — AI security companion: intercepting proxy with desktop app and web UI for capturing/inspecting HTTP traffic.

### Third-party (vendored under autofrida)

- [Fleet](tools/autofrida/third_party/fleet/README.md) — SSH-based orchestration tool for running tasks across fleets of hosts.
- [khuraphati](tools/autofrida/third_party/khuraphati/README.md) — Android/web recon scripts and wordlists.

### Methodology

- [methodology/README.md](methodology/README.md) — recon, enumeration, initial foothold, privilege escalation, lateral movement, exfiltration.

### CI/CD

- [.github/workflows](.github/workflows/) — CI, bugbounty, killchain, and localghost pipelines.
