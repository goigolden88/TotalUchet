/**
 * Сколько записей в базе — по хранилищам. Нужно «Что нового» (свежая
 * установка или обновившаяся копия) и «Настройкам» (есть ли что копировать).
 */

import { useEffect, useState } from 'react'
import { db } from '../app/core.ts'
import { STORES, type Store } from '../app/model.ts'
import { isEmptyBase } from '../shared/screens/firstRun.ts'

export type BaseCounts =
  | { counted: false; empty: false; counts: null; error: string }
  | { counted: true; empty: boolean; counts: Record<Store, number>; error: '' }

async function countAll(): Promise<Record<Store, number>> {
  await db.ready()
  const counts = {} as Record<Store, number>
  for (const store of STORES) counts[store] = await db.count(store)
  return counts
}

export function useBase(): BaseCounts {
  const [state, setState] = useState<BaseCounts>({ counted: false, empty: false, counts: null, error: '' })

  useEffect(() => {
    let alive = true
    const load = () =>
      countAll()
        .then((counts) => {
          if (alive) setState({ counted: true, empty: isEmptyBase(counts, STORES), counts, error: '' })
        })
        .catch((error: unknown) => {
          const text = error instanceof Error ? error.message : 'Неизвестная ошибка'
          if (alive) setState({ counted: false, empty: false, counts: null, error: text })
        })
    void load()
    const stop = db.onChange(() => void load())
    return () => {
      alive = false
      stop()
    }
  }, [])

  return state
}
