/**
 * Записи «Тотального Учёта» — типы, хранилища, версия схемы.
 *
 * Источник истины — docs/02-Архитектура.md, «Модель данных». Своих записей
 * о жизни здесь нет: только список приложений семьи и увиденные срезы.
 * Синхронизации нет (Р-02), но записи — с `Base` ядра: файл-копия сливается
 * по записи, а синхронизация, если понадобится, добавится без миграции.
 */

import type { DateStr } from '../shared/core/dates.ts'
import type { Base, Migration } from '../shared/core/model.ts'
import type { Summary } from '../shared/core/summary.ts'

/** Версия схемы. Растёт с каждым шагом миграции. */
export const SCHEMA_VERSION = 1

/** Шаги перехода схемы. На версии 1 мигрировать нечего. */
export const MIGRATIONS: readonly Migration[] = []

/**
 * Приложение семьи — запись человека, не код (Я-16, Я-22): у друга свои.
 * `id` — ULID.
 */
export type App = Base & {
  /** Подпись на экранах: «Делу Время»; вписывает человек. */
  name: string
  /** Репозиторий данных «владелец/имя»: откуда читать summary.json. */
  dataRepo: string
  /** Адрес сайта приложения со слешем в конце — для ссылок «открыть». */
  site: string
  /** Порядок на «Сводке» и в «Семье». */
  order: number
}

/**
 * Увиденный срез (Р-08). Архив на устройстве: по одной записи на приложение
 * и день расчёта.
 *
 * `id` — `seenId(app, computedOn)`, не ULID: один срез, прочитанный дважды
 * или на двух устройствах, — одна запись; позднее прочтение того же дня
 * расчёта её перезаписывает.
 */
export type Seen = Base & {
  /** id записи App. */
  app: string
  /** День расчёта среза — он же в id. */
  computedOn: DateStr
  /** ISO 8601: когда прочитан. */
  readAt: string
  /** Отпечаток файла в репозитории данных: тот же — не скачивать заново. */
  sha: string
  /** Как пришёл, после parseSummary. */
  summary: Summary
}

/** id увиденного среза: приложение и день расчёта (Р-08). */
export function seenId(app: string, computedOn: DateStr): string {
  return `${app}:${computedOn}`
}

/** Хранилище → тип записи. Это `R` для `AppConfig<R>` ядра. */
export type StoreRecord = {
  apps: App
  seen: Seen
}

export type Store = keyof StoreRecord

/** Все хранилища. Имена лежат в базе на устройствах и не меняются. */
export const STORES: readonly Store[] = ['apps', 'seen']
