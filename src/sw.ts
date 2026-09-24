/**
 * Service worker «Тотального Учёта» — точка входа `injectManifest`. Кеш,
 * работа без сети, автообновление — ядра (`shared/sw.ts`).
 *
 * Напоминаний нет (Р-06): фоновая проверка не регистрируется, и `remind`
 * не зовётся никогда.
 */

import { startWorker } from './shared/sw.ts'

startWorker({ remind: async () => undefined })
