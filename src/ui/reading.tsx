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
 *
 * После прохода — имена репозиториев соседям в пустые места общей базы
 * (Р-34): `dbName` каждого узнаёт само чтение. Что лежит в общей базе,
 * держится здесь же — «Семья» сверяет с ним список.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { config } from '../app/config.ts'
import type { App } from '../app/model.ts'
import { brief, refreshApp, stored, type AppState } from '../reading/refresh.ts'
import { shareRepos } from '../reading/repos.ts'
import { lastSeenAll } from '../reading/seen.ts'
import { family } from '../shared/core/db.ts'
import { useApps } from './useApps.ts'
import { reloadToken, useToken } from './useToken.ts'

export type Reading = {
  /** Приложения в порядке человека; `null` — ещё читаются из базы. */
  apps: App[] | null
  /** Токен «семья» (Р-33); `undefined` — ещё читается, `null` — не вписан. */
  token: string | null | undefined
  /** Состояние по id приложения. */
  states: ReadonlyMap<string, AppState>
  /** Сколько приложений ещё читается. */
  reading: number
  /** Прочитать все заново. Без токена или приложений — ничего. */
  refresh: () => void
  /** Имена репозиториев в общей базе устройства по `dbName`; `undefined` — ещё читаются. */
  repos: Readonly<Record<string, string>> | undefined
  /** Записать имя в общую базу — действие человека, занятое переписывается (Я-37). */
  writeRepo: (dbName: string, repo: string) => Promise<void>
}

const ReadingContext = createContext<Reading | null>(null)

export function ReadingProvider({ children }: { children: ReactNode }) {
  const token = useToken()
  const apps = useApps()

  const [states, setStates] = useState<ReadonlyMap<string, AppState>>(new Map())
  const [reading, setReading] = useState(0)
  const [repos, setRepos] = useState<Readonly<Record<string, string>> | undefined>(undefined)
  // Итоги прежнего прохода — другого токена или списка — не показываются.
  const pass = useRef(0)

  // Общая база не открылась — прежнее остаётся: строки сверки просто нет.
  const reloadRepos = useCallback(async () => {
    try {
      setRepos((await family.read()).repos)
    } catch {
      // Сказать нечего: чтение срезов от этого не зависит.
    }
  }, [])

  useEffect(() => {
    void reloadRepos()
  }, [reloadRepos])

  const writeRepo = useCallback(
    async (dbName: string, repo: string) => {
      await family.setRepo(dbName, repo)
      await reloadRepos()
    },
    [reloadRepos],
  )

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
    // Соседнее приложение могло вписать своё имя, пока нас не было.
    void reloadRepos()
    const dbNames = new Map<string, string | null>()
    const reads = apps.map((app) =>
      refreshApp(app, token).then((state) => {
        if (pass.current !== current) return
        if (state.dbName !== undefined) dbNames.set(app.id, state.dbName)
        setStates((before) => {
          // Чтение не дошло до дерева — прежний `dbName` не забывается.
          const known = state.dbName === undefined ? before.get(app.id)?.dbName : state.dbName
          return new Map(before).set(app.id, { ...state, dbName: known })
        })
        setReading((left) => left - 1)
      }),
    )
    void Promise.all(reads).then(async () => {
      if (pass.current !== current) return
      try {
        await shareRepos(apps, dbNames, config.dbName)
      } catch {
        // Общая база не открылась — имена впишутся при следующем чтении.
      }
      await reloadRepos()
    })
    // Список сравнивается по appsKey: новый массив с теми же репозиториями — не повод читать заново.
  }, [token, appsKey])

  return (
    <ReadingContext.Provider value={{ apps, token, states, reading, refresh, repos, writeRepo }}>
      {children}
    </ReadingContext.Provider>
  )
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
 * список — тоже повод: `refresh` меняется вместе с ними. Токен «семья»
 * перечитывается при открытии: его могли заменить или забыть в соседнем
 * приложении (Р-33).
 */
export function useReadOnOpen(): Reading {
  const reading = useReading()
  useEffect(() => {
    void reloadToken()
  }, [])
  useEffect(reading.refresh, [reading.refresh])
  return reading
}
