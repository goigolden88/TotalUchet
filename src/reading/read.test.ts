import { describe, expect, it } from 'vitest'
import { blobSha } from '../shared/core/github.ts'
import { buildSummary, summaryFile } from '../shared/core/summary.ts'
import { shelfSummary } from '../shared/testing/shelf.ts'
import { fakeGitHub } from './fakeGitHub.ts'
import { appOf, NOT_GIVEN, readSummary } from './read.ts'

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
    expect(result).toEqual({ kind: 'new', sha: await blobSha(FILE.content), summary: SUMMARY })
    expect(github.paths[0]).toBe(REPO)
    expect(github.paths.filter((path) => path.includes('/git/blobs/'))).toEqual([`${REPO}/git/blobs/${await blobSha(FILE.content)}`])
    expect(github.paths).toHaveLength(4)
  })

  it('тот же отпечаток — файл не качается', async () => {
    const github = fakeGitHub({ [REPO]: { files: FILES } })
    expect(await read(github, await blobSha(FILE.content))).toEqual({ kind: 'same' })
    expect(github.paths.some((path) => path.includes('/git/blobs/'))).toBe(false)
  })

  it('нет summary.json — «срез не отдаёт», не ошибка (Я-16)', async () => {
    const result = await read(fakeGitHub({ [REPO]: { files: { 'meta.json': '{}' } } }))
    expect(result).toEqual({ kind: 'none', text: NOT_GIVEN })
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

  it('право записи у аккаунта — не повод для тревоги: права токена GitHub не сообщает (Р-12)', async () => {
    const result = await read(fakeGitHub({ [REPO]: { push: true, files: FILES } }))
    expect(result.kind).toBe('new')
    expect(result).not.toHaveProperty('canWrite')
  })

  it('кривое имя репозитория — без запросов', async () => {
    const github = fakeGitHub({})
    const result = await read(github, null, 'не репозиторий')
    expect(result.kind === 'failed' && result.failure).toBe('badRepo')
    expect(github.paths).toEqual([])
  })

  it('без withApp meta.json не качается — так читает бот', async () => {
    const github = fakeGitHub({ [REPO]: { files: FILES } })
    const result = await read(github)
    expect(result).not.toHaveProperty('dbName')
    expect(github.paths.filter((path) => path.includes('/git/blobs/'))).toHaveLength(1)
  })

  it('токен — только в заголовке Authorization', async () => {
    const github = fakeGitHub({ [REPO]: { files: FILES } })
    await read(github)
    expect(github.auth.every((value) => value === `Bearer ${TOKEN}`)).toBe(true)
    expect(github.paths.some((path) => path.includes(TOKEN))).toBe(false)
  })
})

describe('dbName приложения из meta.json (Р-34)', () => {
  function named(github: ReturnType<typeof fakeGitHub>, lastSha: string | null = null) {
    return readSummary({ dataRepo: REPO, token: TOKEN, lastSha, withApp: true, fetch: github.fetch })
  }

  it('тем же проходом: поле app, ещё один blob — meta.json', async () => {
    const github = fakeGitHub({ [REPO]: { files: FILES } })
    const result = await named(github)
    expect(result).toEqual({ kind: 'new', sha: await blobSha(FILE.content), summary: SUMMARY, dbName: 'polka' })
    expect(github.paths.filter((path) => path.includes('/git/blobs/')).sort()).toEqual(
      [`${REPO}/git/blobs/${await blobSha(FILE.content)}`, `${REPO}/git/blobs/${await blobSha(FILES['meta.json'])}`].sort(),
    )
  })

  it('тот же срез — dbName всё равно узнаётся', async () => {
    const result = await named(fakeGitHub({ [REPO]: { files: FILES } }), await blobSha(FILE.content))
    expect(result).toEqual({ kind: 'same', dbName: 'polka' })
  })

  it('срез не отдаёт, а meta.json есть — dbName есть', async () => {
    const result = await named(fakeGitHub({ [REPO]: { files: { 'meta.json': '{"app":"polka"}' } } }))
    expect(result).toEqual({ kind: 'none', text: NOT_GIVEN, dbName: 'polka' })
  })

  it('нет meta.json, нет поля app или файл кривой — null, срез читается как был', async () => {
    const without = await named(fakeGitHub({ [REPO]: { files: { [FILE.path]: FILE.content } } }))
    expect(without).toMatchObject({ kind: 'new', dbName: null })
    const noApp = await named(fakeGitHub({ [REPO]: { files: { ...FILES, 'meta.json': '{"schemaVersion":1}' } } }))
    expect(noApp).toMatchObject({ kind: 'new', dbName: null })
    const crooked = await named(fakeGitHub({ [REPO]: { files: { ...FILES, 'meta.json': 'не JSON' } } }))
    expect(crooked).toMatchObject({ kind: 'new', dbName: null })
    expect(await named(fakeGitHub({ [REPO]: { files: null } }))).toEqual({ kind: 'none', text: NOT_GIVEN, dbName: null })
  })

  it('из meta.json берётся только строка app', () => {
    expect(appOf('{"app":" polka ","schemaVersion":1}')).toBe('polka')
    expect(appOf('{"app":7}')).toBeNull()
    expect(appOf('{"app":""}')).toBeNull()
    expect(appOf('null')).toBeNull()
    expect(appOf('[]')).toBeNull()
  })
})
