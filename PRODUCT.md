# Product

## Purpose

Give Air applications one typed boundary for IPTV provider discovery, live
channel playback sources, VOD/series catalogs, M3U playlists, and XMLTV guide
data without binding applications to one provider's inconsistent JSON shapes.

## Capabilities

- Xtream-compatible live, VOD, series, short/full EPG, playlist, and XMLTV surfaces.
- Stalker/Ministra live and VOD discovery with temporary-link resolution.
- Extended IPTV M3U metadata and catch-up parsing.
- Streaming/gzip XMLTV batches, channels, programmes, EPG matching, and now/next lookup.
- Ranked, paged, multi-source global search with an injectable persistence index.
- Conditional, cancellation-aware playlist refresh snapshots and deterministic diffs.
- Source-scoped URL trust and validated redirect policies.
- Request injection through `@get-air/http` and optional serialized caching
  through `@get-air/cache`.
- Plain Promise and Effect-native entrypoints over one implementation.
- Branded identifiers, boundary schemas, and failure-specific tagged errors.

## Boundaries

- This library discovers and normalizes legal provider data; it does not supply
  channels, credentials, DRM circumvention, or content.
- Playback UI belongs to `@get-air/video` and native playback to platform
  adapters such as `@get-air/video-tauri`.
- Provider credentials must never be logged or stored in plaintext cache keys.
- Favorites, history, and application registries remain application state rather
  than shared-cache data.
