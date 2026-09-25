/**
 * Связки (Р-17) — записи человека: проверка формы и какие строки уже заняты.
 * Без базы и React.
 */

import { parseOrder } from './apps.ts'
import type { Bundle, BundleRow } from './model.ts'

/** Строка в связке однозначна приложением и ключом. */
export function rowId(row: BundleRow): string {
  return `${row.app}\u0000${row.key}`
}

/**
 * Строка → имя связки, в которой она уже лежит. Строка — не больше чем
 * в одной связке (Р-17); своя связка `self` не считается.
 */
export function takenRows(bundles: readonly Bundle[], self: string | null): Map<string, string> {
  const taken = new Map<string, string>()
  for (const bundle of bundles) {
    if (bundle.deleted || bundle.id === self) continue
    for (const row of bundle.rows) taken.set(rowId(row), bundle.name)
  }
  return taken
}

/** Что человек выбрал в форме связки. */
export type BundleInput = { name: string; order: string; rows: readonly BundleRow[] }

export type BundleFields = Pick<Bundle, 'name' | 'order' | 'rows'>

export type BundleChecked = { ok: true; fields: BundleFields } | { ok: false; problems: string[] }

/** Проверка формы: имя, порядок числом, хотя бы одна строка, ни одной чужой (Р-21). */
export function checkBundle(input: BundleInput, taken: ReadonlyMap<string, string>): BundleChecked {
  const problems: string[] = []

  const name = input.name.trim()
  if (name === '') problems.push('Имя не вписано')

  const order = parseOrder(input.order)
  if (order === null) problems.push('Порядок — число')

  // Повтор строки в самой форме — одна строка.
  const rows = [...new Map(input.rows.map((row) => [rowId(row), { app: row.app, key: row.key }])).values()]
  if (rows.length === 0) problems.push('Не выбрано ни одной строки')

  const others = [...new Set(rows.map((row) => taken.get(rowId(row))).filter((other) => other !== undefined))]
  for (const other of others) problems.push(`Строка уже в связке «${other}» — одна строка живёт в одной связке`)

  if (problems.length > 0 || order === null) return { ok: false, problems }
  return { ok: true, fields: { name, order, rows } }
}
