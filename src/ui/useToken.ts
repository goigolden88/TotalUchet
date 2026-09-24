/**
 * Токен чтения (Я-16, Я-27, Р-02): `settings.readToken` устройства.
 *
 * Не синхронизируется и в файл-копию не входит — `settings` ядра туда
 * не попадает. На экран не выводится: только «вписан» или «не вписан».
 * Экраны узнают о замене сразу — «Сводка» читает новым токеном.
 */

import { useEffect, useSyncExternalStore } from 'react'
import { db } from '../app/core.ts'

/** Ключ в `settings` — по Архитектуре, «Настройки устройства». */
export const TOKEN_KEY = 'readToken'

/** `undefined` — ещё не прочитан из базы; `null` — не вписан. */
let current: string | null | undefined
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

function publish(token: string | null): void {
  current = token
  for (const listener of listeners) listener()
}

function load(): Promise<void> {
  loading ??= db.settings.get<string>(TOKEN_KEY).then((value) => publish(typeof value === 'string' && value !== '' ? value : null))
  return loading
}

/** Вписать. Пробелы по краям — след копирования, не часть токена. */
export async function saveToken(input: string): Promise<void> {
  const token = input.trim()
  if (token === '') return forgetToken()
  await db.settings.set(TOKEN_KEY, token)
  publish(token)
}

export async function forgetToken(): Promise<void> {
  await db.settings.remove(TOKEN_KEY)
  publish(null)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Токен устройства: `undefined`, пока читается из базы. */
export function useToken(): string | null | undefined {
  useEffect(() => {
    void load()
  }, [])
  return useSyncExternalStore(subscribe, () => current)
}
