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
  source: Schema.Literal("m3u", "xtream"),
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
