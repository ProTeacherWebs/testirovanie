import { useCallback, useEffect, useMemo, useState } from 'react';
import { questions } from './questions.js';

async function adminApi(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Не удалось выполнить запрос.');
  return body;
}

const openQuestions = questions.filter((question) => question.type === 'text' || question.type === 'fields');

function studentAnswer(question, answer) {
  if (question.type === 'fields') {
    return <dl className="admin-field-answers">
      {question.fields.map((field) => <div key={field}><dt>{field}</dt><dd>{answer?.[field]?.trim() || 'Ответ не дан'}</dd></div>)}
    </dl>;
  }
  return <div className={`admin-student-answer${answer?.trim() ? '' : ' is-empty'}`}>
    {answer?.trim() || 'Ответ не дан'}
  </div>;
}

function correctAnswer(question, grade) {
  if (question.type !== 'single' && question.type !== 'multi') return null;
  const ids = grade?.expectedOptions || [];
  const labels = ids.map((id) => question.options?.find(([optionId]) => optionId === id)?.[1]).filter(Boolean);
  return labels.length ? labels.join(', ') : 'Не задан';
}

function automaticAnswer(question, answer) {
  if (!answer || (Array.isArray(answer) && answer.length === 0)) return 'Ответ не дан';
  const selected = Array.isArray(answer) ? answer : [answer];
  return selected.map((id) => question.options?.find(([optionId]) => optionId === id)?.[1] || id).join(', ');
}

function AdminFrame({ children, onLogout, authed = true }) {
  return <div className="admin-shell">
    <header className="admin-topbar">
      <a className="brand" href="/" aria-label="Перейти к тесту">
        <span className="brand-mark" aria-hidden="true">F</span><span>Курс frontend</span>
      </a>
      <div className="admin-topbar-actions">
        <span className="admin-role">Панель преподавателя</span>
        {authed && <button type="button" className="admin-quiet-button" onClick={onLogout}>Выйти</button>}
      </div>
    </header>
    <main className="admin-main">{children}</main>
    <footer className="admin-footer"><span>Итоговое тестирование</span><a href="/">Вернуться к странице теста</a></footer>
  </div>;
}

function Login({ onLogin }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await adminApi('/api/admin/login', { method: 'POST', body: JSON.stringify({ password }) });
      onLogin();
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setBusy(false);
    }
  }

  return <AdminFrame authed={false}>
    <section className="admin-login-card">
      <p className="eyebrow">Доступ для преподавателя</p>
      <h1>Проверка<br />работ учеников</h1>
      <p className="admin-login-copy">Войдите, чтобы открыть попытки, оценить ответы и посмотреть итоговые результаты.</p>
      <form onSubmit={submit}>
        <label className="field-label" htmlFor="admin-password">Пароль</label>
        <input id="admin-password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button-primary button-wide" type="submit" disabled={busy}>{busy ? 'Проверяем…' : 'Войти'}</button>
      </form>
    </section>
  </AdminFrame>;
}

function Roster({ students, onRefresh, onSelect, error, refreshing }) {
  const grouped = useMemo(() => ({
    '15:00': students.filter((student) => student.studyTime === '15:00'),
    '17:00': students.filter((student) => student.studyTime === '17:00')
  }), [students]);
  const waiting = students.filter((student) => student.status === 'review').length;
  const reviewed = students.filter((student) => student.status === 'reviewed').length;

  function statusLabel(student) {
    if (student.status === 'reviewed') return 'Проверен';
    if (student.status === 'review') return 'Ожидает проверки';
    return 'Тест не завершён';
  }

  return <>
    <div className="admin-page-heading">
      <div><p className="eyebrow">Результаты курса</p><h1>Работы учеников</h1><p>Откройте отправленную попытку, чтобы проверить ответы и увидеть итог.</p></div>
      <button type="button" className="admin-quiet-button" onClick={onRefresh} disabled={refreshing}>{refreshing ? 'Обновляем…' : 'Обновить список'}</button>
    </div>
    <div className="admin-roster-stats">
      <div><strong>{students.length}</strong><span>всего учеников</span></div>
      <div><strong>{waiting}</strong><span>ждут проверки</span></div>
      <div><strong>{reviewed}</strong><span>проверены</span></div>
    </div>
    {error && <p className="admin-error" role="alert">{error}</p>}
    <div className="admin-groups">
      {Object.entries(grouped).map(([time, members]) => <section className="admin-group" key={time}>
        <header><h2>{time}</h2><span>{members.length} учеников</span></header>
        {members.length === 0
          ? <p className="admin-empty">Пока нет учеников в этой группе.</p>
          : <div className="admin-student-list">{members.map((student) => <button type="button" className="admin-student-row" key={student.attemptId} onClick={() => onSelect(student)}>
            <span className="admin-student-avatar" aria-hidden="true">{student.firstName.slice(0, 1)}{student.lastName.slice(0, 1)}</span>
            <span className="admin-student-info"><strong>{student.firstName} {student.lastName}</strong><small>{student.submittedAt ? `Отправлен ${new Date(student.submittedAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}` : 'Попытка ещё не отправлена'}</small></span>
            <span className={`admin-status admin-status-${student.status}`}>{statusLabel(student)}</span>
            {student.status === 'reviewed' && <span className="admin-student-score">{student.overallScore}/35</span>}
            <span className="admin-row-arrow" aria-hidden="true">↗</span>
          </button>)}</div>}
      </section>)}
    </div>
  </>;
}

function Review({ detail, marks, setMarks, onSave, onBack, saving, message, error }) {
  const markedCount = openQuestions.filter((question) => typeof marks[question.id] === 'boolean').length;
  const complete = markedCount === openQuestions.length;

  return <>
    <div className="admin-breadcrumb"><button type="button" onClick={onBack}>← Все ученики</button><span>/</span><span>Проверка ответов</span></div>
    <div className="admin-review-heading">
      <div><p className="eyebrow">{detail.studyTime} · {detail.firstName} {detail.lastName}</p><h1>Открытые ответы</h1><p>Отметьте каждый ответ как верный или неверный. Отметки сохраняются для продолжения проверки.</p></div>
      <div className="admin-review-progress"><strong>{markedCount}<span> / {openQuestions.length}</span></strong><small>ответов оценено</small></div>
    </div>
    {!detail.submittedAt && <div className="admin-callout">Ученик ещё проходит тест. Оценить ответы можно после отправки попытки.</div>}
    {error && <p className="admin-error" role="alert">{error}</p>}
    {message && <p className="admin-success" role="status">{message}</p>}
    <div className="admin-review-list">
      {openQuestions.map((question, index) => <article className="admin-review-card" key={question.id}>
        <div className="admin-review-card-head"><span>Открытый вопрос {index + 1} / {openQuestions.length}</span><span>{question.topic}</span></div>
        <h2>{question.prompt}</h2>
        {question.code && <pre className="question-code"><code>{question.code}</code></pre>}
        <div className="admin-answer-label">Ответ ученика</div>
        {studentAnswer(question, detail.answers[question.id])}
        {question.reference && <details className="admin-reference"><summary>Показать подсказку преподавателю</summary><p>{question.reference}</p></details>}
        <div className="admin-grade-actions" role="group" aria-label={`Оценка ответа ${index + 1}`}>
          <button type="button" className={`admin-grade-button is-right${marks[question.id] === true ? ' is-active' : ''}`} aria-pressed={marks[question.id] === true} disabled={!detail.submittedAt} onClick={() => setMarks((current) => ({ ...current, [question.id]: true }))}><span aria-hidden="true">✓</span> Верно</button>
          <button type="button" className={`admin-grade-button is-wrong${marks[question.id] === false ? ' is-active' : ''}`} aria-pressed={marks[question.id] === false} disabled={!detail.submittedAt} onClick={() => setMarks((current) => ({ ...current, [question.id]: false }))}><span aria-hidden="true">×</span> Неверно</button>
        </div>
      </article>)}
    </div>
    <div className="admin-review-bottom">
      <button type="button" className="button button-secondary" onClick={onBack}>К списку учеников</button>
      <div><span>{complete ? 'Все открытые ответы оценены.' : `Оцените ещё ${openQuestions.length - markedCount}.`}</span>
        <button type="button" className="button button-primary" onClick={onSave} disabled={saving || !detail.submittedAt}>{saving ? 'Сохраняем…' : complete ? 'Сохранить и открыть итог' : 'Сохранить отметки'}</button>
      </div>
    </div>
  </>;
}

function Results({ detail, onBack, onEdit }) {
  const manualCount = openQuestions.filter((question) => detail.manualGrades?.[question.id] === true).length;
  const total = detail.autoTotal + openQuestions.length;
  const correct = detail.autoScore + manualCount;
  const incorrect = total - correct;
  const percent = Math.round(correct / total * 100);
  const gradesById = new Map(detail.gradedQuestions.map((grade) => [grade.questionId, grade]));

  return <>
    <div className="admin-breadcrumb"><button type="button" onClick={onBack}>← Все ученики</button><span>/</span><span>Итог попытки</span></div>
    <section className="admin-result-summary">
      <div><p className="eyebrow">{detail.studyTime} · {detail.firstName} {detail.lastName}</p><h1>Результат тестирования</h1><p>Автоматическая проверка и оценка открытых ответов.</p></div>
      <div className="admin-result-percent"><strong>{percent}%</strong><span>правильных ответов</span></div>
      <div className="admin-result-counts"><div><strong>{correct}</strong><span>верных</span></div><div><strong>{incorrect}</strong><span>неверных</span></div><div><strong>{total}</strong><span>вопросов</span></div></div>
      <div className="admin-result-actions"><button type="button" className="button button-secondary" onClick={onEdit}>Изменить оценку открытых ответов</button><button type="button" className="button button-primary" onClick={onBack}>К списку учеников</button></div>
    </section>
    <div className="admin-result-list-heading"><h2>Ответы по всем вопросам</h2><span>Открытых: {openQuestions.length} · Автоматически проверено: {detail.autoTotal}</span></div>
    <div className="admin-result-list">
      {questions.map((question, index) => {
        const autoGrade = gradesById.get(question.id);
        const isOpen = openQuestions.some((item) => item.id === question.id);
        const isCorrect = isOpen ? detail.manualGrades?.[question.id] === true : autoGrade?.correct === true;
        const status = isCorrect ? 'Верно' : 'Неверно';
        return <article className={`admin-result-question ${isCorrect ? 'is-correct' : 'is-incorrect'}`} key={question.id}>
          <div className="admin-result-question-head"><span>Вопрос {String(index + 1).padStart(2, '0')}</span><strong>{status}</strong></div>
          <h3>{question.prompt}</h3>
          {question.code && <pre className="question-code"><code>{question.code}</code></pre>}
          <div className="admin-result-answer"><span>Ответ ученика</span>{isOpen ? studentAnswer(question, detail.answers[question.id]) : <p>{automaticAnswer(question, detail.answers[question.id])}</p>}</div>
          {!isOpen && !isCorrect && <div className="admin-result-answer is-expected"><span>Правильный ответ</span><p>{correctAnswer(question, autoGrade)}</p></div>}
          {isOpen && question.reference && <details className="admin-reference"><summary>Подсказка преподавателю</summary><p>{question.reference}</p></details>}
        </article>;
      })}
    </div>
  </>;
}

export default function AdminApp() {
  const [auth, setAuth] = useState('checking');
  const [route, setRoute] = useState('roster');
  const [students, setStudents] = useState([]);
  const [selectedAttempt, setSelectedAttempt] = useState(null);
  const [detail, setDetail] = useState(null);
  const [marks, setMarks] = useState({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadStudents = useCallback(async () => {
    setRefreshing(true);
    setError('');
    try {
      const result = await adminApi('/api/admin/students');
      setStudents(result.students);
    } catch (loadError) {
      setError(loadError.message);
      if (loadError.message.includes('Войдите')) setAuth('login');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    adminApi('/api/admin/session').then((result) => {
      if (result.authenticated) {
        setAuth('ready');
        loadStudents();
      } else setAuth('login');
    }).catch((sessionError) => {
      setError(sessionError.message);
      setAuth('login');
    });
  }, [loadStudents]);

  async function openAttempt(student) {
    setError('');
    setMessage('');
    setSelectedAttempt(student.attemptId);
    try {
      const result = await adminApi(`/api/admin/attempts/${encodeURIComponent(student.attemptId)}`);
      setDetail(result);
      setMarks(result.manualGrades || {});
      setRoute(result.reviewedAt ? 'results' : 'review');
    } catch (detailError) {
      setError(detailError.message);
      setRoute('roster');
    }
  }

  async function saveReview() {
    if (!selectedAttempt) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const saved = await adminApi(`/api/admin/attempts/${encodeURIComponent(selectedAttempt)}/review`, {
        method: 'PUT', body: JSON.stringify({ manualGrades: marks })
      });
      const updated = { ...detail, manualGrades: saved.manualGrades, reviewedAt: saved.reviewedAt };
      setDetail(updated);
      if (saved.complete) {
        setRoute('results');
        await loadStudents();
      } else setMessage('Отметки сохранены. Можно вернуться позже и продолжить проверку.');
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  async function logout() {
    await adminApi('/api/admin/logout', { method: 'POST' }).catch(() => {});
    setAuth('login');
    setRoute('roster');
    setDetail(null);
  }

  if (auth === 'checking') return <AdminFrame authed={false}><p className="admin-loading">Проверяем доступ…</p></AdminFrame>;
  if (auth === 'login') return <Login onLogin={() => { setAuth('ready'); loadStudents(); }} />;

  return <AdminFrame onLogout={logout}>
    {route === 'roster' && <Roster students={students} onRefresh={loadStudents} onSelect={openAttempt} error={error} refreshing={refreshing} />}
    {route === 'review' && detail && <Review detail={detail} marks={marks} setMarks={setMarks} onSave={saveReview} onBack={() => { setRoute('roster'); setMessage(''); setError(''); loadStudents(); }} saving={saving} message={message} error={error} />}
    {route === 'results' && detail && <Results detail={detail} onBack={() => { setRoute('roster'); setError(''); loadStudents(); }} onEdit={() => { setMarks(detail.manualGrades || {}); setRoute('review'); }} />}
  </AdminFrame>;
}
