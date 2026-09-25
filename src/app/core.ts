/**
 * Ядро «Тотального Учёта» — собранное по его конфигу (Р-02).
 *
 * Код приложения берёт `db` отсюда. К хранилищу обращаются только через
 * этот `db`: напрямую в IndexedDB не ходит никто, кроме `shared/core/db.ts`.
 * Общий интерфейс ядра получает его контекстом — `<CoreProvider>` в `app.tsx`.
 *
 * `createSync` не вызывается: своей синхронизации нет (Р-02, Я-23).
 * `CoreProvider` получает `config` и `db`, без `sync` (Я-29, Р-16).
 */

import { createDb } from '../shared/core/db.ts'
import { config } from './config.ts'

export const db = createDb(config)
