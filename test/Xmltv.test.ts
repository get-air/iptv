import { describe, expect, it } from "vitest"

import { createIptvClient } from "../src/index.js"

const neverFetch = { fetch: async () => { throw new Error("unexpected network request") } }

describe("XMLTV guides", () => {
  it("normalizes channels and resolves now/next programmes", async () => {
    const client = createIptvClient({ http: neverFetch })
    const guide = await client.parseXmltv(`<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="cnn.us">
    <display-name lang="en">CNN</display-name>
    <icon src="https://img.test/cnn.png" />
  </channel>
  <programme channel="cnn.us" start="20260824010000 +0000" stop="20260824020000 +0000">
    <title lang="en">News Hour</title>
    <desc lang="en">Headlines</desc>
    <category>News</category>
  </programme>
  <programme channel="cnn.us" start="20260824020000 +0000" stop="20260824030000 +0000">
    <title lang="en">World News</title>
  </programme>
</tv>`)

    expect(guide.channels[0]).toMatchObject({
      id: "cnn.us",
      displayNames: ["CNN"],
      iconUrl: "https://img.test/cnn.png",
    })
    expect(guide.programmes[0]).toMatchObject({
      channelId: "cnn.us",
      title: "News Hour",
      description: "Headlines",
      categories: ["News"],
    })

    const result = await client.nowNext(guide, "cnn.us", new Date("2026-08-24T01:30:00Z"))
    expect(result.current?.title).toBe("News Hour")
    expect(result.next?.title).toBe("World News")
    await client.dispose()
  })
})
