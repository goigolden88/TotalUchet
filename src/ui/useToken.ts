/**
 * Токен «семья» для чтения срезов (Р-33, Я-36): из общей базы ядра,
 * `family.read().token`, — тот же, которым синхронизируются все приложения
 * семьи на устройстве. Своего токена у «Тотального Учёта» нет.
 *
 * Вписывают, меняют и забывают его в «Синхронизации» — здесь или в любом
 * приложении семьи. Подписки у общей базы нет, поэтому токен перечитывается:
 * при запуске, при открытии «Сводки», «Семьи» и «Настроек» (`reloadToken`)
 * и при возврате на вкладку — замена в соседнем приложении видна без
 * перезапуска. На экран не выводится: только «есть» или «нет».
 */

import { useEffect, useSyncExternalStore } from 'react'
import { db } from '../app/core.ts'
import { family } from '../shared/core/db.ts'

/**
 * Где лежал прежний токен чтения (Я-16, Я-27). Читать его некому: при запуске
 * он удаляется (`dropReadToken`) и в общую базу не переносится никогда —
 * токен только на чтение на месте «семьи» сломал бы запись всем приложениям.
 */
export const OLD_TOKEN_KEY = 'readToken'

/** `undefined` — ещё не прочитан из базы; `null` — не вписан. */
let current: string | null | undefined
const listeners = new Set<() => void>()

function publish(token: string | null): void {
  if (token === current) return
  current = token
  for (const listener of listeners) listener()
}

/**
 * Перечитать токен из общей базы. Не открылась — прежнее значение остаётся;
 * при первом чтении — «нет токена»: экран не висит на «читаю».
 */
export async function reloadToken(): Promise<void> {
  try {
    publish((await family.read()).token)
  } catch {
    if (current === undefined) publish(null)
  }
}

/** Последний прочитанный токен — снимок для экрана. */
export function currentToken(): string | null | undefined {
  return current
}

/** Прежний токен чтения — с устройства (Р-33). Нет его — ничего. */
export async function dropReadToken(): Promise<void> {
  await db.settings.remove(OLD_TOKEN_KEY)
}

function onVisible(): void {
  if (document.visibilityState === 'visible') void reloadToken()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) {
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }
}

/** Токен «семья»: `undefined`, пока читается из общей базы. Перечитывается при появлении. */
export function useToken(): string | null | undefined {
  useEffect(() => {
    void reloadToken()
  }, [])
  return useSyncExternalStore(subscribe, currentToken)
}
