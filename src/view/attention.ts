/**
 * «Зовут» — пункты «требует внимания» последних увиденных срезов (Р-06).
 *
 * По приложениям в их порядке, внутри — как отдал хозяин. Пункта нет —
 * хозяин не зовёт, а не «всё сделано» (Я-21): отсутствие не толкуется.
 */

import type { Attention, Summary } from '../shared/core/summary.ts'
import { ordered, openLink } from '../app/apps.ts'
import type { App } from '../app/model.ts'
import { formatNumber, shortDate } from './values.ts'

/** Пункт на экран. */
export type CallItem = {
  key: string
  label: string
  /** Счёт словами; `null` у хозяина — пусто. */
  count: string
  /** «за ДД.ММ» — к какому дню относится. */
  day: string
  basis: string
  /** Адрес экрана приложения: сайт и путь хеш-роутинга. */
  href: string
}

export type CallGroup = { app: App; items: CallItem[] }

export type Calls = {
  groups: CallGroup[]
  /**
   * Увиден ли хоть один срез. Нет — сказать «не зовут» не из чего:
   * блок не показывается, состояние чтения говорит у каждого приложения.
   */
  anySeen: boolean
}

function item(app: App, attention: Attention): CallItem {
  return {
    key: attention.key,
    label: attention.label,
    count: attention.count === null ? '' : formatNumber(attention.count),
    day: `за ${shortDate(attention.day)}`,
    basis: attention.basis,
    href: openLink(app.site, attention.link),
  }
}

/** Кто зовёт — по последним увиденным срезам: `latest` — срез по id приложения. */
export function calls(apps: readonly App[], latest: ReadonlyMap<string, Summary>): Calls {
  const groups: CallGroup[] = []
  let anySeen = false
  for (const app of ordered(apps)) {
    const summary = latest.get(app.id)
    if (!summary) continue
    anySeen = true
    if (summary.attention.length > 0) groups.push({ app, items: summary.attention.map((one) => item(app, one)) })
  }
  return { groups, anySeen }
}
