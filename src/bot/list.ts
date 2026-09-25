/**
 * Список для Телеграм-бота — файл `bot.json` (Р-28).
 *
 * У бота нет IndexedDB, а приложения семьи — записи человека на устройстве
 * (Я-16, Я-22). «Настройки» отдают их файлом, человек кладёт его
 * в приватный репозиторий бота (Р-23). В файле — записи `apps`, своё
 * название (Р-03) и адрес «Сводки»; ни архива, ни токена, ни связок (Р-27).
 *
 * Бот проверяет файл той же проверкой, что форма «Семьи»: имена
 * и адреса — только из файла, в коде их нет.
 */

import { checkApp, normalizeSite, ordered } from '../app/apps.ts'
import type { App } from '../app/model.ts'
import { titleOf } from '../ui/title.ts'

/** Имя файла — и при скачивании, и в приватном репозитории. */
export const LIST_FILE = 'bot.json'

/** Метка формы: чужой JSON не примется за список. */
const LIST_KIND = 'totaluchet-bot'

/** Версия формы файла. Растёт, когда меняется форма. */
export const LIST_VERSION = 1

export type BotList = {
  kind: typeof LIST_KIND
  version: typeof LIST_VERSION
  /** Своё название (Р-03): им бот подписывает сообщение. */
  title: string
  /** Адрес «Сводки» — ссылкой внизу сообщения. */
  summaryUrl: string
  /** Живые приложения в порядке человека. */
  apps: App[]
}

/** Список из записей устройства. `summaryUrl` — адрес страницы, откуда скачан. */
export function botList(apps: readonly App[], title: string, pageUrl: string): BotList {
  return {
    kind: LIST_KIND,
    version: LIST_VERSION,
    title: titleOf(title),
    summaryUrl: normalizeSite(pageUrl) ?? pageUrl,
    apps: ordered(apps),
  }
}

/** Текст файла. */
export function listText(list: BotList): string {
  return `${JSON.stringify(list, null, 2)}\n`
}

export type ParsedList = { ok: true; list: BotList } | { ok: false; problem: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function refuse(problem: string): ParsedList {
  return { ok: false, problem }
}

/** Разбор файла. Что не так — словами, первым найденным. */
export function parseBotList(text: string): ParsedList {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return refuse('файл — не JSON')
  }
  if (!isRecord(raw) || raw.kind !== LIST_KIND) return refuse(`это не список для бота — скачай ${LIST_FILE} в «Настройках» заново`)
  if (raw.version !== LIST_VERSION) return refuse(`форма списка ${String(raw.version)}, бот знает ${LIST_VERSION} — скачай ${LIST_FILE} заново`)

  const summaryUrl = typeof raw.summaryUrl === 'string' ? normalizeSite(raw.summaryUrl) : null
  if (summaryUrl === null) return refuse('нет адреса «Сводки»')
  if (!Array.isArray(raw.apps)) return refuse('нет списка приложений')

  const apps: App[] = []
  for (const [index, item] of raw.apps.entries()) {
    const where = `приложение ${index + 1}`
    if (!isRecord(item) || typeof item.id !== 'string' || item.id === '') return refuse(`${where}: нет id`)
    const checked = checkApp({
      name: typeof item.name === 'string' ? item.name : '',
      dataRepo: typeof item.dataRepo === 'string' ? item.dataRepo : '',
      site: typeof item.site === 'string' ? item.site : '',
      order: typeof item.order === 'number' ? String(item.order) : '',
    })
    if (!checked.ok) return refuse(`${where}: ${checked.problems.join('; ')}`)
    apps.push({ id: item.id, updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : '', ...checked.fields })
  }

  return { ok: true, list: { kind: LIST_KIND, version: LIST_VERSION, title: titleOf(raw.title), summaryUrl, apps: ordered(apps) } }
}
