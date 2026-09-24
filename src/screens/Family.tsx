import { Head } from './Head.tsx'
import { FAMILY_TAB, SUMMARY_TAB } from './tabs.ts'

/**
 * «Семья» — приложения семьи: ссылка, состояние среза, как установить (Р-07).
 * На Этапе 0 — каркас; добавить приложение — Этап 1, остальное — Этап 2.
 */
export function Family() {
  return (
    <>
      <Head title={FAMILY_TAB.name} />

      <section className="block">
        <p className="stub">
          Здесь будут приложения семьи: ссылка на каждое и что с его срезом итогов. Отсюда же их
          добавляют — тогда они появятся во вкладке «{SUMMARY_TAB.name}».
        </p>
      </section>
    </>
  )
}
