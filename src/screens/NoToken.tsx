import { Link } from 'react-router-dom'

/** Нет токена чтения — одна подсказка на экран со ссылкой в «Настройки» (Р-05). */
export function NoToken() {
  return (
    <section className="block">
      <p className="stub">
        Не настроено: нет токена чтения. Впиши его в <Link to="/settings">«Настройках»</Link> — без него срезы
        приложений не читаются.
      </p>
    </section>
  )
}
