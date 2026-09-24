import { describe, expect, it } from 'vitest'
import { buildSummary } from '../shared/core/summary.ts'
import { shelfSummary, type Session } from '../shared/testing/shelf.ts'
import { CHOICES, DEFAULT_CHOICE, findPeriod, freshness, screenPeriod } from './periods.ts'

/** Выдуманный срез «Полки» ядра (Р-01): по сеансу чтения в каждой неделе. */
const SESSIONS: Session[] = [
  { id: 's1', updatedAt: '2026-09-10T08:00:00.000Z', date: '2026-09-09', bookId: 'b', minutes: 90 },
  { id: 's2', updatedAt: '2026-09-17T08:00:00.000Z', date: '2026-09-16', bookId: 'b', minutes: 40 },
  { id: 's3', updatedAt: '2026-09-23T08:00:00.000Z', date: '2026-09-22', bookId: 'b', minutes: 25 },
]

function summaryOn(day: string) {
  const data = { sessions: SESSIONS.filter((session) => session.date <= day), books: [] }
  return buildSummary(shelfSummary(data, day), data, day)
}

describe('отрезок экрана (Р-04)', () => {
  it('по умолчанию — идущая неделя; четыре отрезка от сегодня', () => {
    expect(DEFAULT_CHOICE).toBe('thisWeek')
    expect(CHOICES.map((item) => item.id)).toEqual(['thisWeek', 'lastWeek', 'lastMonth', 'thisMonth'])
    // 24.09.2026 — четверг.
    expect(screenPeriod('thisWeek', '2026-09-24')).toEqual({ grain: 'week', from: '2026-09-21', to: '2026-09-27' })
    expect(screenPeriod('lastWeek', '2026-09-24')).toEqual({ grain: 'week', from: '2026-09-14', to: '2026-09-20' })
    expect(screenPeriod('lastMonth', '2026-09-24')).toEqual({ grain: 'month', from: '2026-08-01', to: '2026-08-31' })
    expect(screenPeriod('thisMonth', '2026-09-24')).toEqual({ grain: 'month', from: '2026-09-01', to: '2026-09-30' })
  })
})

describe('отрезок среза — по концам, не по месту (Р-04)', () => {
  it('срез посчитан сегодня — отрезки совпадают', () => {
    const view = findPeriod(summaryOn('2026-09-24'), screenPeriod('thisWeek', '2026-09-24'))
    expect(view.found).toBe(true)
    if (!view.found) return
    expect(view.going).toBe('идёт, по 24.09')
    expect(view.period.metrics).toEqual([expect.objectContaining({ key: 'reading', value: { n: 25, unit: 'minutes' } })])
  })

  it('срез прошлой недели: его «идущая» — наша «прошлая», и она не подставляется в идущую', () => {
    const old = summaryOn('2026-09-17')
    const last = findPeriod(old, screenPeriod('lastWeek', '2026-09-24'))
    expect(last.found).toBe(true)
    if (last.found) expect(last.period.metrics).toEqual([expect.objectContaining({ value: { n: 40, unit: 'minutes' } })])

    const current = findPeriod(old, screenPeriod('thisWeek', '2026-09-24'))
    expect(current).toEqual({ found: false, text: 'не известно: срез посчитан 17.09, этой недели в нём нет' })
  })

  it('закончившийся отрезок — без «идёт» и без «окончательно» (Я-21)', () => {
    const view = findPeriod(summaryOn('2026-09-24'), screenPeriod('lastWeek', '2026-09-24'))
    expect(view.found && view.going).toBe('')
  })

  it('месяца нет — «этого месяца»', () => {
    const view = findPeriod(summaryOn('2026-07-15'), screenPeriod('thisMonth', '2026-09-24'))
    expect(view).toEqual({ found: false, text: 'не известно: срез посчитан 15.07, этого месяца в нём нет' })
  })

  it('месяц с тем же началом, но другим концом — не наш (Я-12)', () => {
    const summary = summaryOn('2026-09-24')
    const odd = { ...summary, periods: summary.periods.map((p) => (p.grain === 'month' && p.from === '2026-09-01' ? { ...p, to: '2026-09-24' } : p)) }
    expect(findPeriod(odd, screenPeriod('thisMonth', '2026-09-24')).found).toBe(false)
  })
})

describe('свежесть', () => {
  it('посчитано и по записям по', () => {
    expect(freshness(summaryOn('2026-09-24'))).toBe('посчитано 24.09 · по записям по 23.09')
  })

  it('записей нет — так и сказано', () => {
    expect(freshness(buildSummary(shelfSummary({ sessions: [], books: [] }, '2026-09-24'), {}, '2026-09-24'))).toBe(
      'посчитано 24.09 · записей нет',
    )
  })
})
