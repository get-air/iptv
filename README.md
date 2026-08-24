# Air IPTV toolkit

`@get-air/iptv` is Air's type-safe toolkit for IPTV providers and playlists.
It combines Xtream-compatible Player API access, extended M3U/M3U8 parsing,
XMLTV guide parsing, now/next lookup, and playback-ready stream URL generation.

The package root is a plain Promise API. `@get-air/iptv/effect` exposes the same
implementation as Effect services, layers, schemas, branded IDs, and typed
errors.

## Install

```sh
npm install @get-air/iptv @get-air/http @get-air/cache
```

## Promise API

```ts
import { MemoryCacheStore } from '@get-air/cache'
import { FunctionHttpTransport } from '@get-air/http'
import { createIptvClient } from '@get-air/iptv'

const client = createIptvClient({
  http: new FunctionHttpTransport(fetch),
  cache: new MemoryCacheStore(),
})

const provider = client.xtream({
  baseUrl: 'https://provider.example:8443',
  username: 'viewer',
  password: 'secret',
  preferredFormat: 'm3u8',
})

const channels = await provider.liveChannels({ categoryId: '7' })
const guide = await provider.shortEpg({ channelId: channels[0].id, limit: 4 })
```

Returned channels have branded IDs and a `streamUrl` ready for
`@get-air/video`. Xtream credentials are required in playback URLs by the
provider protocol, but they are never stored verbatim in cache keys or copied
into typed request errors.

## M3U and XMLTV

```ts
const playlist = await client.loadM3u('https://provider.example/list.m3u')
const epg = await client.loadXmltv(playlist.epgUrls[0])
const channelId = playlist.entries[0]?.epgChannelId
const listing = channelId ? await client.nowNext(epg, channelId) : undefined
```

The M3U parser understands IPTV header EPG URLs, `tvg-*`, `group-title`,
`#EXTGRP`, `#EXTVLCOPT`, `#KODIPROP`, common catch-up metadata, relative URLs,
radio entries, and positive-duration VOD entries. XMLTV output is normalized to
stable channels and programmes with real `Date` values.

## Effect API

```ts
import { MemoryCacheStore } from '@get-air/cache'
import { layerHttpTransport } from '@get-air/http/effect'
import { Effect, Layer } from 'effect'
import { IptvService, layerIptvClient } from '@get-air/iptv/effect'

const IptvLive = layerIptvClient({}, {
  cache: new MemoryCacheStore(),
}).pipe(
  Layer.provide(layerHttpTransport({ fetch: (request) => fetch(request) })),
)

const program = IptvService.liveChannels({
  baseUrl: 'https://provider.example',
  username: 'viewer',
  password: 'secret',
})

const channels = await Effect.runPromise(program.pipe(Effect.provide(IptvLive)))
```

## Xtream compatibility

The initial surface covers:

- account/server profile;
- live, movie, and series categories;
- live channels, VOD listings/details, and series listings/details;
- short channel EPG;
- full M3U and XMLTV endpoint URLs;
- live, movie, episode, timeshift/catch-up metadata, and preferred stream formats.

Xtream-compatible servers often vary field types and omit optional properties.
Provider responses are therefore accepted through a tolerant unknown-data
boundary, normalized, and decoded into strict Effect schemas before they reach
callers.

The compatibility design was informed by the Player API endpoint catalog in
[`worldofiptvcom/xtream-codes-api`](https://github.com/worldofiptvcom/xtream-codes-api),
the typed response work in [`@iptv/xtream-api`](https://github.com/ektotv/xtream-api),
the extended tags handled by
[`iptv-playlist-parser`](https://github.com/freearhey/iptv-playlist-parser), and
the high-volume parser in [`@iptv/xmltv`](https://github.com/ektotv/xmltv).

## Networking and caching

Every request goes through `@get-air/http`; the package never calls global
`fetch` itself. Pass the Tauri transport from `@get-air/http/tauri` in a Tauri
application.

Caching is optional and uses `@get-air/cache` under the unique
`@get-air/iptv` namespace. Only serialized response text is stored. Cache
failures are logged through Effect and do not prevent a network response.

No package version has been published yet.
