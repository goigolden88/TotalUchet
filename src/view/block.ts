/**
 * Блок приложения на отрезке — одна сборка на «Сводку» и Телеграм-бота
 * (Р-04, Я-33, Р-26).
 *
 * Свежесть, «идёт, по» или «не известно», строки хозяина в его порядке —
 * каждая со значением словами и основанием. Ничего не считает (Я-15):
 * раскладывает то, что отдал хозяин.
 */

import type { Summary, SummaryPeriod } from '../shared/core/summary.ts'
import { findPeriod, freshness } from './periods.ts'
import { formatValue, type ValueText } from './values.ts'

/** Строка хозяина: подпись, значение словами, основание. */
export type BlockRow = { key: string; label: string; value: ValueText; basis: string }

export type BlockBody =
  /** Отрезка в срезе нет — одна строка словами. */
  | { kind: 'missing'; text: string }
  /** Отрезок «не известно» целиком — одна строка словами хозяина. */
  | { kind: 'unknown'; going: string; text: string }
  | { kind: 'rows'; going: string; rows: BlockRow[] }

export type Block = { freshness: string; body: BlockBody }

/** Блок среза на отрезке экрана: строки — в порядке хозяина, без сортировки. */
export function appBlock(summary: Summary, screen: SummaryPeriod): Block {
  const view = findPeriod(summary, screen)
  const fresh = freshness(summary)
  if (!view.found) return { freshness: fresh, body: { kind: 'missing', text: view.text } }
  const { metrics } = view.period
  if ('unknown' in metrics) return { freshness: fresh, body: { kind: 'unknown', going: view.going, text: formatValue(metrics).text } }
  return {
    freshness: fresh,
    body: {
      kind: 'rows',
      going: view.going,
      rows: metrics.map((metric) => ({ key: metric.key, label: metric.label, value: formatValue(metric.value), basis: metric.basis })),
    },
  }
}
