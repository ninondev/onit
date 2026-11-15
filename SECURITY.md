# Security

## Reporting a vulnerability

Open a private security advisory on GitHub, or email the maintainer at the address on the GitHub profile. Do not open a public issue for a vulnerability.

Include the version or commit, the platform, and the steps to reproduce. You will get an answer within a week.

## Design

- The server binds to a numeric loopback address. It refuses non-loopback listeners.
- Every `/v1/` route needs a bearer token. Tokens are created by `init` or `issue` and stored in 0600 files.
- The data directory is created with mode 0700.
- No telemetry, analytics or update check. The only outbound request is to the model endpoint you configure.
- Model keys are not stored by the server. Background work calls the endpoint without a key; use a local proxy if your provider needs one.
- Backups are plain copies with digests, not encrypted archives. Protect the destination.

## Supported versions

The `main` branch is the supported version.
