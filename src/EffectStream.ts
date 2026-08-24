import { Effect, Stream } from "effect"

import { IptvService } from "./Client.js"
import { XmltvParseError } from "./Errors.js"
import type { EpgBatch } from "./Schemas.js"
import { streamXmltvChunks } from "./StreamingXmltv.js"
import type {
  IptvCallOptions,
  XmltvChunkSource,
  XmltvStreamOptions,
} from "./Types.js"

export function streamXmltv(
  source: XmltvChunkSource,
  options: XmltvStreamOptions = {},
): Stream.Stream<EpgBatch, XmltvParseError> {
  return Stream.fromAsyncIterable(
    streamXmltvChunks(source, options),
    (cause) => cause instanceof XmltvParseError
      ? cause
      : new XmltvParseError({ message: cause instanceof Error ? cause.message : String(cause) }),
  )
}

export function loadXmltvStream(
  url: string,
  options: XmltvStreamOptions = {},
  callOptions: IptvCallOptions = {},
) {
  return Stream.unwrap(
    IptvService.openXmltv(url, callOptions).pipe(
      Effect.map((response) => streamXmltv(response.body!, options)),
    ),
  )
}
