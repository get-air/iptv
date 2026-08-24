import { layerHttpTransport } from "@get-air/http/effect"
import { Effect, Either, Layer, ManagedRuntime } from "effect"

import { IptvService, layerIptvClient } from "./Client.js"
import type { IptvClientError } from "./Errors.js"
import { streamXmltvChunks } from "./StreamingXmltv.js"
import type {
  CatalogOptions,
  EpgMatchOptions,
  IptvCallOptions,
  IptvClient,
  IptvClientConfig,
  M3uParseOptions,
  PlaylistRefreshOptions,
  ShortEpgOptions,
  StalkerClient,
  StalkerCredentials,
  XmltvChunkSource,
  XmltvParseOptions,
  XmltvStreamOptions,
  XtreamCatchupOptions,
  XtreamClient,
  XtreamCredentials,
} from "./Types.js"
import {
  normalizeXtreamCredentials,
  playlistUrl,
  timeshiftUrl,
  xmltvUrl,
} from "./Xtream.js"

export function createIptvClient(config: IptvClientConfig): IptvClient {
  const runtime = ManagedRuntime.make(
    layerIptvClient({
      ...(config.cacheTtlMillis === undefined ? {} : { cacheTtlMillis: config.cacheTtlMillis }),
      ...(config.epgCacheTtlMillis === undefined ? {} : { epgCacheTtlMillis: config.epgCacheTtlMillis }),
      ...(config.maxResponseBytes === undefined ? {} : { maxResponseBytes: config.maxResponseBytes }),
      ...(config.userAgent === undefined ? {} : { userAgent: config.userAgent }),
      ...(config.urlPolicy === undefined ? {} : { urlPolicy: config.urlPolicy }),
      ...(config.searchCandidateLimit === undefined ? {} : { searchCandidateLimit: config.searchCandidateLimit }),
    }, {
      ...(config.cache === undefined ? {} : { cache: config.cache }),
      ...(config.searchIndex === undefined ? {} : { searchIndex: config.searchIndex }),
    }).pipe(
      Layer.provide(layerHttpTransport(config.http)),
    ),
  )
  const run = async <A>(effect: Effect.Effect<A, IptvClientError, IptvService>): Promise<A> => {
    const result = await runtime.runPromise(Effect.either(effect))
    if (Either.isLeft(result)) throw result.left
    return result.right
  }

  const xtream = (credentials: XtreamCredentials): XtreamClient => ({
    profile: (options) => run(IptvService.profile(credentials, options)),
    liveCategories: (options) => run(IptvService.categories(credentials, "live", options)),
    liveChannels: (filters, options) => run(
      IptvService.liveChannels(credentials, filters, options),
    ),
    movieCategories: (options) => run(IptvService.categories(credentials, "movie", options)),
    movies: (filters, options) => run(IptvService.movies(credentials, filters, options)),
    movie: (movieId, options) => run(IptvService.movie(credentials, movieId, options)),
    seriesCategories: (options) => run(IptvService.categories(credentials, "series", options)),
    series: (filters, options) => run(IptvService.series(credentials, filters, options)),
    seriesDetails: (seriesId, options) => run(
      IptvService.seriesDetails(credentials, seriesId, options),
    ),
    shortEpg: (input, options) => run(IptvService.shortEpg(credentials, input, options)),
    fullEpg: (channelId, options) => run(IptvService.fullEpg(credentials, channelId, options)),
    timeshiftUrl: (channelId, start, durationSeconds, options) => {
      const resolved = normalizeXtreamCredentials(credentials)
      return timeshiftUrl(resolved, channelId, start, durationSeconds, options ?? {
        variant: resolved.preferredFormat === "m3u8" ? "rest-m3u8" : "rest-ts",
      })
    },
    resolveTimeshiftUrl: (channelId, start, durationSeconds, options, callOptions) => run(
      IptvService.resolveTimeshiftUrl(
        credentials,
        channelId,
        start,
        durationSeconds,
        options,
        callOptions,
      ),
    ),
    xmltvUrl: () => xmltvUrl(normalizeXtreamCredentials(credentials)),
    playlistUrl: (format) => {
      const resolved = normalizeXtreamCredentials(credentials)
      return playlistUrl(resolved, format ?? resolved.preferredFormat)
    },
  })

  const stalker = (credentials: StalkerCredentials): StalkerClient => ({
    profile: (options) => run(IptvService.stalkerProfile(credentials, options)),
    liveCategories: (options) => run(IptvService.stalkerCategories(credentials, options)),
    liveChannels: (options) => run(IptvService.stalkerChannels(credentials, options)),
    movieCategories: (options) => run(IptvService.stalkerMovieCategories(credentials, options)),
    movies: (filters, options) => run(IptvService.stalkerMovies(credentials, filters, options)),
    resolveStreamUrl: (channel, options) => run(
      IptvService.resolveStalkerStream(credentials, channel, options),
    ),
    resolveMovieUrl: (movie, options) => run(
      IptvService.resolveStalkerMovie(credentials, movie, options),
    ),
  })

  const loadXmltvStream = async function* (
    url: string,
    options?: XmltvStreamOptions,
    callOptions?: IptvCallOptions,
  ) {
    const response = await run(IptvService.openXmltv(url, callOptions))
    yield* streamXmltvChunks(response.body!, options)
  }

  return {
    xtream,
    stalker,
    parseM3u: (text: string, options?: M3uParseOptions) =>
      run(IptvService.parseM3u(text, options)),
    loadM3u: (url: string, options?: M3uParseOptions, callOptions?: IptvCallOptions) =>
      run(IptvService.loadM3u(url, options, callOptions)),
    refreshM3u: (url: string, options?: PlaylistRefreshOptions, callOptions?: IptvCallOptions) =>
      run(IptvService.refreshM3u(url, options, callOptions)),
    parseXmltv: (text: string, options?: XmltvParseOptions) =>
      run(IptvService.parseXmltv(text, options)),
    loadXmltv: (url: string, options?: XmltvParseOptions, callOptions?: IptvCallOptions) =>
      run(IptvService.loadXmltv(url, options, callOptions)),
    streamXmltv: (source: XmltvChunkSource, options?: XmltvStreamOptions) =>
      streamXmltvChunks(source, options),
    loadXmltvStream,
    matchEpgChannel: (guide, entry, options?: EpgMatchOptions) =>
      run(IptvService.matchEpg(guide, entry, options)),
    replaceSearchSource: (source, content) =>
      run(IptvService.replaceSearchSource(source, content)),
    removeSearchSource: (sourceId) => run(IptvService.removeSearchSource(sourceId)),
    search: (query, options) => run(IptvService.search(query, options)),
    clearSearch: () => run(IptvService.clearSearch()),
    nowNext: (guide, channelId, at) => run(IptvService.nowNext(guide, channelId, at)),
    dispose: () => runtime.dispose(),
  }
}

export type {
  CatalogOptions,
  IptvCallOptions,
  IptvClient,
  IptvClientConfig,
  M3uParseOptions,
  PlaylistRefreshOptions,
  ShortEpgOptions,
  StalkerClient,
  StalkerCredentials,
  XmltvChunkSource,
  XmltvParseOptions,
  XmltvStreamOptions,
  XtreamCatchupOptions,
  XtreamClient,
  XtreamCredentials,
}
