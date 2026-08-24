import { Schema } from "effect"
import { SaxesParser, type SaxesTagPlain } from "saxes"

import { XmltvParseError } from "./Errors.js"
import {
  EpgBatch,
  EpgChannel,
  type EpgBatch as EpgBatchType,
  type EpgChannel as EpgChannelType,
  type EpgProgramme,
} from "./Schemas.js"
import type { XmltvChunkSource, XmltvStreamOptions } from "./Types.js"

interface PendingChannel {
  id: string
  displayNames: string[]
  iconUrl?: string
  urls: string[]
}

interface PendingProgramme {
  channelId: string
  start: Date
  end?: Date
  titles: Array<{ value: string; lang?: string }>
  subtitles: Array<{ value: string; lang?: string }>
  descriptions: Array<{ value: string; lang?: string }>
  categories: string[]
  iconUrl?: string
  episode?: string
}

export async function* streamXmltvChunks(
  source: XmltvChunkSource,
  options: XmltvStreamOptions = {},
): AsyncIterable<EpgBatchType> {
  const parser = new XmltvBatchParser(options)
  try {
    for await (const chunk of decodedTextChunks(source)) {
      parser.write(chunk)
      for (const batch of parser.drain()) yield batch
    }
    parser.finish()
    for (const batch of parser.drain()) yield batch
  } catch (cause) {
    throw cause instanceof XmltvParseError
      ? cause
      : new XmltvParseError({ message: cause instanceof Error ? cause.message : String(cause) })
  }
}

class XmltvBatchParser {
  readonly #parser = new SaxesParser({ xmlns: false, position: true })
  readonly #channelBatchSize: number
  readonly #programmeBatchSize: number
  readonly #language: string | undefined
  readonly #channels: EpgChannelType[] = []
  readonly #programmes: EpgProgramme[] = []
  readonly #batches: EpgBatchType[] = []
  #currentChannel: PendingChannel | undefined
  #currentProgramme: PendingProgramme | undefined
  #currentText = ""
  #currentLang: string | undefined
  #totalChannels = 0
  #totalProgrammes = 0
  #failure: Error | undefined

  constructor(options: XmltvStreamOptions) {
    this.#channelBatchSize = Math.max(1, Math.floor(options.channelBatchSize ?? 250))
    this.#programmeBatchSize = Math.max(1, Math.floor(options.programmeBatchSize ?? 1_000))
    this.#language = options.language
    this.#parser.on("error", (error) => { this.#failure = error })
    this.#parser.on("opentag", (tag) => this.#open(tag))
    this.#parser.on("text", (text) => { this.#currentText += text })
    this.#parser.on("cdata", (text) => { this.#currentText += text })
    this.#parser.on("closetag", (tag) => this.#close(tag.name))
  }

  write(chunk: string): void {
    this.#parser.write(chunk)
    if (this.#failure) throw this.#failure
  }

  finish(): void {
    this.#parser.close()
    if (this.#failure) throw this.#failure
    if (this.#totalChannels === 0) {
      throw new XmltvParseError({ message: "XMLTV stream produced no channels" })
    }
    this.#flush()
  }

  drain(): EpgBatchType[] { return this.#batches.splice(0) }

  #open(tag: SaxesTagPlain): void {
    this.#currentText = ""
    switch (tag.name) {
      case "channel":
        this.#currentChannel = {
          id: attribute(tag, "id"),
          displayNames: [],
          urls: [],
        }
        break
      case "programme": {
        if (this.#channels.length > 0) this.#flush()
        const start = parseXmltvTimestamp(attribute(tag, "start"))
        if (start === undefined) {
          throw new XmltvParseError({ message: "XMLTV programme has an invalid start timestamp" })
        }
        const end = parseXmltvTimestamp(attribute(tag, "stop"))
        this.#currentProgramme = {
          channelId: attribute(tag, "channel"),
          start,
          ...(end === undefined ? {} : { end }),
          titles: [],
          subtitles: [],
          descriptions: [],
          categories: [],
        }
        break
      }
      case "display-name":
      case "title":
      case "sub-title":
      case "desc":
        this.#currentLang = optionalAttribute(tag, "lang")
        break
      case "icon": {
        const src = optionalAttribute(tag, "src")
        if (src !== undefined) {
          if (this.#currentChannel) this.#currentChannel.iconUrl ??= src
          else if (this.#currentProgramme) this.#currentProgramme.iconUrl ??= src
        }
        break
      }
      case "episode-num":
        break
    }
  }

  #close(name: string): void {
    const text = this.#currentText.trim()
    if (this.#currentChannel) {
      if (name === "display-name" && text !== "") this.#currentChannel.displayNames.push(text)
      else if (name === "url" && text !== "") this.#currentChannel.urls.push(text)
      else if (name === "channel") {
        if (this.#currentChannel.id !== "" && this.#currentChannel.displayNames.length > 0) {
          this.#channels.push(Schema.decodeUnknownSync(EpgChannel)({
            id: this.#currentChannel.id,
            displayNames: this.#currentChannel.displayNames,
            ...(this.#currentChannel.iconUrl === undefined ? {} : { iconUrl: this.#currentChannel.iconUrl }),
            urls: this.#currentChannel.urls,
          }))
          this.#totalChannels += 1
        }
        this.#currentChannel = undefined
        if (this.#channels.length >= this.#channelBatchSize) this.#flush()
      }
    }

    if (this.#currentProgramme) {
      const localized = { value: text, ...(this.#currentLang === undefined ? {} : { lang: this.#currentLang }) }
      if (name === "title" && text !== "") this.#currentProgramme.titles.push(localized)
      else if (name === "sub-title" && text !== "") this.#currentProgramme.subtitles.push(localized)
      else if (name === "desc" && text !== "") this.#currentProgramme.descriptions.push(localized)
      else if (name === "category" && text !== "") this.#currentProgramme.categories.push(text)
      else if (name === "episode-num" && text !== "") this.#currentProgramme.episode ??= text
      else if (name === "programme") {
        const title = pickLocalized(this.#currentProgramme.titles, this.#language) ?? "Untitled programme"
        const subtitle = pickLocalized(this.#currentProgramme.subtitles, this.#language)
        const description = pickLocalized(this.#currentProgramme.descriptions, this.#language)
        this.#programmes.push({
          channelId: this.#currentProgramme.channelId as EpgProgramme["channelId"],
          start: this.#currentProgramme.start,
          ...(this.#currentProgramme.end === undefined ? {} : { end: this.#currentProgramme.end }),
          title,
          ...(subtitle === undefined ? {} : { subtitle }),
          ...(description === undefined ? {} : { description }),
          categories: this.#currentProgramme.categories,
          ...(this.#currentProgramme.iconUrl === undefined ? {} : { iconUrl: this.#currentProgramme.iconUrl }),
          ...(this.#currentProgramme.episode === undefined ? {} : { episode: this.#currentProgramme.episode }),
        })
        this.#totalProgrammes += 1
        this.#currentProgramme = undefined
        if (this.#programmes.length >= this.#programmeBatchSize) this.#flush()
      }
    }
    this.#currentText = ""
    this.#currentLang = undefined
  }

  #flush(): void {
    if (this.#channels.length === 0 && this.#programmes.length === 0) return
    this.#batches.push(Schema.decodeUnknownSync(EpgBatch)({
      channels: this.#channels.splice(0),
      programmes: this.#programmes.splice(0),
      totalChannels: this.#totalChannels,
      totalProgrammes: this.#totalProgrammes,
    }))
  }
}

export function parseXmltvTimestamp(value: string): Date | undefined {
  const compact = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-])(\d{2})(\d{2})$/.exec(value.trim())
  if (compact) {
    const [, year, month, day, hour, minute, second = "0", sign, offsetHour, offsetMinute] = compact
    const utc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))
    const offset = (Number(offsetHour) * 60 + Number(offsetMinute)) * (sign === "-" ? -1 : 1)
    const date = new Date(utc - offset * 60_000)
    return Number.isNaN(date.getTime()) ? undefined : date
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

async function* decodedTextChunks(source: XmltvChunkSource): AsyncIterable<string> {
  const iterator = asAsyncIterable(source)[Symbol.asyncIterator]()
  const first = await iterator.next()
  if (first.done) return
  if (typeof first.value === "string") {
    yield first.value
    for await (const chunk of iteratorRemainder(iterator)) {
      yield typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)
    }
    return
  }

  const bytes = first.value
  const gzipped = bytes[0] === 0x1f && bytes[1] === 0x8b
  const byteSource = prepend(bytes, iterator)
  const decodedSource = gzipped ? decompressGzip(byteSource) : byteSource
  const decoder = new TextDecoder()
  for await (const chunk of decodedSource) yield decoder.decode(chunk, { stream: true })
  const tail = decoder.decode()
  if (tail !== "") yield tail
}

async function* decompressGzip(source: AsyncIterable<Uint8Array>): AsyncIterable<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new XmltvParseError({ message: "Gzip XMLTV requires DecompressionStream support" })
  }
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of source) controller.enqueue(chunk)
        controller.close()
      } catch (cause) { controller.error(cause) }
    },
  })
  const pair = new DecompressionStream("gzip") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>
  for await (const chunk of readableChunks(readable.pipeThrough(pair))) yield chunk
}

function asAsyncIterable(source: XmltvChunkSource): AsyncIterable<string | Uint8Array> {
  if (Symbol.asyncIterator in source) return source
  return {
    async *[Symbol.asyncIterator]() {
      const reader = source.getReader()
      let completed = false
      try {
        while (true) {
          const item = await reader.read()
          if (item.done) {
            completed = true
            return
          }
          yield item.value
        }
      } finally {
        if (!completed) await reader.cancel().catch(() => undefined)
        reader.releaseLock()
      }
    },
  }
}

function readableChunks<T>(source: ReadableStream<T>): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      const reader = source.getReader()
      let completed = false
      try {
        while (true) {
          const item = await reader.read()
          if (item.done) {
            completed = true
            return
          }
          yield item.value
        }
      } finally {
        if (!completed) await reader.cancel().catch(() => undefined)
        reader.releaseLock()
      }
    },
  }
}

async function* prepend(
  first: Uint8Array,
  iterator: AsyncIterator<string | Uint8Array>,
): AsyncIterable<Uint8Array> {
  yield first
  for await (const chunk of iteratorRemainder(iterator)) {
    if (typeof chunk === "string") yield new TextEncoder().encode(chunk)
    else yield chunk
  }
}

async function* iteratorRemainder<T>(iterator: AsyncIterator<T>): AsyncIterable<T> {
  while (true) {
    const item = await iterator.next()
    if (item.done) return
    yield item.value
  }
}

function attribute(tag: SaxesTagPlain, name: string): string {
  return optionalAttribute(tag, name) ?? ""
}

function optionalAttribute(tag: SaxesTagPlain, name: string): string | undefined {
  const value = tag.attributes[name]
  return typeof value === "string" && value.trim() !== "" ? value : undefined
}

function pickLocalized(
  values: readonly { value: string; lang?: string }[],
  language: string | undefined,
): string | undefined {
  return (language === undefined ? undefined : values.find((value) => value.lang === language))?.value
    ?? values[0]?.value
}
