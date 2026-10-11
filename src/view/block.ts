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

/** Строка хозяина: подпись, значение словами, основание, полоса. */
export type BlockRow = {
  key: string
  label: string
  value: ValueText
  basis: string
  /** Серия строки — общее начало ключа (Р-35); вне серии — `null`. */
  series: string | null
  /** Длина полосы, 1 — наибольшая в серии; ноль, «не известно», вне серии — `null`. */
  bar: number | null
}

/** Подряд идущие строки одной серии — или вне серий; порядок хозяина не меняется. */
export type RowRun = { series: string | null; rows: BlockRow[] }

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
    rows: metrics.map((metric) => {
      const prefix = seriesOf(metric.key)
      const scale = prefix === null ? undefined : scales.get(prefix)
      const { value } = metric
      return {
        key: metric.key,
        label: metric.label,
        value: formatValue(value),
        basis: metric.basis,
        series: scale === undefined ? null : prefix,
        bar: scale !== undefined && 'n' in value && value.n > 0 ? value.n / scale : null,
      }
    }),
  }
}

/** Общее начало ключа — всё до последней точки (Р-35); ключ без точки — вне серий. */
function seriesOf(key: string): string | null {
  const dot = key.lastIndexOf('.')
  return dot > 0 ? key.slice(0, dot) : null
}

/**
 * Серии строк и их масштаб — наибольшее значение (Р-35). Серия — две строки
 * с числом и больше под одним началом ключа, в одной единице. Разные
 * единицы под одним началом — не серия. Наибольшее не больше нуля — полос
 * нет совсем, серии тоже.
 */
function seriesScales(metrics: readonly Metric[]): Map<string, number> {
  const groups = new Map<string, { unit: Unit; values: number[] } | null>()
  for (const { key, value } of metrics) {
    const prefix = seriesOf(key)
    if (prefix === null || !('n' in value)) continue
    const group = groups.get(prefix)
    if (group === undefined) groups.set(prefix, { unit: value.unit, values: [value.n] })
    else if (group !== null && group.unit === value.unit) group.values.push(value.n)
    else groups.set(prefix, null)
  }
  const scales = new Map<string, number>()
  for (const [prefix, group] of groups) {
    if (group === null || group.values.length < 2) continue
    const top = Math.max(...group.values)
    if (top > 0) scales.set(prefix, top)
  }
  return scales
}

/** Строки — подряд идущими кусками одной серии, для сворачиваемого блока полос (Р-35). */
export function rowRuns(rows: readonly BlockRow[]): RowRun[] {
  const runs: RowRun[] = []
  for (const row of rows) {
    const last = runs.at(-1)
    if (last && last.series === row.series) last.rows.push(row)
    else runs.push({ series: row.series, rows: [row] })
  }
  return runs
}
