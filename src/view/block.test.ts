import { describe, expect, it } from 'vitest'
import { buildSummary, type Metric, type NameList, type Summary } from '../shared/core/summary.ts'
import { shelfSummary, type Session } from '../shared/testing/shelf.ts'
import { appBlock, rowRuns } from './block.ts'
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
      rows: [
        { key: 'reading', label: expect.any(String), value: { text: '25 мин', muted: false }, basis: expect.any(String), series: null, bar: null },
      ],
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
  /** Срез «Полки» с выдуманными строками прошлой недели (Р-01). */
  function withRows(metrics: Metric[]): Summary {
    return { ...SUMMARY, periods: SUMMARY.periods.map((period) => ({ ...period, metrics })) }
  }
  const minutes = (key: string, n: number): Metric => ({ key, label: key, value: { n, unit: 'minutes' }, basis: 'по записям' })
  const unknown = (key: string): Metric => ({ key, label: key, value: { unknown: 'no-data', text: 'записей нет' }, basis: 'нет записей' })
  const rows = (metrics: Metric[]) => {
    const body = appBlock(withRows(metrics), screenPeriod('lastWeek', DAY)).body
    return body.kind === 'rows' ? body.rows : []
  }
  const bars = (metrics: Metric[]) => rows(metrics).map((row) => row.bar)

  it('наибольшая — во всю длину, остальные — в том же масштабе; порядок хозяина', () => {
    const result = rows([minutes('pond.group.b', 30), minutes('pond.group.a', 120), minutes('pond.group.c', 60)])
    expect(result.map((row) => row.key)).toEqual(['pond.group.b', 'pond.group.a', 'pond.group.c'])
    expect(result.map((row) => row.bar)).toEqual([0.25, 1, 0.5])
    expect(result.map((row) => row.series)).toEqual(['pond.group', 'pond.group', 'pond.group'])
    expect(result.map((row) => row.value.text)).toEqual(['30 мин', '2 ч', '1 ч'])
  })

  it('у каждой серии свой масштаб; строки вне серий — без полос', () => {
    expect(bars([minutes('pond.group.a', 40), minutes('pond.group.b', 20), minutes('pond.calm.a', 10), minutes('pond.calm.b', 5), minutes('total', 999)])).toEqual([
      1, 0.5, 1, 0.5, null,
    ])
  })

  it('одна строка под началом ключа — не серия', () => {
    expect(bars([minutes('pond.group.a', 40), minutes('pond.calm.a', 10)])).toEqual([null, null])
  })

  it('разные единицы под одним началом — не серия', () => {
    const km: Metric = { key: 'walk.km', label: 'км', value: { n: 5, unit: 'km' }, basis: 'по прогулкам' }
    const count: Metric = { key: 'walk.count', label: 'раз', value: { n: 3, unit: 'count' }, basis: 'по прогулкам' }
    expect(rows([km, count, minutes('walk.minutes', 90)]).map((row) => [row.series, row.bar])).toEqual([
      [null, null],
      [null, null],
      [null, null],
    ])
  })

  it('ноль — без полосы, строка на месте; «не известно» — без полосы и не в масштабе', () => {
    const result = rows([minutes('pond.group.a', 0), unknown('pond.group.b'), minutes('pond.group.c', 50), minutes('pond.group.d', 25)])
    expect(result.map((row) => row.bar)).toEqual([null, null, 1, 0.5])
    expect(result.map((row) => row.series)).toEqual(['pond.group', 'pond.group', 'pond.group', 'pond.group'])
  })

  it('в серии все нули и «не известно» — полос нет совсем', () => {
    const result = rows([minutes('pond.group.a', 0), unknown('pond.group.b'), minutes('pond.group.c', 0)])
    expect(result.map((row) => [row.series, row.bar])).toEqual([
      [null, null],
      [null, null],
      [null, null],
    ])
  })

  it('куски подряд идущих строк одной серии — в порядке хозяина', () => {
    const runs = rowRuns(rows([minutes('total', 5), minutes('pond.group.a', 40), minutes('pond.group.b', 20), minutes('more', 1), minutes('pond.group.c', 10)]))
    expect(runs.map((run) => [run.series, run.rows.map((row) => row.key)])).toEqual([
      [null, ['total']],
      ['pond.group', ['pond.group.a', 'pond.group.b']],
      [null, ['more']],
      ['pond.group', ['pond.group.c']],
    ])
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
