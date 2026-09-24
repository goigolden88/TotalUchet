/**
 * Ядро «Тотального Учёта» — собранное по его конфигу (Р-02).
 *
 * Код приложения берёт `db` отсюда. К хранилищу обращаются только через
 * этот `db`: напрямую в IndexedDB не ходит никто, кроме `shared/core/db.ts`.
 * Общий интерфейс ядра получает его контекстом — `<CoreProvider>` в `app.tsx`.
 *
 * `createSync` не вызывается: своей синхронизации нет (Р-02, Я-23).
 * `CoreProvider` ядра всё же требует синхронизацию — ему `noSync` (Р-09).
 */

import { createDb } from '../shared/core/db.ts'
import type { Sync, SyncConfig, SyncStatus } from '../shared/core/sync.ts'
import { config } from './config.ts'

export const db = createDb(config)

const OFF: SyncStatus = {
  state: 'off',
  pending: 0,
  lastAt: null,
  error: '',
  badToken: false,
  deferred: false,
}

const NO_CONFIG: SyncConfig = { enabled: false, repo: '', token: '', branch: '', tokenExpires: null }

/**
 * Синхронизация, которой нет (Р-09): всегда «выключено», в сеть не ходит,
 * в `settings` не пишет. Уйдёт, когда ядро сделает `sync` в `Core` необязательным.
 */
export const noSync: Sync = {
  readConfig: async () => NO_CONFIG,
  saveConfig: async () => {},
  forgetToken: async () => {},
  checkAccess: async () => {
    throw new Error('Синхронизации у приложения нет')
  },
  getStatus: () => OFF,
  subscribe: () => () => {},
  refreshStatus: async () => OFF,
  syncNow: async () => null,
}
