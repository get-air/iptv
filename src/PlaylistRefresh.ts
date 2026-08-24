import { Schema } from "effect"

import {
  PlaylistDiff,
  PlaylistSnapshot,
  type IptvPlaylist,
  type IptvPlaylistEntry,
  type PlaylistDiff as PlaylistDiffType,
  type PlaylistSnapshot as PlaylistSnapshotType,
} from "./Schemas.js"

export function makePlaylistSnapshot(input: {
  readonly sourceUrl: string
  readonly name?: string
  readonly playlist: IptvPlaylist
  readonly etag?: string
  readonly lastModified?: string
  readonly loadedAt?: Date
}): PlaylistSnapshotType {
  return Schema.decodeUnknownSync(PlaylistSnapshot)({
    sourceUrl: input.sourceUrl,
    ...(input.name === undefined ? {} : { name: input.name }),
    loadedAt: input.loadedAt ?? new Date(),
    revision: playlistRevision(input.playlist),
    ...(input.etag === undefined ? {} : { etag: input.etag }),
    ...(input.lastModified === undefined ? {} : { lastModified: input.lastModified }),
    playlist: input.playlist,
  })
}

export function diffPlaylists(
  previous: IptvPlaylist | undefined,
  next: IptvPlaylist,
): PlaylistDiffType {
  if (previous === undefined) {
    return Schema.decodeUnknownSync(PlaylistDiff)({
      added: next.entries,
      removed: [],
      updated: [],
      unchanged: [],
    })
  }
  const before = new Map(previous.entries.map((entry) => [entryIdentity(entry), entry]))
  const after = new Map(next.entries.map((entry) => [entryIdentity(entry), entry]))
  const added: IptvPlaylistEntry[] = []
  const removed: IptvPlaylistEntry[] = []
  const updated: Array<{ before: IptvPlaylistEntry; after: IptvPlaylistEntry }> = []
  const unchanged: IptvPlaylistEntry[] = []

  for (const [identity, entry] of after) {
    const old = before.get(identity)
    if (old === undefined) added.push(entry)
    else if (entryFingerprint(old) === entryFingerprint(entry)) unchanged.push(entry)
    else updated.push({ before: old, after: entry })
  }
  for (const [identity, entry] of before) {
    if (!after.has(identity)) removed.push(entry)
  }
  return Schema.decodeUnknownSync(PlaylistDiff)({ added, removed, updated, unchanged })
}

export function playlistRevision(playlist: IptvPlaylist): string {
  return hash(JSON.stringify({
    name: playlist.name,
    epgUrls: [...playlist.epgUrls].sort(),
    entries: playlist.entries.map((entry) => [entryIdentity(entry), entryFingerprint(entry)]).sort(),
  }))
}

function entryIdentity(entry: IptvPlaylistEntry): string {
  return entry.epgChannelId?.trim()
    || entry.attributes["tvg-id"]?.trim()
    || entry.streamUrl.trim()
    || entry.id
}

function entryFingerprint(entry: IptvPlaylistEntry): string {
  return JSON.stringify({
    name: entry.name,
    streamUrl: entry.streamUrl,
    kind: entry.kind,
    durationSeconds: entry.durationSeconds,
    categoryIds: [...entry.categoryIds].sort(),
    epgChannelId: entry.epgChannelId,
    logoUrl: entry.logoUrl,
    headers: sorted(entry.headers),
    catchup: entry.catchup,
    attributes: sorted(entry.attributes),
  })
}

function sorted(value: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)))
}

function hash(value: string): string {
  let state = 0xcbf29ce484222325n
  for (const byte of new TextEncoder().encode(value)) {
    state ^= BigInt(byte)
    state = BigInt.asUintN(64, state * 0x100000001b3n)
  }
  return state.toString(36)
}
