import { describe, expect, it } from 'vitest'
import { buildSummary, type Summary } from '../shared/core/summary.ts'
import { shelfSummary } from '../shared/testing/shelf.ts'
import type { App } from '../app/model.ts'
import { calls } from './attention.ts'

const AT = '2026-09-24T10:00:00.000Z'

/** Выдуманные приложения (Р-01). */
function app(id: string, order: number, name = `Приложение ${id}`): App {
  return { id, updatedAt: AT, name, dataRepo: `someone/${id}-data`, site: `https://example.org/${id}/`, order }
}

const withBooks: Summary = buildSummary(
  shelfSummary({ sessions: [], books: [{ id: 'b', updatedAt: AT, title: 'Книга', addedOn: null }] }, '2026-09-24'),
  {},
  '2026-09-24',
)

const quiet: Summary = { ...withBooks, attention: [] }

describe('«Зовут» (Р-06)', () => {
  it('пункты — по приложениям в их порядке, со счётом, днём, основанием и ссылкой', () => {
    const result = calls([app('b', 2), app('a', 1)], new Map([['a', withBooks], ['b', withBooks]]))
    expect(result.anySeen).toBe(true)
    expect(result.groups.map((group) => group.app.id)).toEqual(['a', 'b'])
    expect(result.groups[0]?.items).toEqual([
      {
        key: 'undated-books',
        label: 'Книги без даты',
        count: '1',
        day: 'за 24.09',
        basis: 'по датам добавления всех книг',
        href: 'https://example.org/a/#/books',
      },
    ])
  })

  it('count null — без счёта', () => {
    const attention = withBooks.attention.map((one) => ({ ...one, count: null }))
    const result = calls([app('a', 1)], new Map([['a', { ...withBooks, attention }]]))
    expect(result.groups[0]?.items[0]?.count).toBe('')
  })

  it('пусто — не зовут, но срез увиден; нет срезов — сказать нечего (Я-21)', () => {
    expect(calls([app('a', 1)], new Map([['a', quiet]]))).toEqual({ groups: [], anySeen: true })
    expect(calls([app('a', 1)], new Map())).toEqual({ groups: [], anySeen: false })
  })

  it('убранное приложение не зовёт', () => {
    const gone = { ...app('a', 1), deleted: true }
    expect(calls([gone], new Map([['a', withBooks]]))).toEqual({ groups: [], anySeen: false })
  })
})
