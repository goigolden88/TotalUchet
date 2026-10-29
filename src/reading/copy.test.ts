import { describe, expect, it } from 'vitest'
import {
  anyCopied,
  COPY_FORMAT,
  copyFamily,
  copyFileName,
  copyLine,
  OWN_NOT_SET,
  OWN_UNKNOWN,
  ownRepo,
  type AppCopy,
  type OwnRepo,
} from './copy.ts'
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

/** Свой репозиторий в тестах до своего раздела — уже в «Семье»: второй раз не входит. */
const LISTED: OwnRepo = { name: 'Учёт', dataRepo: SHELF.dataRepo }

function copy(github: ReturnType<typeof fakeGitHub>, apps = [SHELF, POND], own: OwnRepo = LISTED) {
  return copyFamily({ apps, own, token: TOKEN, day: DAY, fetch: github.fetch })
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
    const result = await copy(github, [{ name: 'Полка', dataRepo: 'не репозиторий' }], { name: 'Учёт', failed: OWN_NOT_SET })
    expect(result.apps).toEqual([
      { name: 'Полка', dataRepo: 'не репозиторий', failed: failureText('badRepo', 'не репозиторий') },
      { name: 'Учёт', dataRepo: '', failed: OWN_NOT_SET },
    ])
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
      own: LISTED,
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

describe('свой репозиторий данных в копии (Р-37)', () => {
  const OWN = { name: 'Учёт', dataRepo: 'someone/uchet-data' }
  const OWN_FILES = { 'apps.json': '[{"name":"Полка"}]\n', 'seen.json': '[]\n' }

  it('не в «Семье» — последним, с теми же полями, что у остальных', async () => {
    const github = fakeGitHub({ [SHELF.dataRepo]: { files: SHELF_FILES }, [OWN.dataRepo]: { files: OWN_FILES } })
    const result = await copy(github, [SHELF], OWN)
    expect(result.apps.map((app) => app.name)).toEqual([SHELF.name, OWN.name])
    expect(result.apps[1]).toEqual({
      ...OWN,
      commit: expect.any(String),
      files: Object.entries(OWN_FILES).map(([path, text]) => ({ path, text })),
    })
  })

  it('уже в «Семье» — один раз, под именем из списка; регистр и ссылка — тот же репозиторий', async () => {
    const github = fakeGitHub({ [SHELF.dataRepo]: { files: SHELF_FILES } })
    const result = await copy(github, [SHELF], { name: 'Учёт', dataRepo: 'https://github.com/Someone/Shelf-Data' })
    expect(result.apps.map((app) => app.name)).toEqual([SHELF.name])
  })

  it('не прочитался — в файле с причиной словами чтения, остальные целы', async () => {
    const github = fakeGitHub({ [SHELF.dataRepo]: { files: SHELF_FILES } })
    const result = await copy(github, [SHELF], OWN)
    expect(result.apps[0]).toMatchObject({ ...SHELF, files: expect.any(Array) })
    expect(result.apps[1]).toEqual({ ...OWN, failed: failureText('noAccess', OWN.dataRepo) })
    expect(anyCopied(result)).toBe(true)
  })

  it('не вписан — в файле с причиной и пустым репозиторием, без запросов за ним', async () => {
    const github = fakeGitHub({ [SHELF.dataRepo]: { files: SHELF_FILES } })
    const result = await copy(github, [SHELF], ownRepo('Учёт', {}, 'uchet'))
    expect(result.apps[1]).toEqual({ name: 'Учёт', dataRepo: '', failed: OWN_NOT_SET })
    expect(copyLine(result.apps[1] as AppCopy)).toBe(`не прочитано: ${OWN_NOT_SET}`)
    expect(github.paths.every((path) => path.includes(SHELF.dataRepo))).toBe(true)
  })

  it('имя — из общей базы по своему dbName; пустое — не вписано; база не открылась — своя причина', () => {
    expect(ownRepo('Учёт', { uchet: ' someone/uchet-data ', polka: SHELF.dataRepo }, 'uchet')).toEqual(OWN)
    expect(ownRepo('Учёт', { polka: SHELF.dataRepo }, 'uchet')).toEqual({ name: 'Учёт', failed: OWN_NOT_SET })
    expect(ownRepo('Учёт', { uchet: '  ' }, 'uchet')).toEqual({ name: 'Учёт', failed: OWN_NOT_SET })
    expect(ownRepo('Учёт', null, 'uchet')).toEqual({ name: 'Учёт', failed: OWN_UNKNOWN })
  })

  it('«Семья» пуста — в копии только свой репозиторий, файл есть что скачать', async () => {
    const github = fakeGitHub({ [OWN.dataRepo]: { files: OWN_FILES } })
    const result = await copy(github, [], OWN)
    expect(result.apps).toEqual([
      { ...OWN, commit: expect.any(String), files: Object.entries(OWN_FILES).map(([path, text]) => ({ path, text })) },
    ])
    expect(anyCopied(result)).toBe(true)
  })

  it('«Семья» пуста и свой не вписан — в копии одна причина, скачивать нечего', async () => {
    const github = fakeGitHub({})
    const result = await copy(github, [], ownRepo('Учёт', {}, 'uchet'))
    expect(result.apps).toEqual([{ name: 'Учёт', dataRepo: '', failed: OWN_NOT_SET }])
    expect(anyCopied(result)).toBe(false)
    expect(github.paths).toEqual([])
  })

  it('токена в файле нет и у своего', async () => {
    const github = fakeGitHub({ [OWN.dataRepo]: { files: OWN_FILES } })
    const result = await copy(github, [], OWN)
    expect(result.apps).toHaveLength(1)
    expect(JSON.stringify(result)).not.toContain(TOKEN)
  })
})
