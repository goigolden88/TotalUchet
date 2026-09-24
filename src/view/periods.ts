/**
 * Отрезок экрана и отрезок среза (Р-04).
 *
 * Отрезок экрана считается от сегодня устройства. Отрезки среза — от его дня
 * расчёта `computedOn`, и у срезов, посчитанных в разные дни, «прошлая неделя» —
 * разные недели. Поэтому отрезок среза ищется по концам, а не по месту
 * в списке: не нашёлся — «не известно» с днём расчёта, а не соседняя неделя.
 */

import { summaryPeriods, type PeriodSummary, type Summary, type SummaryPeriod } from '../shared/core/summary.ts'
import type { DateStr } from '../shared/core/dates.ts'
import { shortDate } from './values.ts'

/** Отрезки переключателя «Сводки». Место в `summaryPeriods` ядра — `index`. */
export const CHOICES = [
  { id: 'thisWeek', label: 'Эта неделя', index: 1 },
  { id: 'lastWeek', label: 'Прошлая неделя', index: 0 },
  { id: 'lastMonth', label: 'Прошлый месяц', index: 2 },
  { id: 'thisMonth', label: 'Этот месяц', index: 3 },
] as const

export type Choice = (typeof CHOICES)[number]['id']

/** По умолчанию — идущая неделя (Р-04). */
export const DEFAULT_CHOICE: Choice = 'thisWeek'

/** Отрезок экрана на сегодня: те же четыре, что у среза, посчитанного сегодня. */
export function screenPeriod(choice: Choice, today: DateStr): SummaryPeriod {
  const found = CHOICES.find((item) => item.id === choice) ?? CHOICES[0]
  const period = summaryPeriods(today)[found.index]
  if (!period) throw new Error(`Нет отрезка ${choice}`)
  return period
}

/** Что показать по отрезку одного среза. */
export type PeriodView =
  | { found: true; period: PeriodSummary; going: string }
  | { found: false; text: string }

/**
 * Отрезок среза с теми же зерном и концами, что у отрезка экрана.
 * `going` — «идёт, по ДД.ММ» у идущего; у закончившегося — пусто, без
 * «окончательно»: он не заморожен (Я-21).
 */
export function findPeriod(summary: Summary, screen: SummaryPeriod): PeriodView {
  const period = summary.periods.find(
    (item) => item.grain === screen.grain && item.from === screen.from && item.to === screen.to,
  )
  if (!period) {
    const what = screen.grain === 'week' ? 'этой недели' : 'этого месяца'
    return { found: false, text: `не известно: срез посчитан ${shortDate(summary.computedOn)}, ${what} в нём нет` }
  }
  return { found: true, period, going: period.through === null ? '' : `идёт, по ${shortDate(period.through)}` }
}

/** «посчитано ДД.ММ · по записям по ДД.ММ»; записей нет — так и сказано. */
export function freshness(summary: Summary): string {
  const edit = summary.lastEdit === null ? 'записей нет' : `по записям по ${shortDate(summary.lastEdit)}`
  return `посчитано ${shortDate(summary.computedOn)} · ${edit}`
}
