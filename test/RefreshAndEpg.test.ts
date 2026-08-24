import { describe, expect, it } from "vitest"

import { createIptvClient } from "../src/index.js"

const PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-name="News Network" group-title="News",News
https://media.test/news.m3u8
`

describe("playlist refresh and EPG matching", () => {
  it("uses conditional requests and only replaces a fully parsed snapshot", async () => {
    let requests = 0
    const client = createIptvClient({
      http: {
        fetch: async (request) => {
          requests += 1
          if (requests === 1) {
            return new Response(PLAYLIST, {
              headers: { ETag: '"revision-1"', "Last-Modified": "Mon, 24 Aug 2026 01:00:00 GMT" },
            })
          }
          expect(request.headers.get("if-none-match")).toBe('"revision-1"')
          expect(request.headers.get("if-modified-since")).toBe("Mon, 24 Aug 2026 01:00:00 GMT")
          return new Response(null, { status: 304 })
        },
      },
    })

    const first = await client.refreshM3u("https://provider.test/list.m3u")
    expect(first.status).toBe("updated")
    if (first.status !== "updated") throw new Error("unexpected refresh result")
    expect(first.diff.added).toHaveLength(1)
    expect(first.snapshot.etag).toBe('"revision-1"')

    const second = await client.refreshM3u("https://provider.test/list.m3u", {
      previous: first.snapshot,
    })
    expect(second).toMatchObject({ status: "not-modified", snapshot: { revision: first.snapshot.revision } })
    await client.dispose()
  })

  it("matches EPG by id, tvg-name, channel name, and explicit override without guessing ambiguity", async () => {
    const client = createIptvClient({ http: { fetch: async () => { throw new Error("unused") } } })
    const playlist = await client.parseM3u(PLAYLIST)
    const entry = playlist.entries[0]!
    const guide = await client.parseXmltv(`<?xml version="1.0"?><tv>
      <channel id="news.us"><display-name>News Network</display-name></channel>
      <channel id="news.alt"><display-name>News Network</display-name></channel>
    </tv>`)

    await expect(client.matchEpgChannel(guide, entry)).resolves.toMatchObject({
      status: "ambiguous",
      via: "tvg-name",
      candidates: [{ id: "news.us" }, { id: "news.alt" }],
    })
    await expect(client.matchEpgChannel(guide, entry, {
      overrides: { [entry.id]: "news.alt" },
    })).resolves.toMatchObject({
      status: "matched",
      via: "override",
      channel: { id: "news.alt" },
    })
    await client.dispose()
  })
})
