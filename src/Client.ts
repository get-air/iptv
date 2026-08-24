import type { CacheStore } from "@get-air/cache"
import {
  CacheReadError,
  CacheRemoveError,
  CacheStoreService,
  CacheWriteError,
  layerCacheStore,
} from "@get-air/cache/effect"
import { HttpTransportService } from "@get-air/http/effect"
import { Context, Effect, Either, Layer, Schema } from "effect"

import {
  IptvHttpStatusError,
  IptvInvalidJsonError,
  IptvInvalidUrlError,
  IptvRedirectError,
  IptvResponseTooLargeError,
  IptvResponseValidationError,
  IptvTransportError,
  IptvUrlPolicyError,
  StalkerAuthenticationError,
  StalkerPortalError,
  isIptvClientError,
} from "./Errors.js"
import { matchEpgChannel } from "./EpgMatch.js"
import { parseM3u } from "./M3u.js"
import { diffPlaylists, makePlaylistSnapshot } from "./PlaylistRefresh.js"
import { InMemoryIptvSearchIndex } from "./Search.js"
import { IptvSourceRef } from "./Schemas.js"
import type {
  CategoryId,
  ChannelId,
  EpgChannelId,
  EpgMatchResult,
  IptvGuide,
  IptvPlaylistEntry,
  MovieId,
  PlaylistRefreshResult,
  SeriesId,
  SourceId,
} from "./Schemas.js"
import {
  normalizeStalkerCategories,
  normalizeStalkerChannels,
  normalizeStalkerCredentials,
  normalizeStalkerMovies,
  normalizeStalkerProfile,
  resolveStalkerLink,
  stalkerEndpointCandidates,
  stalkerHeaders,
  stalkerPayload,
  stalkerPrehash,
  stalkerRequestUrl,
  type ResolvedStalkerCredentials,
} from "./Stalker.js"
import type {
  CatalogOptions,
  EpgMatchOptions,
  EffectIptvClientConfig,
  IptvCallOptions,
  IptvSearchIndex,
  IptvSearchOptions,
  IptvSearchSourceContent,
  IptvSourceInput,
  IptvUrlPurpose,
  IptvUrlPolicy,
  M3uParseOptions,
  PlaylistRefreshOptions,
  ShortEpgOptions,
  StalkerCredentials,
  XmltvParseOptions,
  XtreamCatchupOptions,
  XtreamCredentials,
} from "./Types.js"
import {
  catchupVariantCandidates,
  normalizeCategories,
  normalizeChannels,
  normalizeFullEpg,
  normalizeMovie,
  normalizeMovies,
  normalizeProfile,
  normalizeSeries,
  normalizeSeriesDetails,
  normalizeShortEpg,
  normalizeXtreamCredentials,
  playerApiUrl,
  timeshiftUrl,
} from "./Xtream.js"
import {
  isRedirectStatus,
  redirectLocation,
  redirectRequest,
  validateIptvUrl,
} from "./UrlPolicy.js"
import { nowNext, parseXmltv } from "./Xmltv.js"

interface ResolvedConfig {
  readonly cacheTtlMillis: number
  readonly epgCacheTtlMillis: number
  readonly maxResponseBytes: number
  readonly userAgent: string
  readonly urlPolicy: IptvUrlPolicy
  readonly searchIndex: IptvSearchIndex
}

interface StalkerSession {
  readonly credentials: ResolvedStalkerCredentials
  readonly endpoint: URL
  readonly token: string
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
    const stalkerSessions = new Map<string, StalkerSession>()

    const fetchResponse = Effect.fn("IptvService.fetchResponse")(function* (
      url: URL,
      resource: string,
      purpose: IptvUrlPurpose,
      options: IptvCallOptions = {},
      input: { readonly method?: string; readonly headers?: HeadersInit } = {},
    ) {
      const headers = new Headers(input.headers)
      if (!headers.has("Accept")) {
        headers.set("Accept", "application/json, application/xml, audio/x-mpegurl, text/plain;q=0.9")
      }
      if (!headers.has("User-Agent")) headers.set("User-Agent", config.userAgent)
      const manual = config.urlPolicy.redirectMode === "validate"
      let currentUrl = url
      let previousUrl: URL | undefined
      let request = new Request(currentUrl, {
        method: input.method ?? "GET",
        headers,
        redirect: manual ? "manual" : "follow",
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
      const maximumRedirects = Math.max(0, Math.floor(config.urlPolicy.maxRedirects ?? 5))

      for (let redirectCount = 0; ; redirectCount += 1) {
        yield* Effect.tryPromise({
          try: () => validateIptvUrl(
            currentUrl,
            resource,
            purpose,
            config.urlPolicy,
            redirectCount,
            previousUrl,
          ),
          catch: (cause) => cause instanceof IptvUrlPolicyError
            ? cause
            : new IptvUrlPolicyError({ resource, message: `${resource} URL policy rejected the request` }),
        })
        const response = yield* Effect.tryPromise({
          try: () => http.fetch(request),
          catch: (cause) => new IptvTransportError({
            resource,
            message: `${resource} request failed (${causeName(cause)})`,
            retryable: true,
          }),
        })
        if (!manual || !isRedirectStatus(response.status)) return response
        if (redirectCount >= maximumRedirects) {
          return yield* new IptvRedirectError({ resource, message: `${resource} exceeded its redirect limit` })
        }
        const nextUrl = yield* Effect.try({
          try: () => redirectLocation(response, currentUrl, resource),
          catch: (cause) => cause instanceof IptvRedirectError
            ? cause
            : new IptvRedirectError({ resource, message: `${resource} returned an invalid redirect` }),
        })
        const nextRequest = yield* Effect.try({
          try: () => redirectRequest(request, currentUrl, nextUrl, response.status, config.urlPolicy, resource),
          catch: (cause) => cause instanceof IptvRedirectError
            ? cause
            : new IptvRedirectError({ resource, message: `${resource} redirect could not be followed safely` }),
        })
        previousUrl = currentUrl
        currentUrl = nextUrl
        request = nextRequest
      }
    })

    const readResponseText = Effect.fn("IptvService.readResponseText")(function* (
      response: Response,
      resource: string,
    ) {
      const declaredLength = Number(response.headers.get("content-length"))
      if (Number.isFinite(declaredLength) && declaredLength > config.maxResponseBytes) {
        return yield* new IptvResponseTooLargeError({
          resource,
          maxResponseBytes: config.maxResponseBytes,
          message: `${resource} exceeds the configured response limit`,
        })
      }
      const bytes = yield* Effect.tryPromise({
        try: async () => new Uint8Array(await response.arrayBuffer()),
        catch: (cause) => new IptvTransportError({
          resource,
          message: `${resource} response could not be read (${causeName(cause)})`,
          retryable: true,
        }),
      })
      if (bytes.byteLength > config.maxResponseBytes) {
        return yield* new IptvResponseTooLargeError({
          resource,
          maxResponseBytes: config.maxResponseBytes,
          message: `${resource} exceeds the configured response limit`,
        })
      }
      const decoded = yield* Effect.tryPromise({
        try: () => decodeResponseBytes(bytes),
        catch: (cause) => new IptvTransportError({
          resource,
          message: `${resource} compression could not be decoded (${causeName(cause)})`,
          retryable: false,
        }),
      })
      return new TextDecoder().decode(decoded)
    })

    const cachedText = Effect.fn("IptvService.cachedText")(function* (
      url: URL,
      resource: string,
      ttlMillis: number,
      options: IptvCallOptions = {},
      purpose: IptvUrlPurpose = "xtream",
      headers?: HeadersInit,
      cacheScope = "",
    ) {
      const key = `@get-air/iptv:${cacheKey(`${url.toString()}\0${cacheScope}`)}`
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

      const response = yield* fetchResponse(
        url,
        resource,
        purpose,
        options,
        headers === undefined ? {} : { headers },
      )
      if (!response.ok) {
        return yield* new IptvHttpStatusError({
          resource,
          status: response.status,
          message: `${resource} returned HTTP ${response.status}`,
          retryable: response.status === 408 || response.status === 429 || response.status >= 500,
        })
      }
      const text = yield* readResponseText(response, resource)
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
      purpose: IptvUrlPurpose = "xtream",
      headers?: HeadersInit,
      cacheScope = "",
    ) {
      const text = yield* cachedText(url, resource, ttlMillis, options, purpose, headers, cacheScope)
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
        : new IptvResponseValidationError({
          resource,
          message: `${resource} did not match the expected schema`,
        }),
    })

    const stalkerCredentials = Effect.fn("IptvService.stalkerCredentials")((input: StalkerCredentials) =>
      Effect.try({
        try: () => normalizeStalkerCredentials(input),
        catch: (cause) => isIptvClientError(cause)
          ? cause
          : new IptvInvalidUrlError({ resource: "Stalker portal", message: "Portal credentials are invalid" }),
      }))

    const ensureStalkerSession = Effect.fn("IptvService.ensureStalkerSession")(function* (
      input: StalkerCredentials,
      options: IptvCallOptions = {},
    ) {
      const resolved = yield* stalkerCredentials(input)
      const sessionKey = cacheKey([
        resolved.portalUrl,
        resolved.macAddress,
        resolved.serialNumber ?? "",
        resolved.deviceId ?? "",
      ].join("\0"))
      const active = stalkerSessions.get(sessionKey)
      if (active !== undefined) return { key: sessionKey, session: active }
      const prehash = yield* Effect.tryPromise({
        try: () => stalkerPrehash(resolved.macAddress),
        catch: () => new StalkerAuthenticationError({ message: "Stalker prehash could not be generated" }),
      })

      for (const endpoint of stalkerEndpointCandidates(resolved)) {
        const outcome = yield* Effect.either(json(
          stalkerRequestUrl(endpoint, {
            type: "stb",
            action: "handshake",
            token: "",
            prehash,
            JsHttpRequest: "1-xml",
          }),
          "Stalker handshake",
          0,
          { ...options, bypassCache: true },
          "stalker",
          stalkerHeaders(resolved),
          resolved.macAddress,
        ))
        if (Either.isLeft(outcome)) continue
        const payload = yield* normalize("Stalker handshake", () => stalkerPayload(outcome.right, "Stalker handshake"))
        const token = recordString(payload, "token")
        if (token === undefined) continue
        const session: StalkerSession = { credentials: resolved, endpoint, token }
        stalkerSessions.set(sessionKey, session)
        return { key: sessionKey, session }
      }
      return yield* new StalkerAuthenticationError({
        message: "No compatible Stalker/Ministra portal endpoint completed the handshake",
      })
    })

    const stalkerRequest = Effect.fn("IptvService.stalkerRequest")(function* (
      input: StalkerCredentials,
      parameters: Readonly<Record<string, string | number | undefined>>,
      resource: string,
      ttlMillis: number,
      options: IptvCallOptions = {},
    ) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const active = yield* ensureStalkerSession(input, options)
        const outcome = yield* Effect.either(json(
          stalkerRequestUrl(active.session.endpoint, parameters),
          resource,
          ttlMillis,
          options,
          "stalker",
          stalkerHeaders(active.session.credentials, active.session.token),
          active.key,
        ))
        if (Either.isLeft(outcome)) {
          if (attempt === 0 && outcome.left instanceof IptvHttpStatusError
            && (outcome.left.status === 401 || outcome.left.status === 403)) {
            stalkerSessions.delete(active.key)
            continue
          }
          return yield* outcome.left
        }
        const payload = yield* normalize(resource, () => stalkerPayload(outcome.right, resource))
        if (recordNumber(payload, "not_valid") === 1 && attempt === 0) {
          stalkerSessions.delete(active.key)
          continue
        }
        return { payload, session: active.session }
      }
      return yield* new StalkerAuthenticationError({ message: `${resource} could not renew its portal session` })
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

    const fullEpg = Effect.fn("IptvService.fullEpg")(function* (
      input: XtreamCredentials,
      channelId: ChannelId | string,
      options: IptvCallOptions = {},
    ) {
      const resolved = yield* credentials(input)
      const primary = yield* Effect.either(
        json(playerApiUrl(resolved, "get_simple_data_table", { stream_id: channelId }),
          "Xtream full EPG", config.epgCacheTtlMillis, options).pipe(
          Effect.flatMap((value) => normalize("Xtream full EPG", () => normalizeFullEpg(channelId, value))),
        ),
      )
      if (Either.isRight(primary) && primary.right.programmes.length > 0) return primary.right
      const fallback = yield* json(
        playerApiUrl(resolved, "get_simple_date_table", { stream_id: channelId }),
        "Xtream legacy full EPG",
        config.epgCacheTtlMillis,
        options,
      )
      return yield* normalize("Xtream legacy full EPG", () => normalizeFullEpg(channelId, fallback))
    })

    const resolveTimeshiftUrl = Effect.fn("IptvService.resolveTimeshiftUrl")(function* (
      input: XtreamCredentials,
      channelId: ChannelId | string,
      start: Date,
      durationSeconds: number,
      options: XtreamCatchupOptions = {},
      callOptions: IptvCallOptions = {},
    ) {
      const resolved = yield* credentials(input)
      if (options.variant !== undefined) {
        return timeshiftUrl(resolved, channelId, start, durationSeconds, options)
      }
      const key = `@get-air/iptv:catchup:${cacheKey(`${resolved.baseUrl}\0${resolved.username}`)}`
      const cached = yield* Effect.tryPromise({
        try: () => store.get(key),
        catch: (cause) => new CacheReadError({ key, message: message(cause) }),
      }).pipe(Effect.catchTag("CacheReadError", () => Effect.logDebug("IPTV catch-up cache read failed")
        .pipe(Effect.as(undefined))))
      if (cached?.value !== undefined
        && (cached.expiresAtMillis === undefined || cached.expiresAtMillis > Date.now())) {
        const variant = catchupVariantCandidates(resolved.preferredFormat)
          .find((candidate) => candidate === cached.value)
        if (variant !== undefined) return timeshiftUrl(resolved, channelId, start, durationSeconds, {
          ...options,
          variant,
        })
      }

      for (const variant of catchupVariantCandidates(resolved.preferredFormat)) {
        const url = timeshiftUrl(resolved, channelId, start, durationSeconds, { ...options, variant })
        const probe = yield* Effect.either(fetchResponse(
          new URL(url),
          "Xtream catch-up probe",
          "catchup",
          callOptions,
          { headers: { Range: "bytes=0-0" } },
        ))
        if (Either.isRight(probe) && probe.right.body !== null) {
          yield* Effect.tryPromise({
            try: () => probe.right.body!.cancel(),
            catch: () => new IptvTransportError({
              resource: "Xtream catch-up probe",
              message: "Catch-up probe response could not be closed",
              retryable: false,
            }),
          }).pipe(Effect.catchTag("IptvTransportError", () =>
            Effect.logDebug("IPTV catch-up probe body close failed")))
        }
        if (Either.isRight(probe) && probe.right.status >= 200 && probe.right.status < 400) {
          yield* Effect.tryPromise({
            try: () => store.set(key, {
              value: variant,
              expiresAtMillis: Date.now() + 7 * 24 * 60 * 60_000,
            }),
            catch: (cause) => new CacheWriteError({ key, message: message(cause) }),
          }).pipe(Effect.catchTag("CacheWriteError", () => Effect.void))
          return url
        }
      }
      return timeshiftUrl(resolved, channelId, start, durationSeconds, {
        ...options,
        variant: resolved.preferredFormat === "m3u8" ? "rest-m3u8" : "rest-ts",
      })
    })

    const stalkerProfile = Effect.fn("IptvService.stalkerProfile")(function* (
      input: StalkerCredentials,
      options: IptvCallOptions = {},
    ) {
      const result = yield* stalkerRequest(input, {
        type: "stb",
        action: "get_profile",
        hd: 1,
        JsHttpRequest: "1-xml",
      }, "Stalker profile", 0, options)
      return yield* normalize("Stalker profile", () => normalizeStalkerProfile(result.payload))
    })

    const stalkerCategories = Effect.fn("IptvService.stalkerCategories")(function* (
      input: StalkerCredentials,
      options: IptvCallOptions = {},
    ) {
      const result = yield* stalkerRequest(input, {
        type: "itv",
        action: "get_genres",
        JsHttpRequest: "1-xml",
      }, "Stalker genres", config.cacheTtlMillis, options)
      return yield* normalize("Stalker genres", () => normalizeStalkerCategories(result.payload))
    })

    const stalkerChannels = Effect.fn("IptvService.stalkerChannels")(function* (
      input: StalkerCredentials,
      options: IptvCallOptions = {},
    ) {
      const result = yield* stalkerRequest(input, {
        type: "itv",
        action: "get_all_channels",
        JsHttpRequest: "1-xml",
      }, "Stalker channels", config.cacheTtlMillis, options)
      const headers = Object.fromEntries(
        stalkerHeaders(result.session.credentials, result.session.token).entries(),
      )
      return yield* normalize("Stalker channels", () => normalizeStalkerChannels(result.payload, headers))
    })

    const stalkerMovieCategories = Effect.fn("IptvService.stalkerMovieCategories")(function* (
      input: StalkerCredentials,
      options: IptvCallOptions = {},
    ) {
      const result = yield* stalkerRequest(input, {
        type: "vod",
        action: "get_categories",
        JsHttpRequest: "1-xml",
      }, "Stalker movie categories", config.cacheTtlMillis, options)
      return yield* normalize("Stalker movie categories", () =>
        normalizeStalkerCategories(result.payload, "movie"))
    })

    const stalkerMovies = Effect.fn("IptvService.stalkerMovies")(function* (
      input: StalkerCredentials,
      filters: CatalogOptions = {},
      options: IptvCallOptions = {},
    ) {
      const result = yield* stalkerRequest(input, {
        type: "vod",
        action: "get_ordered_list",
        category: filters.categoryId ?? "*",
        p: 1,
        sortby: "added",
        JsHttpRequest: "1-xml",
      }, "Stalker movies", config.cacheTtlMillis, options)
      const firstPage = recordArray(result.payload, "data")
      if (firstPage === undefined) {
        return yield* normalize("Stalker movies", () => normalizeStalkerMovies(result.payload))
      }
      const items = [...firstPage]
      const total = recordNumber(result.payload, "total_items") ?? items.length
      const reportedPageSize = recordNumber(result.payload, "max_page_items") ?? items.length
      const pageSize = Math.max(1, reportedPageSize)
      const pages = Math.min(100, Math.ceil(total / pageSize))
      for (let page = 2; page <= pages; page += 1) {
        const next = yield* stalkerRequest(input, {
          type: "vod",
          action: "get_ordered_list",
          category: filters.categoryId ?? "*",
          p: page,
          sortby: "added",
          JsHttpRequest: "1-xml",
        }, `Stalker movies page ${page}`, config.cacheTtlMillis, options)
        items.push(...(recordArray(next.payload, "data") ?? []))
      }
      return yield* normalize("Stalker movies", () => normalizeStalkerMovies({ data: items }))
    })

    const resolveStalkerStream = Effect.fn("IptvService.resolveStalkerStream")(function* (
      input: StalkerCredentials,
      channel: { readonly directSource?: string | undefined; readonly streamUrl: string },
      options: IptvCallOptions = {},
    ) {
      const command = channel.directSource ?? channel.streamUrl
      if (/^https?:/i.test(channel.streamUrl) && channel.directSource === undefined) return channel.streamUrl
      const result = yield* stalkerRequest(input, {
        type: "itv",
        action: "create_link",
        cmd: command,
        disable_ad: 0,
        download: 0,
        JsHttpRequest: "1-xml",
      }, "Stalker create_link", 0, { ...options, bypassCache: true })
      return yield* normalize("Stalker create_link", () =>
        resolveStalkerLink(result.payload, result.session.endpoint))
    })

    const resolveStalkerMovie = Effect.fn("IptvService.resolveStalkerMovie")(function* (
      input: StalkerCredentials,
      movie: { readonly directSource?: string | undefined; readonly streamUrl: string },
      options: IptvCallOptions = {},
    ) {
      const command = movie.directSource ?? movie.streamUrl
      if (/^https?:/i.test(movie.streamUrl) && movie.directSource === undefined) return movie.streamUrl
      const result = yield* stalkerRequest(input, {
        type: "vod",
        action: "create_link",
        cmd: command,
        disable_ad: 0,
        download: 0,
        JsHttpRequest: "1-xml",
      }, "Stalker VOD create_link", 0, { ...options, bypassCache: true })
      return yield* normalize("Stalker VOD create_link", () =>
        resolveStalkerLink(result.payload, result.session.endpoint))
    })

    const loadM3u = Effect.fn("IptvService.loadM3u")(function* (
      url: string,
      options: M3uParseOptions = {},
      callOptions: IptvCallOptions = {},
    ) {
      const resolved = yield* publicUrl(url, "M3U playlist")
      const text = yield* cachedText(resolved, "M3U playlist", config.cacheTtlMillis, callOptions, "m3u")
      return yield* parseM3u(text, { ...options, baseUrl: options.baseUrl ?? resolved.toString() })
    })

    const refreshM3u = Effect.fn("IptvService.refreshM3u")(function* (
      url: string,
      options: PlaylistRefreshOptions = {},
      callOptions: IptvCallOptions = {},
    ) {
      const resolved = yield* publicUrl(url, "M3U playlist")
      const headers = new Headers()
      if (options.previous?.etag !== undefined) headers.set("If-None-Match", options.previous.etag)
      if (options.previous?.lastModified !== undefined) {
        headers.set("If-Modified-Since", options.previous.lastModified)
      }
      const response = yield* fetchResponse(resolved, "M3U playlist refresh", "m3u", callOptions, { headers })
      if (response.status === 304 && options.previous !== undefined) {
        return { status: "not-modified", snapshot: options.previous } satisfies PlaylistRefreshResult
      }
      if (!response.ok) {
        return yield* new IptvHttpStatusError({
          resource: "M3U playlist refresh",
          status: response.status,
          message: `M3U playlist refresh returned HTTP ${response.status}`,
          retryable: response.status === 408 || response.status === 429 || response.status >= 500,
        })
      }
      const text = yield* readResponseText(response, "M3U playlist refresh")
      const playlist = yield* parseM3u(text, {
        ...options,
        baseUrl: options.baseUrl ?? resolved.toString(),
      })
      const snapshot = yield* normalize("M3U playlist snapshot", () => makePlaylistSnapshot({
        sourceUrl: resolved.toString(),
        ...(options.name === undefined ? {} : { name: options.name }),
        playlist,
        ...(response.headers.get("etag") === null ? {} : { etag: response.headers.get("etag")! }),
        ...(response.headers.get("last-modified") === null
          ? {}
          : { lastModified: response.headers.get("last-modified")! }),
      }))
      const diff = yield* normalize("M3U playlist diff", () =>
        diffPlaylists(options.previous?.playlist, playlist))
      const key = `@get-air/iptv:${cacheKey(resolved.toString())}`
      yield* Effect.tryPromise({
        try: () => store.set(key, {
          value: text,
          expiresAtMillis: Date.now() + config.cacheTtlMillis,
        }),
        catch: (cause) => new CacheWriteError({ key, message: message(cause) }),
      }).pipe(Effect.catchTag("CacheWriteError", () => Effect.void))
      return { status: "updated", snapshot, diff } satisfies PlaylistRefreshResult
    })

    const loadXmltv = Effect.fn("IptvService.loadXmltv")(function* (
      url: string,
      options: XmltvParseOptions = {},
      callOptions: IptvCallOptions = {},
    ) {
      const resolved = yield* publicUrl(url, "XMLTV guide")
      const text = yield* cachedText(resolved, "XMLTV guide", config.epgCacheTtlMillis, callOptions, "xmltv")
      return yield* parseXmltv(text, options)
    })

    const openXmltv = Effect.fn("IptvService.openXmltv")(function* (
      url: string,
      callOptions: IptvCallOptions = {},
    ) {
      const resolved = yield* publicUrl(url, "XMLTV guide")
      const response = yield* fetchResponse(resolved, "XMLTV guide stream", "xmltv", callOptions)
      if (!response.ok) {
        return yield* new IptvHttpStatusError({
          resource: "XMLTV guide stream",
          status: response.status,
          message: `XMLTV guide stream returned HTTP ${response.status}`,
          retryable: response.status === 408 || response.status === 429 || response.status >= 500,
        })
      }
      if (response.body === null) {
        return yield* new IptvTransportError({
          resource: "XMLTV guide stream",
          message: "XMLTV response has no readable body",
          retryable: true,
        })
      }
      return response
    })

    const matchEpg = Effect.fn("IptvService.matchEpgChannel")((
      guide: IptvGuide,
      entry: IptvPlaylistEntry,
      options: EpgMatchOptions = {},
    ) => normalize("EPG channel match", () => matchEpgChannel(guide, entry, options)))

    const replaceSearchSource = Effect.fn("IptvService.replaceSearchSource")(function* (
      input: IptvSourceInput,
      content: IptvSearchSourceContent,
    ) {
      const source = yield* Schema.decodeUnknown(IptvSourceRef)(input).pipe(
        Effect.mapError(() => new IptvResponseValidationError({
          resource: "IPTV search source",
          message: "Search source id, name, and kind must be valid",
        })),
      )
      yield* Effect.tryPromise({
        try: () => config.searchIndex.replaceSource(source, content),
        catch: () => new IptvResponseValidationError({
          resource: "IPTV search index",
          message: "Search source could not be indexed",
        }),
      })
    })

    const removeSearchSource = Effect.fn("IptvService.removeSearchSource")(function* (
      sourceId: SourceId | string,
    ) {
      yield* Effect.tryPromise({
        try: () => config.searchIndex.removeSource(sourceId),
        catch: () => new IptvResponseValidationError({
          resource: "IPTV search index",
          message: "Search source could not be removed",
        }),
      })
    })

    const search = Effect.fn("IptvService.search")(function* (
      query: string,
      options: IptvSearchOptions = {},
    ) {
      return yield* Effect.tryPromise({
        try: () => config.searchIndex.search(query, options),
        catch: () => new IptvResponseValidationError({
          resource: "IPTV search",
          message: "Search query could not be completed",
        }),
      })
    })

    const clearSearch = Effect.fn("IptvService.clearSearch")(function* () {
      yield* Effect.tryPromise({
        try: () => config.searchIndex.clear(),
        catch: () => new IptvResponseValidationError({
          resource: "IPTV search index",
          message: "Search index could not be cleared",
        }),
      })
    })

    return {
      parseM3u,
      loadM3u,
      refreshM3u,
      parseXmltv,
      loadXmltv,
      openXmltv,
      nowNext,
      matchEpg,
      replaceSearchSource,
      removeSearchSource,
      search,
      clearSearch,
      profile,
      categories,
      liveChannels,
      movies,
      movie,
      series,
      seriesDetails,
      shortEpg,
      fullEpg,
      resolveTimeshiftUrl,
      stalkerProfile,
      stalkerCategories,
      stalkerChannels,
      stalkerMovieCategories,
      stalkerMovies,
      resolveStalkerStream,
      resolveStalkerMovie,
    } as const
  }),
}) {}

export function layerIptvClient(
  input: EffectIptvClientConfig = {},
  options: { readonly cache?: CacheStore; readonly searchIndex?: IptvSearchIndex } = {},
): Layer.Layer<IptvService, never, HttpTransportService> {
  const config: ResolvedConfig = {
    cacheTtlMillis: Math.max(0, input.cacheTtlMillis ?? 5 * 60_000),
    epgCacheTtlMillis: Math.max(0, input.epgCacheTtlMillis ?? 30 * 60_000),
    maxResponseBytes: Math.max(1, input.maxResponseBytes ?? 128 * 1024 * 1024),
    userAgent: input.userAgent?.trim() || "@get-air/iptv",
    urlPolicy: {
      allowPrivateNetworks: true,
      ...input.urlPolicy,
    },
    searchIndex: options.searchIndex
      ?? new InMemoryIptvSearchIndex(Math.max(100, Math.floor(input.searchCandidateLimit ?? 10_000))),
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

function recordString(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  const field = (value as Record<string, unknown>)[key]
  return typeof field === "string" && field.trim() !== "" ? field.trim() : undefined
}

function recordNumber(value: unknown, key: string): number | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  const field = (value as Record<string, unknown>)[key]
  const parsed = typeof field === "number" ? field : typeof field === "string" ? Number(field) : Number.NaN
  return Number.isFinite(parsed) ? parsed : undefined
}

function recordArray(value: unknown, key: string): readonly unknown[] | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  const field = (value as Record<string, unknown>)[key]
  return Array.isArray(field) ? field : undefined
}

async function decodeResponseBytes(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes
  if (typeof DecompressionStream === "undefined") throw new Error("DecompressionStream is unavailable")
  const copy = Uint8Array.from(bytes)
  const stream = new Blob([copy.buffer]).stream().pipeThrough(new DecompressionStream("gzip"))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export type {
  CategoryId,
  ChannelId,
  EpgChannelId,
  IptvGuide,
}
