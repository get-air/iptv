import { Schema } from "effect"

import {
  IptvSearchDocument,
  IptvSearchPage,
  type IptvContentKind,
  type IptvSearchDocument as SearchDocument,
  type IptvSearchMatch,
  type IptvSearchPage as SearchPage,
  type IptvSearchResult,
  type IptvSourceRef,
  type SourceId,
} from "./Schemas.js"
import type {
  IptvSearchIndex,
  IptvSearchOptions,
  IptvSearchSourceContent,
} from "./Types.js"

interface ScoredText {
  readonly score: number
  readonly match: IptvSearchMatch
}

interface ScoredDocument extends ScoredText {
  readonly document: SearchDocument
}

export class InMemoryIptvSearchIndex implements IptvSearchIndex {
  readonly #documents = new Map<string, readonly SearchDocument[]>()
  readonly #byId = new Map<string, SearchDocument>()
  readonly #tokenPrefixes = new Map<string, Set<string>>()
  readonly #trigrams = new Map<string, Set<string>>()

  constructor(readonly candidateLimit = 10_000) {}

  async replaceSource(source: IptvSourceRef, content: IptvSearchSourceContent): Promise<void> {
    this.#documents.set(source.id, documentsFor(source, content))
    this.#rebuild()
  }

  async removeSource(sourceId: SourceId | string): Promise<void> {
    this.#documents.delete(String(sourceId))
    this.#rebuild()
  }

  async clear(): Promise<void> {
    this.#documents.clear()
    this.#rebuild()
  }

  async search(query: string, options: IptvSearchOptions = {}): Promise<SearchPage> {
    const normalizedQuery = normalizeSearchText(query)
    const limit = Math.max(1, Math.min(200, Math.floor(options.limit ?? 40)))
    const offset = Math.max(0, Math.floor(options.offset ?? 0))
    if (normalizedQuery.length < 2) {
      return Schema.decodeUnknownSync(IptvSearchPage)({ items: [], total: 0, offset, limit, hasMore: false })
    }

    const kinds = options.kinds === undefined ? undefined : new Set(options.kinds)
    const sourceIds = options.sourceIds === undefined
      ? undefined
      : new Set(options.sourceIds.map(String))
    const scored: ScoredDocument[] = []
    const candidates = this.#candidateIds(normalizedQuery)
      .slice(0, Math.max(this.candidateLimit, offset + limit))

    for (const id of candidates) {
      const document = this.#byId.get(id)
      if (document !== undefined) {
        if (sourceIds !== undefined && !sourceIds.has(document.source.id)) continue
        if (kinds !== undefined && !kinds.has(document.contentKind)) continue
        if (options.excludeHidden === true && document.hidden) continue
        const match = scoreDocument(document, normalizedQuery)
        if (match === null) continue
        scored.push({ document, ...match })
      }
    }

    scored.sort(compareScoredDocuments)
    const items: IptvSearchResult[] = scored.slice(offset, offset + limit).map((item) => ({
      document: item.document,
      score: item.score,
      match: item.match,
    }))
    return Schema.decodeUnknownSync(IptvSearchPage)({
      items,
      total: scored.length,
      offset,
      limit,
      hasMore: offset + items.length < scored.length,
    })
  }

  #rebuild(): void {
    this.#byId.clear()
    this.#tokenPrefixes.clear()
    this.#trigrams.clear()
    for (const documents of this.#documents.values()) {
      for (const document of documents) {
        this.#byId.set(document.id, document)
        const values = [document.title, document.subtitle, ...document.terms]
        for (const value of values) {
          if (value === undefined) continue
          for (const token of normalizeSearchText(value).split(" ").filter(Boolean)) {
            addIndex(this.#tokenPrefixes, token.slice(0, 1), document.id)
            if (token.length >= 2) addIndex(this.#tokenPrefixes, token.slice(0, 2), document.id)
            for (const gram of trigrams(token)) addIndex(this.#trigrams, gram, document.id)
          }
        }
      }
    }
  }

  #candidateIds(query: string): string[] {
    const tokenSets: Set<string>[] = []
    for (const token of query.split(" ").filter(Boolean)) {
      if (token.length <= 2) {
        tokenSets.push(new Set(this.#tokenPrefixes.get(token) ?? []))
        continue
      }
      const grams = trigrams(token)
      let candidates: Set<string> | undefined
      for (const gram of grams) {
        const matches = this.#trigrams.get(gram) ?? new Set<string>()
        candidates = candidates === undefined ? new Set(matches) : intersection(candidates, matches)
        if (candidates.size === 0) break
      }
      tokenSets.push(candidates ?? new Set())
    }
    if (tokenSets.length === 0) return []
    let candidates = tokenSets[0] ?? new Set<string>()
    for (let index = 1; index < tokenSets.length; index += 1) {
      candidates = intersection(candidates, tokenSets[index] ?? new Set())
    }
    return [...candidates]
  }
}

export function normalizeSearchText(value: unknown): string {
  return typeof value === "string"
    ? value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .replace(/\s+/g, " ")
    : ""
}

export function scoreSearchTextMatch(value: string, query: string): ScoredText | null {
  const candidateText = normalizeSearchText(value)
  const searchText = normalizeSearchText(query)
  if (candidateText === "" || searchText === "") return null
  const searchTokens = searchText.split(" ")
  const candidateTokens = candidateText.split(" ")
  const first = searchTokens[0] ?? ""

  if (first.length <= 2 && !candidateText.startsWith(first)) {
    return searchTokens.length > 1 && ` ${candidateText} `.includes(` ${searchText} `)
      ? { score: 40, match: "phrase-substring" }
      : null
  }
  if (candidateText === searchText) return { score: 0, match: "exact" }
  if (candidateText.startsWith(searchText) && (searchTokens.length > 1 || first.length <= 2)) {
    return { score: 10, match: "phrase-prefix" }
  }
  if (candidateTokens.some((token) => token.startsWith(searchText))) {
    return { score: 20, match: "token-prefix" }
  }
  if (searchTokens.every((token) => candidateTokens.some((candidate) => candidate.startsWith(token)))) {
    return { score: 30, match: "all-token-prefixes" }
  }
  if (candidateText.includes(searchText)) return { score: 40, match: "phrase-substring" }
  if (searchTokens.every((token) => candidateText.includes(token))) {
    return { score: 50, match: "all-token-substrings" }
  }
  return null
}

function scoreDocument(document: SearchDocument, query: string): ScoredText | null {
  const fields = [document.title, document.subtitle, ...document.terms]
  let best: ScoredText | null = null
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index]
    if (field === undefined) continue
    const match = scoreSearchTextMatch(field, query)
    if (match === null) continue
    const score = match.score + (index === 0 ? 0 : 5)
    if (best === null || score < best.score) best = { score, match: match.match }
  }
  return best
}

function compareScoredDocuments(left: ScoredDocument, right: ScoredDocument): number {
  return left.score - right.score
    || left.document.source.name.localeCompare(right.document.source.name)
    || left.document.source.id.localeCompare(right.document.source.id)
    || left.document.title.localeCompare(right.document.title)
    || left.document.id.localeCompare(right.document.id)
}

function documentsFor(source: IptvSourceRef, content: IptvSearchSourceContent): readonly SearchDocument[] {
  const hidden = new Set(content.hiddenEntityIds?.map(String) ?? [])
  const documents: SearchDocument[] = []
  for (const channel of content.channels ?? []) {
    documents.push(documentFor(source, channel.kind, channel.id, channel.name, channel.categoryIds, channel,
      [channel.epgChannelId, channel.directSource], channel.logoUrl, hidden))
  }
  for (const movie of content.movies ?? []) {
    documents.push(documentFor(source, "movie", movie.id, movie.name, movie.categoryIds, movie,
      [movie.year, movie.genre, movie.plot], movie.posterUrl, hidden))
  }
  for (const series of content.series ?? []) {
    documents.push(documentFor(source, "series", series.id, series.name, series.categoryIds, series,
      [series.year, series.genre, series.plot], series.coverUrl, hidden))
  }
  for (const episode of content.episodes ?? []) {
    documents.push(documentFor(source, "episode", episode.id, episode.title, [], episode,
      [`Season ${episode.season}`, `Episode ${episode.episode}`, episode.plot], undefined, hidden))
  }
  for (const entry of content.playlist?.entries ?? []) {
    const groups = entry.categoryIds
    documents.push(documentFor(source, entry.kind, entry.id, entry.name, groups, entry,
      [entry.epgChannelId, entry.attributes["tvg-name"], ...groups], entry.logoUrl, hidden))
  }
  return documents
}

function documentFor(
  source: IptvSourceRef,
  contentKind: IptvContentKind,
  entityId: string,
  title: string,
  categoryIds: readonly string[],
  entity: SearchDocument["entity"],
  terms: readonly (string | undefined)[],
  posterUrl: string | undefined,
  hiddenIds: ReadonlySet<string>,
): SearchDocument {
  return Schema.decodeUnknownSync(IptvSearchDocument)({
    id: `${source.id}:${contentKind}:${entityId}`,
    source,
    contentKind,
    title,
    categoryIds,
    ...(posterUrl === undefined ? {} : { posterUrl }),
    hidden: hiddenIds.has(entityId),
    terms: [...new Set(terms.filter((term): term is string => term !== undefined && term.trim() !== ""))],
    entity,
  })
}

function addIndex(index: Map<string, Set<string>>, key: string, id: string): void {
  const values = index.get(key)
  if (values === undefined) index.set(key, new Set([id]))
  else values.add(id)
}

function trigrams(value: string): string[] {
  if (value.length <= 3) return [value]
  const values: string[] = []
  for (let index = 0; index <= value.length - 3; index += 1) values.push(value.slice(index, index + 3))
  return values
}

function intersection(left: ReadonlySet<string>, right: ReadonlySet<string>): Set<string> {
  const values = new Set<string>()
  const [small, large] = left.size <= right.size ? [left, right] : [right, left]
  for (const value of small) if (large.has(value)) values.add(value)
  return values
}
