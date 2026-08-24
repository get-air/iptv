import { describe, expect, it } from "vitest"

import { createIptvClient } from "../src/index.js"

const neverFetch = { fetch: async () => { throw new Error("unexpected network request") } }

describe("M3U IPTV playlists", () => {
  it("parses IPTV metadata, headers, catch-up, and VOD entries", async () => {
    const client = createIptvClient({ http: neverFetch })
    const playlist = await client.parseM3u(`#EXTM3U url-tvg="https://guide.test/epg.xml" playlist-name="Demo"
#EXTINF:-1 tvg-id="cnn.us" tvg-logo="https://img.test/cnn.png" group-title="News" catchup="xtream" catchup-days="7",CNN
#EXTVLCOPT:http-user-agent=Air TV
#KODIPROP:inputstream.adaptive.stream_headers=Authorization=Bearer%20token&X-Test=yes
streams/cnn.m3u8
#EXTINF:5400 group-title="Movies",Example Movie
https://media.test/movie.mp4
` , { baseUrl: "https://provider.test/list.m3u" })

    expect(playlist.name).toBe("Demo")
    expect(playlist.epgUrls).toEqual(["https://guide.test/epg.xml"])
    expect(playlist.entries).toHaveLength(2)
    expect(playlist.entries[0]).toMatchObject({
      id: "cnn.us",
      name: "CNN",
      streamUrl: "https://provider.test/streams/cnn.m3u8",
      kind: "live",
      categoryIds: ["News"],
      epgChannelId: "cnn.us",
      logoUrl: "https://img.test/cnn.png",
      headers: {
        "User-Agent": "Air TV",
        Authorization: "Bearer token",
        "X-Test": "yes",
      },
      catchup: { type: "xtream", days: 7 },
    })
    expect(playlist.entries[1]).toMatchObject({
      name: "Example Movie",
      kind: "movie",
      durationSeconds: 5400,
    })
    await client.dispose()
  })

  it("rejects malformed playlists with a typed error", async () => {
    const client = createIptvClient({ http: neverFetch })
    await expect(client.parseM3u("https://example.test/live.m3u8")).rejects.toMatchObject({
      _tag: "M3uParseError",
      line: 1,
    })
    await client.dispose()
  })
})
