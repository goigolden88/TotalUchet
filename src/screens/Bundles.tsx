import { useState } from 'react'
import { Link } from 'react-router-dom'
import { nextOrder } from '../app/apps.ts'
import { checkBundle, rowId, takenRows } from '../app/bundles.ts'
import { db } from '../app/core.ts'
import type { App, Bundle, BundleRow } from '../app/model.ts'
import type { AppState } from '../reading/refresh.ts'
import { nowIso } from '../shared/core/dates.ts'
import { ulid } from '../shared/core/id.ts'
import type { SummaryPeriod } from '../shared/core/summary.ts'
import { Fold } from '../shared/ui/Fold.tsx'
import { bundleBrief, bundleView, formOptions, type ArchiveLabels, type RowOption } from '../view/bundles.ts'
import { FAMILY_TAB, SUMMARY_TAB } from './tabs.ts'

/** Адрес связки в «Семье»: там её форма открыта (Р-21). */
export function bundleLink(bundle: Bundle): string {
  return `${FAMILY_TAB.to}?bundle=${encodeURIComponent(bundle.id)}`
}

type Shared = {
  apps: readonly App[]
  states: ReadonlyMap<string, AppState>
  archive: ArchiveLabels
}

/**
 * Связка на «Сводке» (Р-19): по приложениям со своей свежестью, строки —
 * в порядке хозяина, с основанием. Только раскладка — между строками ничего
 * не считается (Я-15).
 */
export function BundleBlock({ bundle, screen, apps, states, archive }: Shared & { bundle: Bundle; screen: SummaryPeriod }) {
  const views = bundleView(bundle, apps, states, screen, archive)
  return (
    <Fold id={`summary:bundle:${bundle.id}`} title={bundle.name} summary={bundleBrief(bundle, apps)}>
      {views.length === 0 && <p className="muted">В связке нет строк приложений из «{FAMILY_TAB.name}».</p>}
      {views.map((view) => (
        <div key={view.app.id} className="bundle__app">
          <h3 className="unit__name">{view.app.name}</h3>
          {view.fresh && <p className="muted">{view.fresh}</p>}
          {view.notes.map((note) => (
            <p key={note.text} className={note.calm ? 'muted' : 'error'}>
              {note.text}
            </p>
          ))}
          {view.going && <p className="muted">{view.going}</p>}
          {view.rows.length > 0 && (
            <ul className="plain metrics">
              {view.rows.map((row) =>
                row.kind === 'value' ? (
                  <li key={row.key} className="metric">
                    <div className="metric__row">
                      <span>{row.label}</span>
                      <span className={row.value.muted ? 'metric__value muted' : 'metric__value'}>{row.value.text}</span>
                    </div>
                    <div className="basis">{row.basis}</div>
                  </li>
                ) : (
                  <li key={row.key} className="metric muted">
                    {row.text}
                    {row.fix && (
                      <>
                        {' — '}
                        <Link to={bundleLink(bundle)}>поправь связку</Link>
                      </>
                    )}
                  </li>
                ),
              )}
            </ul>
          )}
        </div>
      ))}
      <div className="row">
        <Link to={bundleLink(bundle)}>поправить</Link>
      </div>
    </Fold>
  )
}

/**
 * «Семья» → «Связки» (Р-21): связки — записи человека, правятся здесь.
 * `target` — связка, к которой пришли ссылкой со «Сводки»: её форма открыта.
 */
export function BundlesSection({
  bundles,
  target,
  onTargetDone,
  apps,
  states,
  archive,
}: Shared & { bundles: readonly Bundle[]; target: string | null; onTargetDone: () => void }) {
  // null — формы нет; 'new' — новая связка; иначе — id правки.
  const [editing, setEditing] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const current = editing ?? (target && bundles.some((bundle) => bundle.id === target) ? target : null)

  async function drop(bundle: Bundle) {
    if (!window.confirm(`Убрать связку «${bundle.name}»? Строки останутся у своих приложений.`)) return
    await db.remove('bundles', bundle.id)
    setNote(`Связка «${bundle.name}» убрана`)
  }

  function start(target: string) {
    setEditing(target)
    setNote('')
  }

  function done(text: string) {
    setEditing(null)
    setNote(text)
    onTargetDone()
  }

  const summary = bundles.length === 0 ? 'нет' : bundles.map((bundle) => bundle.name).join(', ')
  return (
    <Fold id="family:bundles" title="Связки" summary={summary} reveal={current !== null}>
      <p className="muted">
        Связка ставит рядом во вкладке «{SUMMARY_TAB.name}» строки разных приложений про одно и то же. Ничего не
        складывает и не сравнивает: каждая строка — как её посчитало своё приложение, со своим основанием и датой.
      </p>

      {bundles.map((bundle) => {
        const open = current === bundle.id
        return (
          <Fold
            key={bundle.id}
            id={`family:bundle:${bundle.id}`}
            title={bundle.name}
            summary={bundleBrief(bundle, apps)}
            reveal={open}
            sub
          >
            {open ? (
              <BundleForm bundle={bundle} bundles={bundles} apps={apps} states={states} archive={archive} onDone={done} />
            ) : (
              <div className="family__app">
                <BundleRows bundle={bundle} apps={apps} states={states} archive={archive} />
                <div className="row row--wrap">
                  <button type="button" className="btn" onClick={() => start(bundle.id)}>
                    Поправить
                  </button>
                  <button type="button" className="btn btn--danger" onClick={() => void drop(bundle)}>
                    Убрать
                  </button>
                </div>
              </div>
            )}
          </Fold>
        )
      })}

      {current === 'new' ? (
        <BundleForm key="new" bundle={null} bundles={bundles} apps={apps} states={states} archive={archive} onDone={done} />
      ) : (
        <div className="row">
          <button type="button" className="btn btn--primary" onClick={() => start('new')}>
            Новая связка
          </button>
        </div>
      )}
      {note && <p className="muted">{note}</p>}
    </Fold>
  )
}

/** Строки связки словами: приложение и подпись; пропавшие и убранные — с пометкой (Р-20). */
function BundleRows({ bundle, apps, states, archive }: Shared & { bundle: Bundle }) {
  const form = formOptions(bundle.rows, apps, states, archive, new Map())
  const own = new Set(bundle.rows.map(rowId))
  const lines = form.apps.flatMap((group) =>
    group.options
      .filter((option) => own.has(rowId(option.row)))
      .map((option) => ({ id: rowId(option.row), text: `${group.app.name} — ${option.label}`, mark: option.missing ? MISSING : '' })),
  )
  for (const option of form.removed) lines.push({ id: rowId(option.row), text: option.label, mark: REMOVED })
  return (
    <ul className="plain">
      {lines.map((line) => (
        <li key={line.id}>
          {line.text}
          {line.mark && <span className="muted"> · {line.mark}</span>}
        </li>
      ))}
    </ul>
  )
}

const MISSING = 'нет в последнем срезе'
const REMOVED = 'приложение убрано'

function BundleForm({
  bundle,
  bundles,
  apps,
  states,
  archive,
  onDone,
}: Shared & { bundle: Bundle | null; bundles: readonly Bundle[]; onDone: (note: string) => void }) {
  const [name, setName] = useState(bundle?.name ?? '')
  const [order, setOrder] = useState(String(bundle?.order ?? nextOrder(bundles)))
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set((bundle?.rows ?? []).map(rowId)))
  const [problems, setProblems] = useState<string[]>([])

  const taken = takenRows(bundles, bundle?.id ?? null)
  const form = formOptions(bundle?.rows ?? [], apps, states, archive, taken)
  const all: RowOption[] = [...form.apps.flatMap((group) => group.options), ...form.removed]

  function toggle(row: BundleRow) {
    const next = new Set(chosen)
    const id = rowId(row)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setChosen(next)
    setProblems([])
  }

  async function save() {
    const rows = all.filter((option) => chosen.has(rowId(option.row))).map((option) => option.row)
    const checked = checkBundle({ name, order, rows }, taken)
    if (!checked.ok) {
      setProblems(checked.problems)
      return
    }
    await db.put('bundles', bundle ? { ...bundle, ...checked.fields } : { id: ulid(), updatedAt: nowIso(), ...checked.fields })
    onDone(bundle ? `Связка «${checked.fields.name}» поправлена` : `Связка «${checked.fields.name}» заведена`)
  }

  const box = (option: RowOption, mark: string) => (
    <label key={rowId(option.row)} className="check">
      <input
        type="checkbox"
        checked={chosen.has(rowId(option.row))}
        disabled={option.taken !== null}
        onChange={() => toggle(option.row)}
      />
      <span>
        {option.label}
        {option.taken !== null && <span className="muted"> · в связке «{option.taken}»</span>}
        {mark && <span className="muted"> · {mark}</span>}
      </span>
    </label>
  )

  return (
    <form
      className="form"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <label className="field">
        <span>Имя связки</span>
        <input name="bundleName" value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" />
      </label>
      <label className="field">
        <span>Порядок — меньше стоит выше</span>
        <input name="bundleOrder" value={order} onChange={(event) => setOrder(event.target.value)} inputMode="decimal" autoComplete="off" />
      </label>

      {form.apps.map((group) => (
        <fieldset key={group.app.id} className="bundle__pick">
          <legend className="unit__name">{group.app.name}</legend>
          {group.note && <p className="muted">{group.note}</p>}
          {group.options.map((option) => box(option, option.missing ? MISSING : ''))}
        </fieldset>
      ))}
      {form.removed.length > 0 && (
        <fieldset className="bundle__pick">
          <legend className="unit__name">Убранные из «{FAMILY_TAB.name}»</legend>
          {form.removed.map((option) => box(option, REMOVED))}
        </fieldset>
      )}

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
