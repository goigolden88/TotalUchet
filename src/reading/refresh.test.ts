import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../app/core.ts'
import { seenId } from '../app/model.ts'
import { buildSummary, summaryFile } from '../shared/core/summary.ts'
import { shelfSummary } from '../shared/testing/shelf.ts'
import { fakeGitHub } from './fakeGitHub.ts'
import { refreshApp, stateLine } from './refresh.ts'
import { lastSeen, remember } from './seen.ts'

/** Выдуманные приложение, репозиторий и срезы (Р-01). */
const APP = { id: '01JAPP0000000000000000000A', dataRepo: 'someone/shelf-data' }
const TOKEN = 'fake-read-token'

function fileOn(day: string) {
  return summaryFile(buildSummary(shelfSummary({ sessions: [], books: [] }, day), {}, day))
}

function repoWith(day: string) {
  const file = fileOn(day)
  return { [APP.dataRepo]: { files: { [file.path]: file.content } } }
}

let clock = 0
const now = () => new Date(Date.UTC(2026, 8, 24, 10, clock++)).toISOString()

beforeEach(async () => {
  await db.close().catch(() => {})
  globalThis.indexedDB = new IDBFactory()
  clock = 0
})

afterEach(async () => {
  await db.close().catch(() => {})
})

describe('обновление приложения — чтение и архив (Р-05, Р-08)', () => {
  it('новый срез ложится в архив с id из приложения и дня расчёта', async () => {
    const state = await refreshApp(APP, TOKEN, { fetch: fakeGitHub(repoWith('2026-09-24')).fetch, now })
    expect(state.status).toBe('fresh')
    expect(state.seen?.id).toBe(seenId(APP.id, '2026-09-24'))
    expect(await db.count('seen')).toBe(1)
    expect(stateLine(state)).toBe('')
  })

  it('тот же срез второй раз — та же запись, новый readAt (Р-11)', async () => {
    const github = fakeGitHub(repoWith('2026-09-24'))
    const first = await refreshApp(APP, TOKEN, { fetch: github.fetch, now })
    const second = await refreshApp(APP, TOKEN, { fetch: github.fetch, now })
    expect(await db.count('seen')).toBe(1)
    expect(second.seen?.readAt).not.toBe(first.seen?.readAt)
    expect(github.paths.filter((path) => path.includes('/git/blobs/'))).toHaveLength(1)
  })

  it('срез нового дня — вторая запись; последний — с наибольшим днём расчёта', async () => {
    await refreshApp(APP, TOKEN, { fetch: fakeGitHub(repoWith('2026-09-23')).fetch, now })
    await refreshApp(APP, TOKEN, { fetch: fakeGitHub(repoWith('2026-09-24')).fetch, now })
    expect(await db.count('seen')).toBe(2)
    expect((await lastSeen(APP.id))?.computedOn).toBe('2026-09-24')
  })

  it('без сети — последний увиденный с датой прочтения', async () => {
    await remember(APP.id, 'old', buildSummary(shelfSummary({ sessions: [], books: [] }, '2026-09-22'), {}, '2026-09-22'), '2026-09-22T09:05:00.000Z')
    const state = await refreshApp(APP, TOKEN, { fetch: fakeGitHub({}, { offline: true }).fetch, now })
    expect(state.status).toBe('offline')
    expect(state.seen?.computedOn).toBe('2026-09-22')
    expect(stateLine(state)).toMatch(/^прочитан 22\.09.*, сейчас нет связи$/)
  })

  it('без сети и без архива — так и сказано', async () => {
    const state = await refreshApp(APP, TOKEN, { fetch: fakeGitHub({}, { offline: true }).fetch, now })
    expect(stateLine(state)).toBe('нет связи, срез ещё не читали')
  })

  it('кривой срез — слова ядра, ниже — последний увиденный', async () => {
    await refreshApp(APP, TOKEN, { fetch: fakeGitHub(repoWith('2026-09-23')).fetch, now })
    const broken = { [APP.dataRepo]: { files: { 'summary.json': '{"format":1}' } } }
    const state = await refreshApp(APP, TOKEN, { fetch: fakeGitHub(broken).fetch, now })
    expect(state.status).toBe('broken')
    expect(state.seen?.computedOn).toBe('2026-09-23')
    expect(stateLine(state)).toContain('; ниже — срез, прочитан')
  })

  it('нет доступа — ошибка приложения, архив не трогается', async () => {
    const state = await refreshApp(APP, TOKEN, { fetch: fakeGitHub({}).fetch, now })
    expect(state.status).toBe('noAccess')
    expect(await db.count('seen')).toBe(0)
  })
})
