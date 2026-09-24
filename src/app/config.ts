/**
 * Конфиг «Тотального Учёта» для ядра (Р-02, Я-23).
 *
 * Источник истины — docs/02-Архитектура.md, «Конфиг» и «Раскладка на
 * будущее». `dbName`, `v1Stores`, `indexes` и `places` заморожены после
 * первого релиза (Я-08, Я-09): правка — только шагом миграции.
 */

import type { AppConfig } from '../shared/core/model.ts'
import { DEFAULT_TITLE } from '../ui/title.ts'
import { MIGRATIONS, SCHEMA_VERSION, STORES, type StoreRecord } from './model.ts'

export const config: AppConfig<StoreRecord> = {
  name: DEFAULT_TITLE,
  // Вписан в договор семьи, «Устройство и origin» (Я-23).
  dbName: 'totaluchet',
  schemaVersion: SCHEMA_VERSION,
  migrations: MIGRATIONS,
  stores: STORES,
  v1Stores: STORES,
  indexes: {
    apps: [],
    // Последний увиденный срез приложения — по его записям.
    seen: ['app'],
  },
  // Синхронизации нет, но места выбраны сразу: она добавится без миграции
  // (Р-02, Р-08).
  places: {
    apps: { split: 'none', path: 'apps.json' },
    seen: { split: 'month', dir: 'seen', dateOf: (record) => record.computedOn },
  },
  storeNotes: {
    apps: 'приложения семьи: имя, репозиторий данных, сайт, порядок',
    seen: 'увиденные срезы итогов приложений — по месяцам дня расчёта',
  },
  // Импорта нет — заглушки (Я-23); createImporting не вызывается.
  importFormat: '',
  promptRules: [],
  about: {
    data: 'список приложений семьи и увиденные срезы их итогов',
    privacy: 'внутри итоги недель и месяцев из приложений семьи',
    sources: '',
  },
  // Своего среза метаприложение не отдаёт.
}
