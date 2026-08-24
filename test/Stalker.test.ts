import { describe, expect, it } from "vitest"

import { createIptvClient } from "../src/index.js"

const credentials = {
  portalUrl: "https://portal.test/c/",
  macAddress: "00:1A:79:12:34:56",
  timezone: "America/Detroit",
}

describe("Stalker / Ministra portals", () => {
  it("handshakes once, loads typed live catalogs, and resolves temporary playback links", async () => {
    const actions: string[] = []
    const client = createIptvClient({
      http: {
        fetch: async (request) => {
          const url = new URL(request.url)
          const action = url.searchParams.get("action") ?? ""
          const type = url.searchParams.get("type")
          actions.push(action)
          expect(request.headers.get("cookie")).toContain("mac=00%3A1A%3A79%3A12%3A34%3A56")
          if (action !== "handshake") expect(request.headers.get("authorization")).toBe("Bearer portal-token")
          if (action === "handshake") {
            expect(url.searchParams.get("prehash")).toMatch(/^[A-F0-9]{40}$/)
            return Response.json({ js: { token: "portal-token", random: "random" } })
          }
          if (action === "get_profile") {
            return Response.json({ js: {
              id: "subscriber-1",
              name: "Viewer",
              status: "1",
              expire_billing_date: "2027-01-01 00:00:00",
              default_timezone: "America/Detroit",
            } })
          }
          if (action === "get_genres") {
            return Response.json({ js: [{ id: "1", title: "News" }] })
          }
          if (action === "get_categories" && type === "vod") {
            return Response.json({ js: [{ id: "2", title: "Movies" }] })
          }
          if (action === "get_all_channels") {
            return Response.json({ js: { data: [{
              id: "10",
              name: "News Network",
              number: "5",
              tv_genre_id: "1",
              xmltv_id: "news.us",
              cmd: "ffmpeg http://origin.test/live/10",
              use_http_tmp_link: "1",
            }] } })
          }
          if (action === "create_link") {
            return type === "vod"
              ? Response.json({ js: { cmd: "ffmpeg https://cdn.test/session/movie.mp4" } })
              : Response.json({ js: { cmd: "ffmpeg https://cdn.test/session/10.m3u8" } })
          }
          if (action === "get_ordered_list" && type === "vod") {
            return Response.json({ js: { data: [{
              id: "20",
              name: "Example Movie",
              category_id: "2",
              cmd: "ffmpeg http://origin.test/movie/20",
              screenshot_uri: "https://img.test/movie.jpg",
              description: "A movie",
            }] } })
          }
          return new Response(null, { status: 404 })
        },
      },
    })
    const stalker = client.stalker(credentials)

    await expect(stalker.profile()).resolves.toMatchObject({
      id: "subscriber-1",
      name: "Viewer",
      timezone: "America/Detroit",
    })
    await expect(stalker.liveCategories()).resolves.toEqual([{
      id: "1", name: "News", kind: "live",
    }])
    const channels = await stalker.liveChannels()
    expect(channels[0]).toMatchObject({
      id: "10",
      name: "News Network",
      source: "stalker",
      categoryIds: ["1"],
      epgChannelId: "news.us",
      headers: { authorization: "Bearer portal-token" },
    })
    await expect(stalker.resolveStreamUrl(channels[0]!)).resolves.toBe(
      "https://cdn.test/session/10.m3u8",
    )
    await expect(stalker.movieCategories()).resolves.toEqual([{
      id: "2", name: "Movies", kind: "movie",
    }])
    const movies = await stalker.movies({ categoryId: "2" })
    expect(movies[0]).toMatchObject({ id: "20", name: "Example Movie", categoryIds: ["2"] })
    await expect(stalker.resolveMovieUrl(movies[0]!)).resolves.toBe(
      "https://cdn.test/session/movie.mp4",
    )
    expect(actions.filter((action) => action === "handshake")).toHaveLength(1)
    await client.dispose()
  })
})
