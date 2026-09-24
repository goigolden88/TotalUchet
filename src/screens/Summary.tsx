import { CHANGES } from '../changes.ts'
import { formatDateLong } from '../shared/core/dates.ts'
import { WhatsNew } from '../shared/screens/WhatsNew.tsx'
import { useWhatsNew } from '../shared/screens/useWhatsNew.ts'
import { useToday } from '../shared/ui/useToday.ts'
import { useBase } from '../ui/useBase.ts'
import { useTitle } from '../ui/useTitle.ts'
import { Head } from './Head.tsx'
import { FAMILY_TAB } from './tabs.ts'

/**
 * «Сводка» — главный экран (Р-04). На Этапе 0 — каркас: шапка, «Что нового»
 * и слово о том, что будет. «Зовут» и отрезки — Этап 1.
 */
export function Summary() {
  const title = useTitle()
  const day = useToday()
  const base = useBase()
  const whatsNew = useWhatsNew(base, CHANGES)

  return (
    <>
      <Head title={title}>
        <p className="muted">{formatDateLong(day)}</p>
      </Head>

      {whatsNew.show.length > 0 && <WhatsNew changes={whatsNew.show} onDone={whatsNew.dismiss} />}

      <section className="block">
        <p className="stub">
          Здесь будет неделя и месяц приложений семьи — как их посчитали сами приложения, и кто из них
          сейчас зовёт. Приложения добавляются во вкладке «{FAMILY_TAB.name}».
        </p>
      </section>
    </>
  )
}
