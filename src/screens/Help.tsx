import { Fold } from '../shared/ui/Fold.tsx'
import { useTitle } from '../ui/useTitle.ts'
import { helpSections } from './help.ts'

/**
 * «Справка» — знаком «?» в шапке «Сводки» и «Семьи». Разделы свёрнуты,
 * пока их не открыли: сюда приходят с одним вопросом. Текст — `help.ts`.
 */
export function Help() {
  const title = useTitle()

  return (
    <div className="help">
      <header className="screen-head">
        <h1>Справка</h1>
      </header>

      {helpSections(title).map((section) => (
        <Fold key={section.id} id={section.id} title={section.title} folded>
          {section.paragraphs.map((text) => (
            <p key={text}>{text}</p>
          ))}
        </Fold>
      ))}
    </div>
  )
}
