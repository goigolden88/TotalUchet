/**
 * Приложения семьи — записи человека (Я-16, Я-22): порядок, проверка ввода,
 * ссылка «открыть». Без базы и React.
 */

import { parseRepo } from '../shared/core/github.ts'
import type { App } from './model.ts'

/** Живые приложения в порядке человека; при равном порядке — по имени. */
export function ordered(apps: readonly App[]): App[] {
  return apps
    .filter((app) => !app.deleted)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ru'))
}

/** Порядок нового приложения — следом за последним. */
export function nextOrder(apps: readonly App[]): number {
  const live = apps.filter((app) => !app.deleted)
  return live.length === 0 ? 1 : Math.max(...live.map((app) => app.order)) + 1
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

  const order = Number(input.order.trim().replace(',', '.'))
  if (input.order.trim() === '' || !Number.isFinite(order)) problems.push('Порядок — число')

  if (problems.length > 0) return { ok: false, problems }
  return { ok: true, fields: { name, dataRepo, site: site ?? '', order } }
}
