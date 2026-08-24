---
name: air-package-publishing
version: 1.1.0
---

# Air npm publishing projection

- Do not publish without an explicit release request and a clean, fully tested commit.
- Stable publishing uses a non-prerelease GitHub Release, OIDC, and provenance.
- Never add `NPM_TOKEN`, `NODE_AUTH_TOKEN`, or registry credentials.
- Verify the tag equals `v<package.json version>` before `npm publish`.
- First publication requires separate npm trusted-publisher bootstrap and verification.
