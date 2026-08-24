import { parseXmltv as parseXmltvDocument } from "@iptv/xmltv"
import type { XmltvProgramme } from "@iptv/xmltv"
import { Effect, Schema } from "effect"

import { XmltvParseError } from "./Errors.js"
import {
  EpgNowNext,
  IptvGuide,
  type EpgChannelId,
  type IptvGuide as IptvGuideType,
} from "./Schemas.js"
import type { XmltvParseOptions } from "./Types.js"

export const parseXmltv = Effect.fn("IptvClient.parseXmltv")((
  text: string,
  options: XmltvParseOptions = {},
) => Effect.gen(function* () {
  const value = yield* Effect.try({
    try: () => {
    const document = parseXmltvDocument(text)
    if ((document.channels ?? []).length === 0) {
      throw new XmltvParseError({ message: "XMLTV guide produced no channels" })
    }
    return {
      channels: (document.channels ?? []).map((channel) => ({
        id: channel.id,
        displayNames: channel.displayName.map((name) => name._value).filter(Boolean),
        ...(channel.icon?.[0]?.src ? { iconUrl: channel.icon[0].src } : {}),
        urls: (channel.url ?? []).map((url) => url._value).filter(Boolean),
      })),
      programmes: (document.programmes ?? []).map((programme) => programmeFor(programme, options)),
    }
    },
    catch: (cause) => cause instanceof XmltvParseError
      ? cause
      : new XmltvParseError({ message: message(cause) }),
  })
  return yield* Schema.decodeUnknown(IptvGuide)(value).pipe(
    Effect.mapError(() => new XmltvParseError({ message: "XMLTV guide did not match the expected schema" })),
  )
}))

export const nowNext = Effect.fn("IptvClient.nowNext")((
  guide: IptvGuideType,
  channelId: EpgChannelId | string,
  at: Date = new Date(),
) => Effect.gen(function* () {
    const value = yield* Effect.try({
      try: () => {
    const timestamp = at.getTime()
    const programmes = guide.programmes
      .filter((programme) => programme.channelId === channelId)
      .sort((left, right) => left.start.getTime() - right.start.getTime())
    const current = programmes.find((programme) => {
      const end = programme.end?.getTime() ?? Number.POSITIVE_INFINITY
      return programme.start.getTime() <= timestamp && timestamp < end
    })
    const next = programmes.find((programme) => programme.start.getTime() > timestamp)
    return {
      ...(current === undefined ? {} : { current }),
      ...(next === undefined ? {} : { next }),
    }
      },
      catch: (cause) => new XmltvParseError({ message: message(cause) }),
    })
    return yield* Schema.decodeUnknown(EpgNowNext)(value).pipe(
      Effect.mapError(() => new XmltvParseError({ message: "EPG now/next data is invalid" })),
    )
  }))

function programmeFor(programme: XmltvProgramme, options: XmltvParseOptions): unknown {
  return {
    channelId: programme.channel,
    start: programme.start,
    ...(programme.stop === undefined ? {} : { end: programme.stop }),
    title: localized(programme.title, options.language) || "Untitled programme",
    ...(localized(programme.subTitle, options.language) ? {
      subtitle: localized(programme.subTitle, options.language),
    } : {}),
    ...(localized(programme.desc, options.language) ? {
      description: localized(programme.desc, options.language),
    } : {}),
    categories: (programme.category ?? []).map((category) => category._value).filter(Boolean),
    ...(programme.icon?.[0]?.src ? { iconUrl: programme.icon[0].src } : {}),
    ...(programme.episodeNum?.[0]?._value ? { episode: programme.episodeNum[0]._value } : {}),
  }
}

function localized(
  values: readonly { readonly _value: string; readonly lang?: string }[] | undefined,
  language: string | undefined,
): string | undefined {
  if (values === undefined || values.length === 0) return undefined
  return (language === undefined ? undefined : values.find((value) => value.lang === language))?._value
    ?? values[0]?._value
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
