/**
 * Своё название на устройстве (Р-03): чтение, запись и заголовок вкладки.
 *
 * Название живёт здесь, в памяти, и приходит в экраны хуком: шапка
 * и заголовок вкладки меняются сразу после сохранения в «Настройках».
 * Правило «что показать» — `title.ts`.
 */

import { useSyncExternalStore } from 'react'
import { db } from '../app/core.ts'
import { titleOf, titleToSave, TITLE_KEY } from './title.ts'

let current = titleOf(undefined)
const listeners = new Set<() => void>()

function publish(title: string): void {
  current = title
  document.title = title
  for (const listener of listeners) listener()
}

/** Прочитать своё название до первого экрана — шапка не мигает именем по умолчанию. */
export async function loadTitle(): Promise<void> {
  publish(titleOf(await db.settings.get<string>(TITLE_KEY)))
}

/** Сохранить из поля ввода. Пустое или имя по умолчанию — своего нет. */
export async function saveTitle(input: string): Promise<void> {
  const value = titleToSave(input)
  if (value === null) await db.settings.remove(TITLE_KEY)
  else await db.settings.set(TITLE_KEY, value)
  publish(titleOf(value))
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Название для шапки и текстов. */
export function useTitle(): string {
  return useSyncExternalStore(subscribe, () => current)
}
