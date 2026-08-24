import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import { createIptvClient } from "../src/index.js"
import {
  IptvChannel,
  IptvMovie,
  IptvSourceRef,
} from "../src/effect.js"

const neverFetch = { fetch: async () => { throw new Error("unexpected network request") } }

describe("global IPTV search", () => {
  it("ranks Unicode-normalized results across sources with filters and paging", async () => {
    const client = createIptvClient({ http: neverFetch })
    const xtream = Schema.decodeUnknownSync(IptvSourceRef)({ id: "provider-a", name: "Provider A", kind: "xtream" })
    const playlist = Schema.decodeUnknownSync(IptvSourceRef)({ id: "playlist-b", name: "Local List", kind: "m3u" })
    const news = Schema.decodeUnknownSync(IptvChannel)({
      id: "101", name: "Télévision News", streamUrl: "https://media.test/news.m3u8",
      source: "xtream", kind: "live", categoryIds: ["7"], headers: {},
    })
    const movie = Schema.decodeUnknownSync(IptvMovie)({
      id: "201", name: "News of the World", streamUrl: "https://media.test/movie.mp4",
      categoryIds: ["8"], containerExtension: "mp4", year: "2020",
    })
    const hidden = Schema.decodeUnknownSync(IptvChannel)({
      id: "102", name: "Television News Extra", streamUrl: "https://media.test/extra.m3u8",
      source: "m3u", kind: "live", categoryIds: ["News"], headers: {},
    })

    await client.replaceSearchSource(xtream, { channels: [news], movies: [movie] })
    await client.replaceSearchSource(playlist, { channels: [hidden], hiddenEntityIds: ["102"] })

    const exact = await client.search("television news", { excludeHidden: true })
    expect(exact.items[0]).toMatchObject({
      score: 0,
      match: "exact",
      document: { source: { id: "provider-a" }, title: "Télévision News", contentKind: "live" },
    })
    expect(exact.items.some((result) => result.document.entity.id === "102")).toBe(false)

    const movies = await client.search("news world", { kinds: ["movie"], limit: 1 })
    expect(movies.items[0]?.document.title).toBe("News of the World")
    expect(movies.items[0]?.document.source.name).toBe("Provider A")

    const page = await client.search("news", { limit: 1, offset: 1 })
    expect(page.limit).toBe(1)
    expect(page.offset).toBe(1)
    expect(page.hasMore).toBe(true)
    await client.dispose()
  })
})
