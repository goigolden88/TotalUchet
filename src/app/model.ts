/**
 * Записи «Тотального Учёта» — типы, хранилища, версия схемы.
 *
 * Источник истины — docs/02-Архитектура.md, «Модель данных». Своих записей
 * о жизни здесь нет: только список приложений семьи, увиденные срезы
 * и связки строк соседей.
 * Синхронизации нет (Р-02), но записи — с `Base` ядра: файл-копия сливается
 * по записи, а синхронизация, если понадобится, добавится без миграции.
 */

import type { DateStr } from '../shared/core/dates.ts'
import type { Base, Migration } from '../shared/core/model.ts'
import type { Summary } from '../shared/core/summary.ts'

/** Версия схемы. Растёт с каждым шагом миграции. */
export const SCHEMA_VERSION = 2

/**
 * Шаги перехода схемы. Новое хранилище заводит только миграция: свежая база
 * строится как версия 1 и проходит те же шаги, что установленная (Я-08).
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    to: 2,
    note: 'хранилище bundles — связки строк соседей (Р-18)',
    additive: true,
    run: (database) => {
      database.createObjectStore('bundles', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt')
    },
  },
]

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

/** Строка среза в связке: приложение и ключ строки у него. */
export type BundleRow = {
  /** id записи App. */
  app: string
  /** `key` показателя в срезе приложения. Подпись не хранится — её отдаёт хозяин. */
  key: string
}

/**
 * Связка (Р-17): строки разных приложений про одно и то же — рядом на
 * «Сводке», без счёта между ними (Я-15). Запись человека, не код (Я-22).
 * `id` — ULID.
 */
export type Bundle = Base & {
  /** Имя связки — вписывает человек. */
  name: string
  /** Порядок на «Сводке» и в «Семье», как у App. */
  order: number
  rows: BundleRow[]
}

/** Хранилище → тип записи. Это `R` для `AppConfig<R>` ядра. */
export type StoreRecord = {
  apps: App
  seen: Seen
  bundles: Bundle
}

export type Store = keyof StoreRecord

/** Все хранилища. Имена лежат в базе на устройствах и не меняются. */
export const STORES: readonly Store[] = ['apps', 'seen', 'bundles']

/** Хранилища версии 1 — заморожены (Я-08): позднейшие заводят миграции. */
export const V1_STORES: readonly Store[] = ['apps', 'seen']
