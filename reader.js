'use strict';

const $ = id => document.getElementById(id);
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Явные границы сцен не разрывают абзацы, диалоги и авторские части рассказа.
const pages = chapters.flatMap((chapter, chapterIndex) => chapter.scenes.map((scene, sceneIndex) => ({
  ...scene, chapter:chapterIndex, scene:sceneIndex, sceneCount:chapter.scenes.length,
  end:chapterIndex === chapters.length - 1 && sceneIndex === chapter.scenes.length - 1
})));
// Сначала экранируем HTML; поддерживаем только авторский курсив и полужирное выделение.
function inlineText(text) { return escapeHTML(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>'); }
const storageKey = 'between-lines';
let saved = {};
try { const value = JSON.parse(localStorage.getItem(storageKey) || '{}'); if (value && typeof value === 'object') saved = value; } catch (_) {}
// Новый рассказ начинается с первой сцены; настройки читателя остаются прежними.
let current = saved.bookId === bookInfo.id && Number.isInteger(saved.page) ? Math.max(0, Math.min(pages.length - 1, saved.page)) : 0;
let fontSize = Number.isFinite(saved.fontSize) ? Math.max(16, Math.min(28, saved.fontSize)) : 19;
let lineSpacing = [1.55, 1.8, 2.05].includes(saved.lineSpacing) ? saved.lineSpacing : 1.8;
let theme = saved.theme === 'dark' ? 'dark' : 'light';
// При входе всегда показываем обложку; сохранённая сцена открывается по кнопке.
let started = false;
let turning = false, pageTurn = null, drag = null, endingTimer = null;
let navigationId = 0, dragFrame = 0, scrollFloor = null;
const imageCache = new Map();
let endingReady = false;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const mobile = () => matchMedia('(max-width: 760px)').matches;
// На широких кадрах фокус держится на лицах при обрезке под книжный разворот.
const imageFocus = {
  'assets/road.jpg': {desktop:'84% 48%', mobile:'50% 42%'},
  'assets/mirror.jpg': {desktop:'88% 42%', mobile:'50% 34%'},
  'assets/memory.jpg': {desktop:'37% 45%', mobile:'50% 44%'},
  'assets/snow.jpg': {desktop:'43% 34%', mobile:'50% 29%'}
};
function applySceneImage(image, page) {
  if (image.getAttribute('src') !== page.image) image.src = page.image;
  image.alt = page.alt;
  const focus = imageFocus[page.image];
  image.style.objectPosition = focus ? focus[mobile() ? 'mobile' : 'desktop'] : '50% 48%';
}
function persist() { try { localStorage.setItem(storageKey, JSON.stringify({version:3, bookId:bookInfo.id, page:current, fontSize, lineSpacing, theme, started})); } catch (_) {} }
function pageMarkup(page, index) {
  return `<div class="chapter-meta">ЧАСТЬ ${String(page.chapter + 1).padStart(2, '0')} <span>· СЦЕНА ${page.scene + 1} ИЗ ${page.sceneCount}</span></div>
    <h2>${escapeHTML(page.title)}</h2>
    ${index === 0 ? `<p class="story-date"><time datetime="${bookInfo.dateISO}"><em>${escapeHTML(bookInfo.date)}</em></time></p>` : ''}
    ${page.paragraphs.map((text, i) => `<p class="story-paragraph${i === 0 && !text.startsWith('—') && !text.startsWith('*') ? ' lead' : ''}${text.startsWith('—') ? ' dialogue' : ''}${text.startsWith('**') ? ' closing-line' : ''}">${inlineText(text)}</p>`).join('')}
    ${page.end ? `<div class="quiet-ending"><span aria-hidden="true">✧</span><p>Конец.<br>Побудьте здесь ещё немного.</p><button id="restart-reading"${endingReady ? '' : ' hidden'}>Прочитать снова <svg aria-hidden="true"><use href="#i-right"/></svg></button></div>` : ''}`;
}
function scheduleEnding() {
  clearTimeout(endingTimer);
  if (current !== pages.length - 1 || !started) return;
  if (endingReady) { const button = $('restart-reading'); if (button) button.hidden = false; return; }
  // Пауза начинается, когда читатель действительно дошёл до последней строки.
  const ending = document.querySelector('.quiet-ending');
  if (ending) endingObserver.observe(ending);
}
const endingObserver = new IntersectionObserver(entries => {
  if (!entries.some(entry => entry.isIntersecting) || turning || document.hidden) return;
  endingObserver.disconnect();
  endingTimer = setTimeout(() => {
    if (current !== pages.length - 1 || !started) return;
    endingReady = true;
    const button = $('restart-reading'); if (button) button.hidden = false;
  }, 3500);
}, {threshold: 0.65});
function render(index = current) {
  const page = pages[index];
  endingObserver.disconnect(); clearTimeout(endingTimer);
  $('story').innerHTML = pageMarkup(page, index);
  applySceneImage($('cover-photo'), page);
  $('scene-number').textContent = `СЦЕНА ${String(index + 1).padStart(2, '0')}`;
  $('scene-caption').textContent = chapters[page.chapter].title;
  $('page-fraction').textContent = `${String(index + 1).padStart(2, '0')} / ${pages.length}`;
  $('folio').textContent = index + 1;
  $('previous').disabled = index === 0;
  $('next').hidden = index === pages.length - 1;
  $('progress-caption').textContent = index === 0 ? 'Начало истории' : chapters[page.chapter].title;
  $('progress-count').textContent = `${index + 1} из ${pages.length}`;
  $('page-slider').value = index + 1;
  $('page-slider').style.setProperty('--progress', `${index / Math.max(1, pages.length - 1) * 100}%`);
  $('page-slider').setAttribute('aria-valuetext', `Сцена ${index + 1} из ${pages.length}: ${page.title}`);
  document.querySelectorAll('.chapter-link').forEach((button, chapter) => {
    if (chapter === page.chapter) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    button.querySelector('svg').style.visibility = chapter === page.chapter ? 'visible' : 'hidden';
  });
  document.title = started && index > 0 ? `${page.title} — ${bookInfo.title}` : `${bookInfo.title} — между строк`;
  warmImage(index + 1); warmImage(index - 1);
}
function warmImage(index) {
  if (!pages[index]) return Promise.resolve();
  const path = pages[index].image;
  if (!imageCache.has(path)) {
    const image = new Image(); image.src = path;
    imageCache.set(path, image.decode().catch(() => {}));
  }
  return imageCache.get(path);
}
function clonePaper(index, width, height) {
  const clone = $('reading-page').cloneNode(true);
  if (index !== current) {
    clone.querySelector('.story').innerHTML = pageMarkup(pages[index], index);
    clone.querySelector('.page-running-head > span:last-child').textContent = `${String(index + 1).padStart(2, '0')} / ${pages.length}`;
    clone.querySelector('.folio').textContent = index + 1;
  }
  clone.removeAttribute('id');
  clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
  clone.querySelectorAll('button,input,select,[tabindex]').forEach(el => el.setAttribute('tabindex', '-1'));
  clone.inert = true;
  clone.style.width = `${width}px`;
  if (height) clone.style.height = `${height}px`;
  return clone;
}
function holdScrollFloor() {
  if (!scrollFloor) scrollFloor = {original:document.body.style.minHeight};
  // При сокращении страницы браузер не должен мгновенно обрезать scrollY.
  document.body.style.minHeight = `${Math.max(document.documentElement.scrollHeight, scrollY + innerHeight)}px`;
}
function releaseScrollFloor() {
  if (!scrollFloor) return;
  document.body.style.minHeight = scrollFloor.original;
  scrollFloor = null;
}
async function alignBook(token) {
  const top = Math.max(0, Math.min($('book').getBoundingClientRect().top + scrollY - 16, document.documentElement.scrollHeight - innerHeight));
  if (Math.abs(scrollY - top) < 2) return;
  scrollTo({top, behavior:reducedMotion.matches ? 'instant' : 'smooth'});
  if (reducedMotion.matches) return;
  const start = performance.now();
  await new Promise(resolve => {
    function check() {
      if (token !== navigationId || Math.abs(scrollY - top) < 2 || performance.now() - start > 900) resolve();
      else requestAnimationFrame(check);
    }
    requestAnimationFrame(check);
  });
}
function prepareTurn(target) {
  turning = true;
  const forward = target > current;
  const book = $('book'), layer = $('turn-layer');
  const rect = $('reading-page').getBoundingClientRect();
  const sourceHeight = book.getBoundingClientRect().height;
  const visualHeight = mobile() ? $('visual-page').offsetHeight : 0;
  const minimum = mobile() ? 0 : Math.max(parseFloat(getComputedStyle(book).minHeight) || 0, parseFloat(getComputedStyle($('visual-page')).minHeight) || 0);
  const source = clonePaper(current, rect.width, rect.height);
  const destination = clonePaper(target, rect.width);
  layer.style.top = `${visualHeight}px`;
  const base = document.createElement('div'); base.className = 'turn-base';
  base.append(destination); layer.append(base);
  // Единственное измерение новой страницы. Основной текст и навигация пока не меняются.
  const destinationHeight = Math.max(destination.getBoundingClientRect().height, minimum);
  destination.style.height = `${destinationHeight}px`;
  const targetHeight = destinationHeight + visualHeight;
  const paperHeight = Math.max(rect.height, destinationHeight);
  const sheet = document.createElement('div'); sheet.className = 'page-turn-sheet'; sheet.style.height = `${paperHeight}px`;
  const front = document.createElement('div'); front.className = 'page-turn-front';
  const back = document.createElement('div'); back.className = 'page-turn-back';
  const highlight = document.createElement('div'); highlight.className = 'page-turn-highlight';
  if (forward) front.append(source);
  else { base.replaceChildren(source); front.append(destination); }
  sheet.append(front, back, highlight);
  const shadow = document.createElement('div'); shadow.className = 'page-turn-shadow';
  layer.append(shadow, sheet);
  const illustration = $('visual-page').cloneNode(true);
  illustration.className = 'turn-illustration'; illustration.removeAttribute('id');
  illustration.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
  illustration.setAttribute('aria-hidden', 'true');
  const image = illustration.querySelector('img'); applySceneImage(image, pages[target]); image.alt = '';
  illustration.querySelector('.scene-caption > span').textContent = `СЦЕНА ${String(target + 1).padStart(2, '0')}`;
  illustration.querySelector('.scene-caption > p').textContent = chapters[pages[target].chapter].title;
  $('visual-page').append(illustration);
  holdScrollFloor();
  book.style.height = `${sourceHeight}px`;
  book.classList.add('is-turning'); book.setAttribute('aria-busy', 'true');
  pageTurn = {target, forward, sheet, shadow, highlight, illustration, sourceHeight, targetHeight, progress:0, animations:[], token:navigationId};
  setTurnProgress(0);
}
function paperFrame(progress, forward) {
  const p = forward ? progress : 1 - progress;
  return {transform:`rotateY(${-112 * p}deg) rotateZ(${-0.65 * Math.sin(p * Math.PI)}deg)`, opacity:Math.min(1, (1 - p) / .22)};
}
function shadowFrame(progress, forward) {
  const p = forward ? progress : 1 - progress;
  return {transform:`translate3d(${-p * 75}%,0,0) scaleX(${.35 + Math.sin(p * Math.PI) * .65})`, opacity:Math.sin(p * Math.PI) * .25};
}
function setTurnProgress(progress) {
  if (!pageTurn) return;
  pageTurn.progress = Math.max(0, Math.min(1, progress));
  Object.assign(pageTurn.sheet.style, paperFrame(pageTurn.progress, pageTurn.forward));
  Object.assign(pageTurn.shadow.style, shadowFrame(pageTurn.progress, pageTurn.forward));
  pageTurn.illustration.style.opacity = pageTurn.progress;
  pageTurn.highlight.style.opacity = Math.sin(pageTurn.progress * Math.PI) * .65;
}
function settleTurn(commit) {
  if (!pageTurn) return;
  const session = pageTurn;
  cancelAnimationFrame(dragFrame); dragFrame = 0;
  // Сначала подменяем скрытый оригинал. Видимый лист уже совпадает с конечным кадром.
  if (commit) { current = session.target; render(); }
  $('book').style.height = `${commit ? session.targetHeight : session.sourceHeight}px`;
  session.animations.forEach(animation => animation.cancel());
  session.illustration.remove(); $('turn-layer').replaceChildren();
  $('book').classList.remove('is-turning'); $('book').removeAttribute('aria-busy'); $('book').style.height = '';
  pageTurn = null; turning = false;
  persist(); scheduleEnding();
  if (commit) {
    $('announcement').textContent = `Сцена ${current + 1} из ${pages.length}. ${pages[current].title}`;
    $('story').focus({preventScroll:true});
  }
  // Пол высоты можно убрать только когда плавная прокрутка закончилась.
  if (commit && session.scrollPromise) session.scrollPromise.then(() => { if (session.token === navigationId) releaseScrollFloor(); });
  else releaseScrollFloor();
}
function animateTurn(commit) {
  if (!pageTurn) return;
  const session = pageTurn, from = pageTurn.progress, to = commit ? 1 : 0;
  if (reducedMotion.matches) { settleTurn(commit); return; }
  cancelAnimationFrame(dragFrame); dragFrame = 0;
  const duration = Math.max(180, Math.abs(to - from) * 560);
  const options = {duration, easing:'cubic-bezier(.25,.1,.25,1)', fill:'both'};
  const progress = Array.from({length:17}, (_, i) => from + (to - from) * i / 16);
  // Web Animations выполняет движение и свет на композиторе без JS-цикла по полосам.
  session.animations = [
    session.sheet.animate(progress.map(p => paperFrame(p, session.forward)), options),
    session.shadow.animate(progress.map(p => shadowFrame(p, session.forward)), options),
    session.illustration.animate([{opacity:from},{opacity:to}], options),
    session.highlight.animate(progress.map(p => ({opacity:Math.sin(p * Math.PI) * .65})), options),
    $('book').animate([{height:`${session.sourceHeight}px`},{height:`${commit ? session.targetHeight : session.sourceHeight}px`}], options)
  ];
  if (commit && (mobile() || $('book').getBoundingClientRect().top < -60)) session.scrollPromise = alignBook(session.token);
  Promise.all(session.animations.map(animation => animation.finished)).then(() => {
    if (pageTurn === session) settleTurn(commit);
  }).catch(() => {}); // Отмена жеста, resize или Escape завершают сессию отдельно.
}
function cancelTurn() {
  const wasTurning = turning;
  navigationId++;
  if (pageTurn) settleTurn(false);
  turning = false; drag = null; releaseScrollFloor();
  if (wasTurning) scrollTo({top:scrollY, behavior:'instant'});
}
async function goTo(index) {
  if (turning || index === current || index < 0 || index >= pages.length) return;
  if (!started) startReading();
  turning = true;
  const token = ++navigationId;
  await Promise.all([warmImage(index), document.fonts.ready]);
  if (token !== navigationId) return;
  // Кнопка внизу сначала мягко возвращает к началу листа, затем запускает поворот.
  if (mobile() || $('book').getBoundingClientRect().top < -60) await alignBook(token);
  if (token !== navigationId) return;
  if (reducedMotion.matches) {
    current = index; render(); turning = false; persist(); scheduleEnding();
    $('announcement').textContent = `Сцена ${current + 1} из ${pages.length}. ${pages[current].title}`;
    $('story').focus({preventScroll:true}); return;
  }
  prepareTurn(index);
  const session = pageTurn;
  requestAnimationFrame(() => { if (pageTurn === session) animateTurn(true); });
}
function startReading() {
  started = true; $('intro').hidden = true; $('reader').hidden = false;
  $('book-navigation').hidden = false; persist(); render(); scheduleEnding();
  $('story').focus({preventScroll:true});
  scrollTo({top:Math.max(0, $('book').getBoundingClientRect().top + scrollY - 16), behavior:reducedMotion.matches ? 'instant' : 'smooth'});
}
function setFont(value) {
  if (turning) cancelTurn();
  fontSize = Math.min(28, Math.max(16, value));
  document.documentElement.style.setProperty('--story-size', `${fontSize}px`);
  $('font-size').textContent = `${fontSize} px`;
  $('font-smaller').disabled = fontSize <= 16; $('font-larger').disabled = fontSize >= 28; persist();
}
function setSpacing(value) {
  if (turning) cancelTurn();
  lineSpacing = value; document.documentElement.style.setProperty('--story-leading', value);
  $('line-spacing').value = value; persist();
}
function setTheme(value) {
  if (turning) cancelTurn();
  theme = value; document.documentElement.dataset.theme = theme;
  $('theme-button').querySelector('use').setAttribute('href', theme === 'dark' ? '#i-sun' : '#i-moon');
  $('theme-button').setAttribute('aria-label', `Включить ${theme === 'dark' ? 'светлую' : 'тёмную'} тему`);
  document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#1c211e' : '#eeede7'; persist();
}
function closeType() { $('type-panel').hidden = true; $('type-button').setAttribute('aria-expanded', 'false'); }
$('start-reading').addEventListener('click', startReading);
$('story').addEventListener('click', event => {
  if (!event.target.closest('#restart-reading')) return;
  endingReady = false; current = 0; started = false; persist();
  $('start-reading').querySelector('span').textContent = 'Начать читать';
  $('intro').hidden = false; $('reader').hidden = true;
  document.title = `${bookInfo.title} — между строк`;
  $('start-reading').focus({preventScroll:true}); scrollTo({top:0, behavior:reducedMotion.matches ? 'instant' : 'smooth'});
});
$('previous').addEventListener('click', () => goTo(current - 1));
$('next').addEventListener('click', () => goTo(current + 1));
$('page-slider').max = pages.length;
$('page-slider').addEventListener('change', event => { if (turning) { $('page-slider').value = current + 1; return; } goTo(Number(event.target.value) - 1); });
$('font-smaller').addEventListener('click', () => setFont(fontSize - 1));
$('font-larger').addEventListener('click', () => setFont(fontSize + 1));
$('font-reset').addEventListener('click', () => { setFont(19); setSpacing(1.8); });
$('line-spacing').addEventListener('change', event => setSpacing(Number(event.target.value)));
$('theme-button').addEventListener('click', () => setTheme(theme === 'light' ? 'dark' : 'light'));
$('type-button').addEventListener('click', () => { const open = $('type-panel').hidden; $('type-panel').hidden = !open; $('type-button').setAttribute('aria-expanded', String(open)); });
document.addEventListener('click', event => { if (!event.target.closest('.settings-anchor')) closeType(); });
$('chapter-list').innerHTML = chapters.map((chapter, index) => `<li><button class="chapter-link" data-page="${pages.findIndex(page => page.chapter === index)}"><span>${String(index + 1).padStart(2, '0')}</span><span>${escapeHTML(chapter.title)}</span><svg aria-hidden="true"><use href="#i-check"/></svg></button></li>`).join('');
$('chapter-list').addEventListener('click', event => { const button = event.target.closest('[data-page]'); if (!button || turning) return; $('contents-dialog').close(); if (!started) startReading(); goTo(Number(button.dataset.page)); });
$('contents-button').addEventListener('click', () => { closeType(); $('contents-dialog').showModal(); });
$('close-contents').addEventListener('click', () => $('contents-dialog').close());
$('contents-dialog').addEventListener('click', event => {
  if (event.target !== $('contents-dialog')) return;
  const r = $('contents-dialog').getBoundingClientRect();
  if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) $('contents-dialog').close();
});
function focusMode(active) { if (turning) cancelTurn(); document.body.classList.toggle('focus-mode', active); $('focus-button').setAttribute('aria-pressed', String(active)); $('exit-focus').hidden = !active; (active ? $('exit-focus') : $('focus-button')).focus(); }
$('focus-button').addEventListener('click', () => focusMode(true));
$('exit-focus').addEventListener('click', () => focusMode(false));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { closeType(); if (turning) cancelTurn(); drag = null; if (document.body.classList.contains('focus-mode')) focusMode(false); }
  if (!started || event.target.closest('input,textarea,select,button,a') || $('contents-dialog').open || !$('type-panel').hidden || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === 'ArrowRight') { event.preventDefault(); goTo(current + 1); }
  if (event.key === 'ArrowLeft') { event.preventDefault(); goTo(current - 1); }
});
$('book').addEventListener('pointerdown', event => {
  if (!event.isPrimary) { if (turning) cancelTurn(); drag = null; return; }
  if (turning || !started || event.button !== 0 || event.target.closest('button,a,input,select') || window.getSelection()?.toString()) return;
  const r = $('reading-page').getBoundingClientRect();
  if (event.clientY < r.top || event.clientY > r.bottom) return;
  const edge = event.clientX > r.right - 38 ? 1 : event.clientX < r.left + 38 ? -1 : 0;
  if (event.pointerType === 'mouse' && !edge) return;
  drag = {id:event.pointerId, x:event.clientX, y:event.clientY, width:r.width, edge, active:false, progress:0};
});
$('book').addEventListener('pointermove', event => {
  if (!drag || event.pointerId !== drag.id) return;
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  if (!drag.active) {
    if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { drag = null; return; }
    if (Math.abs(dx) < 14 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const direction = dx < 0 ? 1 : -1, target = current + direction;
    if ((drag.edge && direction !== drag.edge) || target < 0 || target >= pages.length) { drag = null; return; }
    drag.active = true; drag.direction = direction;
    navigationId++;
    $('book').setPointerCapture(event.pointerId); prepareTurn(target);
  }
  event.preventDefault();
  drag.progress = Math.min(1, Math.max(0, -dx * drag.direction / (drag.width * .75)));
  // Несколько pointermove за один кадр дают одну запись transform.
  if (!dragFrame) dragFrame = requestAnimationFrame(() => { dragFrame = 0; if (drag?.active) setTurnProgress(drag.progress); });
});
function finishDrag(event, cancel = false) {
  if (!drag || event.pointerId !== drag.id) return;
  const wasActive = drag.active, commit = !cancel && drag.progress > .24, id = drag.id;
  if (wasActive) setTurnProgress(drag.progress);
  drag = null;
  if ($('book').hasPointerCapture(id)) $('book').releasePointerCapture(id);
  if (wasActive) animateTurn(commit);
}
$('book').addEventListener('pointerup', event => finishDrag(event));
$('book').addEventListener('pointercancel', event => finishDrag(event, true));
$('book').addEventListener('lostpointercapture', event => {
  // Touch сначала захвачен абзацем. Передача захвата книге не отменяет жест.
  if (event.target === $('book')) finishDrag(event, true);
});
let layoutWidth = innerWidth;
window.addEventListener('resize', () => { if (innerWidth !== layoutWidth) { layoutWidth = innerWidth; cancelTurn(); applySceneImage($('cover-photo'), pages[current]); } });
document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelTurn(); clearTimeout(endingTimer); } else scheduleEnding(); });
const words = pages.reduce((sum, page) => sum + page.paragraphs.join(' ').split(/\s+/).length, 0);
const minutes = Math.max(1, Math.ceil(words / 160));
$('reading-time').textContent = `Около ${minutes} мин чтения`;
$('intro-meta').textContent = `${chapters.length} частей · ${pages.length} сцен · около ${minutes} мин`;
$('start-reading').querySelector('span').textContent = current > 0 ? 'Продолжить чтение' : 'Начать читать';
$('intro').hidden = started; $('reader').hidden = !started;
setFont(fontSize); setSpacing(lineSpacing); setTheme(theme); render(); scheduleEnding();
