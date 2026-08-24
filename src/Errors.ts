import { Schema } from "effect"

export class IptvInvalidUrlError extends Schema.TaggedError<IptvInvalidUrlError>()(
  "IptvInvalidUrlError",
  { resource: Schema.String, message: Schema.String },
) {}

export class IptvTransportError extends Schema.TaggedError<IptvTransportError>()(
  "IptvTransportError",
  { resource: Schema.String, message: Schema.String, retryable: Schema.Boolean },
) {}

export class IptvHttpStatusError extends Schema.TaggedError<IptvHttpStatusError>()(
  "IptvHttpStatusError",
  {
    resource: Schema.String,
    status: Schema.Number,
    message: Schema.String,
    retryable: Schema.Boolean,
  },
) {}

export class IptvResponseTooLargeError extends Schema.TaggedError<IptvResponseTooLargeError>()(
  "IptvResponseTooLargeError",
  { resource: Schema.String, maxResponseBytes: Schema.Number, message: Schema.String },
) {}

export class IptvInvalidJsonError extends Schema.TaggedError<IptvInvalidJsonError>()(
  "IptvInvalidJsonError",
  { resource: Schema.String, message: Schema.String },
) {}

export class IptvResponseValidationError extends Schema.TaggedError<IptvResponseValidationError>()(
  "IptvResponseValidationError",
  { resource: Schema.String, message: Schema.String },
) {}

export class XtreamAuthenticationError extends Schema.TaggedError<XtreamAuthenticationError>()(
  "XtreamAuthenticationError",
  { status: Schema.optional(Schema.String), message: Schema.String },
) {}

export class M3uParseError extends Schema.TaggedError<M3uParseError>()(
  "M3uParseError",
  { line: Schema.optional(Schema.Number), message: Schema.String },
) {}

export class XmltvParseError extends Schema.TaggedError<XmltvParseError>()(
  "XmltvParseError",
  { message: Schema.String },
) {}

export class IptvUrlPolicyError extends Schema.TaggedError<IptvUrlPolicyError>()(
  "IptvUrlPolicyError",
  { resource: Schema.String, message: Schema.String },
) {}

export class IptvRedirectError extends Schema.TaggedError<IptvRedirectError>()(
  "IptvRedirectError",
  { resource: Schema.String, message: Schema.String },
) {}

export class StalkerAuthenticationError extends Schema.TaggedError<StalkerAuthenticationError>()(
  "StalkerAuthenticationError",
  { message: Schema.String },
) {}

export class StalkerPortalError extends Schema.TaggedError<StalkerPortalError>()(
  "StalkerPortalError",
  { resource: Schema.String, message: Schema.String },
) {}

export type IptvClientError =
  | IptvInvalidUrlError
  | IptvTransportError
  | IptvHttpStatusError
  | IptvResponseTooLargeError
  | IptvInvalidJsonError
  | IptvResponseValidationError
  | XtreamAuthenticationError
  | M3uParseError
  | XmltvParseError
  | IptvUrlPolicyError
  | IptvRedirectError
  | StalkerAuthenticationError
  | StalkerPortalError

export function isIptvClientError(error: unknown): error is IptvClientError {
  if (!(error instanceof Error) || typeof error !== "object" || error === null) return false
  const tag = (error as unknown as { _tag?: unknown })._tag
  return typeof tag === "string" && IPTV_ERROR_TAGS.has(tag)
}

const IPTV_ERROR_TAGS = new Set([
  "IptvInvalidUrlError",
  "IptvTransportError",
  "IptvHttpStatusError",
  "IptvResponseTooLargeError",
  "IptvInvalidJsonError",
  "IptvResponseValidationError",
  "XtreamAuthenticationError",
  "M3uParseError",
  "XmltvParseError",
  "IptvUrlPolicyError",
  "IptvRedirectError",
  "StalkerAuthenticationError",
  "StalkerPortalError",
])
