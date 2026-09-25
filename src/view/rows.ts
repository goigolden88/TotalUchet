/**
 * Строки среза для связок (Р-17, Р-20): какие есть и как подписаны.
 * Без базы, React и чтения — их берут и показ, и архив.
 */

import type { Seen } from '../app/model.ts'
import type { Summary } from '../shared/core/summary.ts'

/** Строка среза, которую можно положить в связку. */
export type RowChoice = { key: string; label: string }

/**
 * Строки среза — все четыре отрезка вместе, в порядке хозяина: по первому
 * появлению. Строка, которая есть только у месяцев, — после недельных.
 */
export function rowChoices(summary: Summary): RowChoice[] {
  const found = new Map<string, string>()
  for (const period of summary.periods) {
    if ('unknown' in period.metrics) continue
    for (const metric of period.metrics) if (!found.has(metric.key)) found.set(metric.key, metric.label)
  }
  return [...found].map(([key, label]) => ({ key, label }))
}

/**
 * Подписи строк приложения по архиву: ключ → подпись из самого позднего
 * среза, где строка была. Нужны строкам, которых в последнем срезе нет (Р-20).
 */
export function labelsFrom(seen: readonly Seen[]): Map<string, string> {
  const labels = new Map<string, string>()
  for (const one of [...seen].sort((a, b) => a.computedOn.localeCompare(b.computedOn))) {
    for (const choice of rowChoices(one.summary)) labels.set(choice.key, choice.label)
  }
  return labels
}
