/**
 * Связка на экране (Р-17, Р-19, Р-20): строки разных приложений рядом.
 *
 * Только раскладка: значения и основания — те же функции, что у блока
 * приложения, по одному за раз. Между строками ничего не считается — ни
 * суммы, ни разности, ни доли (Я-15). Отсутствие строки не толкуется (Я-21):
 * сказано, где её нет, а не почему.
 */

import { rowId } from '../app/bundles.ts'
import type { App, Bundle, BundleRow } from '../app/model.ts'
import { isCalm, stateLine, type AppState } from '../reading/refresh.ts'
import type { SummaryPeriod } from '../shared/core/summary.ts'
import { findPeriod, freshness } from './periods.ts'
import { rowChoices, type RowChoice } from './rows.ts'
import { formatValue, shortDate, type ValueText } from './values.ts'

/** Подписи по архиву: id приложения → ключ → подпись. */
export type ArchiveLabels = ReadonlyMap<string, ReadonlyMap<string, string>>

/** Подпись строки: из последнего среза, иначе из архива, иначе — сам ключ. */
function labelOf(key: string, choices: readonly RowChoice[], archive: ReadonlyMap<string, string> | undefined): string {
  return choices.find((choice) => choice.key === key)?.label ?? archive?.get(key) ?? key
}

export type BundleRowView =
  | { kind: 'value'; key: string; label: string; value: ValueText; basis: string }
  /** Строки нет. `fix` — нет ни в одном отрезке среза: пора поправить связку. */
  | { kind: 'absent'; key: string; text: string; fix: boolean }

export type BundleAppView = {
  app: App
  /** «посчитано ДД.ММ · по записям по ДД.ММ»; среза нет — пусто. */
  fresh: string
  /** «идёт, по ДД.ММ» у идущего отрезка. */
  going: string
  /** Строка над строками: состояние чтения, «не известно» отрезка — или пусто. */
  notes: { text: string; calm: boolean }[]
  rows: BundleRowView[]
}

/**
 * Связка на отрезке экрана — по приложениям в порядке человека. Строки
 * убранного приложения не показываются: его на экране нет (Р-20).
 */
export function bundleView(
  bundle: Bundle,
  apps: readonly App[],
  states: ReadonlyMap<string, AppState>,
  screen: SummaryPeriod,
  archive: ArchiveLabels,
): BundleAppView[] {
  const views: BundleAppView[] = []
  for (const app of apps) {
    const keys = bundle.rows.filter((row) => row.app === app.id).map((row) => row.key)
    if (keys.length === 0) continue
    views.push(appView(app, keys, states.get(app.id), screen, archive.get(app.id)))
  }
  return views
}

function appView(
  app: App,
  keys: readonly string[],
  state: AppState | undefined,
  screen: SummaryPeriod,
  archive: ReadonlyMap<string, string> | undefined,
): BundleAppView {
  const view: BundleAppView = { app, fresh: '', going: '', notes: [], rows: [] }
  if (!state) {
    view.notes.push({ text: '…', calm: true })
    return view
  }
  const line = stateLine(state)
  if (line) view.notes.push({ text: line, calm: isCalm(state) })

  const summary = state.seen?.summary
  if (!summary) return view
  view.fresh = freshness(summary)

  const choices = rowChoices(summary)
  const inSlice = new Set(choices.map((choice) => choice.key))
  const wanted = new Set(keys)
  const shown = new Set<string>()

  const period = findPeriod(summary, screen)
  if (!period.found) view.notes.push({ text: period.text, calm: true })
  else {
    view.going = period.going
    if ('unknown' in period.period.metrics) view.notes.push({ text: formatValue(period.period.metrics).text, calm: true })
    else {
      // Порядок хозяина, а не порядок выбора.
      for (const metric of period.period.metrics) {
        if (!wanted.has(metric.key)) continue
        shown.add(metric.key)
        view.rows.push({ kind: 'value', key: metric.key, label: metric.label, value: formatValue(metric.value), basis: metric.basis })
      }
    }
  }

  // Отрезок, которого нет, или «не известно» целиком уже сказаны строкой выше —
  // «нет за этот отрезок» у каждой строки их бы повторило. Нет нигде — говорится всегда.
  const periodSaid = !period.found || 'unknown' in period.period.metrics
  for (const key of keys) {
    if (shown.has(key)) continue
    const label = labelOf(key, choices, archive)
    if (!inSlice.has(key)) {
      view.rows.push({
        kind: 'absent',
        key,
        text: `${label} — в срезе от ${shortDate(summary.computedOn)} этой строки нет ни в одном отрезке`,
        fix: true,
      })
    } else if (!periodSaid) {
      view.rows.push({ kind: 'absent', key, text: `${label} — нет в срезе за этот отрезок`, fix: false })
    }
  }
  return view
}

/** Итог у свёрнутой связки — имена приложений, без чисел (Р-19). */
export function bundleBrief(bundle: Bundle, apps: readonly App[]): string {
  const names = apps.filter((app) => bundle.rows.some((row) => row.app === app.id)).map((app) => app.name)
  return names.length === 0 ? 'строк нет' : names.join(' · ')
}

/** Есть ли в связке строка, которой нет ни в одном отрезке последнего среза. */
export function needsFix(views: readonly BundleAppView[]): boolean {
  return views.some((view) => view.rows.some((row) => row.kind === 'absent' && row.fix))
}

// ─── Форма связки (Р-21) ───────────────────────────────────────────────────

/** Строка в форме: можно ли выбрать и что о ней сказать. */
export type RowOption = {
  row: BundleRow
  label: string
  /** Имя другой связки, где строка уже лежит; `null` — свободна. */
  taken: string | null
  /** Строка этой связки, которой нет в последнем срезе (Р-20). */
  missing: boolean
}

export type AppOptions = {
  app: App
  options: RowOption[]
  /** Среза нет — выбрать нечего: почему. */
  note: string
}

export type FormOptions = {
  apps: AppOptions[]
  /** Строки этой связки у приложений, убранных из «Семьи» (Р-20). */
  removed: RowOption[]
}

/**
 * Что показать в форме: строки последних срезов по приложениям в порядке
 * человека, в порядке хозяина. Строки связки, которых в срезе нет, — следом,
 * с пометкой; строки убранных приложений — отдельно.
 */
export function formOptions(
  own: readonly BundleRow[],
  apps: readonly App[],
  states: ReadonlyMap<string, AppState>,
  archive: ArchiveLabels,
  taken: ReadonlyMap<string, string>,
): FormOptions {
  const option = (row: BundleRow, label: string, missing: boolean): RowOption => ({
    row,
    label,
    taken: taken.get(rowId(row)) ?? null,
    missing,
  })

  const result: FormOptions = { apps: [], removed: [] }
  for (const app of apps) {
    const summary = states.get(app.id)?.seen?.summary
    const choices = summary ? rowChoices(summary) : []
    const options = choices.map((choice) => option({ app: app.id, key: choice.key }, choice.label, false))
    const listed = new Set(choices.map((choice) => choice.key))
    for (const row of own) {
      if (row.app !== app.id || listed.has(row.key)) continue
      options.push(option(row, labelOf(row.key, choices, archive.get(app.id)), true))
    }
    result.apps.push({ app, options, note: summary ? '' : 'среза ещё не видели — выбрать нечего' })
  }

  const live = new Set(apps.map((app) => app.id))
  for (const row of own) {
    if (!live.has(row.app)) result.removed.push(option(row, archive.get(row.app)?.get(row.key) ?? row.key, false))
  }
  return result
}
