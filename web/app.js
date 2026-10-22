'use strict';

// 可修改内容：文案与交互在本文件，颜色／布局在 styles.css，服务器在 server.py。
const $ = (s, parent = document) => parent.querySelector(s);
const $$ = (s, parent = document) => [...parent.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths = {
  grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  list:'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01',
  calendar:'M8 2v4 M16 2v4 M3 10h18 M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2z M7 14h2 M13 14h2 M7 18h2',
  sun:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5 19 19 M5 19l1.5-1.5 M17.5 6.5 19 5',
  clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l3 2',
  timer:'M9 2h6 M12 2v3 M18 5l2 2 M12 6a8 8 0 1 0 0 16 8 8 0 0 0 0-16 M12 9v5l3 1',
  chart:'M4 3v18h17 M8 16v-4 M13 16V7 M18 16V4',
  settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3l-1 2-2 1-2-1-2 4 2 2v2l-2 2 2 4 2-1 2 1 1 2h6l1-2 2-1 2 1 2-4-2-2v-2l2-2-2-4-2 1-2-1-1-2z',
  check:'M5 12l4 4L19 6', plus:'M12 5v14 M5 12h14', search:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M15 15l6 6',
  more:'M5 12h.01 M12 12h.01 M19 12h.01', close:'M6 6l12 12 M6 18 18 6',
  arrow:'M5 12h14 M13 6l6 6-6 6', left:'M15 5l-7 7 7 7', right:'M9 5l7 7-7 7',
  pin:'M9 3h6 M10 3v6l-4 5h12l-4-5V3 M12 14v7',
  file:'M14 2H5v20h14V7z M14 2v5h5 M8 12h8 M8 16h6',
  trash:'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7',
  cloud:'M6 18a5 5 0 0 1-.5-10 7 7 0 0 1 13-1A5 5 0 0 1 19 18 M9 13l3-3 3 3 M12 10v11',
  server:'M3 3h18v7H3z M3 14h18v7H3z M7 6.5h.01 M7 17.5h.01 M15 6.5h3 M15 17.5h3',
  shield:'M12 2l9 4v6c0 5-9 10-9 10S3 17 3 12V6z M8 12l3 3 5-6',
  leaf:'M5 19C1 8 9 3 21 3c0 12-6 20-15 15 M5 19 16 8',
  play:'M8 4l12 8-12 8z', pause:'M7 4h3v16H7z M14 4h3v16h-3z', stop:'M6 6h12v12H6z',
  download:'M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5', upload:'M12 16V4 M7 9l5-5 5 5 M4 16v5h16v-5',
  copy:'M8 8h13v13H8z M16 8V3H3v13h5', menu:'M3 6h18 M3 12h18 M3 18h18',
  logout:'M9 3H3v18h6 M9 12h12 M16 7l5 5-5 5', restore:'M3 10a9 9 0 1 1 1 9 M3 4v6h6 M12 7v5l3 2',
  inbox:'M4 3h16l2 13v5H2v-5z M2 16h6l2 3h4l2-3h6',
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.grid}"/></svg>`;
const quadrants = [
  {id:1, name:'重要且紧急', hint:'立即行动', important:true, urgent:true, short:'立即做'},
  {id:2, name:'重要不紧急', hint:'为长远留出时间', important:true, urgent:false, short:'计划做'},
  {id:3, name:'紧急不重要', hint:'高效处理，适当委派', important:false, urgent:true, short:'尽快做'},
  {id:4, name:'不重要不紧急', hint:'留一点生活的空隙', important:false, urgent:false, short:'有空做'},
];
const views = {board:'四象限', calendar:'日历计划', focus:'番茄专注', stats:'数据回顾', completed:'已完成', trash:'回收站', settings:'设置与同步'};
const palette = {green:['#245a47','#eaf1e9'], blue:['#345f85','#e9f0f7'], purple:['#725b89','#f0ebf6'], orange:['#a7683b','#faf0e7']};
let state = null, meta = null, view = 'board', layout = localStorage.getItem('quadrant.layout') || 'board';
let query = '', sort = 'default', onlyToday = false, offset = 0, connected = true;
let selectedDay = localDay(), month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let editorTask = null, editorId = '', pickedFiles = [], focusMode = 'focus';
let customHours=0, customMinutes=25;
try {const saved=JSON.parse(localStorage.getItem('quadrant.custom-time'));if(saved&&Number.isInteger(saved.hours)&&Number.isInteger(saved.minutes)&&saved.hours>=0&&saved.hours<=24&&saved.minutes>=0&&saved.minutes<=59){customHours=saved.hours;customMinutes=saved.minutes;}} catch {}
let refreshing = false, toastTimeout, pollTimer, lastTimerStatus = null;

function localDay(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function dateText(day) {
  if (!day) return '';
  if (day === localDay()) return '今天';
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate()+1);
  if (day === localDay(tomorrow)) return '明天';
  return `${Number(day.slice(5,7))}月${Number(day.slice(8,10))}日`;
}
function dateTime(ms) { return new Date(ms).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}); }
function qid(t) { return t.important ? (t.urgent ? 1 : 2) : (t.urgent ? 3 : 4); }
function activeTasks() { return (state?.tasks || []).filter(t => !t.deleted_at); }
function openTasks() { return activeTasks().filter(t => !t.done); }
function dayStats(day) {
  return {completed:activeTasks().filter(t=>t.done && t.completed_at && localDay(new Date(t.completed_at))===day).length,
    focus:(state?.focus_logs||[]).filter(l=>localDay(new Date(l.finished_at))===day).reduce((n,l)=>n+l.duration,0)};
}
function toast(message) {
  $('#toast').textContent = message; $('#toast').classList.add('show');
  clearTimeout(toastTimeout); toastTimeout = setTimeout(()=>$('#toast').classList.remove('show'),4500);
}
async function api(path, options = {}) {
  const init = {method:options.method || 'GET', credentials:'same-origin', headers:{...options.headers}};
  if (options.body !== undefined) {
    if (options.body instanceof Blob || options.body instanceof ArrayBuffer) init.body = options.body;
    else { init.body = JSON.stringify(options.body); init.headers['Content-Type'] = 'application/json'; }
  }
  let response;
  try { response = await fetch(path, init); } catch { throw new Error('无法连接服务器。请检查主电脑是否开启，以及是否连接同一网络。'); }
  if (!response.ok) {
    const result = await response.json().catch(()=>({}));
    if (response.status === 401 && path !== '/api/login') {
      clearInterval(pollTimer); $('#task-dialog').close(); meta = {...meta, initialized:true, authenticated:false}; renderAuth();
    }
    const error = new Error(result.error || `操作失败（${response.status}）`); error.status = response.status; throw error;
  }
  return response.json();
}
async function refresh(force = false) {
  if (refreshing) return;
  refreshing = true;
  try {
    const next = await api('/api/state');
    const changed = !state || state.revision !== next.revision;
    const previous=state; offset = next.server_time - Date.now(); state = next; connected = true;
    window.TimerAudio?.stateChanged(previous,state);
    if (lastTimerStatus === 'running' && state.timer.status === 'idle') toast('本轮计时已结束，专注记录已保存');
    lastTimerStatus = state.timer.status;
    if (!$('#main-content')) renderShell();
    else if (force || (changed && !$('#settings-form')?.contains(document.activeElement))) renderMain();
    updateConnection(); tickClock();
  } catch (e) {
    connected = false; updateConnection(); if (force) toast(e.message);
  } finally { refreshing = false; }
}
function updateConnection() {
  $$('.connection-label').forEach(el=>el.textContent=connected?(window.PhoneStore?'数据保存在手机':'已连接本机空间'):'连接已中断');
  $$('.connection-dot').forEach(el=>el.classList.toggle('off',!connected));
  const el = $('#top-sync'); if(el) el.innerHTML=`<i class="dot connection-dot ${connected?'':'off'}"></i>${connected?'已保存':'等待连接'}`;
}
function applyBrand() {
  const settings = state?.settings || {name:'象限',accent:'green'};
  const colors = palette[settings.accent] || palette.green;
  document.documentElement.style.setProperty('--accent',colors[0]);
  document.documentElement.style.setProperty('--accent-soft',colors[1]);
  document.title = `${settings.name} · ${views[view] || '个人任务空间'}`;
  $$('.brand-name').forEach(el=>el.textContent=settings.name);
}
function renderAuth() {
  const setup = !meta.initialized;
  $('#app').innerHTML=`<main class="auth-page"><section class="auth-art"><div class="brand"><img src="/icon.svg" alt=""><div><strong>${esc(meta.name || '象限')}</strong><span>YOUR OWN SPACE</span></div></div><div><h1>把时间留给<br>重要的事。</h1><p>有条理地安排当下，<br>也为长远的自己留一点空间。</p><div class="auth-cells" aria-hidden="true"><div class="auth-cell"></div><div class="auth-cell"></div><div class="auth-cell"></div><div class="auth-cell"></div></div></div><p>本地保存 · 手动同步 · 自由编辑</p></section><section class="auth-form-area"><form id="auth-form" class="auth-form"><div class="eyebrow">A LITTLE MORE FOCUS</div><h2>${setup?'建立你的任务空间':'欢迎回到你的空间'}</h2><p>${setup?(window.PhoneStore?'任务保存在这台手机，电脑关机也能使用。先设置本机访问密码。':'任务保存在这台电脑。设置访问密码后，浏览器可访问本机空间。'):'输入本机空间的访问密码，继续处理重要的事。'}</p>${setup?'<label class="field"><span>给空间起个名字</span><input name="name" value="象限" maxlength="30" required autocomplete="organization"></label>':''}<label class="field"><span>访问密码${setup?'（至少 8 位）':''}</span><input name="password" type="password" minlength="${setup?8:1}" maxlength="128" required autocomplete="${setup?'new-password':'current-password'}" placeholder="${setup?'请设置访问密码':'请输入访问密码'}"></label>${setup?'<label class="field"><span>再输入一次密码</span><input name="confirm" type="password" minlength="8" maxlength="128" required autocomplete="new-password" placeholder="确认访问密码"></label>':''}<button type="submit" class="btn primary">${setup?'创建空间':'进入空间'} ${icon('arrow')}</button><p class="error" id="auth-error" role="alert"></p><div class="auth-foot">${icon('shield')} 数据由你的${window.PhoneStore?'手机':'电脑'}保存</div></form></section></main>`;
}
function navButton(id, name, iconName, count = '') {
  return `<button class="nav-btn ${view===id?'active':''}" data-nav="${id}">${icon(iconName)}<span>${name}</span>${count!==''?`<span class="count">${count}</span>`:''}</button>`;
}
function renderShell() {
  $('#app').innerHTML=`<div class="shell"><div class="mobile-shade" data-action="menu-close"></div><aside class="sidebar" id="sidebar"><div class="brand"><img src="/icon.svg" alt=""><div><strong class="brand-name">象限</strong><span>PERSONAL WORKSPACE</span></div></div><nav class="nav" id="main-nav"></nav><div class="sidebar-foot"><div class="server-mini"><i class="dot connection-dot"></i><span class="connection-label">已连接主服务器</span></div><div class="server-mini"><p>${window.PhoneStore?'手机离线可用 · 手动同步':'电脑本地保存 · 手动同步'}</p></div><span class="edition">LOCAL EDITION / 01</span></div></aside><main class="main"><div class="topline"><div class="crumb">我的空间 &nbsp; / &nbsp; <strong id="crumb-view">四象限</strong></div><div class="mobile-top"><button class="icon-btn" data-action="menu" aria-label="打开菜单">${icon('menu')}</button><img src="/icon.svg" alt=""><span class="brand-name">象限</span></div><div class="top-right"><span class="date-small">少一点忙碌，多一点从容</span><button class="btn small sync-launch" data-action="lan-sync" aria-label="与另一台设备手动同步">⇄ <span>同步</span></button><span class="sync-status" id="top-sync"></span><span class="avatar">我</span></div></div><div id="main-content"></div></main></div>`;
  renderMain();
}
function renderNav() {
  $('#main-nav').innerHTML=navButton('board','四象限','grid',openTasks().length)+navButton('calendar','日历计划','calendar')+'<div class="nav-label">专注与回顾</div>'+navButton('focus','番茄专注','timer')+navButton('stats','数据回顾','chart')+navButton('completed','已完成','check')+'<div class="nav-label">你的空间</div>'+navButton('settings','设置与同步','settings')+navButton('trash','回收站','trash');
}
function summary() {
  const tasks=openTasks(), stats=dayStats(localDay());
  const entries=[['待办事项',tasks.length,'件','inbox'],['今日截止',tasks.filter(t=>t.due===localDay()).length,'件','calendar'],['今日完成',stats.completed,'件','check'],['今日专注',Math.floor(stats.focus/60),'分钟','leaf']];
  return `<div class="summary">${entries.map(([label,value,unit,ico])=>`<div class="summary-card"><div><span class="label">${label}</span><strong>${value}<span>${unit}</span></strong></div><div class="summary-icon">${icon(ico)}</div></div>`).join('')}</div>`;
}
function pageHeading(title, sub, eyebrow='YOUR PERSONAL WORKSPACE') {
  return `<div class="greeting"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p class="subtitle">${sub}</p></div><div class="datebox"><strong>${new Date().toLocaleDateString('zh-CN',{month:'long',day:'numeric'})}</strong>${new Date().toLocaleDateString('zh-CN',{weekday:'long',year:'numeric'})}</div></div>`;
}
function filteredTasks(tasks) {
  const q=query.toLowerCase();
  tasks=tasks.filter(t=>!q || [t.title,t.notes].join(' ').toLowerCase().includes(q));
  return tasks.sort((a,b)=>{
    if(a.done!==b.done) return a.done?1:-1;
    if(a.pinned!==b.pinned) return a.pinned?-1:1;
    if(sort==='due') return (a.due || '9999').localeCompare(b.due || '9999') || b.created_at-a.created_at;
    if(sort==='created') return b.created_at-a.created_at;
    return qid(a)-qid(b) || (a.due || '9999').localeCompare(b.due || '9999') || b.created_at-a.created_at;
  });
}
function toolbar(showLayout = false) {
  return `<div class="toolbar"><div class="tools-left">${showLayout?`<div class="tabs" role="group" aria-label="任务视图"><button data-action="layout" data-value="board" aria-pressed="${layout==='board'}" class="${layout==='board'?'active':''}">${icon('grid')}四象限</button><button data-action="layout" data-value="list" aria-pressed="${layout==='list'}" class="${layout==='list'?'active':''}">${icon('list')}列表</button></div><select id="task-filter" aria-label="任务范围"><option value="" ${!onlyToday?'selected':''}>全部待办</option><option value="today" ${onlyToday?'selected':''}>今日待办</option></select>`:''}</div><div class="tools-right"><div class="search">${icon('search')}<input id="search-input" value="${esc(query)}" placeholder="搜索任务或备注" aria-label="搜索任务"></div><select id="sort-filter" aria-label="排序方式"><option value="default" ${sort==='default'?'selected':''}>优先级</option><option value="due" ${sort==='due'?'selected':''}>截止日期</option><option value="created" ${sort==='created'?'selected':''}>创建时间</option></select><button class="btn primary" data-action="new">${icon('plus')}新建任务</button></div></div>`;
}
function taskCard(task) {
  const files=state.files.filter(f=>f.task_id===task.id), q=quadrants[qid(task)-1];
  const due=task.due?`<span class="due ${!task.done&&task.due<localDay()?'late':''}">${icon('calendar')}${dateText(task.due)}${!task.done&&task.due<localDay()?' · 已逾期':''}</span>`:'';
  return `<article class="task-card ${task.done?'done':''}" draggable="${!task.deleted_at}" data-task="${esc(task.id)}"><button class="check-btn ${task.done?'checked':''}" data-action="toggle" data-id="${esc(task.id)}" aria-label="${task.done?'标为未完成':'完成任务'}" ${task.deleted_at?'disabled':''}>${task.done?icon('check'):''}</button><div class="task-body" role="button" tabindex="0" data-action="edit" data-id="${esc(task.id)}"><div class="task-title">${task.pinned?icon('pin','pin'):''}${esc(task.title)}</div>${task.notes?`<div class="task-notes">${esc(task.notes)}</div>`:''}<div class="task-meta">${due}${files.length?`<span class="row" style="gap:2px">${icon('file')}${files.length}</span>`:''}${view!=='board'?`<span class="muted">${q.name}</span>`:''}${task.deleted_at?`<button class="danger-link" data-action="restore" data-id="${esc(task.id)}">恢复</button><button class="danger-link" data-action="purge" data-id="${esc(task.id)}">永久删除</button>`:''}</div></div><button class="icon-btn task-more" data-action="edit" data-id="${esc(task.id)}" aria-label="编辑任务">${icon('more')}</button></article>`;
}
function empty(message='这里还没有任务', detail='给重要的事一个位置，从一条小任务开始。', add=true) {
  return `<div class="empty">${icon('leaf')}<strong>${message}</strong>${detail}${add?'<br><button class="btn small" data-action="new">新建任务</button>':''}</div>`;
}
function renderBoard() {
  const tasks=filteredTasks(openTasks().filter(t=>!onlyToday||t.due===localDay()));
  const content=layout==='board'?`<div class="board">${quadrants.map(q=>{
    const items=tasks.filter(t=>qid(t)===q.id);
    return `<section class="quadrant q${q.id}" data-quadrant="${q.id}"><header class="quadrant-header"><div class="q-title"><span class="q-num">0${q.id}</span><div><h2>${q.name}</h2><p>${q.hint}</p></div></div><span class="q-count" aria-label="${items.length} 项待办">${items.length}</span></header><div class="task-list">${items.length?items.map(taskCard).join(''):empty('留给'+q.short+'的事',onlyToday?'今天暂无安排':query?'暂无匹配任务':'点击上方新建任务',false)}</div></section>`;
  }).join('')}</div>`:`<div class="task-table"><div class="list-heading"><span>${onlyToday?'今日待办':'全部待办'}</span><span>${tasks.length} 项待办</span></div>${tasks.length?tasks.map(taskCard).join(''):empty(query?'没有匹配的任务':onlyToday?'今日暂无待办':'暂无待办',query?'换个关键词试试。':'点击上方新建任务。',false)}</div>`;
  return pageHeading('四象限',esc(state.settings.subtitle)) + summary()+toolbar(true)+`<div class="filter-line"><span>${onlyToday?'今日待办':'全部待办'}<span class="filter-divider">/</span>${tasks.length} 项待办</span><span class="desktop-hint">以重要性与紧急性，安排你的下一步</span></div><div id="task-results">${content}</div><div class="board-info">${icon('grid')}<span class="desktop-hint">可拖动任务切换象限 · </span>点击任务，编辑详情</div>${state.tasks.length===0?'<div class="board-info"><button class="danger-link" style="color:var(--accent)" data-action="demo">载入示例</button></div>':''}${footer()}`;
}
function footer() {
  return `<footer class="footer"><span>${icon('shield')} ${window.PhoneStore?'保存在手机 · 离线可用':'保存在电脑 · 页面自动刷新'}</span><span>把时间留给重要的事。</span></footer>`;
}
function renderTaskPage() {
  let tasks, title, sub;
  if(view==='completed') { tasks=activeTasks().filter(t=>t.done); title='已完成'; sub='每一步，都算数。'; }
  if(view==='trash') { tasks=state.tasks.filter(t=>t.deleted_at); title='回收站'; sub='恢复任务，或永久删除。'; }
  tasks=filteredTasks(tasks);
  return pageHeading(title,sub)+summary()+toolbar()+`<div class="task-table"><div class="list-heading"><span>${views[view]}</span><span>${tasks.length} 项</span></div>${tasks.length?tasks.map(taskCard).join(''):empty(query?'没有匹配的任务':view==='completed'?'完成之后，在这里回顾':view==='trash'?'回收站是空的':'现在没有待办',view==='completed'?'去完成一件小事吧。':view==='trash'?'删除的任务仍然可以找回来。':'给今天留一点空间。',!['completed','trash'].includes(view))}</div>${footer()}`;
}
function renderCalendar() {
  const first=new Date(month), start=new Date(first); start.setDate(1-(first.getDay()+6)%7);
  const days=Array.from({length:42},(_,i)=>{const d=new Date(start);d.setDate(start.getDate()+i);return d;});
  const tasks=activeTasks(), agenda=tasks.filter(t=>t.due===selectedDay).sort((a,b)=>Number(a.done)-Number(b.done)||qid(a)-qid(b));
  return pageHeading('日历计划','选一天，查看安排。')+summary()+`<div class="two-columns"><section class="panel"><div class="calendar-nav"><h2>${month.getFullYear()} 年 ${month.getMonth()+1} 月</h2><div class="row"><button class="icon-btn" data-action="month" data-value="-1" aria-label="上个月">${icon('left')}</button><button class="btn small" data-action="calendar-today">今天</button><button class="icon-btn" data-action="month" data-value="1" aria-label="下个月">${icon('right')}</button></div></div><div class="calendar-week">${['一','二','三','四','五','六','日'].map(d=>`<div>${d}</div>`).join('')}</div><div class="calendar-days">${days.map(d=>{const day=localDay(d),items=tasks.filter(t=>t.due===day&&!t.done);return `<button class="calendar-day ${d.getMonth()!==month.getMonth()?'other':''} ${day===selectedDay?'selected':''} ${day===localDay()?'today':''}" data-action="day" data-value="${day}" aria-label="${day}，${items.length}项待办"><span>${d.getDate()}</span>${items.length?`<div class="calendar-dots">${items.slice(0,5).map(()=>'<i></i>').join('')}</div><small>${items.length}</small>`:''}</button>`;}).join('')}</div></section><section class="panel agenda"><div class="section-title"><div><h2>${dateText(selectedDay)}的安排</h2><p class="subtitle">${esc(selectedDay)} · ${agenda.length} 项任务</p></div><button class="icon-btn" data-action="new" data-date="${selectedDay}" aria-label="添加当日任务">${icon('plus')}</button></div>${agenda.length?agenda.map(taskCard).join(''):empty('暂无安排','点击右上角 + 添加。',false)}</section></div>${footer()}`;
}
function remaining() {
  const t=state.timer;
  if(t.status==='running') return Math.max(0,Math.ceil((t.ends_at-Date.now()-offset)/1000));
  if(t.status==='paused') return Math.ceil(t.remaining);
  return focusMode==='custom'?customHours*3600+customMinutes*60:state.settings[focusMode==='focus'?'focus_minutes':'break_minutes']*60;
}
function tickClock() {
  window.TimerAudio?.tick();
  if(!state || !$('#clock-number')) return;
  const seconds=remaining(), t=state.timer;
  $('#clock-number').textContent=(seconds>=3600?`${String(Math.floor(seconds/3600)).padStart(2,'0')}:`:'')+`${String(Math.floor(seconds/60)%60).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
  const fraction=t.status==='idle'?1:Math.min(1,seconds/(t.duration||1));
  $('#clock-progress').style.strokeDashoffset=String(741.42*(1-fraction));
}
function renderFocus() {
  const t=state.timer, busy=t.status!=='idle', mode=busy?t.mode:focusMode, stats=dayStats(localDay());
  const logs=[...state.focus_logs].sort((a,b)=>b.finished_at-a.finished_at).slice(0,30);
  return pageHeading('番茄专注','此刻，只做一件事。')+summary()+`
    <div class="focus-layout"><section class="panel focus-panel">
      <div class="focus-controls"><div class="tabs focus-mode">
        <button data-action="focus-mode" data-value="focus" class="${mode==='focus'?'active':''}" ${busy?'disabled':''}>专注 ${state.settings.focus_minutes} 分钟</button>
        <button data-action="focus-mode" data-value="break" class="${mode==='break'?'active':''}" ${busy?'disabled':''}>休息 ${state.settings.break_minutes} 分钟</button>
      </div><div class="custom-duration ${mode==='custom'?'active':''}">
        <button data-action="focus-mode" data-value="custom" aria-pressed="${mode==='custom'}" ${busy?'disabled':''}>自定义时间</button>
        <label><input id="custom-hours" aria-label="自定义小时" type="number" inputmode="numeric" min="0" max="24" step="1" value="${customHours}" ${busy?'disabled':''}>小时</label>
        <label><input id="custom-minutes" aria-label="自定义分钟" type="number" inputmode="numeric" min="0" max="59" step="1" value="${customMinutes}" ${busy?'disabled':''}>分钟</label>
      </div></div>
      <div class="clock"><svg viewBox="0 0 266 266" aria-hidden="true"><circle class="track" cx="133" cy="133" r="118"/><circle class="progress" id="clock-progress" cx="133" cy="133" r="118"/></svg><strong id="clock-number">25:00</strong><p>${t.status==='paused'?'已暂停':busy?(mode==='break'?'好好休息':'正在专注'):'准备开始'}</p></div>
      <div class="focus-actions">${busy?`<button class="btn primary" data-action="timer" data-value="${t.status==='paused'?'resume':'pause'}">${icon(t.status==='paused'?'play':'pause')}${t.status==='paused'?'继续专注':'暂停计时'}</button><button class="btn" data-action="cancel-timer">${icon('stop')}结束本轮</button>`:`<button class="btn primary" data-action="timer" data-value="start">${icon('play')}开始${mode==='break'?'休息':'专注'}</button>`}</div>
      <button class="btn small hidden" id="stop-alarm" data-action="stop-alarm">停止提示音</button>
      <p class="focus-hint">两端独立计时，记录可同步。<br>提示音可在设置中更换。</p>
    </section><section class="panel"><h2 class="section-title">专注足迹</h2><div class="focus-totals"><div><span>今日专注</span><strong>${Math.floor(stats.focus/60)}<span> 分钟</span></strong></div><div><span>累计轮次</span><strong>${state.focus_logs.length}<span> 轮</span></strong></div></div><div class="history-list">${logs.length?logs.map(l=>`<div class="focus-log"><div class="log-icon">${icon('leaf')}</div><div><p>${esc(state.tasks.find(v=>v.id===l.task_id)?.title || '独立专注')}</p><small>${dateTime(l.finished_at)}</small></div><strong>${Math.round(l.duration/60)} 分钟</strong></div>`).join(''):empty('暂无记录','完成计时后自动记录。',false)}</div><p class="settings-help">仅记录完整结束的专注计时。</p></section></div>${footer()}`;
}
function renderStats() {
  const days=Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-6+i);return {day:localDay(d),label:i===6?'今天':`${d.getMonth()+1}/${d.getDate()}`,...dayStats(localDay(d))};});
  const max=Math.max(1,...days.map(d=>d.completed)), all=activeTasks(), tasks=openTasks();
  return pageHeading('数据回顾','看见每一天的积累。')+summary()+`<div class="two-columns"><section class="panel"><div class="row between"><div><h2>近七天的完成节奏</h2><p class="subtitle">完成 ${days.reduce((s,d)=>s+d.completed,0)} 项任务 · 专注 ${Math.floor(days.reduce((s,d)=>s+d.focus,0)/60)} 分钟</p></div><span class="badge">近 7 天</span></div><div class="chart" role="img" aria-label="近七天完成任务数：${days.map(d=>`${d.label} ${d.completed}项`).join('；')}">${days.map(d=>`<div class="bar-col"><b>${d.completed}</b><div class="bar" style="height:${Math.max(2,d.completed/max*135)}px"></div><small>${d.label}</small></div>`).join('')}</div><p class="settings-help" style="margin-top:25px">累计 ${all.filter(t=>t.done).length} 项完成 · ${tasks.length} 项待办</p></section><section class="panel"><h2>你的精力分布</h2><p class="subtitle">当前待办的四象限分布</p>${quadrants.map(q=>{const n=tasks.filter(t=>qid(t)===q.id).length;return `<div class="q-stat q${q.id}"><span class="q-num">0${q.id}</span><div style="flex:1"><div class="stat-label">${q.name}</div><div class="meter"><div style="width:${tasks.length?n/tasks.length*100:0}%"></div></div></div><b>${n}</b></div>`;}).join('')}<div class="note-box" style="margin-top:25px">为“重要不紧急”的事留出时间，让明天少一点匆忙。</div></section></div>${footer()}`;
}
function renderSettings() {
  const s=state.settings;
  return pageHeading('设置','外观、同步与备份。')+`<div class="settings-grid" style="margin-top:28px">
    ${window.LanSyncUI?.settings()||''}${window.TimerAudio?.settings(state)||''}
    <section class="panel"><h2>外观与计时</h2><form id="settings-form" class="stack">
      <label class="field"><span>应用名称</span><input name="name" value="${esc(s.name)}" maxlength="30" required></label>
      <label class="field"><span>首页寄语</span><input name="subtitle" value="${esc(s.subtitle)}" maxlength="100"></label>
      <div class="field"><span>主题色</span><div class="theme-options">${Object.entries(palette).map(([name,[color]])=>`<button type="button" class="theme-option ${s.accent===name?'active':''}" data-action="theme" data-value="${name}" style="--swatch:${color}" aria-label="${{green:'森林绿',blue:'雾蓝',purple:'浅紫',orange:'陶橙'}[name]}"></button>`).join('')}</div><input type="hidden" name="accent" value="${s.accent}"></div>
      <div class="form-grid"><label class="field"><span>专注（分钟）</span><input name="focus_minutes" type="number" min="1" max="180" value="${s.focus_minutes}" required></label><label class="field"><span>休息（分钟）</span><input name="break_minutes" type="number" min="1" max="180" value="${s.break_minutes}" required></label></div>
      <div><button class="btn primary" type="submit">保存设置</button></div></form><p class="settings-help">外观与计时长度，两端分别设置。</p>
    </section>
    <section class="panel"><h2>本机与连接</h2><p class="settings-help">${window.PhoneStore?'数据保存在手机，离线可用。':'数据保存在电脑。以下地址可供浏览器访问。'}</p>
      <div class="stack">${(state.addresses||[]).map(a=>`<div class="address"><code>${esc(a)}</code><button class="icon-btn" data-action="copy" data-value="${esc(a)}" aria-label="复制地址">${icon('copy')}</button></div>`).join('')}</div>
      <p class="settings-help">${window.PhoneStore?'卸载或清除应用数据会删除记录，请定期备份。':'安卓 App 独立保存数据，更新需手动同步。'}</p>
      <details class="security-block"><summary>修改密码</summary><form id="password-form" class="stack"><label class="field"><span>当前密码</span><input name="old_password" type="password" autocomplete="current-password" maxlength="128" required></label><label class="field"><span>新密码（至少 8 位）</span><input name="new_password" type="password" minlength="8" maxlength="128" autocomplete="new-password" required></label><button class="btn" type="submit">修改并退出登录</button></form></details>
      <button class="btn" style="margin-top:20px" data-action="logout">${icon('logout')}退出登录</button>
    </section>
    <section class="panel"><h2>数据备份</h2>
      <div class="data-action"><div><h3>完整备份</h3><p>含任务、专注、附件和提示音。</p></div><a class="btn small" href="/api/backup" download>${icon('download')}导出 ZIP</a></div>
      <div class="data-action"><div><h3>数据导出</h3><p>可编辑的 JSON，不含文件。</p></div><a class="btn small" href="/api/export" download>导出 JSON</a></div>
      <div class="data-action"><div><h3>恢复备份</h3><p>合并 ZIP 或 JSON，重复任务跳过。</p></div><button class="btn small" data-action="import">${icon('upload')}选择文件</button></div>
      <input type="file" id="import-file" accept=".zip,.json" class="hidden"><p class="settings-help">最大 64 MB，保留当前外观设置。</p>
    </section></div>${footer()}`;
}

function renderMain() {
  if(!state) return;
  applyBrand(); renderNav(); $('#crumb-view').textContent=views[view];
  const renderers={board:renderBoard,calendar:renderCalendar,focus:renderFocus,stats:renderStats,settings:renderSettings};
  $('#main-content').innerHTML=(renderers[view] || renderTaskPage)();
  window.TimerAudio?.updateUI();
  updateConnection(); tickClock();
}
function navigate(id) {
  if(!views[id]) return;
  view=id; query=''; onlyToday=false; sort='default';
  $('#sidebar')?.classList.remove('open'); $('.mobile-shade')?.classList.remove('show');
  renderMain(); window.scrollTo({top:0});
}
function openEditor(id='', quadrant=1, due='') {
  editorTask=id?state.tasks.find(t=>t.id===id):null; editorId=id; pickedFiles=[];
  const t=editorTask || {title:'',notes:'',due:due || (view==='board'&&onlyToday?localDay():''),pinned:false,done:false};
  const q=editorTask?qid(t):Number(quadrant);
  const dialog=$('#task-dialog');
  dialog.innerHTML=`<form id="task-form"><div class="dialog-head"><h2 id="editor-title">${id?'编辑任务':'新建任务'}</h2><button type="button" class="icon-btn" data-action="editor-close" aria-label="关闭">${icon('close')}</button></div><div class="dialog-content"><label class="field"><span class="hidden">任务标题</span><textarea name="title" class="title-input" rows="2" maxlength="500" required placeholder="你想完成什么？">${esc(t.title)}</textarea></label><label class="field"><span>备注</span><textarea name="notes" rows="3" maxlength="20000" placeholder="记下想法、步骤或需要注意的细节…">${esc(t.notes)}</textarea></label><span class="small muted">放进一个象限</span><div class="quadrant-options">${quadrants.map(v=>`<label class="quadrant-option q${v.id}"><input type="radio" name="quadrant" value="${v.id}" ${v.id===q?'checked':''}>${v.name}</label>`).join('')}</div><div class="form-grid"><label class="field"><span>日期</span><input name="due" type="date" value="${esc(t.due)}"></label></div><div class="dialog-check"><label><input name="pinned" type="checkbox" ${t.pinned?'checked':''}>${icon('pin')}置顶</label><label><input name="done" type="checkbox" ${t.done?'checked':''}>已完成</label></div><div class="attachments"><span class="small muted">附件</span><div id="editor-files"></div><label class="upload-label">${icon('plus')}添加附件<input id="task-files" type="file" multiple class="hidden"></label><div class="file-picked" id="picked-files"></div><p class="small muted" style="margin-top:8px">每项最多 12 个附件，每个 20 MB。保存时上传。</p></div><p class="error" id="task-error" role="alert"></p></div><div class="dialog-bottom">${id?`<button type="button" class="danger-link" data-action="${t.deleted_at?'restore':'delete'}" data-id="${esc(id)}">${t.deleted_at?'恢复任务':'移至回收站'}</button>${t.deleted_at?`<button type="button" class="danger-link" data-action="purge" data-id="${esc(id)}">永久删除</button>`:''}`:'<span class="small muted">保存到本机</span>'}<div class="row"><button type="button" class="btn" data-action="editor-close">取消</button><button type="submit" class="btn primary">保存</button></div></div></form>`;
  renderEditorFiles(); if(!dialog.open) dialog.showModal();
  setTimeout(()=>$('[name=title]',dialog).focus(),50);
}
function renderEditorFiles() {
  if(!$('#editor-files')) return;
  $('#editor-files').innerHTML=state.files.filter(f=>f.task_id===editorId).map(f=>`<div class="attachment"><a href="/api/files/${encodeURIComponent(f.id)}" download>${icon('file')} ${esc(f.name)} <span class="muted">${Math.max(1,Math.round(f.size/1024))} KB</span></a><button class="icon-btn" type="button" data-action="file-delete" data-id="${esc(f.id)}" aria-label="删除附件">${icon('close')}</button></div>`).join('');
}
async function confirmAction(title, message, action, label='确认') {
  const d=$('#confirm-dialog');
  d.innerHTML=`<div class="dialog-head"><h2 id="confirm-title">${esc(title)}</h2></div><div class="dialog-content"><p class="subtitle" style="margin:0;line-height:1.9">${esc(message)}</p></div><div class="dialog-bottom"><button class="btn" id="confirm-no">取消</button><button class="btn primary" id="confirm-yes">${esc(label)}</button></div>`;
  d.showModal();
  $('#confirm-no').onclick=()=>d.close();
  $('#confirm-yes').onclick=async()=>{d.close();try {await action();}catch(e){toast(e.message);}};
}
async function taskChange(id, values, method='PATCH') {
  const t=state.tasks.find(t=>t.id===id);
  if(!t) return;
  try {await api(`/api/tasks/${encodeURIComponent(id)}`,{method,body:{revision:t.revision,...values}});await refresh(true);}
  catch(e){if(e.status===409) await refresh(true);throw e;}
}
async function timerAction(action) {
  const body={action,revision:state.timer.revision,task_id:'',mode:focusMode};
  if(action==='start'&&focusMode==='custom') {
    if(!Number.isInteger(customHours)||!Number.isInteger(customMinutes)||customHours<0||customHours>24||customMinutes<0||customMinutes>59)throw new Error('请填写有效的小时和分钟');
    body.duration=customHours*3600+customMinutes*60;
    if(body.duration<60||body.duration>86400)throw new Error('自定义时间应为 1 分钟至 24 小时');
  }
  if(action==='start'||action==='resume')window.TimerAudio?.prepare();
  const next=await api('/api/timer',{method:'POST',body});
  state.timer=next;lastTimerStatus=next.status;
  await window.TimerAudio?.scheduleNative(next,action==='start'||action==='resume');
  await refresh(true);
}
async function copyText(text) {
  try {await navigator.clipboard.writeText(text);toast('地址已复制');}
  catch {const area=document.createElement('textarea');area.value=text;document.body.append(area);area.select();const ok=document.execCommand('copy');area.remove();toast(ok?'地址已复制':'请长按或选中地址复制');}
}
async function loadDemo() {
  await confirmAction('载入示例任务','将添加 6 条可以编辑或删除的示例任务。',async()=>{
    const tomorrow=new Date();tomorrow.setDate(tomorrow.getDate()+1);
    const sample=[
      ['完成本周汇报','整理进展与下一步计划。',true,true,localDay()],
      ['回复今天的邮件','确认结论与待办。',true,true,localDay()],
      ['阅读 30 分钟','读书、笔记，持续积累。',true,false,localDay(tomorrow)],
      ['运动半小时','为精力充电。',true,false,''],
      ['确认快递时间','及时收件。',false,true,localDay()],
      ['挑一部电影','留一点放松时间。',false,false,''],
    ];
    for(const [title,notes,important,urgent,due] of sample) await api('/api/tasks',{method:'POST',body:{title,notes,important,urgent,due}});
    await refresh(true);toast('示例已载入，可以随意修改');
  },'载入示例');
}

document.addEventListener('click',async event=>{
  const nav=event.target.closest('[data-nav]');
  if(nav){navigate(nav.dataset.nav);return;}
  const el=event.target.closest('[data-action]'); if(!el) return;
  const {action,id,value}=el.dataset;
  try {
    if(action==='menu') {$('#sidebar').classList.add('open');$('.mobile-shade').classList.add('show');}
    if(action==='menu-close') {$('#sidebar').classList.remove('open');$('.mobile-shade').classList.remove('show');}
    if(action==='new') openEditor('',Number(el.dataset.q || 1),el.dataset.date || '');
    if(action==='edit') openEditor(id);
    if(action==='editor-close') $('#task-dialog').close();
    if(action==='toggle') {await taskChange(id,{done:!state.tasks.find(t=>t.id===id).done});toast('任务已更新');}
    if(action==='delete') await confirmAction('移至回收站？','任务与附件会被保留，可以从回收站恢复。',async()=>{await taskChange(id,{},'DELETE');$('#task-dialog').close();toast('任务已移至回收站');},'移至回收站');
    if(action==='purge') {const task=editorId===id&&$('#task-dialog').open?editorTask:state.tasks.find(t=>t.id===id);await confirmAction('永久删除这条任务？','任务与全部附件将无法恢复。下次同步时，也会从另一端删除。',async()=>{await api(`/api/tasks/${encodeURIComponent(id)}/purge`,{method:'POST',body:{revision:task.revision}});$('#task-dialog').close();await refresh(true);toast('任务及附件已永久删除');},'永久删除');}
    if(action==='stop-alarm') await window.TimerAudio?.stop();
    if(action==='restore') {await taskChange(id,{deleted_at:null});$('#task-dialog').close();toast('任务已恢复');}
    if(action==='layout') {layout=value;localStorage.setItem('quadrant.layout',value);renderMain();}
    if(action==='day') {selectedDay=value;renderMain();}
    if(action==='month') {month=new Date(month.getFullYear(),month.getMonth()+Number(value),1);renderMain();}
    if(action==='calendar-today') {selectedDay=localDay();month=new Date(new Date().getFullYear(),new Date().getMonth(),1);renderMain();}
    if(action==='focus-mode') {focusMode=value;renderMain();}
    if(action==='timer') await timerAction(value);
    if(action==='cancel-timer') await confirmAction('结束这一轮？','提前结束不会计入专注记录。也可以选择暂停，稍后继续。',async()=>timerAction('cancel'),'结束本轮');
    if(action==='theme') {$$('.theme-option').forEach(b=>b.classList.toggle('active',b.dataset.value===value));$('#settings-form [name=accent]').value=value;}
    if(action==='copy') await copyText(value);
    if(action==='import') $('#import-file').click();
    if(action==='file-delete') await confirmAction('删除附件？','附件将从主电脑移除。',async()=>{await api(`/api/files/${encodeURIComponent(id)}`,{method:'DELETE'});await refresh();renderEditorFiles();toast('附件已删除');},'删除附件');
    if(action==='logout') {await api('/api/logout',{method:'POST',body:{}});clearInterval(pollTimer);state=null;meta={...meta,initialized:true,authenticated:false};renderAuth();}
    if(action==='demo') await loadDemo();
    if(action==='retry') await boot();
  } catch(e) {toast(e.message);if(e.status===409) await refresh(true);}
});
document.addEventListener('keydown',e=>{
  if((e.key==='Enter'||e.key===' ') && e.target.matches('.task-body')) {e.preventDefault();openEditor(e.target.dataset.id);}
  if(e.key==='Escape') {$('#sidebar')?.classList.remove('open');$('.mobile-shade')?.classList.remove('show');}
});
document.addEventListener('input',e=>{
  if(['custom-hours','custom-minutes'].includes(e.target.id)){customHours=Number($('#custom-hours').value);customMinutes=Number($('#custom-minutes').value);focusMode='custom';$('.custom-duration')?.classList.add('active');$$('.focus-mode button').forEach(b=>b.classList.remove('active'));localStorage.setItem('quadrant.custom-time',JSON.stringify({hours:customHours,minutes:customMinutes}));tickClock();}

  if(e.target.id==='search-input') {
    const cursor=e.target.selectionStart;query=e.target.value;renderMain();
    const replacement=$('#search-input');replacement.focus();replacement.setSelectionRange(cursor,cursor);
  }
});
document.addEventListener('change',async e=>{
  if(e.target.id==='task-filter') {
    const value=e.target.value;
    onlyToday=view==='board'&&value==='today';
    renderMain();
  }
  if(e.target.id==='sort-filter') {sort=e.target.value;renderMain();}
  if(e.target.id==='task-files') {
    const files=[...e.target.files];
    if(files.some(f=>f.size>20*1024*1024)) {toast('每个附件不能超过 20 MB');e.target.value='';return;}
    const existing=state.files.filter(f=>f.task_id===editorId).length;
    if(files.length+existing>12) {toast('每个任务最多 12 个附件');e.target.value='';return;}
    pickedFiles=files;$('#picked-files').textContent=files.map(f=>`${f.name}（${Math.max(1,Math.round(f.size/1024))} KB）`).join(' · ');
  }
  if(e.target.id==='import-file') {
    const file=e.target.files[0];if(!file) return;
    e.target.value='';
    if(file.size>64*1024*1024) {toast('单次导入不能超过 64 MB');return;}
    await confirmAction('合并导入数据？',`将从“${file.name}”添加任务，已有编号跳过。当前任务和外观设置会保留。`,async()=>{
      const r=await api('/api/import',{method:'POST',body:file});await refresh(true);toast(`已导入 ${r.imported} 条任务，跳过 ${r.skipped} 条重复任务`);
    },'开始导入');
  }
});
document.addEventListener('submit',async e=>{
  e.preventDefault();const form=e.target, button=$('button[type=submit]',form); if(!button) return;
  const data=new FormData(form);button.disabled=true;
  try {
    if(form.id==='auth-form') {
      const setup=!meta.initialized;
      if(setup&&data.get('password')!==data.get('confirm')) throw new Error('两次输入的密码不一致');
      await api(setup?'/api/setup':'/api/login',{method:'POST',body:{password:data.get('password'),name:data.get('name')||'象限'}});
      meta={...meta,initialized:true,authenticated:true};state=null;await refresh(true);startPolling();
    }
    if(form.id==='task-form') {
      const q=quadrants[Number(data.get('quadrant'))-1];
      const body={title:data.get('title'),notes:data.get('notes'),due:data.get('due'),important:q.important,urgent:q.urgent,pinned:data.has('pinned'),done:data.has('done')};
      if(editorId) body.revision=editorTask.revision;
      const t=await api(editorId?`/api/tasks/${encodeURIComponent(editorId)}`:'/api/tasks',{method:editorId?'PATCH':'POST',body});
      editorTask=t;editorId=t.id;
      while(pickedFiles.length) {
        const file=pickedFiles[0];
        await api('/api/upload',{method:'POST',body:file,headers:{'X-Task-Id':t.id,'X-File-Name':encodeURIComponent(file.name)}});
        pickedFiles.shift();
      }
      $('#task-dialog').close();await refresh(true);toast('任务已保存');
    }
    if(form.id==='settings-form') {
      await api('/api/settings',{method:'PATCH',body:{name:data.get('name'),subtitle:data.get('subtitle'),accent:data.get('accent'),focus_minutes:Number(data.get('focus_minutes')),break_minutes:Number(data.get('break_minutes'))}});
      await refresh(true);toast('本机设置已保存');
    }
    if(form.id==='password-form') {
      await api('/api/password',{method:'POST',body:Object.fromEntries(data)});
      clearInterval(pollTimer);meta={...meta,initialized:true,authenticated:false};state=null;renderAuth();toast('密码已修改，请重新登录');
    }
  } catch(error) {
    const target=form.id==='auth-form'?$('#auth-error'):form.id==='task-form'?$('#task-error'):null;
    if(target) target.textContent=error.message;else toast(error.message);
    if(error.status===409) await refresh(true);
  } finally {button.disabled=false;}
});
document.addEventListener('dragstart',e=>{
  const task=e.target.closest('[data-task]');if(!task) return;
  e.dataTransfer.setData('text/plain',task.dataset.task);e.dataTransfer.effectAllowed='move';
});
document.addEventListener('dragover',e=>{
  const q=e.target.closest('[data-quadrant]');if(!q) return;
  e.preventDefault();q.classList.add('drag-over');
});
document.addEventListener('dragleave',e=>{const q=e.target.closest('[data-quadrant]');if(q&&!q.contains(e.relatedTarget)) q.classList.remove('drag-over');});
document.addEventListener('drop',async e=>{
  const el=e.target.closest('[data-quadrant]');if(!el) return;e.preventDefault();el.classList.remove('drag-over');
  const id=e.dataTransfer.getData('text/plain'), q=quadrants[Number(el.dataset.quadrant)-1];
  try{await taskChange(id,{important:q.important,urgent:q.urgent});toast('已移动到'+q.name);}catch(error){toast(error.message);}
});
function startPolling() {
  clearInterval(pollTimer);pollTimer=setInterval(()=>{if(!document.hidden) refresh();},2500);
}
async function boot() {
  try {
    meta=await api('/api/meta');
    if(meta.authenticated){await refresh(true);startPolling();}else renderAuth();
  } catch(e) {
    $('#app').innerHTML=`<main class="empty-page"><img src="/icon.svg" width="45" height="45" alt=""><h2 style="margin-top:20px">暂时连不上你的空间</h2><p>${esc(e.message)}</p><button class="btn primary" data-action="retry">重新连接</button></main>`;
  }
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state) refresh();});
window.addEventListener('online',()=>{if(state) refresh(true);});
setInterval(tickClock,500);
boot();
