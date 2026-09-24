/**
 * Чтение срезов — одно на «Сводку» и «Семью» (Р-13).
 *
 * Архив, проход чтения и «Обновить» живут здесь, над маршрутами, а экраны
 * их только показывают: иначе состояние пропадало бы при переходе между
 * вкладками, и два экрана держали бы два разных итога.
 *
 * Сам провайдер не читает. Читает экран при открытии — `useReadOnOpen` (Р-05):
 * в фоне — нет. Сразу — последние увиденные срезы из архива: без сети это
 * всё, что есть. Каждое приложение читается само по себе, ошибка одного
 * не трогает остальных.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { App } from '../app/model.ts'
import { brief, refreshApp, stored, type AppState } from '../reading/refresh.ts'
import { lastSeenAll } from '../reading/seen.ts'
import { useApps } from './useApps.ts'
import { useToken } from './useToken.ts'

export type Reading = {
  /** Приложения в порядке человека; `null` — ещё читаются из базы. */
  apps: App[] | null
  /** Токен чтения; `undefined` — ещё читается, `null` — не вписан. */
  token: string | null | undefined
  /** Состояние по id приложения. */
  states: ReadonlyMap<string, AppState>
  /** Сколько приложений ещё читается. */
  reading: number
  /** Прочитать все заново. Без токена или приложений — ничего. */
  refresh: () => void
}

const ReadingContext = createContext<Reading | null>(null)

export function ReadingProvider({ children }: { children: ReactNode }) {
  const token = useToken()
  const apps = useApps()

  const [states, setStates] = useState<ReadonlyMap<string, AppState>>(new Map())
  const [reading, setReading] = useState(0)
  // Итоги прежнего прохода — другого токена или списка — не показываются.
  const pass = useRef(0)

  const appsKey = apps?.map((app) => `${app.id}:${app.dataRepo}`).join('|')

  // Архив — сразу: без сети это всё, что есть.
  useEffect(() => {
    if (!apps) return
    let alive = true
    void lastSeenAll(apps.map((app) => app.id)).then((found) => {
      if (!alive) return
      setStates((before) => {
        const next = new Map(before)
        for (const app of apps) if (!next.has(app.id)) next.set(app.id, stored(found.get(app.id)))
        return next
      })
    })
    return () => {
      alive = false
    }
    // Список сравнивается по appsKey: новый массив с теми же репозиториями — не повод читать заново.
  }, [appsKey])

  const refresh = useCallback(() => {
    if (!token || !apps || apps.length === 0) return
    const current = ++pass.current
    setReading(apps.length)
    for (const app of apps) {
      void refreshApp(app, token).then((state) => {
        if (pass.current !== current) return
        setStates((before) => new Map(before).set(app.id, state))
        setReading((left) => left - 1)
      })
    }
    // Список сравнивается по appsKey: новый массив с теми же репозиториями — не повод читать заново.
  }, [token, appsKey])

  return <ReadingContext.Provider value={{ apps, token, states, reading, refresh }}>{children}</ReadingContext.Provider>
}

export function useReading(): Reading {
  const reading = useContext(ReadingContext)
  if (!reading) throw new Error('useReading — только внутри ReadingProvider')
  return reading
}

/**
 * Итог у свёрнутого блока приложения (Р-13): слова — `brief`, ошибка — красным.
 * Пусто — `undefined`: `Fold` тогда не ставит «·» у заголовка.
 */
export function foldSummary(state: AppState | undefined): ReactNode {
  const said = brief(state)
  if (!said) return undefined
  return said.error ? <span className="error">{said.text}</span> : said.text
}

/**
 * Чтение при открытии экрана (Р-05, Р-13). Новый токен или поправленный
 * список — тоже повод: `refresh` меняется вместе с ними.
 */
export function useReadOnOpen(): Reading {
  const reading = useReading()
  useEffect(reading.refresh, [reading.refresh])
  return reading
}
