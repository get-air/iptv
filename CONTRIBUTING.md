# Contributing

Use Node.js 24 and install from the frozen lockfile:

```sh
npm ci
npm run check
npm test
npm run build
npm pack --dry-run --ignore-scripts
```

Run the hosted CI job locally before pushing:

```sh
npm run ci:act
```

Keep provider fixtures synthetic. Never commit working IPTV credentials,
customer playlists, credential-bearing URLs, or downloaded guide data.

The publish workflow is dormant until a non-prerelease GitHub Release is
explicitly published and npm trusted publishing has been configured. Do not
create a release as part of ordinary development.
