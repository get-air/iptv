import type { CacheStore } from "@get-air/cache"
import type { HttpTransport } from "@get-air/http"

import type {
  CategoryId,
  ChannelId,
  EpgBatch,
  EpgMatchResult,
  EpgNowNext,
  EpgChannelId,
  IptvCategory,
  IptvChannel,
  IptvEpisode,
  IptvGuide,
  IptvMovie,
  IptvPlaylist,
  IptvPlaylistEntry,
  IptvSearchPage,
  IptvSeries,
  IptvSeriesDetails,
  IptvSourceRef,
  MovieId,
  PlaylistRefreshResult,
  PlaylistSnapshot,
  SeriesId,
  SourceId,
  StalkerProfile,
  StreamFormat,
  XtreamCatchupVariant,
  XtreamProfile,
} from "./Schemas.js"

export interface XtreamCredentials {
  readonly baseUrl: string
  readonly username: string
  readonly password: string
  readonly preferredFormat?: StreamFormat
}

export interface IptvCallOptions {
  readonly signal?: AbortSignal
  readonly bypassCache?: boolean
}

export type IptvUrlPurpose = "xtream" | "stalker" | "m3u" | "xmltv" | "catchup"

export interface IptvUrlValidationContext {
  readonly purpose: IptvUrlPurpose
  readonly redirectCount: number
  readonly previousUrl?: URL
}

export interface IptvUrlPolicy {
  readonly allowPrivateNetworks?: boolean
  readonly trustedPrivateNetworkOrigins?:
    | readonly string[]
    | Partial<Record<IptvUrlPurpose, readonly string[]>>
  readonly maxRedirects?: number
  readonly sensitiveHeaders?: readonly string[]
  readonly redirectMode?: "transport" | "validate"
  readonly resolveHostname?: (hostname: string) => Promise<readonly string[]>
  readonly validate?: (
    url: URL,
    context: IptvUrlValidationContext,
  ) => void | Promise<void>
}

export interface CatalogOptions {
  readonly categoryId?: CategoryId | string
}

export interface ShortEpgOptions {
  readonly channelId: ChannelId | string
  readonly limit?: number
}

export interface IptvClientConfig {
  readonly http: HttpTransport
  readonly cache?: CacheStore
  readonly cacheTtlMillis?: number
  readonly epgCacheTtlMillis?: number
  readonly maxResponseBytes?: number
  readonly userAgent?: string
  readonly urlPolicy?: IptvUrlPolicy
  readonly searchCandidateLimit?: number
  readonly searchIndex?: IptvSearchIndex
}

export interface EffectIptvClientConfig {
  readonly cacheTtlMillis?: number
  readonly epgCacheTtlMillis?: number
  readonly maxResponseBytes?: number
  readonly userAgent?: string
  readonly urlPolicy?: IptvUrlPolicy
  readonly searchCandidateLimit?: number
}

export interface M3uParseOptions {
  readonly baseUrl?: string
  readonly name?: string
}

export interface XmltvParseOptions {
  readonly language?: string
}

export interface XmltvStreamOptions extends XmltvParseOptions {
  readonly channelBatchSize?: number
  readonly programmeBatchSize?: number
}

export type XmltvChunkSource =
  | AsyncIterable<string | Uint8Array>
  | ReadableStream<Uint8Array>

export interface IptvSearchSourceContent {
  readonly channels?: readonly IptvChannel[]
  readonly movies?: readonly IptvMovie[]
  readonly series?: readonly IptvSeries[]
  readonly episodes?: readonly IptvEpisode[]
  readonly playlist?: IptvPlaylist
  readonly hiddenEntityIds?: readonly string[]
}

export interface IptvSourceInput {
  readonly id: string
  readonly name: string
  readonly kind: "xtream" | "m3u" | "stalker"
}

export interface IptvSearchOptions {
  readonly kinds?: readonly ("live" | "radio" | "movie" | "series" | "episode" | "unknown")[]
  readonly sourceIds?: readonly (SourceId | string)[]
  readonly excludeHidden?: boolean
  readonly limit?: number
  readonly offset?: number
}

export interface IptvSearchIndex {
  replaceSource(source: IptvSourceRef, content: IptvSearchSourceContent): Promise<void>
  removeSource(sourceId: SourceId | string): Promise<void>
  search(query: string, options?: IptvSearchOptions): Promise<IptvSearchPage>
  clear(): Promise<void>
}

export interface EpgMatchOptions {
  readonly overrides?: Readonly<Record<string, EpgChannelId | string>>
}

export interface PlaylistRefreshOptions extends M3uParseOptions {
  readonly previous?: PlaylistSnapshot
}

export interface XtreamCatchupOptions {
  readonly variant?: XtreamCatchupVariant
  readonly serverTimezone?: string
}

export interface StalkerCredentials {
  readonly portalUrl: string
  readonly macAddress: string
  readonly timezone?: string
  readonly language?: string
  readonly userAgent?: string
  readonly serialNumber?: string
  readonly deviceId?: string
  readonly deviceId2?: string
  readonly signature?: string
}

export interface XtreamClient {
  profile(options?: IptvCallOptions): Promise<XtreamProfile>
  liveCategories(options?: IptvCallOptions): Promise<readonly IptvCategory[]>
  liveChannels(filters?: CatalogOptions, options?: IptvCallOptions): Promise<readonly IptvChannel[]>
  movieCategories(options?: IptvCallOptions): Promise<readonly IptvCategory[]>
  movies(filters?: CatalogOptions, options?: IptvCallOptions): Promise<readonly IptvMovie[]>
  movie(movieId: MovieId | string, options?: IptvCallOptions): Promise<IptvMovie>
  seriesCategories(options?: IptvCallOptions): Promise<readonly IptvCategory[]>
  series(filters?: CatalogOptions, options?: IptvCallOptions): Promise<readonly IptvSeries[]>
  seriesDetails(seriesId: SeriesId | string, options?: IptvCallOptions): Promise<IptvSeriesDetails>
  shortEpg(input: ShortEpgOptions, options?: IptvCallOptions): Promise<IptvGuide>
  fullEpg(channelId: ChannelId | string, options?: IptvCallOptions): Promise<IptvGuide>
  timeshiftUrl(
    channelId: ChannelId | string,
    start: Date,
    durationSeconds: number,
    options?: XtreamCatchupOptions,
  ): string
  resolveTimeshiftUrl(
    channelId: ChannelId | string,
    start: Date,
    durationSeconds: number,
    options?: XtreamCatchupOptions,
    callOptions?: IptvCallOptions,
  ): Promise<string>
  xmltvUrl(): string
  playlistUrl(format?: StreamFormat): string
}

export interface StalkerClient {
  profile(options?: IptvCallOptions): Promise<StalkerProfile>
  liveCategories(options?: IptvCallOptions): Promise<readonly IptvCategory[]>
  liveChannels(options?: IptvCallOptions): Promise<readonly IptvChannel[]>
  movieCategories(options?: IptvCallOptions): Promise<readonly IptvCategory[]>
  movies(filters?: CatalogOptions, options?: IptvCallOptions): Promise<readonly IptvMovie[]>
  resolveStreamUrl(channel: IptvChannel, options?: IptvCallOptions): Promise<string>
  resolveMovieUrl(movie: IptvMovie, options?: IptvCallOptions): Promise<string>
}

export interface IptvClient {
  xtream(credentials: XtreamCredentials): XtreamClient
  stalker(credentials: StalkerCredentials): StalkerClient
  parseM3u(text: string, options?: M3uParseOptions): Promise<IptvPlaylist>
  loadM3u(url: string, options?: M3uParseOptions, callOptions?: IptvCallOptions): Promise<IptvPlaylist>
  refreshM3u(
    url: string,
    options?: PlaylistRefreshOptions,
    callOptions?: IptvCallOptions,
  ): Promise<PlaylistRefreshResult>
  parseXmltv(text: string, options?: XmltvParseOptions): Promise<IptvGuide>
  loadXmltv(url: string, options?: XmltvParseOptions, callOptions?: IptvCallOptions): Promise<IptvGuide>
  streamXmltv(source: XmltvChunkSource, options?: XmltvStreamOptions): AsyncIterable<EpgBatch>
  loadXmltvStream(
    url: string,
    options?: XmltvStreamOptions,
    callOptions?: IptvCallOptions,
  ): AsyncIterable<EpgBatch>
  matchEpgChannel(
    guide: IptvGuide,
    entry: IptvPlaylistEntry,
    options?: EpgMatchOptions,
  ): Promise<EpgMatchResult>
  replaceSearchSource(source: IptvSourceInput, content: IptvSearchSourceContent): Promise<void>
  removeSearchSource(sourceId: SourceId | string): Promise<void>
  search(query: string, options?: IptvSearchOptions): Promise<IptvSearchPage>
  clearSearch(): Promise<void>
  nowNext(guide: IptvGuide, channelId: EpgChannelId | string, at?: Date): Promise<{
    readonly current?: EpgNowNext["current"]
    readonly next?: EpgNowNext["next"]
  }>
  dispose(): Promise<void>
}
