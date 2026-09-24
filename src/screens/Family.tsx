import { useState } from 'react'
import { checkApp, nextOrder, type AppInput } from '../app/apps.ts'
import { db } from '../app/core.ts'
import type { App } from '../app/model.ts'
import { nowIso } from '../shared/core/dates.ts'
import { ulid } from '../shared/core/id.ts'
import { useApps } from '../ui/useApps.ts'
import { Head } from './Head.tsx'
import { FAMILY_TAB, SUMMARY_TAB } from './tabs.ts'

/**
 * «Семья» — приложения семьи (Р-07). Список — записи человека, не код
 * (Я-16, Я-22). На Этапе 1 — добавить, поправить, убрать; порядок — числом
 * в той же форме (Р-10). Состояние среза у каждого и «Установить» — Этап 2.
 */
export function Family() {
  const apps = useApps()
  // null — формы нет; 'new' — новое приложение; иначе — правка этого.
  const [editing, setEditing] = useState<App | 'new' | null>(null)
  const [note, setNote] = useState('')

  async function drop(app: App) {
    if (!window.confirm(`Убрать «${app.name}» из семьи? Увиденные срезы останутся в архиве.`)) return
    await db.remove('apps', app.id)
    setNote(`«${app.name}» убрано`)
  }

  return (
    <>
      <Head title={FAMILY_TAB.name} />

      <section className="block">
        {apps && apps.length === 0 && editing === null && (
          <p className="muted">
            Приложений пока нет. Добавь те, чьи итоги хочешь видеть во вкладке «{SUMMARY_TAB.name}»: имя,
            репозиторий данных, из которого читать срез, и адрес сайта.
          </p>
        )}

        {apps && apps.length > 0 && (
          <ul className="plain family">
            {apps.map((app) => (
              <li key={app.id} className="family__app">
                <div>
                  <strong>{app.name}</strong>
                  <div className="muted">{app.dataRepo}</div>
                  <a href={app.site} target="_blank" rel="noopener">
                    {app.site}
                  </a>
                </div>
                <div className="row row--wrap">
                  <button type="button" className="btn" onClick={() => setEditing(app)}>
                    Поправить
                  </button>
                  <button type="button" className="btn btn--danger" onClick={() => void drop(app)}>
                    Убрать
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {editing === null ? (
          apps && (
            <div className="row">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  setEditing('new')
                  setNote('')
                }}
              >
                Добавить приложение
              </button>
            </div>
          )
        ) : (
          <AppForm
            key={editing === 'new' ? 'new' : editing.id}
            app={editing === 'new' ? null : editing}
            order={nextOrder(apps ?? [])}
            onDone={(text) => {
              setEditing(null)
              setNote(text)
            }}
          />
        )}

        {note && <p className="muted">{note}</p>}
      </section>
    </>
  )
}

function AppForm({ app, order, onDone }: { app: App | null; order: number; onDone: (note: string) => void }) {
  const [input, setInput] = useState<AppInput>(
    app
      ? { name: app.name, dataRepo: app.dataRepo, site: app.site, order: String(app.order) }
      : { name: '', dataRepo: '', site: '', order: String(order) },
  )
  const [problems, setProblems] = useState<string[]>([])

  function field(key: keyof AppInput) {
    return {
      name: key,
      value: input[key],
      onChange: (event: { target: { value: string } }) => {
        setInput({ ...input, [key]: event.target.value })
        setProblems([])
      },
    }
  }

  async function save() {
    const checked = checkApp(input)
    if (!checked.ok) {
      setProblems(checked.problems)
      return
    }
    await db.put('apps', app ? { ...app, ...checked.fields } : { id: ulid(), updatedAt: nowIso(), ...checked.fields })
    onDone(app ? `«${checked.fields.name}» поправлено` : `«${checked.fields.name}» добавлено`)
  }

  return (
    <form
      className="form"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <label className="field">
        <span>Имя — как подписывать на экранах</span>
        <input {...field('name')} autoComplete="off" />
      </label>
      <label className="field">
        <span>Репозиторий данных — «владелец/имя» или ссылка на него</span>
        <input {...field('dataRepo')} autoComplete="off" autoCapitalize="none" spellCheck={false} />
      </label>
      <label className="field">
        <span>Сайт приложения — адрес любого его экрана</span>
        <input {...field('site')} inputMode="url"autoComplete="off" autoCapitalize="none" spellCheck={false} />
      </label>
      <label className="field">
        <span>Порядок — меньше стоит выше</span>
        <input {...field('order')} inputMode="decimal" autoComplete="off" />
      </label>
      {problems.length > 0 && (
        <ul className="error">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      <div className="form__actions">
        <button type="button" className="btn" onClick={() => onDone('')}>
          Отмена
        </button>
        <button type="submit" className="btn btn--primary">
          Сохранить
        </button>
      </div>
    </form>
  )
}
