import { Schema } from "effect"

import { IptvInvalidUrlError, IptvResponseValidationError, StalkerPortalError } from "./Errors.js"
import {
  IptvCategory,
  IptvChannel,
  IptvMovie,
  StalkerProfile,
  type IptvCategory as IptvCategoryType,
  type IptvChannel as IptvChannelType,
  type IptvMovie as IptvMovieType,
  type StalkerProfile as StalkerProfileType,
} from "./Schemas.js"
import type { StalkerCredentials } from "./Types.js"

type UnknownRecord = Record<string, unknown>

export interface ResolvedStalkerCredentials extends Required<Omit<StalkerCredentials,
  "serialNumber" | "deviceId" | "deviceId2" | "signature">> {
  readonly serialNumber?: string
  readonly deviceId?: string
  readonly deviceId2?: string
  readonly signature?: string
}

export function normalizeStalkerCredentials(input: StalkerCredentials): ResolvedStalkerCredentials {
  let url: URL
  try { url = new URL(input.portalUrl) }
  catch { throw new IptvInvalidUrlError({ resource: "Stalker portal", message: "Portal URL is invalid" }) }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new IptvInvalidUrlError({ resource: "Stalker portal", message: "Portal must use HTTP or HTTPS" })
  }
  url.username = ""
  url.password = ""
  url.search = ""
  url.hash = ""
  const macAddress = input.macAddress.trim().replace(/-/g, ":").toUpperCase()
  if (!/^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/.test(macAddress)) {
    throw new IptvResponseValidationError({
      resource: "Stalker credentials",
      message: "MAC address must contain six hexadecimal octets",
    })
  }
  return {
    portalUrl: url.toString(),
    macAddress,
    timezone: input.timezone?.trim() || "UTC",
    language: input.language?.trim() || "en",
    userAgent: input.userAgent?.trim() || "Mozilla/5.0 (QtEmbedded; U; Linux; C) MAG250 stbapp",
    ...(input.serialNumber?.trim() ? { serialNumber: input.serialNumber.trim() } : {}),
    ...(input.deviceId?.trim() ? { deviceId: input.deviceId.trim() } : {}),
    ...(input.deviceId2?.trim() ? { deviceId2: input.deviceId2.trim() } : {}),
    ...(input.signature?.trim() ? { signature: input.signature.trim() } : {}),
  }
}

export function stalkerEndpointCandidates(credentials: ResolvedStalkerCredentials): readonly URL[] {
  const input = new URL(credentials.portalUrl)
  if (/\/(?:server\/load|portal)\.php$/i.test(input.pathname)) return [input]
  const base = input.pathname.endsWith("/") ? input : new URL("./", input)
  return [...new Set([
    new URL("server/load.php", base).toString(),
    new URL("portal.php", base).toString(),
    new URL("stalker_portal/server/load.php", base).toString(),
    new URL("ministra/server/load.php", base).toString(),
  ])].map((value) => new URL(value))
}

export function stalkerRequestUrl(
  endpoint: URL,
  parameters: Readonly<Record<string, string | number | undefined>>,
): URL {
  const url = new URL(endpoint)
  for (const [name, value] of Object.entries(parameters)) {
    if (value !== undefined) url.searchParams.set(name, String(value))
  }
  return url
}

export function stalkerHeaders(
  credentials: ResolvedStalkerCredentials,
  token?: string,
): Headers {
  const headers = new Headers({
    Accept: "application/json",
    "User-Agent": credentials.userAgent,
    "X-User-Agent": "Model: MAG250; Link: WiFi",
    Cookie: `mac=${encodeURIComponent(credentials.macAddress)}; stb_lang=${encodeURIComponent(credentials.language)}; timezone=${encodeURIComponent(credentials.timezone)}`,
  })
  if (token !== undefined) headers.set("Authorization", `Bearer ${token}`)
  return headers
}

export async function stalkerPrehash(macAddress: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(macAddress.toUpperCase()))
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase()
}

export function stalkerPayload(input: unknown, resource: string): unknown {
  const root = asRecord(input, resource)
  if (root.js === undefined) throw new StalkerPortalError({ resource, message: `${resource} omitted its js payload` })
  const js = root.js
  if (isRecord(js) && optionalString(js.error) !== undefined) {
    throw new StalkerPortalError({ resource, message: `${resource} returned a portal error` })
  }
  return js
}

export function normalizeStalkerProfile(input: unknown): StalkerProfileType {
  const value = asRecord(input, "Stalker profile")
  const expires = parseDate(value.expire_billing_date) ?? parseDate(value.expire_date)
  return Schema.decodeUnknownSync(StalkerProfile)({
    ...(optionalString(value.id) ? { id: optionalString(value.id) } : {}),
    ...(optionalString(value.name) ?? optionalString(value.fname)
      ? { name: optionalString(value.name) ?? optionalString(value.fname) }
      : {}),
    ...(optionalString(value.status) ? { status: optionalString(value.status) } : {}),
    ...(expires === undefined ? {} : { expiresAt: expires }),
    ...(optionalString(value.default_timezone) ? { timezone: optionalString(value.default_timezone) } : {}),
  })
}

export function normalizeStalkerCategories(
  input: unknown,
  kind: "live" | "movie" = "live",
): readonly IptvCategoryType[] {
  return asArray(input, "Stalker genres").map((value) => {
    const item = asRecord(value, "Stalker genre")
    return Schema.decodeUnknownSync(IptvCategory)({
      id: requiredString(item.id, "genre id"),
      name: optionalString(item.title) ?? optionalString(item.name) ?? "Unnamed category",
      kind,
    })
  })
}

export function normalizeStalkerMovies(input: unknown): readonly IptvMovieType[] {
  const root = isRecord(input) && Array.isArray(input.data) ? input.data : input
  return asArray(root, "Stalker movies").map((value) => {
    const item = asRecord(value, "Stalker movie")
    const id = requiredString(item.id, "movie id")
    const command = optionalString(item.cmd) ?? ""
    const staticUrl = commandUrl(command)
    const extension = optionalString(item.container_extension)
      ?? extensionFromUrl(staticUrl)
      ?? "mp4"
    const category = optionalString(item.category_id) ?? optionalString(item.category)
    return Schema.decodeUnknownSync(IptvMovie)({
      id,
      name: optionalString(item.name) ?? "Unnamed movie",
      streamUrl: staticUrl ?? `stalker://vod/${encodeURIComponent(id)}`,
      categoryIds: category === undefined ? [] : [category],
      containerExtension: extension,
      ...(optionalString(item.year) ? { year: optionalString(item.year) } : {}),
      ...(optionalString(item.screenshot_uri) ?? optionalString(item.poster_url)
        ? { posterUrl: optionalString(item.screenshot_uri) ?? optionalString(item.poster_url) }
        : {}),
      ...(optionalString(item.description) ? { plot: optionalString(item.description) } : {}),
      ...(numberValue(item.rating) === undefined ? {} : { rating: numberValue(item.rating) }),
      ...(command === "" ? {} : { directSource: command }),
    })
  })
}

export function normalizeStalkerChannels(
  input: unknown,
  headers: Readonly<Record<string, string>>,
): readonly IptvChannelType[] {
  const root = isRecord(input) && Array.isArray(input.data) ? input.data : input
  return asArray(root, "Stalker channels").map((value) => {
    const item = asRecord(value, "Stalker channel")
    const id = requiredString(item.id, "channel id")
    const command = optionalString(item.cmd) ?? ""
    const staticUrl = commandUrl(command)
    const category = optionalString(item.tv_genre_id) ?? optionalString(item.genre_id)
    return Schema.decodeUnknownSync(IptvChannel)({
      id,
      name: optionalString(item.name) ?? "Unnamed channel",
      streamUrl: staticUrl ?? `stalker://channel/${encodeURIComponent(id)}`,
      source: "stalker",
      kind: booleanValue(item.radio) ? "radio" : "live",
      ...(numberValue(item.number) === undefined ? {} : { number: numberValue(item.number) }),
      categoryIds: category === undefined ? [] : [category],
      ...(optionalString(item.xmltv_id) ? { epgChannelId: optionalString(item.xmltv_id) } : {}),
      ...(optionalString(item.logo) ? { logoUrl: optionalString(item.logo) } : {}),
      ...(command === "" ? {} : { directSource: command }),
      headers,
    })
  })
}

export function resolveStalkerLink(input: unknown, endpoint: URL): string {
  const value = asRecord(input, "Stalker create_link")
  const command = optionalString(value.cmd)
  if (command === undefined) throw new StalkerPortalError({
    resource: "Stalker create_link",
    message: "Portal did not return a playback command",
  })
  const direct = commandUrl(command)
  if (direct !== undefined) return direct
  try { return new URL(command.replace(/^\s*(?:ffmpeg|ffrt)\s+/i, ""), endpoint).toString() }
  catch { throw new StalkerPortalError({ resource: "Stalker create_link", message: "Playback URL is invalid" }) }
}

function commandUrl(command: string): string | undefined {
  const candidate = command.replace(/^\s*(?:ffmpeg|ffrt)\s+/i, "").trim().split(/\s+/)[0] ?? ""
  try {
    const url = new URL(candidate)
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined
  } catch { return undefined }
}

function extensionFromUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  try {
    const match = /\.([a-z0-9]{2,5})$/i.exec(new URL(value).pathname)
    return match?.[1]?.toLowerCase()
  } catch { return undefined }
}

function parseDate(value: unknown): Date | undefined {
  const text = optionalString(value)
  if (text === undefined || text === "0" || /^0000-/.test(text)) return undefined
  const date = new Date(text.includes("T") ? text : `${text.replace(" ", "T")}Z`)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function requiredString(value: unknown, field: string): string {
  const result = optionalString(value)
  if (result !== undefined) return result
  throw new StalkerPortalError({ resource: "Stalker response", message: `Response omitted ${field}` })
}

function optionalString(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() === "" ? undefined : value.trim()
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return undefined
}

function numberValue(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : undefined
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true"
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asRecord(value: unknown, resource: string): UnknownRecord {
  if (isRecord(value)) return value
  throw new StalkerPortalError({ resource, message: `${resource} must be an object` })
}

function asArray(value: unknown, resource: string): readonly unknown[] {
  if (Array.isArray(value)) return value
  throw new StalkerPortalError({ resource, message: `${resource} must be an array` })
}
