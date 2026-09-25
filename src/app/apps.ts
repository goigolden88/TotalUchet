/**
 * Приложения семьи — записи человека (Я-16, Я-22): порядок, проверка ввода,
 * ссылка «открыть». Без базы и React.
 */

import { parseRepo } from '../shared/core/github.ts'
import type { App } from './model.ts'

/** Запись человека с именем и порядком — приложение или связка. */
type Placed = { name: string; order: number; deleted?: boolean }

/** Живые записи в порядке человека; при равном порядке — по имени. */
export function ordered<T extends Placed>(records: readonly T[]): T[] {
  return records
    .filter((record) => !record.deleted)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ru'))
}

/** Порядок новой записи — следом за последней живой. */
export function nextOrder(records: readonly Placed[]): number {
  const live = records.filter((record) => !record.deleted)
  return live.length === 0 ? 1 : Math.max(...live.map((record) => record.order)) + 1
}

/** Порядок из формы — число; запятая вместо точки тоже годится. `null` — не число. */
export function parseOrder(input: string): number | null {
  const order = Number(input.trim().replace(',', '.'))
  return input.trim() === '' || !Number.isFinite(order) ? null : order
}

/** Адрес экрана приложения: сайт со слешем и путь хеш-роутинга (Р-06). */
export function openLink(site: string, link: string): string {
  if (link === '') return site
  return `${site}#${link.startsWith('/') ? link : `/${link}`}`
}

/** Что человек вписал в форму «Семьи». */
export type AppInput = { name: string; dataRepo: string; site: string; order: string }

export type AppFields = Pick<App, 'name' | 'dataRepo' | 'site' | 'order'>

export type Checked = { ok: true; fields: AppFields } | { ok: false; problems: string[] }

/**
 * Сайт приложения — только http(s); хвост после `#` и `?` отбрасывается,
 * слеш в конце дописывается: вставить можно адрес любого экрана приложения.
 */
export function normalizeSite(input: string): string | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const path = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`
  return `${url.origin}${path}`
}

/** Проверка формы. Репозиторий — «владелец/имя», как бы его ни вставили. */
export function checkApp(input: AppInput): Checked {
  const problems: string[] = []

  const name = input.name.trim()
  if (name === '') problems.push('Имя не вписано')

  let dataRepo = ''
  try {
    const repo = parseRepo(input.dataRepo)
    dataRepo = `${repo.owner}/${repo.name}`
  } catch (error) {
    problems.push(error instanceof Error ? error.message : 'Репозиторий не разобран')
  }

  const site = normalizeSite(input.site)
  if (site === null) problems.push('Сайт — адрес, начинающийся с https://')

  const order = parseOrder(input.order)
  if (order === null) problems.push('Порядок — число')

  if (problems.length > 0 || order === null) return { ok: false, problems }
  return { ok: true, fields: { name, dataRepo, site: site ?? '', order } }
}
