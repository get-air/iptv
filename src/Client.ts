import type { CacheStore } from "@get-air/cache"
import {
  CacheReadError,
  CacheRemoveError,
  CacheStoreService,
  CacheWriteError,
  layerCacheStore,
} from "@get-air/cache/effect"
import { HttpTransportService } from "@get-air/http/effect"
import { Context, Effect, Layer } from "effect"

import {
  IptvHttpStatusError,
  IptvInvalidJsonError,
  IptvInvalidUrlError,
  IptvResponseTooLargeError,
  IptvResponseValidationError,
  IptvTransportError,
  isIptvClientError,
} from "./Errors.js"
import { parseM3u } from "./M3u.js"
import type {
  CategoryId,
  ChannelId,
  EpgChannelId,
  IptvGuide,
  MovieId,
  SeriesId,
} from "./Schemas.js"
import type {
  CatalogOptions,
  EffectIptvClientConfig,
  IptvCallOptions,
  M3uParseOptions,
  ShortEpgOptions,
  XmltvParseOptions,
  XtreamCredentials,
} from "./Types.js"
import {
  normalizeCategories,
  normalizeChannels,
  normalizeMovie,
  normalizeMovies,
  normalizeProfile,
  normalizeSeries,
  normalizeSeriesDetails,
  normalizeShortEpg,
  normalizeXtreamCredentials,
  playerApiUrl,
} from "./Xtream.js"
import { nowNext, parseXmltv } from "./Xmltv.js"

interface ResolvedConfig {
  readonly cacheTtlMillis: number
  readonly epgCacheTtlMillis: number
  readonly maxResponseBytes: number
  readonly userAgent: string
}

class IptvConfigService extends Context.Tag("@get-air/iptv/Config")<
  IptvConfigService,
  ResolvedConfig
>() {}

const noCacheStore: CacheStore = {
  get: async () => undefined,
  set: async () => undefined,
  remove: async () => undefined,
}

export class IptvService extends Effect.Service<IptvService>()("@get-air/iptv/IptvService", {
  accessors: true,
  effect: Effect.gen(function* () {
    const config = yield* IptvConfigService
    const http = yield* HttpTransportService
    const store = yield* CacheStoreService

    const cachedText = Effect.fn("IptvService.cachedText")(function* (
      url: URL,
      resource: string,
      ttlMillis: number,
      options: IptvCallOptions = {},
    ) {
      const key = `@get-air/iptv:${cacheKey(url.toString())}`
      if (options.bypassCache !== true) {
        const entry = yield* Effect.tryPromise({
          try: () => store.get(key),
          catch: (cause) => new CacheReadError({ key, message: message(cause) }),
        }).pipe(
          Effect.catchTags({
            CacheReadError: (error) => Effect.logWarning("IPTV cache read failed", { message: error.message })
              .pipe(Effect.as(undefined)),
          }),
        )
        if (entry !== undefined && (entry.expiresAtMillis === undefined || entry.expiresAtMillis > Date.now())) {
          return entry.value
        }
        if (entry?.expiresAtMillis !== undefined) {
          yield* Effect.tryPromise({
            try: () => store.remove(key),
            catch: (cause) => new CacheRemoveError({ key, message: message(cause) }),
          }).pipe(
            Effect.catchTag("CacheRemoveError", (error) =>
              Effect.logWarning("IPTV expired-cache removal failed", { message: error.message })),
          )
        }
      }

      const request = new Request(url, {
        headers: { Accept: "application/json, application/xml, audio/x-mpegurl, text/plain;q=0.9", "User-Agent": config.userAgent },
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
      const response = yield* Effect.tryPromise({
        try: () => http.fetch(request),
        catch: (cause) => new IptvTransportError({
          resource,
          message: `${resource} request failed (${causeName(cause)})`,
          retryable: true,
        }),
      })
      if (!response.ok) {
        return yield* new IptvHttpStatusError({
          resource,
          status: response.status,
          message: `${resource} returned HTTP ${response.status}`,
          retryable: response.status === 408 || response.status === 429 || response.status >= 500,
        })
      }
      const declaredLength = Number(response.headers.get("content-length"))
      if (Number.isFinite(declaredLength) && declaredLength > config.maxResponseBytes) {
        return yield* new IptvResponseTooLargeError({
          resource,
          maxResponseBytes: config.maxResponseBytes,
          message: `${resource} exceeds the configured response limit`,
        })
      }
      const text = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: (cause) => new IptvTransportError({
          resource,
          message: `${resource} response could not be read (${causeName(cause)})`,
          retryable: true,
        }),
      })
      if (new TextEncoder().encode(text).byteLength > config.maxResponseBytes) {
        return yield* new IptvResponseTooLargeError({
          resource,
          maxResponseBytes: config.maxResponseBytes,
          message: `${resource} exceeds the configured response limit`,
        })
      }
      if (ttlMillis > 0) {
        yield* Effect.tryPromise({
          try: () => store.set(key, {
            value: text,
            expiresAtMillis: Date.now() + ttlMillis,
          }),
          catch: (cause) => new CacheWriteError({ key, message: message(cause) }),
        }).pipe(
          Effect.catchTag("CacheWriteError", (error) =>
            Effect.logWarning("IPTV cache write failed", { message: error.message })),
        )
      }
      return text
    })

    const json = Effect.fn("IptvService.json")(function* (
      url: URL,
      resource: string,
      ttlMillis: number,
      options: IptvCallOptions = {},
    ) {
      const text = yield* cachedText(url, resource, ttlMillis, options)
      return yield* Effect.try({
        try: () => JSON.parse(text) as unknown,
        catch: (cause) => new IptvInvalidJsonError({ resource, message: message(cause) }),
      })
    })

    const credentials = Effect.fn("IptvService.credentials")((input: XtreamCredentials) =>
      Effect.try({
        try: () => normalizeXtreamCredentials(input),
        catch: (cause) => cause instanceof IptvInvalidUrlError
          ? cause
          : new IptvInvalidUrlError({ resource: "xtream server", message: message(cause) }),
      }))

    const normalize = <A>(resource: string, operation: () => A) => Effect.try({
      try: operation,
      catch: (cause) => isIptvClientError(cause)
        ? cause
        : new IptvResponseValidationError({ resource, message: message(cause) }),
    })

    const profile = Effect.fn("IptvService.profile")(function* (
      input: XtreamCredentials,
      options: IptvCallOptions = {},
    ) {
      const resolved = yield* credentials(input)
      const value = yield* json(playerApiUrl(resolved), "Xtream profile", 0, {
        ...options,
        bypassCache: true,
      })
      return yield* normalize("Xtream profile", () => normalizeProfile(value))
    })

    const categories = Effect.fn("IptvService.categories")(function* (
      input: XtreamCredentials,
      kind: "live" | "movie" | "series",
      options: IptvCallOptions = {},
    ) {
      const resolved = yield* credentials(input)
      const action = kind === "live" ? "get_live_categories"
        : kind === "movie" ? "get_vod_categories" : "get_series_categories"
      const value = yield* json(playerApiUrl(resolved, action), `Xtream ${kind} categories`,
        config.cacheTtlMillis, options)
      return yield* normalize(`Xtream ${kind} categories`, () => normalizeCategories(kind, value))
    })

    const liveChannels = Effect.fn("IptvService.liveChannels")(function* (
      input: XtreamCredentials,
      filters: CatalogOptions = {},
      options: IptvCallOptions = {},
    ) {
      const resolved = yield* credentials(input)
      const value = yield* json(playerApiUrl(resolved, "get_live_streams", {
        category_id: filters.categoryId,
      }), "Xtream live channels", config.cacheTtlMillis, options)
      return yield* normalize("Xtream live channels", () => normalizeChannels(resolved, value))
    })

    const movies = Effect.fn("IptvService.movies")(function* (
      input: XtreamCredentials,
      filters: CatalogOptions = {},
      options: IptvCallOptions = {},
    ) {
      const resolved = yield* credentials(input)
      const value = yield* json(playerApiUrl(resolved, "get_vod_streams", {
        category_id: filters.categoryId,
      }), "Xtream movies", config.cacheTtlMillis, options)
      return yield* normalize("Xtream movies", () => normalizeMovies(resolved, value))
    })

    const movie = Effect.fn("IptvService.movie")(function* (
      input: XtreamCredentials,
      movieId: MovieId | string,
      options: IptvCallOptions = {},
    ) {
      const resolved = yield* credentials(input)
      const value = yield* json(playerApiUrl(resolved, "get_vod_info", { vod_id: movieId }),
        "Xtream movie details", config.cacheTtlMillis, options)
      return yield* normalize("Xtream movie details", () => normalizeMovie(resolved, value))
    })

    const series = Effect.fn("IptvService.series")(function* (
      input: XtreamCredentials,
      filters: CatalogOptions = {},
      options: IptvCallOptions = {},
    ) {
      const resolved = yield* credentials(input)
      const value = yield* json(playerApiUrl(resolved, "get_series", {
        category_id: filters.categoryId,
      }), "Xtream series", config.cacheTtlMillis, options)
      return yield* normalize("Xtream series", () => normalizeSeries(value))
    })

    const seriesDetails = Effect.fn("IptvService.seriesDetails")(function* (
      input: XtreamCredentials,
      seriesId: SeriesId | string,
      options: IptvCallOptions = {},
    ) {
      const resolved = yield* credentials(input)
      const value = yield* json(playerApiUrl(resolved, "get_series_info", { series_id: seriesId }),
        "Xtream series details", config.cacheTtlMillis, options)
      return yield* normalize("Xtream series details", () =>
        normalizeSeriesDetails(resolved, seriesId, value))
    })

    const shortEpg = Effect.fn("IptvService.shortEpg")(function* (
      input: XtreamCredentials,
      request: ShortEpgOptions,
      options: IptvCallOptions = {},
    ) {
      const resolved = yield* credentials(input)
      const value = yield* json(playerApiUrl(resolved, "get_short_epg", {
        stream_id: request.channelId,
        limit: request.limit,
      }), "Xtream short EPG", config.epgCacheTtlMillis, options)
      return yield* normalize("Xtream short EPG", () => normalizeShortEpg(request.channelId, value))
    })

    const loadM3u = Effect.fn("IptvService.loadM3u")(function* (
      url: string,
      options: M3uParseOptions = {},
      callOptions: IptvCallOptions = {},
    ) {
      const resolved = yield* publicUrl(url, "M3U playlist")
      const text = yield* cachedText(resolved, "M3U playlist", config.cacheTtlMillis, callOptions)
      return yield* parseM3u(text, { ...options, baseUrl: options.baseUrl ?? resolved.toString() })
    })

    const loadXmltv = Effect.fn("IptvService.loadXmltv")(function* (
      url: string,
      options: XmltvParseOptions = {},
      callOptions: IptvCallOptions = {},
    ) {
      const resolved = yield* publicUrl(url, "XMLTV guide")
      const text = yield* cachedText(resolved, "XMLTV guide", config.epgCacheTtlMillis, callOptions)
      return yield* parseXmltv(text, options)
    })

    return {
      parseM3u,
      loadM3u,
      parseXmltv,
      loadXmltv,
      nowNext,
      profile,
      categories,
      liveChannels,
      movies,
      movie,
      series,
      seriesDetails,
      shortEpg,
    } as const
  }),
}) {}

export function layerIptvClient(
  input: EffectIptvClientConfig = {},
  options: { readonly cache?: CacheStore } = {},
): Layer.Layer<IptvService, never, HttpTransportService> {
  const config: ResolvedConfig = {
    cacheTtlMillis: Math.max(0, input.cacheTtlMillis ?? 5 * 60_000),
    epgCacheTtlMillis: Math.max(0, input.epgCacheTtlMillis ?? 30 * 60_000),
    maxResponseBytes: Math.max(1, input.maxResponseBytes ?? 128 * 1024 * 1024),
    userAgent: input.userAgent?.trim() || "@get-air/iptv",
  }
  const infrastructure = Layer.mergeAll(
    Layer.succeed(IptvConfigService, config),
    layerCacheStore(options.cache ?? noCacheStore),
  )
  return IptvService.Default.pipe(Layer.provide(infrastructure))
}

function publicUrl(value: string, resource: string) {
  return Effect.try({
    try: () => {
      const url = new URL(value)
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported protocol")
      return url
    },
    catch: () => new IptvInvalidUrlError({
      resource,
      message: `${resource} URL must be an absolute HTTP or HTTPS URL`,
    }),
  })
}

function cacheKey(value: string): string {
  let hash = 0xcbf29ce484222325n
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte)
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash.toString(36)
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function causeName(cause: unknown): string {
  return cause instanceof Error && cause.name !== "" ? cause.name : "transport error"
}

export type {
  CategoryId,
  ChannelId,
  EpgChannelId,
  IptvGuide,
}
