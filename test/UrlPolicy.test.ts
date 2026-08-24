import { describe, expect, it, vi } from "vitest"

import { createIptvClient } from "../src/index.js"

const PLAYLIST = "#EXTM3U\n#EXTINF:-1,News\nhttps://media.test/news.m3u8\n"

describe("source-scoped URL policies", () => {
  it("blocks literal private sources unless their origin is explicitly trusted", async () => {
    const fetch = vi.fn(async () => new Response(PLAYLIST))
    const blocked = createIptvClient({
      http: { fetch },
      urlPolicy: { allowPrivateNetworks: false },
    })
    await expect(blocked.loadM3u("http://192.168.1.5/list.m3u")).rejects.toMatchObject({
      _tag: "IptvUrlPolicyError",
    })
    expect(fetch).not.toHaveBeenCalled()
    await blocked.dispose()

    const trusted = createIptvClient({
      http: { fetch },
      urlPolicy: {
        allowPrivateNetworks: false,
        trustedPrivateNetworkOrigins: ["http://192.168.1.5"],
      },
    })
    await expect(trusted.loadM3u("http://192.168.1.5/list.m3u")).resolves.toMatchObject({
      entries: [{ name: "News" }],
    })
    await trusted.dispose()
  })

  it("validates every manually followed redirect", async () => {
    const seen: string[] = []
    const client = createIptvClient({
      http: {
        fetch: async (request) => {
          if (request.url.includes("one.test")) {
            expect(request.headers.get("user-agent")).toBe("private-agent")
            return new Response(null, { status: 302, headers: { Location: "https://two.test/list.m3u" } })
          }
          expect(request.headers.get("user-agent")).toBeNull()
          return new Response(PLAYLIST)
        },
      },
      userAgent: "private-agent",
      urlPolicy: {
        redirectMode: "validate",
        sensitiveHeaders: ["user-agent"],
        validate: (url, context) => { seen.push(`${context.redirectCount}:${url.hostname}`) },
      },
    })
    await client.loadM3u("https://one.test/list.m3u")
    expect(seen).toEqual(["0:one.test", "1:two.test"])
    await client.dispose()
  })

  it("can reject public hostnames that resolve onto private addresses", async () => {
    const fetch = vi.fn(async () => new Response(PLAYLIST))
    const client = createIptvClient({
      http: { fetch },
      urlPolicy: {
        allowPrivateNetworks: false,
        resolveHostname: async () => ["127.0.0.1"],
      },
    })
    await expect(client.loadM3u("https://rebound.test/list.m3u")).rejects.toMatchObject({
      _tag: "IptvUrlPolicyError",
    })
    expect(fetch).not.toHaveBeenCalled()
    await client.dispose()
  })
})
