import { describe, expect, it } from 'vitest'
import { anyCopied, COPY_FORMAT, copyFamily, copyFileName, copyLine, type AppCopy } from './copy.ts'
import { fakeGitHub } from './fakeGitHub.ts'
import { failureText } from './read.ts'

/** Выдуманные: приложения, репозитории, файлы, токен (Р-01). */
const TOKEN = 'fake-family-token'
const DAY = '2026-10-21'
const SHELF = { name: 'Полка', dataRepo: 'someone/shelf-data' }
const POND = { name: 'Пруд', dataRepo: 'someone/pond-data' }
const SHELF_FILES = {
  'meta.json': '{"app":"polka","schemaVersion":1}\n',
  'summary.json': '{"format":1}\n',
  'books/2026-09.json': '[{"title":"Выдуманная книга"}]\n',
}
const POND_FILES = { 'meta.json': '{"app":"prud"}\n', 'fish.json': '[]\n' }

function copy(github: ReturnType<typeof fakeGitHub>, apps = [SHELF, POND]) {
  return copyFamily({ apps, token: TOKEN, day: DAY, fetch: github.fetch })
}

describe('копия всей семьи (Р-36)', () => {
  it('все прочитались: у каждого имя, репозиторий, коммит и все файлы текстом как есть', async () => {
    const github = fakeGitHub({ [SHELF.dataRepo]: { files: SHELF_FILES }, [POND.dataRepo]: { files: POND_FILES } })
    const result = await copy(github)
    expect(result.format).toBe(COPY_FORMAT)
    expect(result.takenOn).toBe(DAY)
    expect(result.apps).toEqual([
      { ...SHELF, commit: expect.any(String), files: Object.entries(SHELF_FILES).map(([path, text]) => ({ path, text })) },
      { ...POND, commit: expect.any(String), files: Object.entries(POND_FILES).map(([path, text]) => ({ path, text })) },
    ])
    expect(anyCopied(result)).toBe(true)
    expect(result.apps.map(copyLine)).toEqual(['в копии: 3 файла', 'в копии: 2 файла'])
  })

  it('один не прочитался: остальные в копии, у него — причина словами чтения среза', async () => {
    const github = fakeGitHub({ [SHELF.dataRepo]: { files: SHELF_FILES } })
    const result = await copy(github)
    const text = failureText('noAccess', POND.dataRepo)
    expect(result.apps[0]).toMatchObject({ ...SHELF, files: expect.any(Array) })
    expect(result.apps[1]).toEqual({ ...POND, failed: text })
    expect(anyCopied(result)).toBe(true)
    expect(copyLine(result.apps[1] as AppCopy)).toBe(`не прочитано: ${text}`)
  })

  it('лимит и права — свои причины, как у среза', async () => {
    const github = fakeGitHub({
      [SHELF.dataRepo]: { filesStatus: 403, limited: true, files: SHELF_FILES },
      [POND.dataRepo]: { filesStatus: 403, files: POND_FILES },
    })
    const result = await copy(github)
    expect(result.apps).toEqual([
      { ...SHELF, failed: failureText('limit', SHELF.dataRepo) },
      { ...POND, failed: failureText('noRights', POND.dataRepo) },
    ])
  })

  it('ни один не прочитался — копировать нечего, у каждого причина', async () => {
    const result = await copy(fakeGitHub({}, { offline: true }))
    expect(result.apps).toEqual([
      { ...SHELF, failed: 'нет связи' },
      { ...POND, failed: 'нет связи' },
    ])
    expect(anyCopied(result)).toBe(false)
  })

  it('кривое имя репозитория — причина без запросов', async () => {
    const github = fakeGitHub({})
    const result = await copy(github, [{ name: 'Полка', dataRepo: 'не репозиторий' }])
    expect(result.apps).toEqual([{ name: 'Полка', dataRepo: 'не репозиторий', failed: failureText('badRepo', 'не репозиторий') }])
    expect(github.paths).toEqual([])
  })

  it('пустой репозиторий — в копии, без коммита и без файлов', async () => {
    const result = await copy(fakeGitHub({ [SHELF.dataRepo]: { files: null } }), [SHELF])
    expect(result.apps).toEqual([{ ...SHELF, commit: null, files: [] }])
    expect(copyLine(result.apps[0] as AppCopy)).toBe('в копии: 0 файлов')
  })

  it('только чтение: ни одного запроса, кроме GET', async () => {
    const methods: string[] = []
    const github = fakeGitHub({ [SHELF.dataRepo]: { files: SHELF_FILES } })
    await copyFamily({
      apps: [SHELF],
      token: TOKEN,
      day: DAY,
      fetch: (input, init) => {
        methods.push(init?.method ?? 'GET')
        return github.fetch(input, init)
      },
    })
    expect(methods.length).toBeGreaterThan(0)
    expect(methods.every((method) => method === 'GET')).toBe(true)
  })

  it('токена в файле нет; в запросах — только в заголовке Authorization', async () => {
    const github = fakeGitHub({ [SHELF.dataRepo]: { files: SHELF_FILES }, [POND.dataRepo]: { status: 401 } })
    const result = await copy(github)
    expect(JSON.stringify(result)).not.toContain(TOKEN)
    expect(github.auth.every((value) => value === `Bearer ${TOKEN}`)).toBe(true)
    expect(github.paths.some((path) => path.includes(TOKEN))).toBe(false)
  })

  it('имя файла — family-ГГГГ-ММ-ДД.json; строка — с числом словами', () => {
    expect(copyFileName(DAY)).toBe('family-2026-10-21.json')
    const one: AppCopy = { ...SHELF, commit: 'c', files: [{ path: 'a.json', text: '' }] }
    expect(copyLine(one)).toBe('в копии: 1 файл')
  })
})
