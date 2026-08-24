import type { CacheEntry, CacheStore } from "@get-air/cache"
import { layerHttpTransport } from "@get-air/http/effect"
import { Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"

import { createIptvClient } from "../src/index.js"
import { IptvService, layerIptvClient } from "../src/effect.js"

const credentials = {
  baseUrl: "https://provider.test:8443",
  username: "viewer@example.test",
  password: "secret value",
  preferredFormat: "m3u8" as const,
}

class RecordingCache implements CacheStore {
  readonly entries = new Map<string, CacheEntry>()
  async get(key: string): Promise<CacheEntry | undefined> { return this.entries.get(key) }
  async set(key: string, entry: CacheEntry): Promise<void> { this.entries.set(key, entry) }
  async remove(key: string): Promise<void> { this.entries.delete(key) }
}

function transport(counter: { value: number }) {
  return {
    fetch: async (request: Request): Promise<Response> => {
      counter.value += 1
      const url = new URL(request.url)
      const action = url.searchParams.get("action")
      expect(url.searchParams.get("username")).toBe(credentials.username)
      expect(url.searchParams.get("password")).toBe(credentials.password)
      if (action === null) {
        return Response.json({
          user_info: {
            auth: "1",
            status: "Active",
            exp_date: "1800000000",
            is_trial: "0",
            active_cons: "1",
            max_connections: "2",
            allowed_output_formats: ["m3u8", "ts"],
          },
          server_info: {
            server_protocol: "https",
            url: "provider.test",
            port: "8443",
            timezone: "UTC",
            timestamp_now: 1787530000,
            version: "1.0",
          },
        })
      }
      if (action === "get_live_categories") {
        return Response.json([{ category_id: "7", category_name: "News", parent_id: 0 }])
      }
      if (action === "get_live_streams") {
        return Response.json([{
          num: 12,
          name: "CNN",
          stream_type: "live",
          stream_id: 101,
          stream_icon: "https://img.test/cnn.png",
          epg_channel_id: "cnn.us",
          category_id: "7",
          category_ids: [7],
          tv_archive: 1,
          tv_archive_duration: 7,
          direct_source: "",
        }])
      }
      if (action === "get_vod_categories") {
        return Response.json([{ category_id: "8", category_name: "Movies", parent_id: 0 }])
      }
      if (action === "get_vod_streams") {
        return Response.json([{
          stream_id: 201,
          name: "Example Movie",
          container_extension: "mp4",
          category_id: "8",
          category_ids: [8],
          stream_icon: "https://img.test/movie.jpg",
          duration_secs: 5400,
        }])
      }
      if (action === "get_vod_info") {
        return Response.json({
          movie_data: { stream_id: 201, name: "Example Movie", container_extension: "mp4", category_id: "8" },
          info: { plot: "A test film", duration_secs: 5400, rating: "8.2" },
        })
      }
      if (action === "get_series_categories") {
        return Response.json([{ category_id: "9", category_name: "Series", parent_id: 0 }])
      }
      if (action === "get_series") {
        return Response.json([{ series_id: 301, name: "Example Show", category_id: "9", cover: "https://img.test/show.jpg" }])
      }
      if (action === "get_series_info") {
        return Response.json({
          info: { name: "Example Show", category_id: "9", cover: "https://img.test/show.jpg" },
          episodes: {
            "1": [{
              id: 302,
              title: "Pilot",
              season: 1,
              episode_num: 1,
              container_extension: "mkv",
              info: { plot: "The beginning", duration_secs: 2700 },
            }],
          },
        })
      }
      if (action === "get_short_epg") {
        return Response.json({ epg_listings: [{
          title: btoa("News Hour"),
          description: btoa("Headlines"),
          start_timestamp: "1787530000",
          stop_timestamp: "1787533600",
        }] })
      }
      return new Response("missing", { status: 404 })
    },
  }
}

describe("Xtream-compatible providers", () => {
  it("normalizes profile, live channels, URLs, EPG, and serialized caching", async () => {
    const counter = { value: 0 }
    const cache = new RecordingCache()
    const client = createIptvClient({ http: transport(counter), cache })
    const xtream = client.xtream(credentials)

    await expect(xtream.profile()).resolves.toMatchObject({
      account: { authenticated: true, status: "Active", maxConnections: 2 },
      server: { protocol: "https", host: "provider.test" },
    })
    expect(cache.entries.size).toBe(0)
    await expect(xtream.liveCategories()).resolves.toEqual([{
      id: "7", name: "News", kind: "live",
    }])
    const channels = await xtream.liveChannels({ categoryId: "7" })
    expect(channels[0]).toMatchObject({
      id: "101",
      name: "CNN",
      categoryIds: ["7"],
      epgChannelId: "cnn.us",
      catchup: { type: "xtream", days: 7 },
    })
    expect(channels[0]?.streamUrl).toBe(
      "https://provider.test:8443/live/viewer%40example.test/secret%20value/101.m3u8",
    )
    expect(xtream.playlistUrl()).toContain("/get.php?")
    expect(xtream.xmltvUrl()).toContain("/xmltv.php?")
    expect(xtream.timeshiftUrl("101", new Date("2026-08-24T01:30:00Z"), 3600)).toContain(
      "/timeshift/viewer%40example.test/secret%20value/3600/2026-08-24:01-30/101.ts",
    )

    const beforeCachedRead = counter.value
    await xtream.liveChannels({ categoryId: "7" })
    expect(counter.value).toBe(beforeCachedRead)
    expect([...cache.entries.keys()].every((key) =>
      !key.includes(credentials.username) && !key.includes(credentials.password))).toBe(true)

    const epg = await xtream.shortEpg({ channelId: "101", limit: 2 })
    expect(epg.programmes[0]).toMatchObject({ title: "News Hour", description: "Headlines" })

    const movies = await xtream.movies({ categoryId: "8" })
    expect(movies[0]).toMatchObject({
      id: "201", name: "Example Movie", durationSeconds: 5400,
    })
    expect((await xtream.movie("201")).plot).toBe("A test film")
    const shows = await xtream.series({ categoryId: "9" })
    expect(shows[0]).toMatchObject({ id: "301", name: "Example Show" })
    const show = await xtream.seriesDetails("301")
    expect(show.episodes[0]).toMatchObject({
      id: "302", seriesId: "301", title: "Pilot", season: 1, episode: 1,
    })
    expect(show.episodes[0]?.streamUrl).toContain("/series/viewer%40example.test/secret%20value/302.mkv")
    await client.dispose()
  })

  it("provides the same implementation through an Effect layer", async () => {
    const counter = { value: 0 }
    const MainLive = layerIptvClient({}, { cache: new RecordingCache() }).pipe(
      Layer.provide(layerHttpTransport(transport(counter))),
    )
    const channels = await Effect.runPromise(
      IptvService.liveChannels(credentials, {}, {}).pipe(Effect.provide(MainLive)),
    )
    expect(channels[0]?.id).toBe("101")
  })

  it("rejects failed authentication without exposing credentials", async () => {
    const client = createIptvClient({
      http: { fetch: async () => Response.json({ user_info: { auth: 0, status: "Disabled" }, server_info: {} }) },
    })
    const failure = await client.xtream(credentials).profile().then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(failure).toMatchObject({ _tag: "XtreamAuthenticationError", status: "Disabled" })
    expect(String(failure)).not.toContain(credentials.password)
    await client.dispose()
  })
})
