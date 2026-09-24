/**
 * Подставной GitHub для тестов чтения: ровно те запросы, которые делает
 * клиент ядра на пути «доступ → голова → дерево → файл».
 *
 * Репозитории и срезы — выдуманные (Р-01). Ни одного настоящего имени.
 */

import { blobSha } from '../shared/core/github.ts'

export type FakeRepo = {
  /** Ответ на проверку доступа не 200 — этот код. */
  status?: number
  /** Ответ на чтение файлов (голова, дерево, файл) не 200 — этот код. */
  filesStatus?: number
  /** Исчерпан ли лимит: 403 с `x-ratelimit-remaining: 0`. */
  limited?: boolean
  /** Токен с правом записи. */
  push?: boolean
  /** Файлы в корне; `null` — репозиторий без единого коммита. */
  files?: Record<string, string> | null
}

export type FakeGitHub = {
  fetch: typeof globalThis.fetch
  /** Пути запросов по порядку, без адреса API. */
  paths: string[]
  /** Заголовки Authorization по порядку. */
  auth: string[]
}

const API = 'https://api.github.com/repos/'
const HEAD = 'c0mmit'

function base64(text: string): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

function refusal(status: number, limited = false): Response {
  return json(status, { message: 'refused' }, limited ? { 'x-ratelimit-remaining': '0' } : {})
}

/** GitHub с этими репозиториями: ключ — «владелец/имя». `offline` — обрыв связи на любом запросе. */
export function fakeGitHub(repos: Record<string, FakeRepo>, options: { offline?: boolean } = {}): FakeGitHub {
  const paths: string[] = []
  const auth: string[] = []

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (options.offline) throw new TypeError('Failed to fetch')
    if (!url.startsWith(API)) throw new Error(`Не GitHub: ${url}`)
    const rest = url.slice(API.length)
    paths.push(rest)
    auth.push(new Headers(init?.headers).get('Authorization') ?? '')

    const [owner = '', name = '', ...tail] = rest.split('/')
    const repo = repos[`${decodeURIComponent(owner)}/${decodeURIComponent(name)}`]
    if (!repo) return refusal(404)
    const path = tail.join('/')

    if (path === '') {
      if (repo.status) return refusal(repo.status, repo.limited)
      return json(200, { full_name: `${owner}/${name}`, private: true, default_branch: 'main', permissions: { pull: true, push: repo.push ?? false } })
    }
    if (repo.filesStatus) return refusal(repo.filesStatus, repo.limited)
    if (repo.files === null) return json(409, { message: 'Git Repository is empty.' })

    const files = repo.files ?? {}
    const entries = await Promise.all(
      Object.entries(files).map(async ([file, content]) => ({ path: file, sha: await blobSha(content), type: 'blob', content })),
    )
    if (path === 'git/ref/heads/main') return json(200, { object: { sha: HEAD } })
    if (path === `git/trees/${HEAD}?recursive=1`) {
      return json(200, { tree: entries.map(({ path: file, sha, type }) => ({ path: file, sha, type })), truncated: false })
    }
    if (path.startsWith('git/blobs/')) {
      const found = entries.find((entry) => entry.sha === path.slice('git/blobs/'.length))
      return found ? json(200, { content: base64(found.content), encoding: 'base64' }) : refusal(404)
    }
    return refusal(404)
  }

  return { fetch, paths, auth }
}
