import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { family } from '../shared/core/db.ts'
import { repoNames, repoStatus, repoStatusText, sameRepo, shareRepos } from './repos.ts'

/** Выдуманные приложения, `dbName` и репозитории (Р-01). */
const OWN = 'meta'
const SHELF = { id: '01JAPP0000000000000000000A', dataRepo: 'someone/shelf-data' }
const GARDEN = { id: '01JAPP0000000000000000000B', dataRepo: 'someone/garden-data' }
const NOTES = { id: '01JAPP0000000000000000000C', dataRepo: 'someone/notes-data' }

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

describe('что раздать (Р-34)', () => {
  it('по узнанным dbName; неузнанные, без meta.json и своё — мимо', () => {
    const names = repoNames(
      [SHELF, GARDEN, NOTES, { id: 'own', dataRepo: 'someone/meta-data' }],
      new Map([
        [SHELF.id, 'polka'],
        [GARDEN.id, null],
        ['own', OWN],
      ]),
      OWN,
    )
    expect(names).toEqual({ polka: SHELF.dataRepo })
  })

  it('два приложения с одним dbName — первое по порядку', () => {
    const names = repoNames([SHELF, GARDEN], new Map([[SHELF.id, 'polka'], [GARDEN.id, 'polka']]), OWN)
    expect(names).toEqual({ polka: SHELF.dataRepo })
  })
})

describe('имена — в пустые места общей базы (Р-34, Я-37)', () => {
  it('новое устройство: пусто у всех — вписываются все узнанные', async () => {
    const dbNames = new Map([
      [SHELF.id, 'polka'],
      [GARDEN.id, 'sad'],
    ])
    expect((await shareRepos([SHELF, GARDEN], dbNames, OWN)).sort()).toEqual(['polka', 'sad'])
    expect((await family.read()).repos).toEqual({ polka: SHELF.dataRepo, sad: GARDEN.dataRepo })
  })

  it('уже вписанное не меняется', async () => {
    await family.setRepo('polka', 'someone/other-shelf')
    const written = await shareRepos([SHELF, GARDEN], new Map([[SHELF.id, 'polka'], [GARDEN.id, 'sad']]), OWN)
    expect(written).toEqual(['sad'])
    expect((await family.read()).repos.polka).toBe('someone/other-shelf')
  })

  it('своё место не трогается, даже пустое', async () => {
    await shareRepos([{ id: 'own', dataRepo: 'someone/meta-data' }], new Map([['own', OWN]]), OWN)
    expect((await family.read()).repos).toEqual({})
  })

  it('«Записать имя из списка» — занятое переписывается действием человека', async () => {
    await family.setRepo('polka', 'someone/other-shelf')
    await family.setRepo('polka', SHELF.dataRepo)
    expect((await family.read()).repos.polka).toBe(SHELF.dataRepo)
  })
})

describe('сверка в «Семье» (Р-34)', () => {
  const repos = { polka: SHELF.dataRepo, sad: 'someone/old-garden' }

  it('совпадает, пусто, другое — словами', () => {
    expect(repoStatusText(repoStatus('polka', SHELF.dataRepo, repos, OWN), 'Мета')).toBe('имя на устройстве: совпадает')
    expect(repoStatusText(repoStatus('zametki', NOTES.dataRepo, repos, OWN), 'Мета')).toBe(
      'имя на устройстве: пусто — впишется при чтении',
    )
    const other = repoStatus('sad', GARDEN.dataRepo, repos, OWN)
    expect(other).toEqual({ kind: 'other', repo: 'someone/old-garden' })
    expect(repoStatusText(other, 'Мета')).toBe('имя на устройстве другое: someone/old-garden')
  })

  it('без meta.json — «не знаю, какое это приложение»; не читали — строки нет', () => {
    expect(repoStatusText(repoStatus(null, SHELF.dataRepo, repos, OWN), 'Мета')).toContain('не знаю, какое это приложение')
    expect(repoStatusText(repoStatus(undefined, SHELF.dataRepo, repos, OWN), 'Мета')).toBe('')
  })

  it('своё место — не сверяется, отсылает к «Синхронизации» со своим названием', () => {
    expect(repoStatus(OWN, 'someone/meta-data', repos, OWN)).toEqual({ kind: 'own' })
    expect(repoStatusText({ kind: 'own' }, 'Мета')).toContain('«Мета»')
  })

  it('регистр и ссылка вместо «владелец/имя» — то же имя', () => {
    expect(sameRepo('Someone/Shelf-Data', 'someone/shelf-data')).toBe(true)
    expect(sameRepo('https://github.com/someone/shelf-data', 'someone/shelf-data')).toBe(true)
    expect(sameRepo('someone/shelf-data', 'someone/garden-data')).toBe(false)
  })
})
