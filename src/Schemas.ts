import { Schema } from "effect"

const NonEmptyString = Schema.String.pipe(Schema.minLength(1))
const OptionalNonEmptyString = Schema.optional(NonEmptyString)

export const ChannelId = NonEmptyString.pipe(Schema.brand("@get-air/iptv/ChannelId"))
export type ChannelId = typeof ChannelId.Type

export const CategoryId = NonEmptyString.pipe(Schema.brand("@get-air/iptv/CategoryId"))
export type CategoryId = typeof CategoryId.Type

export const MovieId = NonEmptyString.pipe(Schema.brand("@get-air/iptv/MovieId"))
export type MovieId = typeof MovieId.Type

export const SeriesId = NonEmptyString.pipe(Schema.brand("@get-air/iptv/SeriesId"))
export type SeriesId = typeof SeriesId.Type

export const EpisodeId = NonEmptyString.pipe(Schema.brand("@get-air/iptv/EpisodeId"))
export type EpisodeId = typeof EpisodeId.Type

export const EpgChannelId = NonEmptyString.pipe(Schema.brand("@get-air/iptv/EpgChannelId"))
export type EpgChannelId = typeof EpgChannelId.Type

export const PlaylistEntryId = NonEmptyString.pipe(Schema.brand("@get-air/iptv/PlaylistEntryId"))
export type PlaylistEntryId = typeof PlaylistEntryId.Type

export const SourceId = NonEmptyString.pipe(Schema.brand("@get-air/iptv/SourceId"))
export type SourceId = typeof SourceId.Type

export const SearchDocumentId = NonEmptyString.pipe(Schema.brand("@get-air/iptv/SearchDocumentId"))
export type SearchDocumentId = typeof SearchDocumentId.Type

export const IptvSourceKind = Schema.Literal("xtream", "m3u", "stalker")
export type IptvSourceKind = typeof IptvSourceKind.Type

export const IptvContentKind = Schema.Literal("live", "radio", "movie", "series", "episode", "unknown")
export type IptvContentKind = typeof IptvContentKind.Type

export const StreamFormat = Schema.Literal("m3u8", "ts", "rtmp")
export type StreamFormat = typeof StreamFormat.Type

export const IptvHeaders = Schema.Record({ key: Schema.String, value: Schema.String })
export type IptvHeaders = typeof IptvHeaders.Type

export const Catchup = Schema.Struct({
  type: Schema.Literal("default", "append", "shift", "flussonic", "xtream"),
  source: OptionalNonEmptyString,
  days: Schema.optional(Schema.Number.pipe(Schema.nonNegative())),
})
export type Catchup = typeof Catchup.Type

export const IptvChannel = Schema.Struct({
  id: ChannelId,
  name: NonEmptyString,
  streamUrl: NonEmptyString,
  source: IptvSourceKind,
  kind: Schema.Literal("live", "radio"),
  number: Schema.optional(Schema.Number),
  categoryIds: Schema.Array(CategoryId),
  epgChannelId: Schema.optional(EpgChannelId),
  logoUrl: OptionalNonEmptyString,
  directSource: OptionalNonEmptyString,
  headers: IptvHeaders,
  catchup: Schema.optional(Catchup),
})
export type IptvChannel = typeof IptvChannel.Type

export const IptvCategory = Schema.Struct({
  id: CategoryId,
  name: NonEmptyString,
  kind: Schema.Literal("live", "movie", "series"),
  parentId: Schema.optional(CategoryId),
})
export type IptvCategory = typeof IptvCategory.Type

export const IptvMovie = Schema.Struct({
  id: MovieId,
  name: NonEmptyString,
  streamUrl: NonEmptyString,
  categoryIds: Schema.Array(CategoryId),
  containerExtension: NonEmptyString,
  year: OptionalNonEmptyString,
  posterUrl: OptionalNonEmptyString,
  plot: OptionalNonEmptyString,
  genre: OptionalNonEmptyString,
  rating: Schema.optional(Schema.Number),
  durationSeconds: Schema.optional(Schema.Number.pipe(Schema.nonNegative())),
  directSource: OptionalNonEmptyString,
})
export type IptvMovie = typeof IptvMovie.Type

export const IptvSeries = Schema.Struct({
  id: SeriesId,
  name: NonEmptyString,
  categoryIds: Schema.Array(CategoryId),
  year: OptionalNonEmptyString,
  coverUrl: OptionalNonEmptyString,
  plot: OptionalNonEmptyString,
  genre: OptionalNonEmptyString,
  rating: Schema.optional(Schema.Number),
})
export type IptvSeries = typeof IptvSeries.Type

export const IptvEpisode = Schema.Struct({
  id: EpisodeId,
  seriesId: SeriesId,
  title: NonEmptyString,
  season: Schema.Number.pipe(Schema.nonNegative()),
  episode: Schema.Number.pipe(Schema.nonNegative()),
  streamUrl: NonEmptyString,
  containerExtension: NonEmptyString,
  plot: OptionalNonEmptyString,
  durationSeconds: Schema.optional(Schema.Number.pipe(Schema.nonNegative())),
})
export type IptvEpisode = typeof IptvEpisode.Type

export const IptvSeriesDetails = Schema.Struct({
  series: IptvSeries,
  episodes: Schema.Array(IptvEpisode),
})
export type IptvSeriesDetails = typeof IptvSeriesDetails.Type

export const EpgChannel = Schema.Struct({
  id: EpgChannelId,
  displayNames: Schema.Array(NonEmptyString),
  iconUrl: OptionalNonEmptyString,
  urls: Schema.Array(NonEmptyString),
})
export type EpgChannel = typeof EpgChannel.Type

export const EpgProgramme = Schema.Struct({
  channelId: EpgChannelId,
  start: Schema.ValidDateFromSelf,
  end: Schema.optional(Schema.ValidDateFromSelf),
  title: NonEmptyString,
  subtitle: OptionalNonEmptyString,
  description: OptionalNonEmptyString,
  categories: Schema.Array(NonEmptyString),
  iconUrl: OptionalNonEmptyString,
  episode: OptionalNonEmptyString,
})
export type EpgProgramme = typeof EpgProgramme.Type

export const IptvGuide = Schema.Struct({
  channels: Schema.Array(EpgChannel),
  programmes: Schema.Array(EpgProgramme),
})
export type IptvGuide = typeof IptvGuide.Type

export const IptvPlaylistEntry = Schema.Struct({
  id: PlaylistEntryId,
  name: NonEmptyString,
  streamUrl: NonEmptyString,
  kind: Schema.Literal("live", "radio", "movie", "series", "unknown"),
  durationSeconds: Schema.optional(Schema.Number.pipe(Schema.nonNegative())),
  categoryIds: Schema.Array(CategoryId),
  epgChannelId: Schema.optional(EpgChannelId),
  logoUrl: OptionalNonEmptyString,
  headers: IptvHeaders,
  catchup: Schema.optional(Catchup),
  attributes: Schema.Record({ key: Schema.String, value: Schema.String }),
})
export type IptvPlaylistEntry = typeof IptvPlaylistEntry.Type

export const IptvPlaylist = Schema.Struct({
  name: OptionalNonEmptyString,
  epgUrls: Schema.Array(NonEmptyString),
  entries: Schema.Array(IptvPlaylistEntry),
})
export type IptvPlaylist = typeof IptvPlaylist.Type

export const IptvSourceRef = Schema.Struct({
  id: SourceId,
  name: NonEmptyString,
  kind: IptvSourceKind,
})
export type IptvSourceRef = typeof IptvSourceRef.Type

export const IptvSearchEntity = Schema.Union(
  IptvChannel,
  IptvMovie,
  IptvSeries,
  IptvEpisode,
  IptvPlaylistEntry,
)
export type IptvSearchEntity = typeof IptvSearchEntity.Type

export const IptvSearchDocument = Schema.Struct({
  id: SearchDocumentId,
  source: IptvSourceRef,
  contentKind: IptvContentKind,
  title: NonEmptyString,
  subtitle: OptionalNonEmptyString,
  categoryIds: Schema.Array(CategoryId),
  posterUrl: OptionalNonEmptyString,
  hidden: Schema.Boolean,
  terms: Schema.Array(NonEmptyString),
  entity: IptvSearchEntity,
})
export type IptvSearchDocument = typeof IptvSearchDocument.Type

export const IptvSearchMatch = Schema.Literal(
  "exact",
  "phrase-prefix",
  "token-prefix",
  "all-token-prefixes",
  "phrase-substring",
  "all-token-substrings",
)
export type IptvSearchMatch = typeof IptvSearchMatch.Type

export const IptvSearchResult = Schema.Struct({
  document: IptvSearchDocument,
  score: Schema.Number.pipe(Schema.nonNegative()),
  match: IptvSearchMatch,
})
export type IptvSearchResult = typeof IptvSearchResult.Type

export const IptvSearchPage = Schema.Struct({
  items: Schema.Array(IptvSearchResult),
  total: Schema.Number.pipe(Schema.nonNegative()),
  offset: Schema.Number.pipe(Schema.nonNegative()),
  limit: Schema.Number.pipe(Schema.positive()),
  hasMore: Schema.Boolean,
})
export type IptvSearchPage = typeof IptvSearchPage.Type

export const EpgBatch = Schema.Struct({
  channels: Schema.Array(EpgChannel),
  programmes: Schema.Array(EpgProgramme),
  totalChannels: Schema.Number.pipe(Schema.nonNegative()),
  totalProgrammes: Schema.Number.pipe(Schema.nonNegative()),
})
export type EpgBatch = typeof EpgBatch.Type

export const EpgMatchVia = Schema.Literal("override", "id", "tvg-name", "channel-name")
export type EpgMatchVia = typeof EpgMatchVia.Type

export const EpgMatchResult = Schema.Union(
  Schema.Struct({
    status: Schema.Literal("matched"),
    channel: EpgChannel,
    via: EpgMatchVia,
  }),
  Schema.Struct({
    status: Schema.Literal("ambiguous"),
    candidates: Schema.Array(EpgChannel),
    via: EpgMatchVia,
  }),
  Schema.Struct({ status: Schema.Literal("unmatched") }),
)
export type EpgMatchResult = typeof EpgMatchResult.Type

export const PlaylistSnapshot = Schema.Struct({
  sourceUrl: NonEmptyString,
  name: OptionalNonEmptyString,
  loadedAt: Schema.ValidDateFromSelf,
  revision: NonEmptyString,
  etag: OptionalNonEmptyString,
  lastModified: OptionalNonEmptyString,
  playlist: IptvPlaylist,
})
export type PlaylistSnapshot = typeof PlaylistSnapshot.Type

export const PlaylistDiff = Schema.Struct({
  added: Schema.Array(IptvPlaylistEntry),
  removed: Schema.Array(IptvPlaylistEntry),
  updated: Schema.Array(Schema.Struct({ before: IptvPlaylistEntry, after: IptvPlaylistEntry })),
  unchanged: Schema.Array(IptvPlaylistEntry),
})
export type PlaylistDiff = typeof PlaylistDiff.Type

export const PlaylistRefreshResult = Schema.Union(
  Schema.Struct({
    status: Schema.Literal("updated"),
    snapshot: PlaylistSnapshot,
    diff: PlaylistDiff,
  }),
  Schema.Struct({
    status: Schema.Literal("not-modified"),
    snapshot: PlaylistSnapshot,
  }),
)
export type PlaylistRefreshResult = typeof PlaylistRefreshResult.Type

export const XtreamCatchupVariant = Schema.Literal(
  "rest-ts",
  "rest-m3u8",
  "legacy-ts",
  "legacy-m3u8",
)
export type XtreamCatchupVariant = typeof XtreamCatchupVariant.Type

export const StalkerProfile = Schema.Struct({
  id: OptionalNonEmptyString,
  name: OptionalNonEmptyString,
  status: OptionalNonEmptyString,
  expiresAt: Schema.optional(Schema.ValidDateFromSelf),
  timezone: OptionalNonEmptyString,
})
export type StalkerProfile = typeof StalkerProfile.Type

export const XtreamAccount = Schema.Struct({
  authenticated: Schema.Boolean,
  status: OptionalNonEmptyString,
  expiresAt: Schema.optional(Schema.ValidDateFromSelf),
  trial: Schema.Boolean,
  activeConnections: Schema.Number.pipe(Schema.nonNegative()),
  maxConnections: Schema.optional(Schema.Number.pipe(Schema.nonNegative())),
  allowedFormats: Schema.Array(StreamFormat),
})
export type XtreamAccount = typeof XtreamAccount.Type

export const XtreamServer = Schema.Struct({
  protocol: OptionalNonEmptyString,
  host: OptionalNonEmptyString,
  port: OptionalNonEmptyString,
  timezone: OptionalNonEmptyString,
  timestamp: Schema.optional(Schema.Number),
  version: OptionalNonEmptyString,
})
export type XtreamServer = typeof XtreamServer.Type

export const XtreamProfile = Schema.Struct({
  account: XtreamAccount,
  server: XtreamServer,
})
export type XtreamProfile = typeof XtreamProfile.Type

export const EpgNowNext = Schema.Struct({
  current: Schema.optional(EpgProgramme),
  next: Schema.optional(EpgProgramme),
})
export type EpgNowNext = typeof EpgNowNext.Type
