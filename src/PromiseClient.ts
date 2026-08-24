import { layerHttpTransport } from "@get-air/http/effect"
import { Effect, Either, Layer, ManagedRuntime } from "effect"

import { IptvService, layerIptvClient } from "./Client.js"
import type { IptvClientError } from "./Errors.js"
import type {
  CatalogOptions,
  IptvCallOptions,
  IptvClient,
  IptvClientConfig,
  M3uParseOptions,
  ShortEpgOptions,
  XmltvParseOptions,
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
    }, config.cache === undefined ? {} : { cache: config.cache }).pipe(
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
    timeshiftUrl: (channelId, start, durationSeconds) =>
      timeshiftUrl(normalizeXtreamCredentials(credentials), channelId, start, durationSeconds),
    xmltvUrl: () => xmltvUrl(normalizeXtreamCredentials(credentials)),
    playlistUrl: (format) => {
      const resolved = normalizeXtreamCredentials(credentials)
      return playlistUrl(resolved, format ?? resolved.preferredFormat)
    },
  })

  return {
    xtream,
    parseM3u: (text: string, options?: M3uParseOptions) =>
      run(IptvService.parseM3u(text, options)),
    loadM3u: (url: string, options?: M3uParseOptions, callOptions?: IptvCallOptions) =>
      run(IptvService.loadM3u(url, options, callOptions)),
    parseXmltv: (text: string, options?: XmltvParseOptions) =>
      run(IptvService.parseXmltv(text, options)),
    loadXmltv: (url: string, options?: XmltvParseOptions, callOptions?: IptvCallOptions) =>
      run(IptvService.loadXmltv(url, options, callOptions)),
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
  ShortEpgOptions,
  XmltvParseOptions,
  XtreamClient,
  XtreamCredentials,
}
