# Product

## Purpose

Give Air applications one typed boundary for IPTV provider discovery, live
channel playback sources, VOD/series catalogs, M3U playlists, and XMLTV guide
data without binding applications to one provider's inconsistent JSON shapes.

## Capabilities

- Xtream-compatible live, VOD, series, short EPG, playlist, and XMLTV surfaces.
- Extended IPTV M3U metadata and catch-up parsing.
- XMLTV channels, programmes, and now/next lookup.
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
