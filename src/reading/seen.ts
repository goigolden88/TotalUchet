/**
 * Архив увиденных срезов (Р-08) — хранилище `seen`.
 *
 * Последний увиденный срез приложения — запись с наибольшим `computedOn`:
 * по нему «Сводка» работает без сети (Р-05). Записи удалённого приложения
 * остаются — это история.
 */

import { db } from '../app/core.ts'
import { seenId, type Seen } from '../app/model.ts'
import type { Summary } from '../shared/core/summary.ts'
import { labelsFrom } from '../view/rows.ts'

/** Последний увиденный срез приложения; не видели — `undefined`. */
export async function lastSeen(app: string): Promise<Seen | undefined> {
  const all = await db.getByIndex('seen', 'app', app)
  let latest: Seen | undefined
  for (const one of all) {
    if (!latest || one.computedOn > latest.computedOn) latest = one
  }
  return latest
}

/** Последние увиденные срезы всех приложений: id приложения → запись. */
export async function lastSeenAll(apps: readonly string[]): Promise<Map<string, Seen>> {
  const found = new Map<string, Seen>()
  for (const app of apps) {
    const seen = await lastSeen(app)
    if (seen) found.set(app, seen)
  }
  return found
}

/**
 * Новый срез — в архив. Тот же день расчёта — та же запись: позднее
 * прочтение её перезаписывает (Р-08).
 */
export async function remember(app: string, sha: string, summary: Summary, readAt: string): Promise<Seen> {
  return db.put('seen', {
    id: seenId(app, summary.computedOn),
    updatedAt: readAt,
    app,
    computedOn: summary.computedOn,
    readAt,
    sha,
    summary,
  })
}

/** Отпечаток тот же — срез прежний, но проверен сейчас: новый `readAt` (Р-11). */
export async function confirm(seen: Seen, readAt: string): Promise<Seen> {
  return db.put('seen', { ...seen, readAt })
}

/**
 * Подписи строк по архиву — для строк связки, которых в последнем срезе нет
 * (Р-20): id приложения → ключ → подпись из самого позднего среза, где была.
 */
export async function archiveLabels(apps: readonly string[]): Promise<Map<string, Map<string, string>>> {
  const labels = new Map<string, Map<string, string>>()
  for (const app of new Set(apps)) labels.set(app, labelsFrom(await db.getByIndex('seen', 'app', app)))
  return labels
}
