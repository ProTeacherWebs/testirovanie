import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { questions, shuffle } from './questions.js';
import AdminApp from './AdminApp.jsx';

const SESSION_KEY = 'frontendExamSession';
const TIME_LIMIT = 60 * 60 * 1000;

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Не удалось связаться с сервером.');
  return body;
}

function isAnswered(question, value) {
  if (question.type === 'fields') return value && Object.values(value).some((part) => part?.trim());
  if (question.type === 'multi') return Array.isArray(value) && value.length > 0;
  return typeof value === 'string' && value.trim().length > 0;
}

function formatTime(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function Header() {
  return <header className="topbar">
    <a className="brand" href="/" aria-label="Финальная проверка, на главную">
      <span className="brand-mark" aria-hidden="true">F</span><span>Курс frontend</span>
    </a>
    <div className="topbar-actions"><div className="topbar-note"><span className="status-dot" />Итоговое тестирование</div><a className="admin-link" href="/admin">Админка</a></div>
  </header>;
}

function Intro() {
  return <section className="intro-row" aria-labelledby="page-title">
    <div className="intro-copy">
      <p className="eyebrow">Проверка знаний</p>
      <h1 id="page-title">Финальный<br /><span>тест курса</span></h1>
      <p className="intro-text">HTML, CSS, JavaScript, Git и React — всё, что вы прошли на курсе, в одной проверке.</p>
    </div>
    <div className="exam-summary" aria-label="Сведения о тесте">
      <div className="summary-item"><strong>{questions.length}</strong><span>вопросов</span></div>
      <div className="summary-rule" />
      <div className="summary-item"><strong>60</strong><span>минут</span></div>
      <div className="summary-rule" />
      <div className="summary-item"><strong>↻</strong><span>автосохранение</span></div>
    </div>
  </section>;
}

function Registration({ onStart }) {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    const student = {
      firstName: String(form.get('firstName')).trim(),
      lastName: String(form.get('lastName')).trim(),
      studyTime: String(form.get('studyTime'))
    };
    if (!student.firstName || !student.lastName || !student.studyTime) {
      setError('Заполните все поля, чтобы начать тест.');
      return;
    }
    setLoading(true);
    try {
      const session = await api('/api/register', { method: 'POST', body: JSON.stringify(student) });
      onStart({ student, attemptId: session.attemptId });
    } catch (requestError) {
      setError(requestError.message.includes('Turso')
        ? 'Сохранение в Turso пока не настроено. Добавьте адрес базы и токен в файл .env на сервере.'
        : requestError.message);
    } finally {
      setLoading(false);
    }
  }

  return <section className="registration-layout" aria-labelledby="registration-title">
    <div className="registration-note">
      <div className="note-icon" aria-hidden="true">✳</div>
      <h2 id="registration-title">Перед началом</h2>
      <p>Укажите данные, чтобы сохранить вашу попытку. После старта ответы будут сохраняться автоматически.</p>
      <ul className="note-list">
        <li><span>01</span> Отвечайте самостоятельно</li>
        <li><span>02</span> Не закрывайте страницу теста</li>
        <li><span>03</span> Можно вернуться к пропущенным вопросам</li>
      </ul>
    </div>
    <form className="form-card" onSubmit={handleSubmit}>
      <div className="form-heading">
        <p className="eyebrow">Регистрация</p>
        <h2>Начнём с вас</h2>
        <p>Поля со звёздочкой обязательны.</p>
      </div>
      <label className="field-label" htmlFor="first-name">Имя <span>*</span></label>
      <input id="first-name" name="firstName" autoComplete="given-name" required maxLength="80" placeholder="Например, Анна" />
      <label className="field-label" htmlFor="last-name">Фамилия <span>*</span></label>
      <input id="last-name" name="lastName" autoComplete="family-name" required maxLength="80" placeholder="Например, Иванова" />
      <label className="field-label" htmlFor="study-time">Время обучения <span>*</span></label>
      <select id="study-time" name="studyTime" required defaultValue="">
        <option value="" disabled>Выберите время</option>
        <option value="15:00">15:00</option>
        <option value="17:00">17:00</option>
      </select>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button button-primary button-wide" type="submit" disabled={loading}>
        <span>{loading ? 'Сохраняем…' : 'Начать тест'}</span><span aria-hidden="true">↗</span>
      </button>
      <p className="form-footnote">Переходя дальше, вы подтверждаете, что готовы пройти тест самостоятельно.</p>
    </form>
  </section>;
}

function QuestionAnswer({ question, value, onChange }) {
  if (question.type === 'single' || question.type === 'multi') {
    const multi = question.type === 'multi';
    return <>
      <p className="answer-help">{multi ? 'Можно выбрать несколько вариантов.' : 'Выберите один вариант.'}</p>
      <ul className="answer-list">
        {question.options.map(([id, text]) => {
          const selected = multi ? (value || []).includes(id) : value === id;
          return <li key={id}>
            <label className={`answer-option${selected ? ' is-selected' : ''}`}>
              <input type={multi ? 'checkbox' : 'radio'} name={`answer-${question.id}`} value={id} checked={selected} onChange={() => {
                if (!multi) onChange(id);
                else onChange(selected ? value.filter((item) => item !== id) : [...(value || []), id]);
              }} />
              <span>{text}</span>
            </label>
          </li>;
        })}
      </ul>
    </>;
  }

  if (question.type === 'fields') {
    const complete = question.fields.every((field) => value?.[field]?.trim());
    return <>
      <div className="answer-grid">
        {question.fields.map((field) => <label key={field}>{field}
          <input type="text" maxLength="500" value={value?.[field] || ''} placeholder="Ваш ответ…"
            onChange={(event) => onChange({ ...(value || {}), [field]: event.target.value })} />
        </label>)}
      </div>
      {complete && <div className="result-review">{question.reference}</div>}
    </>;
  }

  return <textarea className="answer-text" maxLength="6000" value={value || ''}
    placeholder={question.placeholder || 'Напишите ответ своими словами…'} onChange={(event) => onChange(event.target.value)} />;
}

function WarningDialog({ onContinue }) {
  return <div className="dialog-backdrop">
    <section className="warning-dialog" role="alertdialog" aria-modal="true" aria-labelledby="warning-title">
      <div className="warning-symbol" aria-hidden="true">!</div>
      <p className="eyebrow">Событие записано</p>
      <h2 id="warning-title">Вы покинули страницу теста</h2>
      <p>Переключения фиксируются в попытке. Вернитесь к вопросу, когда будете готовы.</p>
      <button className="button button-primary button-wide" type="button" onClick={onContinue}>Продолжить тест</button>
    </section>
  </div>;
}

function PrintScreenDialog({ onContinue }) {
  return <div className="dialog-backdrop">
    <section className="warning-dialog" role="alertdialog" aria-modal="true" aria-labelledby="print-warning-title">
      <div className="warning-symbol" aria-hidden="true">!</div>
      <p className="eyebrow">Событие записано</p>
      <h2 id="print-warning-title">Нажат Print Screen</h2>
      <p>Попытка зафиксирована. Браузер не всегда получает это нажатие и не может гарантированно заблокировать системный снимок экрана.</p>
      <button className="button button-primary button-wide" type="button" onClick={onContinue}>Продолжить тест</button>
    </section>
  </div>;
}

function ConfirmDialog({ message, submitting, onBack, onSubmit }) {
  return <div className="dialog-backdrop">
    <section className="warning-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="warning-symbol warning-symbol-neutral" aria-hidden="true">?</div>
      <p className="eyebrow">Завершение попытки</p>
      <h2 id="confirm-title">Отправить ответы?</h2>
      <p>{message}</p>
      <div className="dialog-actions">
        <button className="button button-secondary" type="button" onClick={onBack} disabled={submitting}>Вернуться</button>
        <button className="button button-primary" type="button" onClick={onSubmit} disabled={submitting}>{submitting ? 'Отправляем…' : 'Отправить'}</button>
      </div>
    </section>
  </div>;
}

function ExamApp() {
  const [screen, setScreen] = useState('registration');
  const [student, setStudent] = useState(null);
  const [attemptId, setAttemptId] = useState(null);
  const [order, setOrder] = useState([]);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [events, setEvents] = useState([]);
  const [deadline, setDeadline] = useState(null);
  const [remaining, setRemaining] = useState(TIME_LIMIT);
  const [warningOpen, setWarningOpen] = useState(false);
  const [printWarningOpen, setPrintWarningOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [result, setResult] = useState(null);
  const [saveStatus, setSaveStatus] = useState('Сохранено');
  const hiddenAt = useRef(null);
  const submitRef = useRef(null);
  const autosaveReady = useRef(false);
  const answerScrollPosition = useRef(null);

  const question = order.length ? questions[order[index]] : null;
  const answeredCount = useMemo(() => order.filter((qIndex) => isAnswered(questions[qIndex], answers[questions[qIndex].id])).length, [order, answers]);
  const unansweredCount = questions.length - answeredCount;

  const startAttempt = ({ student: registeredStudent, attemptId: id }) => {
    const now = Date.now();
    const shuffledOrder = shuffle(questions.map((_, questionIndex) => questionIndex));
    const endsAt = now + TIME_LIMIT;
    const session = { attemptId: id, student: registeredStudent, order: shuffledOrder, startedAt: now, endsAt };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    setStudent(registeredStudent);
    setAttemptId(id);
    setOrder(shuffledOrder);
    setDeadline(endsAt);
    setRemaining(TIME_LIMIT);
    autosaveReady.current = true;
    setScreen('quiz');
  };

  useEffect(() => {
    let active = true;
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return () => { active = false; };
    (async () => {
      try {
        const savedSession = JSON.parse(raw);
        if (!savedSession.attemptId || savedSession.order?.length !== questions.length) return;
        const saved = await api(`/api/attempts/${encodeURIComponent(savedSession.attemptId)}`);
        if (!active || saved.submittedAt) {
          if (saved.submittedAt) sessionStorage.removeItem(SESSION_KEY);
          return;
        }
        setStudent(savedSession.student);
        setAttemptId(savedSession.attemptId);
        setOrder(savedSession.order);
        setDeadline(savedSession.endsAt);
        setRemaining(Math.max(0, savedSession.endsAt - Date.now()));
        setAnswers(saved.answers || {});
        setEvents(saved.events || []);
        autosaveReady.current = true;
        setScreen('quiz');
      } catch {
        sessionStorage.removeItem(SESSION_KEY);
      }
    })();
    return () => { active = false; };
  }, []);

  const saveSnapshot = useCallback(async (nextAnswers = answers, nextEvents = events) => {
    if (!attemptId) return;
    await api(`/api/attempts/${encodeURIComponent(attemptId)}`, {
      method: 'PUT', body: JSON.stringify({ answers: nextAnswers, events: nextEvents })
    });
  }, [attemptId, answers, events]);

  useEffect(() => {
    if (screen !== 'quiz' || !attemptId || !autosaveReady.current || submitting) return undefined;
    setSaveStatus('Сохранение…');
    const timeout = window.setTimeout(() => {
      saveSnapshot().then(() => setSaveStatus('Сохранено')).catch(() => setSaveStatus('Не удалось сохранить'));
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [answers, events, screen, attemptId, submitting, saveSnapshot]);

  useLayoutEffect(() => {
    if (answerScrollPosition.current === null) return;
    window.scrollTo({ top: answerScrollPosition.current, behavior: 'instant' });
    answerScrollPosition.current = null;
  }, [answers]);

  useEffect(() => {
    if (screen !== 'quiz' || !deadline) return undefined;
    const update = () => setRemaining(Math.max(0, deadline - Date.now()));
    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, [screen, deadline]);

  async function submitExam() {
    if (!attemptId || submitting || result) return;
    setSubmitting(true);
    setSubmitError('');
    setConfirmOpen(false);
    setWarningOpen(false);
    try {
      await saveSnapshot();
      const submitted = await api(`/api/attempts/${encodeURIComponent(attemptId)}/submit`, {
        method: 'POST', body: JSON.stringify({ answers, events })
      });
      setResult(submitted);
      sessionStorage.removeItem(SESSION_KEY);
      setScreen('result');
    } catch (error) {
      setSubmitError(`Не удалось отправить попытку: ${error.message}. Проверьте соединение и попробуйте снова.`);
      setConfirmOpen(true);
    } finally {
      setSubmitting(false);
    }
  }
  submitRef.current = submitExam;

  useEffect(() => {
    if (screen === 'quiz' && remaining === 0) submitRef.current?.();
  }, [remaining, screen]);

  useEffect(() => {
    if (screen !== 'quiz') return undefined;
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now();
        setEvents((current) => [...current, { type: 'page_hidden', at: new Date().toISOString() }]);
      } else if (hiddenAt.current) {
        const awaySeconds = Math.round((Date.now() - hiddenAt.current) / 1000);
        hiddenAt.current = null;
        setEvents((current) => [...current, { type: 'page_returned', at: new Date().toISOString(), awaySeconds }]);
        setWarningOpen(true);
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [screen]);

  useEffect(() => {
    if (screen !== 'quiz') return undefined;
    function onKeyDown(event) {
      if (event.key !== 'PrintScreen') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setEvents((current) => [...current, { type: 'print_screen_key', at: new Date().toISOString() }]);
      setPrintWarningOpen(true);
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [screen]);

  function updateAnswer(value) {
    answerScrollPosition.current = window.scrollY;
    setAnswers((current) => ({ ...current, [question.id]: value }));
  }

  function goTo(nextIndex) {
    if (nextIndex < 0 || nextIndex >= questions.length) return;
    setIndex(nextIndex);
  }

  function openSubmit() {
    setSubmitError('');
    setConfirmOpen(true);
  }

  function resultScreen() {
    const gradedResults = result?.gradedQuestions || [];
    const correctIds = new Set(gradedResults.filter((item) => item.correct).map((item) => item.questionId));
    const gradedIds = new Set(gradedResults.map((item) => item.questionId));
    const correctCount = result?.autoScore ?? 0;
    const incorrectCount = Math.max(0, (result?.autoTotal ?? 0) - correctCount);
    const percent = result?.autoTotal ? Math.round((correctCount / result.autoTotal) * 100) : 0;
    const questionResult = (item) => !gradedIds.has(item.id) ? 'На проверке' : correctIds.has(item.id) ? 'Верно' : 'Неверно';
    return <section className="result-layout" aria-live="polite">
      <div className="result-mark" aria-hidden="true">✓</div>
      <p className="eyebrow">Попытка сохранена</p>
      <h2>Тест завершён</h2>
      <p>{student?.firstName}, ответы сохранены. Ниже показан результат автоматической проверки.</p>
      <div className="result-score">{percent}%<small>правильных ответов с автоматической проверкой</small></div>
      <div className="result-totals" aria-label="Итоги автоматической проверки">
        <div><strong className="result-correct">{correctCount}</strong><span>правильных</span></div>
        <div><strong className="result-incorrect">{incorrectCount}</strong><span>неправильных</span></div>
        <div><strong>{result?.autoTotal ?? 0}</strong><span>проверено автоматически</span></div>
      </div>
      <div className="result-review">Открытые ответы отмечены как «На проверке» и будут оценены преподавателем. Зафиксировано переключений вкладки: {result?.tabSwitches ?? 0}.</div>
      <div className="result-question-list">
        <h3>Результат по вопросам</h3>
        {order.map((questionIndex, position) => {
          const item = questions[questionIndex];
          const status = questionResult(item);
          return <div className={`result-question ${status === 'Верно' ? 'is-correct' : status === 'Неверно' ? 'is-incorrect' : 'is-review'}`} key={item.id}>
            <span className="result-question-number">{String(position + 1).padStart(2, '0')}</span>
            <span className="result-question-prompt">{item.prompt}</span>
            <span className="result-question-status">{status}</span>
          </div>;
        })}
      </div>
    </section>;
  }

  return <div className="page-shell">
    <Header />
    <main className="main-content">
      <Intro />
      {screen === 'registration' && <Registration onStart={startAttempt} />}
      {screen === 'quiz' && question && <section className="quiz-layout" aria-labelledby="quiz-heading">
        <aside className="quiz-side">
          <p className="eyebrow">Итоговое тестирование</p>
          <h2 id="quiz-heading">Ваши знания,<br /><span>в деле.</span></h2>
          <p className="quiz-student">{student?.firstName} {student?.lastName} · {student?.studyTime}</p>
          <div className="timer-card">
            <span className="timer-label">Осталось времени</span>
            <strong>{formatTime(remaining)}</strong>
            <span className="timer-track"><span style={{ width: `${Math.max(0, remaining / TIME_LIMIT * 100)}%` }} /></span>
          </div>
          <div className="question-progress">
            <div className="progress-copy"><span>Прогресс</span><span>{index + 1} из {questions.length} · {answeredCount} отвечено</span></div>
            <div className="progress-track"><span style={{ width: `${((index + 1) / questions.length) * 100}%` }} /></div>
          </div>
          <p className="focus-hint"><span className="hint-mark">i</span> Переключение вкладки будет отмечено. Ответы сохраняются автоматически.</p>
          <p className="focus-hint"><span className="hint-mark">↻</span> {saveStatus}</p>
        </aside>
        <article className="question-panel">
          <div className="question-kicker"><span>Вопрос {String(index + 1).padStart(2, '0')} / {questions.length}</span><span className="question-type">{question.topic}</span></div>
          <h3>{question.prompt}</h3>
          {question.code && <pre className="question-code"><code>{question.code}</code></pre>}
          <QuestionAnswer question={question} value={answers[question.id]} onChange={updateAnswer} />
          <div className="question-nav">
            <div className="nav-left"><button className="nav-button" type="button" disabled={index === 0} onClick={() => goTo(index - 1)}>← Назад</button></div>
            <div className="nav-right">{index === questions.length - 1
              ? <button className="nav-button is-primary" type="button" onClick={openSubmit}>Завершить тест ↗</button>
              : <button className="nav-button is-primary" type="button" onClick={() => goTo(index + 1)}>Следующий вопрос →</button>}</div>
          </div>
          <div className="question-map" aria-label="Перейти к вопросу">
            {order.map((questionIndex, position) => {
              const item = questions[questionIndex];
              const answered = isAnswered(item, answers[item.id]);
              return <button key={item.id} type="button" aria-label={`Вопрос ${position + 1}`}
                className={`${position === index ? 'is-current' : ''} ${answered ? 'is-answered' : ''}`}
                onClick={() => goTo(position)}>{position + 1}</button>;
            })}
          </div>
        </article>
      </section>}
      {screen === 'result' && resultScreen()}
    </main>
    <footer className="footer"><span>Frontend · финальная проверка</span><span>Ваш прогресс сохраняется автоматически</span></footer>
    {warningOpen && <WarningDialog onContinue={() => setWarningOpen(false)} />}
    {printWarningOpen && <PrintScreenDialog onContinue={() => setPrintWarningOpen(false)} />}
    {confirmOpen && <ConfirmDialog message={submitError || (unansweredCount ? `Осталось без ответа: ${unansweredCount}. Всё равно отправить попытку?` : 'После отправки изменить ответы будет нельзя.')}
      submitting={submitting} onBack={() => setConfirmOpen(false)} onSubmit={() => submitExam(false)} />}
  </div>;
}

export default function App() {
  return window.location.pathname.startsWith('/admin') ? <AdminApp /> : <ExamApp />;
}
