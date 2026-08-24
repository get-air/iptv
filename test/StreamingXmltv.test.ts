import { Effect, Stream } from "effect"
import { describe, expect, it } from "vitest"

import { streamXmltvChunks } from "../src/index.js"
import { streamXmltv } from "../src/effect.js"

const XMLTV = `<?xml version="1.0"?><tv>
<channel id="news"><display-name lang="en">News</display-name></channel>
<programme channel="news" start="20260824010000 -0030" stop="20260824020000 -0030">
  <title lang="en">Morning News</title><desc>Headlines</desc>
</programme>
<programme channel="news" start="20260824020000 -0030" stop="20260824030000 -0030">
  <title>World News</title>
</programme></tv>`

describe("streaming XMLTV", () => {
  it("parses arbitrary chunk boundaries and emits bounded batches", async () => {
    const chunks = async function* () {
      for (let index = 0; index < XMLTV.length; index += 17) yield XMLTV.slice(index, index + 17)
    }
    const batches = []
    for await (const batch of streamXmltvChunks(chunks(), {
      channelBatchSize: 1,
      programmeBatchSize: 1,
    })) batches.push(batch)

    expect(batches[0]).toMatchObject({
      channels: [{ id: "news", displayNames: ["News"] }],
      programmes: [],
      totalChannels: 1,
    })
    const programmes = batches.flatMap((batch) => batch.programmes)
    expect(programmes.map((programme) => programme.title)).toEqual(["Morning News", "World News"])
    expect(programmes[0]?.start.toISOString()).toBe("2026-08-24T01:30:00.000Z")
  })

  it("detects and incrementally decompresses gzip guides", async () => {
    const compressed = await gzip(XMLTV)
    const chunks = async function* () {
      for (let index = 0; index < compressed.length; index += 23) {
        yield compressed.slice(index, index + 23)
      }
    }
    const programmes = []
    for await (const batch of streamXmltvChunks(chunks())) programmes.push(...batch.programmes)
    expect(programmes).toHaveLength(2)
  })

  it("rejects empty guides so callers can retain their previous snapshot", async () => {
    const source = async function* () { yield "<?xml version=\"1.0\"?><tv></tv>" }
    const consume = async () => {
      for await (const _batch of streamXmltvChunks(source())) { /* consume */ }
    }
    await expect(consume()).rejects.toMatchObject({ _tag: "XmltvParseError" })
  })

  it("exposes the same batch parser as an Effect Stream", async () => {
    const source = async function* () { yield XMLTV }
    const batches = await Effect.runPromise(Stream.runCollect(streamXmltv(source())))
    expect([...batches].flatMap((batch) => batch.programmes)).toHaveLength(2)
  })
})

async function gzip(value: string): Promise<Uint8Array> {
  const compression = new CompressionStream("gzip")
  const output = new Response(compression.readable).arrayBuffer()
  const writer = compression.writable.getWriter()
  await writer.write(new TextEncoder().encode(value))
  await writer.close()
  return new Uint8Array(await output)
}
