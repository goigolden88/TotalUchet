/**
 * Блок приложения на отрезке — одна сборка на «Сводку» и Телеграм-бота
 * (Р-04, Я-33, Р-26).
 *
 * Свежесть, «идёт, по» или «не известно», строки хозяина в его порядке —
 * каждая со значением словами и основанием; списки названий (Я-43, Р-31).
 * Ничего не считает (Я-15): раскладывает то, что отдал хозяин. Полоса строки
 * серии (Р-35) — длина в масштабе серии, не новое число: на экран не выводится.
 */

import type { Metric, NameList, Summary, SummaryPeriod, Unit } from '../shared/core/summary.ts'
import { findPeriod, freshness } from './periods.ts'
import { formatValue, type ValueText } from './values.ts'

/**
 * Строка хозяина: подпись, значение словами, основание и полоса — длина,
 * 1 — наибольшая в серии (Р-35); вне серии, ноль и «не известно» — `null`.
 */
export type BlockRow = { key: string; label: string; value: ValueText; basis: string; bar: number | null }

/** Сколько частей ключа хотя бы у строки серии (Р-35): `time.group.<ключ>` — да, `time.total` — нет. */
export const SERIES_KEY_PARTS = 3

export type BlockBody =
  /** Отрезка в срезе нет — одна строка словами. */
  | { kind: 'missing'; text: string }
  /** Отрезок «не известно» целиком — одна строка словами хозяина. */
  | { kind: 'unknown'; going: string; text: string }
  | { kind: 'rows'; going: string; rows: BlockRow[] }

/**
 * `lists` — списки названий на день расчёта (Р-31): от отрезка не зависят
 * и стоят на любом, даже когда отрезка в срезе нет. Нет раздела — пусто.
 */
export type Block = { freshness: string; body: BlockBody; lists: NameList[] }

/** Блок среза на отрезке экрана: строки и списки — в порядке хозяина, без сортировки. */
export function appBlock(summary: Summary, screen: SummaryPeriod): Block {
  return { freshness: freshness(summary), body: blockBody(summary, screen), lists: summary.lists ?? [] }
}

function blockBody(summary: Summary, screen: SummaryPeriod): BlockBody {
  const view = findPeriod(summary, screen)
  if (!view.found) return { kind: 'missing', text: view.text }
  const { metrics } = view.period
  if ('unknown' in metrics) return { kind: 'unknown', going: view.going, text: formatValue(metrics).text }
  const scales = seriesScales(metrics)
  return {
    kind: 'rows',
    going: view.going,
    rows: metrics.map((metric) => ({
      key: metric.key,
      label: metric.label,
      value: formatValue(metric.value),
      basis: metric.basis,
      bar: barOf(metric, scales),
    })),
  }
}

/** Полоса строки: значение, делённое на наибольшее в серии; ноль и «не известно» — без полосы. */
function barOf({ key, value }: Metric, scales: ReadonlyMap<string, number>): number | null {
  const series = seriesOf(key)
  const top = series === null ? undefined : scales.get(series)
  if (top === undefined || !('n' in value) || value.n <= 0) return null
  return value.n / top
}

/**
 * Серия ключа — всё до последней точки, если в ключе три части и больше
 * (Р-35). Ключ из двух частей — отдельный итог, вне серий.
 */
function seriesOf(key: string): string | null {
  if (key.split('.').length < SERIES_KEY_PARTS) return null
  return key.slice(0, key.lastIndexOf('.'))
}

/**
 * Серии строк и их масштаб — наибольшее значение (Р-35). Серия — две строки
 * с числом и больше под одним началом ключа, в одной единице; разные единицы
 * под одним началом — не серия. Строки с порядком хозяина не связаны: могут
 * стоять не подряд. Наибольшее не больше нуля — полос нет.
 */
function seriesScales(metrics: readonly Metric[]): Map<string, number> {
  const groups = new Map<string, { unit: Unit; values: number[] } | null>()
  for (const { key, value } of metrics) {
    const series = seriesOf(key)
    if (series === null || !('n' in value)) continue
    const group = groups.get(series)
    if (group === undefined) groups.set(series, { unit: value.unit, values: [value.n] })
    else if (group !== null && group.unit === value.unit) group.values.push(value.n)
    else groups.set(series, null)
  }
  const scales = new Map<string, number>()
  for (const [series, group] of groups) {
    if (group === null || group.values.length < 2) continue
    const top = Math.max(...group.values)
    if (top > 0) scales.set(series, top)
  }
  return scales
}
