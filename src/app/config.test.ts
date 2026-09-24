import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDb } from '../shared/core/db.ts'
import { createLayout } from '../shared/core/layout.ts'
import { checkConfig } from '../shared/core/model.ts'
import { buildSummary } from '../shared/core/summary.ts'
import { shelfSummary } from '../shared/testing/shelf.ts'
import { config } from './config.ts'
import { SCHEMA_VERSION, seenId, type App, type Seen } from './model.ts'

/**
 * Конфиг «Тотального Учёта» для ядра. Механику ядра проверяют его тесты;
 * здесь — своё и замороженное после первого релиза (Я-08, Я-09): имя базы,
 * хранилища, индексы, раскладка — ровно по 02-Архитектура.
 *
 * Срезы в тестах — выдуманные: из «Полки» ядра (Р-01).
 */

const db = createDb(config)
const layout = createLayout(config)

const AT = '2026-09-24T10:00:00.000Z'

beforeEach(async () => {
  await db.close().catch(() => {})
  globalThis.indexedDB = new IDBFactory()
})

afterEach(async () => {
  await db.close().catch(() => {})
})

function app(id: string, order: number): App {
  return { id, updatedAt: AT, name: `Приложение ${order}`, dataRepo: 'someone/shelf-data', site: 'https://example.org/shelf/', order }
}

function seen(appId: string, computedOn: string): Seen {
  return {
    id: seenId(appId, computedOn),
    updatedAt: AT,
    app: appId,
    computedOn,
    readAt: AT,
    sha: 'abc',
    summary: buildSummary(shelfSummary({ sessions: [], books: [] }, computedOn), {}, computedOn),
  }
}

describe('конфиг — по Архитектуре', () => {
  it('ядро принимает конфиг', () => {
    expect(() => checkConfig(config)).not.toThrow()
  })

  it('база — totaluchet, как в договоре семьи (Я-23)', () => {
    expect(config.dbName).toBe('totaluchet')
  })

  it('версия схемы 1, хранилища версии 1 — apps и seen', () => {
    expect(SCHEMA_VERSION).toBe(1)
    expect(config.schemaVersion).toBe(1)
    expect([...config.stores]).toEqual(['apps', 'seen'])
    expect([...config.v1Stores]).toEqual(['apps', 'seen'])
  })

  it('индекс — seen по app', () => {
    expect(config.indexes).toEqual({ apps: [], seen: ['app'] })
  })

  it('места — apps.json одним файлом, seen/ГГГГ-ММ.json по дню расчёта', () => {
    expect(config.places.apps).toEqual({ split: 'none', path: 'apps.json' })
    const place = config.places.seen
    expect(place.split).toBe('month')
    if (place.split === 'none') return
    expect(place.dir).toBe('seen')
    expect(place.dateOf(seen('a', '2026-09-21'))).toBe('2026-09-21')
    expect(layout.storeOf('apps.json')).toBe('apps')
    expect(layout.storeOf('seen/2026-09.json')).toBe('seen')
    expect(layout.storeOf('summary.json')).toBeNull()
  })

  it('своего среза нет, импорта нет — заглушки (Я-23)', () => {
    expect(config.summary).toBeUndefined()
    expect(config.importFormat).toBe('')
    expect(config.promptRules).toEqual([])
    expect(config.about.sources).toBe('')
  })
})

describe('id увиденного среза (Р-08)', () => {
  it('из приложения и дня расчёта, не ULID', () => {
    expect(seenId('01J00000000000000000000000', '2026-09-21')).toBe('01J00000000000000000000000:2026-09-21')
  })

  it('тот же срез, прочитанный дважды, — одна запись; последний увиденный ищется по индексу', async () => {
    await db.put('apps', app('a', 1))
    await db.put('seen', seen('a', '2026-09-20'))
    await db.put('seen', { ...seen('a', '2026-09-21'), readAt: '2026-09-21T08:00:00.000Z' })
    await db.put('seen', { ...seen('a', '2026-09-21'), readAt: '2026-09-22T08:00:00.000Z' })
    await db.put('seen', seen('b', '2026-09-22'))

    const ofA = await db.getByIndex('seen', 'app', 'a')
    expect(ofA.map((record) => record.id).sort()).toEqual(['a:2026-09-20', 'a:2026-09-21'])
    expect(ofA.find((record) => record.computedOn === '2026-09-21')?.readAt).toBe('2026-09-22T08:00:00.000Z')
  })
})
