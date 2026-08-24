import { IptvRedirectError, IptvUrlPolicyError } from "./Errors.js"
import type {
  IptvUrlPolicy,
  IptvUrlPurpose,
  IptvUrlValidationContext,
} from "./Types.js"

const DEFAULT_SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
  "x-auth-token",
  "x-api-key",
])

export async function validateIptvUrl(
  url: URL,
  resource: string,
  purpose: IptvUrlPurpose,
  policy: IptvUrlPolicy,
  redirectCount = 0,
  previousUrl?: URL,
): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new IptvUrlPolicyError({ resource, message: "Only HTTP and HTTPS URLs are supported" })
  }
  if (url.username !== "" || url.password !== "") {
    throw new IptvUrlPolicyError({ resource, message: "Credentials in URL authority are not supported" })
  }
  const configuredTrust = policy.trustedPrivateNetworkOrigins
  const trusted = new Set(isOriginList(configuredTrust)
    ? configuredTrust
    : configuredTrust?.[purpose] ?? [])
  if (policy.allowPrivateNetworks !== true && !trusted.has(url.origin)) {
    if (isPrivateOrLocalHostname(url.hostname)) {
      throw new IptvUrlPolicyError({
        resource,
        message: "URL points to a private or local network address; trust this source explicitly to allow it",
      })
    }
    if (policy.resolveHostname !== undefined && !looksLikeIpAddress(url.hostname)) {
      let addresses: readonly string[]
      try { addresses = await policy.resolveHostname(url.hostname) }
      catch {
        throw new IptvUrlPolicyError({ resource, message: "URL hostname could not be resolved safely" })
      }
      if (addresses.length === 0 || addresses.some(isPrivateOrLocalHostname)) {
        throw new IptvUrlPolicyError({
          resource,
          message: "URL hostname resolves to a private, local, or invalid address",
        })
      }
    }
  }
  const context: IptvUrlValidationContext = {
    purpose,
    redirectCount,
    ...(previousUrl === undefined ? {} : { previousUrl }),
  }
  await policy.validate?.(url, context)
}

export function redirectRequest(
  previous: Request,
  previousUrl: URL,
  nextUrl: URL,
  status: number,
  policy: IptvUrlPolicy,
  resource: string,
): Request {
  const method = previous.method.toUpperCase()
  const rewriteToGet = (status === 303 && method !== "HEAD")
    || ((status === 301 || status === 302) && method === "POST")
  const unsafe = nextUrl.hostname !== previousUrl.hostname
    || (previousUrl.protocol === "https:" && nextUrl.protocol === "http:")
  if (unsafe && !rewriteToGet && method !== "GET" && method !== "HEAD") {
    throw new IptvRedirectError({
      resource,
      message: "Cross-host or HTTPS-to-HTTP redirects cannot replay request bodies",
    })
  }
  const headers = new Headers(previous.headers)
  if (unsafe) {
    const sensitive = new Set([
      ...DEFAULT_SENSITIVE_HEADERS,
      ...(policy.sensitiveHeaders ?? []).map((name) => name.toLowerCase()),
    ])
    for (const name of [...headers.keys()]) {
      if (sensitive.has(name.toLowerCase())) headers.delete(name)
    }
  }
  return new Request(nextUrl, {
    method: rewriteToGet ? "GET" : previous.method,
    headers,
    redirect: "manual",
    signal: previous.signal,
  })
}

export function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

export function redirectLocation(response: Response, current: URL, resource: string): URL {
  const location = response.headers.get("location")
  if (location === null) {
    throw new IptvRedirectError({ resource, message: "Redirect response omitted its Location header" })
  }
  return new URL(location, current)
}

function isPrivateOrLocalHostname(raw: string): boolean {
  const hostname = raw.replace(/^\[|\]$/g, "").toLowerCase()
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) return true
  if (hostname === "::1" || hostname === "0:0:0:0:0:0:0:1") return true
  if (/^(?:fc|fd|fe[89ab])/i.test(hostname)) return true
  const parts = hostname.split(".").map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a = 0, b = 0] = parts
  return a === 0 || a === 10 || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || a >= 224
}

function looksLikeIpAddress(value: string): boolean {
  return value.includes(":") || /^\d+(?:\.\d+){3}$/.test(value)
}

function isOriginList(
  value: IptvUrlPolicy["trustedPrivateNetworkOrigins"],
): value is readonly string[] {
  return Array.isArray(value)
}
