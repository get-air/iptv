# Air IPTV repository guidance

- The package is `@get-air/iptv`; the product name remains Air.
- Keep the root entrypoint Promise/plain JavaScript and `/effect` Effect-native.
  Both must delegate to the same Effect implementation.
- Use `@get-air/http` for all network calls and `@get-air/cache` with the
  package-owned `@get-air/iptv` namespace for optional serialized caching.
- Never store or log Xtream usernames, passwords, or credential-bearing URLs.
- Decode every provider response at the boundary. Xtream-compatible servers are
  inconsistent, so normalize accepted variants into stable branded domain types.
- Keep this repository independent. Do not add workspace or local-file dependencies.
- Do not publish from a development task. CI may build and inspect the package;
  releases require an explicit later request.
