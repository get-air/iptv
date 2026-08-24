import { Schema } from "effect"

import {
  EpgMatchResult,
  type EpgChannel,
  type EpgMatchResult as EpgMatchResultType,
  type EpgMatchVia,
  type IptvGuide,
  type IptvPlaylistEntry,
} from "./Schemas.js"
import type { EpgMatchOptions } from "./Types.js"

export function matchEpgChannel(
  guide: IptvGuide,
  entry: IptvPlaylistEntry,
  options: EpgMatchOptions = {},
): EpgMatchResultType {
  const byId = new Map<string, EpgChannel[]>()
  const byName = new Map<string, EpgChannel[]>()
  for (const channel of guide.channels) {
    append(byId, normalize(channel.id), channel)
    for (const name of channel.displayNames) append(byName, normalize(name), channel)
  }

  const override = options.overrides?.[entry.id]
    ?? (entry.epgChannelId === undefined ? undefined : options.overrides?.[entry.epgChannelId])
  if (override !== undefined) {
    const candidates = byId.get(normalize(override)) ?? []
    return result(candidates, "override")
  }
  if (entry.epgChannelId !== undefined) {
    const candidates = byId.get(normalize(entry.epgChannelId)) ?? []
    if (candidates.length > 0) return result(candidates, "id")
  }
  const tvgName = entry.attributes["tvg-name"]
  if (tvgName !== undefined) {
    const candidates = byName.get(normalize(tvgName)) ?? []
    if (candidates.length > 0) return result(candidates, "tvg-name")
  }
  return result(byName.get(normalize(entry.name)) ?? [], "channel-name")
}

function result(candidates: readonly EpgChannel[], via: EpgMatchVia): EpgMatchResultType {
  const unique = [...new Map(candidates.map((channel) => [channel.id, channel])).values()]
  if (unique.length === 0) return Schema.decodeUnknownSync(EpgMatchResult)({ status: "unmatched" })
  if (unique.length === 1) {
    return Schema.decodeUnknownSync(EpgMatchResult)({ status: "matched", channel: unique[0], via })
  }
  return Schema.decodeUnknownSync(EpgMatchResult)({ status: "ambiguous", candidates: unique, via })
}

function append(target: Map<string, EpgChannel[]>, key: string, channel: EpgChannel): void {
  if (key === "") return
  const values = target.get(key)
  if (values === undefined) target.set(key, [channel])
  else values.push(channel)
}

function normalize(value: string): string {
  return value.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ")
}
