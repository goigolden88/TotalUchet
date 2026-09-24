/**
 * Обновление одного приложения: чтение среза и архив вместе (Р-05, Р-08; Р-11, п. 2).
 *
 * Что бы ни случилось с чтением, показывается последний увиденный срез,
 * если он есть, — со своей датой прочтения. Ошибка одного приложения
 * остальных не трогает: у каждого своё состояние.
 */

import type { App, Seen } from '../app/model.ts'
import { shortDateTime } from '../view/values.ts'
import { readSummary, type Failure } from './read.ts'
import { confirm, lastSeen, remember } from './seen.ts'

export type AppState = {
  /** Что показать: свежий или последний увиденный срез. */
  seen: Seen | undefined
  /** `fresh` — прочитан сейчас; остальное — почему нет. */
  status: 'fresh' | 'none' | 'broken' | Failure
  /** Слова состояния; у свежего — пусто. */
  text: string
}

/** Прочитать срез приложения и положить новый в архив. Не кидает. */
export async function refreshApp(
  app: Pick<App, 'id' | 'dataRepo'>,
  token: string,
  options: { fetch?: typeof globalThis.fetch; now?: () => string } = {},
): Promise<AppState> {
  const now = options.now ?? (() => new Date().toISOString())
  const last = await lastSeen(app.id)
  const result = await readSummary({ dataRepo: app.dataRepo, token, lastSha: last?.sha ?? null, fetch: options.fetch })

  switch (result.kind) {
    case 'new':
      return { seen: await remember(app.id, result.sha, result.summary, now()), status: 'fresh', text: '' }
    case 'same':
      // Тот же отпечаток бывает только у увиденного, но база могла опустеть между шагами.
      return last
        ? { seen: await confirm(last, now()), status: 'fresh', text: '' }
        : { seen: undefined, status: 'other', text: 'срез пропал из архива — нажми «Обновить»' }
    case 'none':
    case 'broken':
      return { seen: last, status: result.kind, text: result.text }
    case 'failed':
      return { seen: last, status: result.failure, text: result.text }
  }
}

/** Состояние, пока не читали: последний увиденный из архива, без сети. */
export function stored(seen: Seen | undefined): AppState {
  return { seen, status: 'fresh', text: '' }
}

/**
 * Строка состояния над блоком приложения. Свежему — пусто. Без сети —
 * «прочитан ДД.ММ ЧЧ:ММ, сейчас нет связи»; иначе — слова причины и,
 * если есть что показать, когда прочитан показанный срез.
 */
export function stateLine(state: AppState): string {
  if (state.status === 'fresh') return ''
  const read = state.seen ? `прочитан ${shortDateTime(state.seen.readAt)}` : ''
  if (state.status === 'offline') return read ? `${read}, сейчас нет связи` : 'нет связи, срез ещё не читали'
  return read ? `${state.text}; ниже — срез, ${read}` : state.text
}
