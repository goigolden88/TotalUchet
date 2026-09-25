import { describe, expect, it } from 'vitest'
import type { App } from '../app/model.ts'
import { DEFAULT_TITLE } from '../ui/title.ts'
import { botList, listText, parseBotList } from './list.ts'

/** Выдуманные приложения (Р-01). */
const SHELF: App = { id: 'A1', updatedAt: '2026-09-20T08:00:00.000Z', name: 'Полка', dataRepo: 'someone/shelf-data', site: 'https://example.org/shelf/', order: 2 }
const POND: App = { id: 'A2', updatedAt: '2026-09-20T08:00:00.000Z', name: 'Пруд', dataRepo: 'someone/pond-data', site: 'https://example.org/pond/', order: 1 }
const GONE: App = { ...SHELF, id: 'A3', name: 'Старое', deleted: true }

describe('список для бота (Р-28)', () => {
  it('живые приложения в порядке человека, своё название, адрес «Сводки» без хвоста экрана', () => {
    const list = botList([SHELF, POND, GONE], 'Мой учёт', 'https://example.org/meta/#/settings')
    expect(list.apps.map((app) => app.name)).toEqual(['Пруд', 'Полка'])
    expect(list.title).toBe('Мой учёт')
    expect(list.summaryUrl).toBe('https://example.org/meta/')
  })

  it('своего названия нет — имя по умолчанию', () => {
    expect(botList([], '', 'https://example.org/meta/').title).toBe(DEFAULT_TITLE)
  })

  it('туда и обратно — то же', () => {
    const list = botList([SHELF, POND], 'Мой учёт', 'https://example.org/meta/')
    expect(parseBotList(listText(list))).toEqual({ ok: true, list })
  })

  it('в файле — ни токена, ни архива, ни связок', () => {
    const text = listText(botList([SHELF], '', 'https://example.org/meta/'))
    expect(Object.keys(JSON.parse(text))).toEqual(['kind', 'version', 'title', 'summaryUrl', 'apps'])
  })
})

describe('разбор списка — что не так, словами', () => {
  const good = botList([SHELF], '', 'https://example.org/meta/')

  it('не JSON, чужой JSON, другая версия', () => {
    expect(parseBotList('{')).toEqual({ ok: false, problem: 'файл — не JSON' })
    expect(parseBotList('{"apps":[]}')).toMatchObject({ ok: false, problem: expect.stringContaining('это не список для бота') })
    expect(parseBotList(JSON.stringify({ ...good, version: 2 }))).toMatchObject({ ok: false, problem: expect.stringContaining('форма списка 2') })
  })

  it('приложение с кривым репозиторием — проверкой «Семьи», с номером', () => {
    const bad = { ...good, apps: [{ ...SHELF, dataRepo: 'без-слеша' }] }
    expect(parseBotList(JSON.stringify(bad))).toMatchObject({ ok: false, problem: expect.stringMatching(/^приложение 1: /) })
  })

  it('без id и без адреса «Сводки» — не принимается', () => {
    expect(parseBotList(JSON.stringify({ ...good, apps: [{ ...SHELF, id: '' }] }))).toEqual({ ok: false, problem: 'приложение 1: нет id' })
    expect(parseBotList(JSON.stringify({ ...good, summaryUrl: 'ftp://x' }))).toEqual({ ok: false, problem: 'нет адреса «Сводки»' })
  })
})
