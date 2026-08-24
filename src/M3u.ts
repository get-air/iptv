import { Effect, Schema } from "effect"

import { M3uParseError } from "./Errors.js"
import {
  IptvPlaylist,
  IptvPlaylistEntry,
} from "./Schemas.js"
import type { M3uParseOptions } from "./Types.js"

interface PendingEntry {
  readonly duration?: number
  readonly name: string
  readonly attributes: Record<string, string>
  group?: string
  readonly vlc: Record<string, string>
  readonly kodi: Record<string, string>
  readonly line: number
}

export const parseM3u = Effect.fn("IptvClient.parseM3u")((
  text: string,
  options: M3uParseOptions = {},
) => Effect.try({
  try: () => parseM3uUnsafe(text, options),
  catch: (cause) => cause instanceof M3uParseError
    ? cause
    : new M3uParseError({ message: "Playlist contains invalid IPTV metadata" }),
}))

function parseM3uUnsafe(text: string, options: M3uParseOptions): IptvPlaylist {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/)
  const firstContent = lines.find((line) => line.trim() !== "")?.trim()
  if (!firstContent?.startsWith("#EXTM3U")) {
    throw new M3uParseError({ line: 1, message: "IPTV playlist must begin with #EXTM3U" })
  }

  const header = parseAttributes(firstContent.slice("#EXTM3U".length))
  const epgUrls = unique([
    ...splitUrls(header["url-tvg"]),
    ...splitUrls(header["x-tvg-url"]),
  ])
  const entries: IptvPlaylistEntry[] = []
  let pending: PendingEntry | undefined

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? ""
    if (line === "") continue
    if (line.startsWith("#EXTINF:")) {
      const { metadata, name } = splitExtInf(line.slice("#EXTINF:".length), index + 1)
      const firstSpace = metadata.search(/\s/)
      const durationText = firstSpace < 0 ? metadata : metadata.slice(0, firstSpace)
      const parsedDuration = Number(durationText)
      pending = {
        ...(Number.isFinite(parsedDuration) ? { duration: parsedDuration } : {}),
        name: name.trim() || "Unnamed stream",
        attributes: parseAttributes(firstSpace < 0 ? "" : metadata.slice(firstSpace + 1)),
        vlc: {},
        kodi: {},
        line: index + 1,
      }
      continue
    }
    if (line.startsWith("#EXTGRP:")) {
      if (pending) pending.group = line.slice("#EXTGRP:".length).trim()
      continue
    }
    if (line.startsWith("#EXTVLCOPT:")) {
      if (pending) assignOption(pending.vlc, line.slice("#EXTVLCOPT:".length))
      continue
    }
    if (line.startsWith("#KODIPROP:")) {
      if (pending) assignOption(pending.kodi, line.slice("#KODIPROP:".length))
      continue
    }
    if (line.startsWith("#")) continue
    if (!pending) {
      throw new M3uParseError({ line: index + 1, message: "Stream URL has no preceding #EXTINF entry" })
    }
    entries.push(toEntry(pending, line, entries.length, options))
    pending = undefined
  }

  if (pending) {
    throw new M3uParseError({ line: pending.line, message: "#EXTINF entry is missing its stream URL" })
  }

  return Schema.decodeUnknownSync(IptvPlaylist)({
    ...(options.name || header["playlist-name"] ? {
      name: options.name ?? header["playlist-name"],
    } : {}),
    epgUrls,
    entries,
  })
}

function toEntry(
  pending: PendingEntry,
  rawUrl: string,
  index: number,
  options: M3uParseOptions,
): IptvPlaylistEntry {
  const attributes = pending.attributes
  const group = attributes["group-title"] || pending.group
  const categoryIds = group === undefined
    ? []
    : group.split(/[;,]/).map((part) => part.trim()).filter(Boolean)
  const epgId = attributes["tvg-id"]?.trim()
  const id = epgId || `m3u-${index + 1}-${pending.name}`
  const duration = pending.duration !== undefined && pending.duration >= 0
    ? pending.duration
    : undefined
  const headers = headersFor(pending)
  const catchup = catchupFor(attributes)
  return Schema.decodeUnknownSync(IptvPlaylistEntry)({
    id,
    name: pending.name,
    streamUrl: resolveUrl(rawUrl, options.baseUrl),
    kind: classify(pending.name, group, attributes, duration),
    ...(duration === undefined ? {} : { durationSeconds: duration }),
    categoryIds,
    ...(epgId ? { epgChannelId: epgId } : {}),
    ...(attributes["tvg-logo"] ? { logoUrl: attributes["tvg-logo"] } : {}),
    headers,
    ...(catchup === undefined ? {} : { catchup }),
    attributes: { ...attributes, ...prefixOptions("vlc", pending.vlc), ...prefixOptions("kodi", pending.kodi) },
  })
}

function classify(
  name: string,
  group: string | undefined,
  attributes: Record<string, string>,
  duration: number | undefined,
): "live" | "radio" | "movie" | "series" | "unknown" {
  const haystack = `${name} ${group ?? ""}`
  if (/^(1|true|yes)$/i.test(attributes.radio ?? "") || /\bradio\b/i.test(haystack)) return "radio"
  if (/\bseries\b|\bseason\b|\bs\d{1,2}e\d{1,3}\b/i.test(haystack)) return "series"
  if (duration !== undefined || /\bmovies?\b|\bvod\b|\bfilms?\b/i.test(haystack)) return "movie"
  return "live"
}

function catchupFor(attributes: Record<string, string>): {
  type: "default" | "append" | "shift" | "flussonic" | "xtream"
  source?: string
  days?: number
} | undefined {
  const rawType = attributes.catchup?.toLowerCase()
  const type = rawType === "append" || rawType === "shift" || rawType === "flussonic" || rawType === "xtream"
    ? rawType
    : rawType === "default" || attributes["catchup-source"] ? "default" : undefined
  if (type === undefined) return undefined
  const fromHours = attributes["catchup-days"] === undefined
    && attributes["catchup-hours"] !== undefined
  const daysText = attributes["catchup-days"] ?? attributes["catchup-hours"]
  const value = daysText === undefined ? undefined : Number(daysText)
  const days = value !== undefined && Number.isFinite(value)
    ? (fromHours ? value / 24 : value)
    : undefined
  return {
    type,
    ...(attributes["catchup-source"] ? { source: attributes["catchup-source"] } : {}),
    ...(days === undefined ? {} : { days: Math.max(0, days) }),
  }
}

function headersFor(pending: PendingEntry): Record<string, string> {
  const headers: Record<string, string> = {}
  const userAgent = pending.vlc["http-user-agent"] ?? pending.attributes["user-agent"]
  const referrer = pending.vlc["http-referrer"]
  if (userAgent) headers["User-Agent"] = userAgent
  if (referrer) headers.Referer = referrer
  const encoded = pending.kodi["inputstream.adaptive.stream_headers"]
  if (encoded) {
    for (const pair of encoded.split("&")) {
      const separator = pair.indexOf("=")
      if (separator <= 0) continue
      headers[decodeURIComponent(pair.slice(0, separator))] = decodeURIComponent(pair.slice(separator + 1))
    }
  }
  return headers
}

function splitExtInf(value: string, line: number): { metadata: string; name: string } {
  let quote: string | undefined
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if ((character === "\"" || character === "'") && value[index - 1] !== "\\") {
      quote = quote === character ? undefined : quote ?? character
    } else if (character === "," && quote === undefined) {
      return { metadata: value.slice(0, index).trim(), name: value.slice(index + 1) }
    }
  }
  throw new M3uParseError({ line, message: "#EXTINF entry is missing its display-name separator" })
}

function parseAttributes(value: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  const pattern = /([\w-]+)=("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s]+)/g
  for (const match of value.matchAll(pattern)) {
    const key = match[1]?.toLowerCase()
    const raw = match[2]
    if (!key || raw === undefined) continue
    attributes[key] = /^(["']).*\1$/.test(raw) ? raw.slice(1, -1).replace(/\\([\\"'])/g, "$1") : raw
  }
  return attributes
}

function assignOption(target: Record<string, string>, value: string): void {
  const separator = value.indexOf("=")
  if (separator <= 0) return
  target[value.slice(0, separator).trim().toLowerCase()] = value.slice(separator + 1).trim()
}

function prefixOptions(prefix: string, values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [`${prefix}:${key}`, value]))
}

function splitUrls(value: string | undefined): string[] {
  return value?.split(/[;,]/).map((part) => part.trim()).filter(Boolean) ?? []
}

function unique(values: readonly string[]): string[] { return [...new Set(values)] }

function resolveUrl(value: string, baseUrl: string | undefined): string {
  if (baseUrl === undefined) return value.trim()
  return new URL(value.trim(), baseUrl).toString()
}
