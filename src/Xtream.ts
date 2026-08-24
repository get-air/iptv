import { Schema } from "effect"

import {
  IptvCategory,
  IptvChannel,
  IptvGuide,
  IptvMovie,
  IptvSeries,
  IptvSeriesDetails,
  XtreamProfile,
  type CategoryId,
  type ChannelId,
  type MovieId,
  type SeriesId,
  type StreamFormat,
  type XtreamCatchupVariant,
} from "./Schemas.js"
import { IptvInvalidUrlError, IptvResponseValidationError, XtreamAuthenticationError } from "./Errors.js"
import type { XtreamCatchupOptions, XtreamCredentials } from "./Types.js"

type ContentKind = "live" | "movie" | "series"
type UnknownRecord = Record<string, unknown>

export function normalizeXtreamCredentials(input: XtreamCredentials): Required<XtreamCredentials> {
  const username = input.username.trim()
  const password = input.password.trim()
  if (username === "" || password === "") {
    throw new IptvInvalidUrlError({
      resource: "xtream credentials",
      message: "Xtream username and password must be non-empty",
    })
  }
  let url: URL
  try { url = new URL(input.baseUrl) }
  catch {
    throw new IptvInvalidUrlError({ resource: "xtream server", message: "Xtream base URL is invalid" })
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new IptvInvalidUrlError({
      resource: "xtream server",
      message: "Xtream base URL must use HTTP or HTTPS",
    })
  }
  url.username = ""
  url.password = ""
  url.search = ""
  url.hash = ""
  url.pathname = url.pathname.replace(/\/(?:player_api|panel_api|get|xmltv)\.php\/?$/i, "").replace(/\/+$/, "")
  return {
    baseUrl: url.toString().replace(/\/$/, ""),
    username,
    password,
    preferredFormat: input.preferredFormat ?? "m3u8",
  }
}

export function playerApiUrl(
  credentials: Required<XtreamCredentials>,
  action?: string,
  parameters: Readonly<Record<string, string | number | undefined>> = {},
): URL {
  const url = new URL("player_api.php", `${credentials.baseUrl}/`)
  url.searchParams.set("username", credentials.username)
  url.searchParams.set("password", credentials.password)
  if (action !== undefined) url.searchParams.set("action", action)
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }
  return url
}

export function playlistUrl(credentials: Required<XtreamCredentials>, format: StreamFormat): string {
  const url = new URL("get.php", `${credentials.baseUrl}/`)
  url.searchParams.set("username", credentials.username)
  url.searchParams.set("password", credentials.password)
  url.searchParams.set("type", "m3u_plus")
  url.searchParams.set("output", format === "rtmp" ? "ts" : format)
  return url.toString()
}

export function xmltvUrl(credentials: Required<XtreamCredentials>): string {
  const url = new URL("xmltv.php", `${credentials.baseUrl}/`)
  url.searchParams.set("username", credentials.username)
  url.searchParams.set("password", credentials.password)
  return url.toString()
}

export function streamUrl(
  credentials: Required<XtreamCredentials>,
  kind: "live" | "movie" | "series",
  id: string,
  extension: string,
): string {
  const path = [
    kind,
    encodeURIComponent(credentials.username),
    encodeURIComponent(credentials.password),
    `${encodeURIComponent(id)}.${encodeURIComponent(extension)}`,
  ].join("/")
  return new URL(path, `${credentials.baseUrl}/`).toString()
}

export function timeshiftUrl(
  credentials: Required<XtreamCredentials>,
  channelId: ChannelId | string,
  start: Date,
  durationSeconds: number,
  options: XtreamCatchupOptions = {},
): string {
  if (Number.isNaN(start.getTime()) || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new IptvResponseValidationError({
      resource: "Xtream timeshift URL",
      message: "Timeshift requires a valid start date and positive duration",
    })
  }
  const timestamp = formatCatchupStart(start, options.serverTimezone)
  const durationMinutes = Math.max(1, Math.round(durationSeconds / 60))
  const variant = options.variant ?? "rest-ts"
  const extension = variant.endsWith("m3u8") ? "m3u8" : "ts"
  if (variant.startsWith("legacy")) {
    const url = new URL("streaming/timeshift.php", `${credentials.baseUrl}/`)
    url.searchParams.set("username", credentials.username)
    url.searchParams.set("password", credentials.password)
    url.searchParams.set("stream", String(channelId))
    url.searchParams.set("start", timestamp)
    url.searchParams.set("duration", String(durationMinutes))
    url.searchParams.set("extension", extension)
    return url.toString()
  }
  const path = [
    "timeshift",
    encodeURIComponent(credentials.username),
    encodeURIComponent(credentials.password),
    durationMinutes,
    timestamp,
    `${encodeURIComponent(String(channelId))}.${extension}`,
  ].join("/")
  return new URL(path, `${credentials.baseUrl}/`).toString()
}

export function catchupVariantCandidates(format: StreamFormat = "m3u8"): readonly XtreamCatchupVariant[] {
  return format === "m3u8"
    ? ["rest-m3u8", "rest-ts", "legacy-m3u8", "legacy-ts"]
    : ["rest-ts", "rest-m3u8", "legacy-ts", "legacy-m3u8"]
}

export function normalizeProfile(input: unknown): XtreamProfile {
  const root = asRecord(input, "Xtream profile")
  const account = asRecord(root.user_info, "Xtream user_info")
  const server = asRecord(root.server_info, "Xtream server_info")
  const authenticated = booleanNumber(account.auth)
  const status = optionalString(account.status)
  if (!authenticated) {
    throw new XtreamAuthenticationError({
      ...(status === undefined ? {} : { status }),
      message: status === undefined ? "Xtream authentication failed" : `Xtream authentication failed: ${status}`,
    })
  }
  const expires = positiveNumber(account.exp_date)
  return decode(XtreamProfile, {
    account: {
      authenticated,
      ...(status === undefined ? {} : { status }),
      ...(expires === undefined ? {} : { expiresAt: new Date(expires * 1_000) }),
      trial: booleanNumber(account.is_trial),
      activeConnections: nonNegativeNumber(account.active_cons) ?? 0,
      ...(nonNegativeNumber(account.max_connections) === undefined ? {} : {
        maxConnections: nonNegativeNumber(account.max_connections),
      }),
      allowedFormats: stringArray(account.allowed_output_formats)
        .filter((format): format is StreamFormat => format === "m3u8" || format === "ts" || format === "rtmp"),
    },
    server: {
      ...(optionalString(server.server_protocol) ? { protocol: optionalString(server.server_protocol) } : {}),
      ...(optionalString(server.url) ? { host: optionalString(server.url) } : {}),
      ...(optionalString(server.port) ? { port: optionalString(server.port) } : {}),
      ...(optionalString(server.timezone) ? { timezone: optionalString(server.timezone) } : {}),
      ...(numberValue(server.timestamp_now) === undefined ? {} : { timestamp: numberValue(server.timestamp_now) }),
      ...(optionalString(server.version) ? { version: optionalString(server.version) } : {}),
    },
  }, "Xtream profile")
}

export function normalizeCategories(kind: ContentKind, input: unknown): readonly IptvCategory[] {
  return asArray(input, `Xtream ${kind} categories`).map((value) => {
    const item = asRecord(value, `Xtream ${kind} category`)
    const id = requiredString(item.category_id, "category_id")
    const parent = optionalId(item.parent_id)
    return decode(IptvCategory, {
      id,
      name: requiredString(item.category_name, "category_name"),
      kind,
      ...(parent === undefined || parent === "0" ? {} : { parentId: parent }),
    }, `Xtream ${kind} category`)
  })
}

export function normalizeChannels(
  credentials: Required<XtreamCredentials>,
  input: unknown,
): readonly IptvChannel[] {
  return asArray(input, "Xtream live channels").map((value) => {
    const item = asRecord(value, "Xtream live channel")
    const id = requiredString(item.stream_id, "stream_id")
    const epg = optionalString(item.epg_channel_id)
    const categoryIds = ids(item.category_ids, item.category_id)
    const archiveDays = nonNegativeNumber(item.tv_archive_duration)
    const archive = booleanNumber(item.tv_archive) || (archiveDays ?? 0) > 0
    return decode(IptvChannel, {
      id,
      name: requiredString(item.name, "name"),
      streamUrl: streamUrl(credentials, "live", id, credentials.preferredFormat),
      source: "xtream",
      kind: /^radio$/i.test(optionalString(item.stream_type) ?? "") ? "radio" : "live",
      ...(numberValue(item.num) === undefined ? {} : { number: numberValue(item.num) }),
      categoryIds,
      ...(epg === undefined ? {} : { epgChannelId: epg }),
      ...(optionalString(item.stream_icon) ? { logoUrl: optionalString(item.stream_icon) } : {}),
      ...(optionalString(item.direct_source) ? { directSource: optionalString(item.direct_source) } : {}),
      headers: {},
      ...(archive ? {
        catchup: {
          type: "xtream",
          ...(archiveDays === undefined ? {} : { days: archiveDays }),
        },
      } : {}),
    }, "Xtream live channel")
  })
}

export function normalizeMovies(
  credentials: Required<XtreamCredentials>,
  input: unknown,
): readonly IptvMovie[] {
  return asArray(input, "Xtream movies").map((value) => movieFor(credentials, asRecord(value, "Xtream movie")))
}

export function normalizeMovie(
  credentials: Required<XtreamCredentials>,
  input: unknown,
): IptvMovie {
  const root = asRecord(input, "Xtream movie details")
  const data = asRecord(root.movie_data, "Xtream movie_data")
  const info = asRecord(root.info, "Xtream movie info")
  return movieFor(credentials, { ...info, ...data })
}

function movieFor(credentials: Required<XtreamCredentials>, item: UnknownRecord): IptvMovie {
  const id = requiredString(item.stream_id, "stream_id")
  const extension = optionalString(item.container_extension) ?? "mp4"
  return decode(IptvMovie, {
    id,
    name: optionalString(item.name) ?? requiredString(item.title, "title"),
    streamUrl: streamUrl(credentials, "movie", id, extension),
    categoryIds: ids(item.category_ids, item.category_id),
    containerExtension: extension,
    ...(optionalString(item.year) ? { year: optionalString(item.year) } : {}),
    ...(optionalString(item.stream_icon) ?? optionalString(item.movie_image) ?? optionalString(item.cover_big)
      ? { posterUrl: optionalString(item.stream_icon) ?? optionalString(item.movie_image) ?? optionalString(item.cover_big) }
      : {}),
    ...(optionalString(item.plot) ?? optionalString(item.description)
      ? { plot: optionalString(item.plot) ?? optionalString(item.description) }
      : {}),
    ...(optionalString(item.genre) ? { genre: optionalString(item.genre) } : {}),
    ...(numberValue(item.rating) === undefined ? {} : { rating: numberValue(item.rating) }),
    ...(nonNegativeNumber(item.duration_secs) === undefined ? {} : {
      durationSeconds: nonNegativeNumber(item.duration_secs),
    }),
  }, "Xtream movie")
}

export function normalizeSeries(input: unknown): readonly IptvSeries[] {
  return asArray(input, "Xtream series").map((value) => seriesFor(asRecord(value, "Xtream series")))
}

export function normalizeSeriesDetails(
  credentials: Required<XtreamCredentials>,
  seriesId: SeriesId | string,
  input: unknown,
): IptvSeriesDetails {
  const root = asRecord(input, "Xtream series details")
  const info = { ...asRecord(root.info, "Xtream series info"), series_id: seriesId }
  const episodesRoot = asRecord(root.episodes, "Xtream series episodes")
  const episodes = Object.entries(episodesRoot).flatMap(([seasonKey, values]) => {
    return asArray(values, `Xtream season ${seasonKey}`).map((value) => {
      const episode = asRecord(value, "Xtream episode")
      const episodeInfo = isRecord(episode.info) ? episode.info : {}
      const id = requiredString(episode.id, "episode id")
      const extension = optionalString(episode.container_extension) ?? "mp4"
      return {
        id,
        seriesId,
        title: optionalString(episode.title) ?? `Episode ${optionalString(episode.episode_num) ?? id}`,
        season: nonNegativeNumber(episode.season) ?? nonNegativeNumber(seasonKey) ?? 0,
        episode: nonNegativeNumber(episode.episode_num) ?? 0,
        streamUrl: streamUrl(credentials, "series", id, extension),
        containerExtension: extension,
        ...(optionalString(episodeInfo.plot) ? { plot: optionalString(episodeInfo.plot) } : {}),
        ...(nonNegativeNumber(episodeInfo.duration_secs) === undefined ? {} : {
          durationSeconds: nonNegativeNumber(episodeInfo.duration_secs),
        }),
      }
    })
  })
  return decode(IptvSeriesDetails, {
    series: seriesFor(info),
    episodes,
  }, "Xtream series details")
}

function seriesFor(item: UnknownRecord): IptvSeries {
  return decode(IptvSeries, {
    id: requiredString(item.series_id, "series_id"),
    name: optionalString(item.name) ?? requiredString(item.title, "title"),
    categoryIds: ids(item.category_ids, item.category_id),
    ...(optionalString(item.year) ? { year: optionalString(item.year) } : {}),
    ...(optionalString(item.cover) ? { coverUrl: optionalString(item.cover) } : {}),
    ...(optionalString(item.plot) ? { plot: optionalString(item.plot) } : {}),
    ...(optionalString(item.genre) ? { genre: optionalString(item.genre) } : {}),
    ...(numberValue(item.rating) === undefined ? {} : { rating: numberValue(item.rating) }),
  }, "Xtream series")
}

export function normalizeShortEpg(channelId: ChannelId | string, input: unknown): IptvGuide {
  return normalizeEpg(channelId, input, "Xtream short EPG")
}

export function normalizeFullEpg(channelId: ChannelId | string, input: unknown): IptvGuide {
  return normalizeEpg(channelId, input, "Xtream full EPG")
}

function normalizeEpg(channelId: ChannelId | string, input: unknown, resource: string): IptvGuide {
  const root = asRecord(input, resource)
  const values = Array.isArray(root.epg_listings) ? root.epg_listings : []
  const programmes = values.map((value) => {
    const item = asRecord(value, "Xtream EPG programme")
    const start = timestamp(item.start_timestamp) ?? dateValue(item.start)
    const end = timestamp(item.stop_timestamp) ?? dateValue(item.end)
    if (start === undefined) {
      throw new IptvResponseValidationError({
        resource,
        message: "EPG programme is missing a valid start time",
      })
    }
    return {
      channelId,
      start,
      ...(end === undefined ? {} : { end }),
      title: decodedText(item.title) ?? "Untitled programme",
      ...(decodedText(item.description) ? { description: decodedText(item.description) } : {}),
      categories: [],
    }
  })
  return decode(IptvGuide, {
    channels: [{ id: channelId, displayNames: [String(channelId)], urls: [] }],
    programmes,
  }, resource)
}

function formatCatchupStart(start: Date, timezone = "UTC"): string {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(start)
  } catch {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(start)
  }
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00"
  return `${value("year")}-${value("month")}-${value("day")}:${value("hour")}-${value("minute")}`
}

function ids(value: unknown, fallback: unknown): string[] {
  const listed = Array.isArray(value) ? value.map(optionalId).filter((id): id is string => id !== undefined) : []
  const single = optionalId(fallback)
  return [...new Set(single === undefined ? listed : [single, ...listed])]
}

function decodedText(value: unknown): string | undefined {
  const input = optionalString(value)
  if (input === undefined) return undefined
  try {
    const binary = atob(input)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    const decoded = new TextDecoder().decode(bytes).trim()
    return decoded === "" ? input : decoded
  } catch {
    return input
  }
}

function timestamp(value: unknown): Date | undefined {
  const seconds = positiveNumber(value)
  return seconds === undefined ? undefined : new Date(seconds * 1_000)
}

function dateValue(value: unknown): Date | undefined {
  const text = optionalString(value)
  if (text === undefined) return undefined
  const date = new Date(text.replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? "" : "Z"))
  return Number.isNaN(date.getTime()) ? undefined : date
}

function requiredString(value: unknown, field: string): string {
  const normalized = optionalString(value)
  if (normalized !== undefined) return normalized
  throw new IptvResponseValidationError({
    resource: "Xtream response",
    message: `Xtream response is missing ${field}`,
  })
}

function optionalString(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() === "" ? undefined : value.trim()
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return undefined
}

function optionalId(value: unknown): string | undefined { return optionalString(value) }

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(optionalString).filter((item): item is string => item !== undefined) : []
}

function numberValue(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN
  return Number.isFinite(number) ? number : undefined
}

function nonNegativeNumber(value: unknown): number | undefined {
  const number = numberValue(value)
  return number === undefined ? undefined : Math.max(0, number)
}

function positiveNumber(value: unknown): number | undefined {
  const number = numberValue(value)
  return number !== undefined && number > 0 ? number : undefined
}

function booleanNumber(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true"
}

function asArray(value: unknown, resource: string): readonly unknown[] {
  if (Array.isArray(value)) return value
  throw new IptvResponseValidationError({ resource, message: `${resource} must be an array` })
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asRecord(value: unknown, resource: string): UnknownRecord {
  if (isRecord(value)) return value
  throw new IptvResponseValidationError({ resource, message: `${resource} must be an object` })
}

function decode<S extends Schema.Schema.AnyNoContext>(schema: S, value: unknown, resource: string): Schema.Schema.Type<S> {
  try { return Schema.decodeUnknownSync(schema)(value) }
  catch (cause) {
    if (cause instanceof IptvResponseValidationError) throw cause
    throw new IptvResponseValidationError({
      resource,
      message: `${resource} did not match the expected schema`,
    })
  }
}

export type { CategoryId, MovieId, SeriesId }
