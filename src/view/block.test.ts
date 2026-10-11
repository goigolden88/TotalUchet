import { describe, expect, it } from 'vitest'
import { buildSummary, type Metric, type NameList, type Summary } from '../shared/core/summary.ts'
import { shelfSummary, type Session } from '../shared/testing/shelf.ts'
import { appBlock, SERIES_KEY_PARTS } from './block.ts'
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
      rows: [{ key: 'reading', label: expect.any(String), value: { text: '25 мин', muted: false }, basis: expect.any(String), bar: null }],
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

describe('полосы у строк серии (Р-35)', () => {
  /** Срез «Полки» с выдуманными строками прошлой недели в форме ключей «Делу Время» (Р-01). */
  function withRows(metrics: Metric[]): Summary {
    return { ...SUMMARY, periods: SUMMARY.periods.map((period) => ({ ...period, metrics })) }
  }
  const minutes = (key: string, n: number): Metric => ({ key, label: key, value: { n, unit: 'minutes' }, basis: 'по записям' })
  const count = (key: string, n: number): Metric => ({ key, label: key, value: { n, unit: 'count' }, basis: 'по плану' })
  const unknown = (key: string): Metric => ({ key, label: key, value: { unknown: 'no-data', text: 'записей нет' }, basis: 'нет записей' })
  const rows = (metrics: Metric[]) => {
    const body = appBlock(withRows(metrics), screenPeriod('lastWeek', DAY)).body
    return body.kind === 'rows' ? body.rows : []
  }
  const bars = (metrics: Metric[]) => rows(metrics).map((row) => row.bar)

  it('наибольшая — во всю длину, остальные — в том же масштабе; порядок, числа и основания хозяина', () => {
    const result = rows([minutes('time.group.beta', 30), minutes('time.group.alpha', 120), minutes('time.group.gamma', 60)])
    expect(result.map((row) => row.key)).toEqual(['time.group.beta', 'time.group.alpha', 'time.group.gamma'])
    expect(result.map((row) => row.bar)).toEqual([0.25, 1, 0.5])
    expect(result.map((row) => row.value.text)).toEqual(['30 мин', '2 ч', '1 ч'])
    expect(result.map((row) => row.basis)).toEqual(['по записям', 'по записям', 'по записям'])
  })

  it('«Всего», «Без группы» и строки плана — без полос; строки групп между ними — одна серия', () => {
    const result = bars([
      minutes('time.total', 600),
      minutes('time.group.alpha', 200),
      minutes('time.ungrouped', 300),
      minutes('time.group.beta', 100),
      count('plan.planned', 8),
      count('plan.done', 4),
      count('plan.late', 1),
    ])
    expect(SERIES_KEY_PARTS).toBe(3)
    expect(result).toEqual([null, 1, null, 0.5, null, null, null])
  })

  it('у каждой серии свой масштаб: `time.background.*` — отдельно от групп', () => {
    expect(
      bars([minutes('time.group.alpha', 40), minutes('time.group.beta', 20), minutes('time.background.music', 10), minutes('time.background.radio', 5)]),
    ).toEqual([1, 0.5, 1, 0.5])
  })

  it('одна строка с таким ключом — не серия', () => {
    expect(bars([minutes('time.group.alpha', 40), minutes('time.background.music', 10), minutes('time.total', 50)])).toEqual([null, null, null])
  })

  it('разные единицы под одним началом — не серия', () => {
    expect(bars([minutes('pond.walk.morning', 90), count('pond.walk.evening', 3)])).toEqual([null, null])
  })

  it('ноль — без полосы, строка на месте; «не известно» — без полосы и не в масштабе', () => {
    const result = rows([minutes('time.group.alpha', 0), unknown('time.group.beta'), minutes('time.group.gamma', 50), minutes('time.group.delta', 25)])
    expect(result.map((row) => row.key)).toEqual(['time.group.alpha', 'time.group.beta', 'time.group.gamma', 'time.group.delta'])
    expect(result.map((row) => row.bar)).toEqual([null, null, 1, 0.5])
    expect(result[1]?.value.text).toBe('не известно — записей нет')
  })

  it('в серии все нули и «не известно» — полос нет', () => {
    expect(bars([minutes('time.group.alpha', 0), unknown('time.group.beta'), minutes('time.group.gamma', 0)])).toEqual([null, null, null])
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
