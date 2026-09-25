import { describe, expect, it } from 'vitest'
import { takenRows } from '../app/bundles.ts'
import { seenId, type App, type Bundle, type Seen } from '../app/model.ts'
import type { AppState } from '../reading/refresh.ts'
import { buildSummary, summaryPeriods, type Metric, type PeriodSummary, type Summary } from '../shared/core/summary.ts'
import { bundleBrief, bundleView, formOptions, needsFix } from './bundles.ts'
import { screenPeriod } from './periods.ts'
import { labelsFrom, rowChoices } from './rows.ts'

/**
 * Связки на выдуманных срезах (Р-01): «Полка» — чтение, «Грядка» — полив.
 * Ни одного ключа или подписи настоящих приложений.
 */

const AT = '2026-09-25T10:00:00.000Z'
const TODAY = '2026-09-24'

function app(id: string, name: string, order: number): App {
  return { id, updatedAt: AT, name, dataRepo: `someone/${id}-data`, site: `https://example.org/${id}/`, order }
}

const SHELF = app('shelf', 'Полка', 1)
const GARDEN = app('garden', 'Грядка', 2)
const GONE = app('gone', 'Убранное', 3)

function metric(key: string, label: string, n: number): Metric {
  return { key, label, value: { n, unit: 'count' }, basis: `основание ${key}` }
}

/** Срез: недельные строки у недель, месячные у месяцев. */
function slice(day: string, weeks: Metric[], months: Metric[] | 'none' = weeks): Summary {
  const periods: PeriodSummary[] = summaryPeriods(day).map((period, index) => {
    const going = index === 1 || index === 3
    const metrics = period.grain === 'week' ? weeks : months === 'none' ? { unknown: 'not-provided', text: 'месяцы не считаю' } : months
    return { ...period, through: going ? day : null, metrics }
  })
  return buildSummary({ periods, attention: [] }, {}, day)
}

function seen(appId: string, summary: Summary): Seen {
  return { id: seenId(appId, summary.computedOn), updatedAt: AT, app: appId, computedOn: summary.computedOn, readAt: AT, sha: 'x', summary }
}

function state(appId: string, summary: Summary): AppState {
  return { seen: seen(appId, summary), status: 'fresh', text: '' }
}

const SHELF_SLICE = slice(TODAY, [metric('reading', 'Чтение', 3), metric('pages', 'Страницы', 120)], [metric('reading', 'Чтение', 9)])
const GARDEN_SLICE = slice('2026-09-23', [metric('beds.water', 'Поливы', 4)], [metric('beds.water', 'Поливы', 12), metric('beds.harvest', 'Урожай', 2)])

const BEDS: Bundle = {
  id: 'b1',
  updatedAt: AT,
  name: 'Огород',
  order: 1,
  rows: [
    { app: 'shelf', key: 'pages' },
    { app: 'garden', key: 'beds.harvest' },
    { app: 'garden', key: 'beds.water' },
    { app: 'shelf', key: 'reading' },
    { app: 'gone', key: 'x.count' },
  ],
}

const STATES = new Map([
  ['shelf', state('shelf', SHELF_SLICE)],
  ['garden', state('garden', GARDEN_SLICE)],
])

const APPS = [SHELF, GARDEN]
const WEEK = screenPeriod('thisWeek', TODAY)
const MONTH = screenPeriod('thisMonth', TODAY)

describe('строки среза (Р-17)', () => {
  it('все четыре отрезка вместе, в порядке хозяина, без повторов', () => {
    expect(rowChoices(GARDEN_SLICE)).toEqual([
      { key: 'beds.water', label: 'Поливы' },
      { key: 'beds.harvest', label: 'Урожай' },
    ])
  })

  it('отрезок «не известно» целиком строк не даёт', () => {
    expect(rowChoices(slice(TODAY, [metric('a', 'А', 1)], 'none'))).toEqual([{ key: 'a', label: 'А' }])
  })

  it('подписи по архиву — из самого позднего среза, где строка была', () => {
    const early = seen('shelf', slice('2026-09-10', [metric('reading', 'Чтение (старое)', 1), metric('old', 'Было', 1)]))
    const late = seen('shelf', SHELF_SLICE)
    const labels = labelsFrom([late, early])
    expect(labels.get('reading')).toBe('Чтение')
    expect(labels.get('old')).toBe('Было')
  })
})

describe('связка на «Сводке» (Р-19)', () => {
  it('по приложениям в порядке человека; строки — в порядке хозяина, со своей свежестью', () => {
    const views = bundleView(BEDS, APPS, STATES, WEEK, new Map())
    expect(views.map((view) => view.app.id)).toEqual(['shelf', 'garden'])

    const [shelf, garden] = views
    expect(shelf?.fresh).toBe('посчитано 24.09 · записей нет')
    expect(shelf?.going).toBe('идёт, по 24.09')
    expect(shelf?.rows.map((row) => row.key)).toEqual(['reading', 'pages'])
    expect(shelf?.rows[0]).toEqual({
      kind: 'value',
      key: 'reading',
      label: 'Чтение',
      value: { text: '3', muted: false },
      basis: 'основание reading',
    })
    expect(garden?.fresh).toBe('посчитано 23.09 · записей нет')
  })

  it('строки нет в этом отрезке — словами; счёта между строками нет (Я-15)', () => {
    const [shelf, garden] = bundleView(BEDS, APPS, STATES, WEEK, new Map())
    expect(garden?.rows).toEqual([
      expect.objectContaining({ kind: 'value', key: 'beds.water' }),
      { kind: 'absent', key: 'beds.harvest', text: 'Урожай — нет в срезе за этот отрезок', fix: false },
    ])
    // Значения строк — каждое своё; ни одной строки, которой нет у хозяина.
    expect(shelf?.rows.every((row) => row.kind === 'value')).toBe(true)
  })

  it('на месяце — месячные строки; недельной «Страницы» нет за этот отрезок', () => {
    const [shelf] = bundleView(BEDS, APPS, STATES, MONTH, new Map())
    expect(shelf?.rows).toEqual([
      expect.objectContaining({ kind: 'value', key: 'reading', value: { text: '9', muted: false } }),
      { kind: 'absent', key: 'pages', text: 'Страницы — нет в срезе за этот отрезок', fix: false },
    ])
  })

  it('строки нет ни в одном отрезке — «поправь связку», подпись из архива; иначе ключ (Р-20)', () => {
    const renamed = new Map([['shelf', state('shelf', slice(TODAY, [metric('reading', 'Чтение', 3)]))]])
    const archive = new Map([['shelf', new Map([['pages', 'Страницы']])]])
    const [shelf] = bundleView(BEDS, [SHELF], renamed, WEEK, archive)
    expect(shelf?.rows[1]).toEqual({
      kind: 'absent',
      key: 'pages',
      text: 'Страницы — в срезе от 24.09 этой строки нет ни в одном отрезке',
      fix: true,
    })
    expect(needsFix(bundleView(BEDS, [SHELF], renamed, WEEK, archive))).toBe(true)
    expect(needsFix(bundleView(BEDS, APPS, STATES, WEEK, new Map()))).toBe(false)

    const [bare] = bundleView(BEDS, [SHELF], renamed, WEEK, new Map())
    expect(bare?.rows[1]).toMatchObject({ text: 'pages — в срезе от 24.09 этой строки нет ни в одном отрезке' })
  })

  it('отрезка нет в срезе или он «не известно» — одна строка, без «нет за этот отрезок» у каждой', () => {
    const lastMonth = screenPeriod('lastMonth', TODAY)
    const old = new Map([['garden', state('garden', slice('2026-07-20', [metric('beds.water', 'Поливы', 1)]))]])
    const [garden] = bundleView(BEDS, [GARDEN], old, lastMonth, new Map())
    expect(garden?.notes).toEqual([{ text: 'не известно: срез посчитан 20.07, этого месяца в нём нет', calm: true }])
    // «Урожай» в том срезе не было вовсе — это говорится всегда.
    expect(garden?.rows).toEqual([expect.objectContaining({ key: 'beds.harvest', fix: true })])

    const weeksOnly = new Map([['shelf', state('shelf', slice(TODAY, [metric('reading', 'Чтение', 3), metric('pages', 'Страницы', 1)], 'none'))]])
    const [shelf] = bundleView(BEDS, [SHELF], weeksOnly, MONTH, new Map())
    expect(shelf?.notes).toEqual([{ text: 'не известно — месяцы не считаю', calm: true }])
    expect(shelf?.rows).toEqual([])
  })

  it('не прочитан — строка состояния; ещё не читали — «…»', () => {
    const broken: AppState = { seen: undefined, status: 'noAccess', text: 'токен не видит репозиторий someone/garden-data' }
    const [garden] = bundleView(BEDS, [GARDEN], new Map([['garden', broken]]), WEEK, new Map())
    expect(garden?.notes).toEqual([{ text: 'токен не видит репозиторий someone/garden-data', calm: false }])
    expect(garden?.rows).toEqual([])

    const [waiting] = bundleView(BEDS, [GARDEN], new Map(), WEEK, new Map())
    expect(waiting?.notes).toEqual([{ text: '…', calm: true }])
  })

  it('убранное приложение на экране не показывается (Р-20)', () => {
    expect(bundleView(BEDS, APPS, STATES, WEEK, new Map()).some((view) => view.app.id === 'gone')).toBe(false)
  })

  it('итог у свёрнутой — имена живых приложений, без чисел', () => {
    expect(bundleBrief(BEDS, APPS)).toBe('Полка · Грядка')
    expect(bundleBrief({ ...BEDS, rows: [] }, APPS)).toBe('строк нет')
  })
})

describe('форма связки (Р-21)', () => {
  it('строки по приложениям; чужая связка — занята; пропавшие и убранные — с пометкой', () => {
    const other: Bundle = { ...BEDS, id: 'b2', name: 'Чтение', rows: [{ app: 'shelf', key: 'reading' }] }
    const own = [
      { app: 'garden', key: 'beds.water' },
      { app: 'garden', key: 'beds.old' },
      { app: 'gone', key: 'x.count' },
    ]
    const archive = new Map([
      ['garden', new Map([['beds.old', 'Прополка']])],
      ['gone', new Map([['x.count', 'Счёт']])],
    ])
    const form = formOptions(own, APPS, STATES, archive, takenRows([other], 'b1'))

    const [shelf, garden] = form.apps
    expect(shelf?.options.map((option) => [option.label, option.taken])).toEqual([
      ['Чтение', 'Чтение'],
      ['Страницы', null],
    ])
    expect(garden?.options.map((option) => [option.label, option.missing])).toEqual([
      ['Поливы', false],
      ['Урожай', false],
      ['Прополка', true],
    ])
    expect(form.removed).toEqual([{ row: { app: 'gone', key: 'x.count' }, label: 'Счёт', taken: null, missing: false }])
  })

  it('среза нет — выбрать нечего, и это сказано', () => {
    const form = formOptions([], [GONE], new Map(), new Map(), new Map())
    expect(form.apps[0]).toEqual({ app: GONE, options: [], note: 'среза ещё не видели — выбрать нечего' })
  })
})
