/**
 * Ядро «Тотального Учёта» — собранное по его конфигу (Р-02).
 *
 * Код приложения берёт `db` отсюда. К хранилищу обращаются только через
 * этот `db`: напрямую в IndexedDB не ходит никто, кроме `shared/core/db.ts`.
 * Общий интерфейс ядра получает его контекстом — `<CoreProvider>` в `app.tsx`.
 *
 * Синхронизация своих записей — ядром, токеном «семья» (Р-33, Я-36):
 * `apps`, `seen`, `bundles` в свой репозиторий данных. `sync` — тоже
 * в `CoreProvider`.
 */

import { createDb } from '../shared/core/db.ts'
import { createSync } from '../shared/core/sync.ts'
import { config } from './config.ts'

export const db = createDb(config)
export const sync = createSync(config, db)
