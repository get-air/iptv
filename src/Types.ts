import type { CacheStore } from "@get-air/cache"
import type { HttpTransport } from "@get-air/http"

import type {
  CategoryId,
  ChannelId,
  EpgNowNext,
  EpgChannelId,
  IptvCategory,
  IptvChannel,
  IptvGuide,
  IptvMovie,
  IptvPlaylist,
  IptvSeries,
  IptvSeriesDetails,
  MovieId,
  SeriesId,
  StreamFormat,
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
}

export interface EffectIptvClientConfig {
  readonly cacheTtlMillis?: number
  readonly epgCacheTtlMillis?: number
  readonly maxResponseBytes?: number
  readonly userAgent?: string
}

export interface M3uParseOptions {
  readonly baseUrl?: string
  readonly name?: string
}

export interface XmltvParseOptions {
  readonly language?: string
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
  timeshiftUrl(channelId: ChannelId | string, start: Date, durationSeconds: number): string
  xmltvUrl(): string
  playlistUrl(format?: StreamFormat): string
}

export interface IptvClient {
  xtream(credentials: XtreamCredentials): XtreamClient
  parseM3u(text: string, options?: M3uParseOptions): Promise<IptvPlaylist>
  loadM3u(url: string, options?: M3uParseOptions, callOptions?: IptvCallOptions): Promise<IptvPlaylist>
  parseXmltv(text: string, options?: XmltvParseOptions): Promise<IptvGuide>
  loadXmltv(url: string, options?: XmltvParseOptions, callOptions?: IptvCallOptions): Promise<IptvGuide>
  nowNext(guide: IptvGuide, channelId: EpgChannelId | string, at?: Date): Promise<{
    readonly current?: EpgNowNext["current"]
    readonly next?: EpgNowNext["next"]
  }>
  dispose(): Promise<void>
}
