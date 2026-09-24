import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { App } from '../app/model.ts'
import { CHANGES } from '../changes.ts'
import { refreshApp, stateLine, stored, type AppState } from '../reading/refresh.ts'
import { lastSeenAll } from '../reading/seen.ts'
import { formatDateLong, formatPeriod } from '../shared/core/dates.ts'
import type { Summary as Slice, SummaryPeriod } from '../shared/core/summary.ts'
import { WhatsNew } from '../shared/screens/WhatsNew.tsx'
import { useWhatsNew } from '../shared/screens/useWhatsNew.ts'
import { useToday } from '../shared/ui/useToday.ts'
import { useApps } from '../ui/useApps.ts'
import { useBase } from '../ui/useBase.ts'
import { useTitle } from '../ui/useTitle.ts'
import { useToken } from '../ui/useToken.ts'
import { calls } from '../view/attention.ts'
import { CHOICES, DEFAULT_CHOICE, findPeriod, freshness, screenPeriod, type Choice } from '../view/periods.ts'
import { formatValue } from '../view/values.ts'
import { Head } from './Head.tsx'
import { FAMILY_TAB } from './tabs.ts'

/** Состояния, которые — не ошибка: срез не отдают или сейчас нет связи. */
const CALM: ReadonlySet<AppState['status']> = new Set(['fresh', 'none', 'offline'])

/**
 * «Сводка» — главный экран (Р-04, Р-06). Сверху «Зовут», ниже — отрезок
 * переключателем и блок каждого приложения. Показывает, а не досчитывает
 * (Я-15): строки — в порядке хозяина, значение — одно за раз.
 *
 * Сразу — последние увиденные срезы из архива; затем каждое приложение
 * читается само по себе, ошибка одного не трогает остальных (Р-05).
 * Читается при открытии и кнопкой «Обновить», в фоне — нет.
 */
export function Summary() {
  const title = useTitle()
  const day = useToday()
  const base = useBase()
  const whatsNew = useWhatsNew(base, CHANGES)
  const token = useToken()
  const apps = useApps()

  const [choice, setChoice] = useState<Choice>(DEFAULT_CHOICE)
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

  useEffect(refresh, [refresh])

  const screen = screenPeriod(choice, day)
  const latest = useMemo(() => {
    const map = new Map<string, Slice>()
    for (const [app, state] of states) if (state.seen) map.set(app, state.seen.summary)
    return map
  }, [states])
  const calling = apps ? calls(apps, latest) : null

  return (
    <>
      <Head title={title}>
        <p className="muted">{formatDateLong(day)}</p>
      </Head>

      {whatsNew.show.length > 0 && <WhatsNew changes={whatsNew.show} onDone={whatsNew.dismiss} />}

      {token === null && (
        <section className="block">
          <p className="stub">
            Не настроено: нет токена чтения. Впиши его в <Link to="/settings">«Настройках»</Link> — без него
            срезы приложений не читаются.
          </p>
        </section>
      )}

      {apps?.length === 0 && (
        <section className="block">
          <p className="stub">
            Приложений пока нет. Добавь их во вкладке <Link to={FAMILY_TAB.to}>«{FAMILY_TAB.name}»</Link> — здесь
            появятся их неделя и месяц, как их посчитали сами приложения, и кто из них зовёт.
          </p>
        </section>
      )}


      {token && apps && apps.length > 0 && (
        <div className="row refresh">
          <button type="button" className="btn" onClick={refresh} disabled={reading > 0}>
            {reading > 0 ? 'Читаю…' : 'Обновить'}
          </button>
        </div>
      )}

      {calling?.anySeen && (
        <section className="block calls">
          <h2>Зовут</h2>
          {calling.groups.length === 0 ? (
            <p className="muted">Приложения сейчас не зовут.</p>
          ) : (
            calling.groups.map((group) => (
              <div key={group.app.id} className="calls__app">
                <h3 className="unit__name">{group.app.name}</h3>
                <ul className="plain">
                  {group.items.map((item) => (
                    <li key={item.key} className="call">
                      <div className="call__head">
                        <span>
                          {item.label}
                          {item.count && <strong> · {item.count}</strong>}
                          <span className="muted"> · {item.day}</span>
                        </span>
                        <a href={item.href} target="_blank" rel="noopener">
                          открыть
                        </a>
                      </div>
                      <div className="basis">{item.basis}</div>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>
      )}

      {apps && apps.length > 0 && (
        <>
          <div className="switch" role="group" aria-label="Отрезок">
            {CHOICES.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === choice ? 'switch__btn switch__btn--on' : 'switch__btn'}
                aria-pressed={item.id === choice}
                onClick={() => setChoice(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <p className="muted period">{formatPeriod(screen)}</p>

          {apps.map((app) => (
            <AppBlock key={app.id} app={app} state={states.get(app.id)} screen={screen} />
          ))}
        </>
      )}
    </>
  )
}

/** Блок приложения: свежесть, состояние чтения, отрезок и строки хозяина. */
function AppBlock({ app, state, screen }: { app: App; state: AppState | undefined; screen: SummaryPeriod }) {
  const summary = state?.seen?.summary
  const line = state ? stateLine(state) : ''
  const view = summary ? findPeriod(summary, screen) : null

  return (
    <section className="block slice">
      <h2>{app.name}</h2>
      {summary && <p className="muted">{freshness(summary)}</p>}
      {line && <p className={state && CALM.has(state.status) ? 'muted' : 'error'}>{line}</p>}
      {!state && <p className="muted">…</p>}

      {view && !view.found && <p className="muted">{view.text}</p>}
      {view?.found && (
        <>
          {view.going && <p className="muted">{view.going}</p>}
          {'unknown' in view.period.metrics ? (
            <p className="muted">{formatValue(view.period.metrics).text}</p>
          ) : (
            <ul className="plain metrics">
              {view.period.metrics.map((metric) => {
                const value = formatValue(metric.value)
                return (
                  <li key={metric.key} className="metric">
                    <div className="metric__row">
                      <span>{metric.label}</span>
                      <span className={value.muted ? 'metric__value muted' : 'metric__value'}>{value.text}</span>
                    </div>
                    <div className="basis">{metric.basis}</div>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
