import { describe, expect, it } from 'vitest'
import { buildSummary, type NameList, type Summary } from '../shared/core/summary.ts'
import { shelfSummary, type Session } from '../shared/testing/shelf.ts'
import { appBlock } from './block.ts'
import { CHOICES, screenPeriod } from './periods.ts'

/** Выдуманный срез «Полки» ядра (Р-01). 24.09.2026 — четверг. */
const DAY = '2026-09-24'
const SESSIONS: Session[] = [
  { id: 's1', updatedAt: '2026-09-17T08:00:00.000Z', date: '2026-09-16', bookId: 'b', minutes: 40 },
  { id: 's2', updatedAt: '2026-09-23T08:00:00.000Z', date: '2026-09-22', bookId: 'b', minutes: 25 },
]
const DATA = { sessions: SESSIONS, books: [] }
const SUMMARY = buildSummary(shelfSummary(DATA, DAY), DATA, DAY)

describe('блок приложения — одна сборка на «Сводку» и бота (Р-26)', () => {
  it('строки хозяина со значением словами и основанием; идущий отрезок — «идёт, по»', () => {
    const block = appBlock(SUMMARY, screenPeriod('thisWeek', DAY))
    expect(block.freshness).toBe('посчитано 24.09 · по записям по 23.09')
    expect(block.body).toEqual({
      kind: 'rows',
      going: 'идёт, по 24.09',
      rows: [{ key: 'reading', label: expect.any(String), value: { text: '25 мин', muted: false }, basis: expect.any(String) }],
    })
  })

  it('закончившийся отрезок — без «идёт» (Я-21)', () => {
    const block = appBlock(SUMMARY, screenPeriod('lastWeek', DAY))
    expect(block.body.kind === 'rows' && block.body.going).toBe('')
  })

  it('отрезка нет в срезе — одна строка', () => {
    const block = appBlock(SUMMARY, screenPeriod('thisWeek', '2026-10-05'))
    expect(block.body).toEqual({ kind: 'missing', text: 'не известно: срез посчитан 24.09, этой недели в нём нет' })
  })

  it('отрезок «не известно» целиком — словами хозяина', () => {
    const odd: Summary = {
      ...SUMMARY,
      periods: SUMMARY.periods.map((period) =>
        period.grain === 'month' ? { ...period, metrics: { unknown: 'not-provided', text: 'месяцы не считаются' } } : period,
      ),
    }
    expect(appBlock(odd, screenPeriod('thisMonth', DAY)).body).toEqual({
      kind: 'unknown',
      going: 'идёт, по 24.09',
      text: 'не известно — месяцы не считаются',
    })
  })
})

describe('списки названий в блоке (Я-43, Р-31)', () => {
  /** Выдуманные списки выдуманной «Полки» (Р-01): порядок хозяина — не алфавитный. */
  const LISTS: NameList[] = [
    { key: 'shelf.reading', label: 'Читаю', names: ['Яблоко', 'Борода'], link: '/reading', basis: '2 книги со статусом «читаю»' },
    { key: 'shelf.next', label: 'Что почитать', names: [], link: '/next', basis: 'в «прочитать» пусто' },
  ]
  const WITH_LISTS: Summary = { ...SUMMARY, lists: LISTS }

  it('нет раздела — списков нет, блок как прежде', () => {
    expect(SUMMARY.lists).toBeUndefined()
    expect(appBlock(SUMMARY, screenPeriod('thisWeek', DAY)).lists).toEqual([])
  })

  it('на всех отрезках — как есть, в порядке хозяина; пустой список — подпись и основание', () => {
    for (const choice of CHOICES) {
      expect(appBlock(WITH_LISTS, screenPeriod(choice.id, DAY)).lists).toEqual(LISTS)
    }
  })

  it('отрезка нет в срезе — списки на месте', () => {
    const block = appBlock(WITH_LISTS, screenPeriod('thisWeek', '2026-10-05'))
    expect(block.body.kind).toBe('missing')
    expect(block.lists).toEqual(LISTS)
  })

  it('отрезок «не известно» целиком — списки на месте', () => {
    const odd: Summary = {
      ...WITH_LISTS,
      periods: WITH_LISTS.periods.map((period) => ({ ...period, metrics: { unknown: 'not-provided', text: 'не считается' } })),
    }
    const block = appBlock(odd, screenPeriod('lastMonth', DAY))
    expect(block.body.kind).toBe('unknown')
    expect(block.lists).toEqual(LISTS)
  })
})
