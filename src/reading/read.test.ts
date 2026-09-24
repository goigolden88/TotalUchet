import { describe, expect, it } from 'vitest'
import { blobSha } from '../shared/core/github.ts'
import { buildSummary, summaryFile } from '../shared/core/summary.ts'
import { shelfSummary } from '../shared/testing/shelf.ts'
import { fakeGitHub } from './fakeGitHub.ts'
import { NOT_GIVEN, readSummary } from './read.ts'

/** Выдуманные: репозиторий, токен, срез «Полки» ядра (Р-01). */
const REPO = 'someone/shelf-data'
const TOKEN = 'fake-read-token'
const DAY = '2026-09-24'
const SUMMARY = buildSummary(shelfSummary({ sessions: [], books: [] }, DAY), {}, DAY)
const FILE = summaryFile(SUMMARY)
const FILES = { [FILE.path]: FILE.content, 'meta.json': '{"app":"polka","schemaVersion":1}\n', 'books/2026-09.json': '[]\n' }

function read(github: ReturnType<typeof fakeGitHub>, lastSha: string | null = null, dataRepo = REPO) {
  return readSummary({ dataRepo, token: TOKEN, lastSha, fetch: github.fetch })
}

describe('чтение среза — доступ, потом файл (Р-05)', () => {
  it('новый срез: доступ, голова, дерево, только summary.json', async () => {
    const github = fakeGitHub({ [REPO]: { files: FILES } })
    const result = await read(github)
    expect(result).toEqual({ kind: 'new', sha: await blobSha(FILE.content), summary: SUMMARY, canWrite: false })
    expect(github.paths[0]).toBe(REPO)
    expect(github.paths.filter((path) => path.includes('/git/blobs/'))).toEqual([`${REPO}/git/blobs/${await blobSha(FILE.content)}`])
    expect(github.paths).toHaveLength(4)
  })

  it('тот же отпечаток — файл не качается', async () => {
    const github = fakeGitHub({ [REPO]: { files: FILES } })
    expect(await read(github, await blobSha(FILE.content))).toEqual({ kind: 'same', canWrite: false })
    expect(github.paths.some((path) => path.includes('/git/blobs/'))).toBe(false)
  })

  it('нет summary.json — «срез не отдаёт», не ошибка (Я-16)', async () => {
    const result = await read(fakeGitHub({ [REPO]: { files: { 'meta.json': '{}' } } }))
    expect(result).toEqual({ kind: 'none', text: NOT_GIVEN, canWrite: false })
  })

  it('пустой репозиторий — тоже «срез не отдаёт»', async () => {
    expect((await read(fakeGitHub({ [REPO]: { files: null } }))).kind).toBe('none')
  })

  it('404 на доступе — «токен не видит репозиторий» с именем', async () => {
    const result = await read(fakeGitHub({}))
    expect(result).toEqual({
      kind: 'failed',
      failure: 'noAccess',
      text: `токен не видит репозиторий ${REPO}: опечатка в имени или токен выдан не на него`,
    })
  })

  it('401 — токен не принят', async () => {
    const result = await read(fakeGitHub({ [REPO]: { status: 401 } }))
    expect(result.kind === 'failed' && result.failure).toBe('badToken')
  })

  it('403 на файлах — видит, но не читает; 403 с исчерпанным лимитом — лимит', async () => {
    const rights = await read(fakeGitHub({ [REPO]: { filesStatus: 403, files: FILES } }))
    expect(rights.kind === 'failed' && rights.text).toContain('Contents: Read-only')
    const limit = await read(fakeGitHub({ [REPO]: { filesStatus: 403, limited: true, files: FILES } }))
    expect(limit.kind === 'failed' && limit.failure).toBe('limit')
  })

  it('нет связи — «нет связи», не текст ядра для пишущего', async () => {
    expect(await read(fakeGitHub({}, { offline: true }))).toEqual({ kind: 'failed', failure: 'offline', text: 'нет связи' })
  })

  it('кривой срез — словами ядра', async () => {
    const broken = JSON.stringify({ ...SUMMARY, periods: [] })
    const result = await read(fakeGitHub({ [REPO]: { files: { [FILE.path]: broken } } }))
    expect(result.kind).toBe('broken')
    expect(result.kind === 'broken' && result.text).toContain('не сходится с формой')
  })

  it('токен с записью — canWrite (Р-11)', async () => {
    const result = await read(fakeGitHub({ [REPO]: { push: true, files: FILES } }))
    expect(result.kind === 'new' && result.canWrite).toBe(true)
  })

  it('кривое имя репозитория — без запросов', async () => {
    const github = fakeGitHub({})
    const result = await read(github, null, 'не репозиторий')
    expect(result.kind === 'failed' && result.failure).toBe('badRepo')
    expect(github.paths).toEqual([])
  })

  it('токен — только в заголовке Authorization', async () => {
    const github = fakeGitHub({ [REPO]: { files: FILES } })
    await read(github)
    expect(github.auth.every((value) => value === `Bearer ${TOKEN}`)).toBe(true)
    expect(github.paths.some((path) => path.includes(TOKEN))).toBe(false)
  })
})
