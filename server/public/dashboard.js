      const paths={menu:'<path d="M3 6h18M3 12h18M3 18h18"/>',
        users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
        activity:'<path d="M3 12h4l3-8 4 16 3-8h4"/>',
        shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
        flask:'<path d="M9 3h6M10 3v7l-5 8a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-8V3M8 14h8"/>',
        rotate:'<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
        chevron:'<path d="m9 6 6 6-6 6"/>',
        plus:'<path d="M12 5v14M5 12h14"/>',
        terminal:'<path d="m5 7 5 5-5 5M13 17h6"/>',
        layers:'<path d="m12 3 9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5"/>',
        chart:'<path d="M4 3v18h17M8 15v-4M13 15V6M18 15v-7"/>',
        external:'<path d="M14 3h7v7M21 3l-9 9M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
        search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
        lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
        key:'<circle cx="8" cy="8" r="5"/><path d="m11.5 11.5 9 9M17 17l3-3M14 14l3-3"/>',
        info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
        x:'<path d="m6 6 12 12M18 6 6 18"/>',
        check:'<path d="m5 12 4 4L19 6"/>',
        copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h4"/>',
        ban:'<circle cx="12" cy="12" r="9"/><path d="m6 6 12 12"/>',
        clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
      };
      const icon=name=>'<svg viewBox="0 0 24 24" aria-hidden="true">'+(paths[name]||paths.info)+'</svg>';
      const $=id=>document.getElementById(id);
      const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      const hydrate=root=>(root||document).querySelectorAll('[data-icon]').forEach(el=>{el.outerHTML=icon(el.dataset.icon);});
      const initials=name=>name.trim().split(/\s+/).slice(0,2).map(n=>n[0]).join('').toUpperCase();
      const palette=[['#e9effb','#6985b1'],['#ede9f7','#8e79b0'],['#e8f3ef','#6b9b88'],['#f8ece4','#b59073'],['#f5eaf0','#ab7b97'],['#e8f0f4','#7b98ab']];
let state={employees:[],keys:[],connections:[],events:[]},view='subscriptions',filter='all',query='',usagePeriod='day',csrf='',gatewayUrl='',revealedKey=null,auth=null,authGeneration=0,toastTimer=null,refreshing=false;
const modal=$('modal');
const latestKey=id=>state.keys.find(k=>k.employeeId===id&&k.status==='active')||state.keys.filter(k=>k.employeeId===id).at(-1);
const employeeState=id=>latestKey(id)?.status||'none';
const counts=()=>state.employees.reduce((a,e)=>{a.all++;a[employeeState(e.id)]++;return a;},{all:0,active:0,none:0,revoked:0});
const employeeById=id=>state.employees.find(e=>e.id===id);
const ready=c=>c.auth==='connected'&&c.enabled&&c.availability!=='quota';
const authLabels={connected:'Авторизована',requires_auth:'Требуется вход',disconnected:'Отключена'};
const authBadge=c=>'<span class="status '+(c.auth==='connected'?'status-active':'status-warning')+'">'+esc(authLabels[c.auth]||'Проверяем вход')+'</span>';
const availabilityBadge=c=>'<span class="status '+(ready(c)?'status-active':'status-warning')+'">'+(!c.enabled?'Приостановлена':c.auth!=='connected'?'Нет подключения':c.availability==='quota'?'Лимит исчерпан':'Готова к запросам')+'</span>';
const timeLabel=iso=>new Date(iso).toLocaleString('ru-RU',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
function avatar(e){const colors=palette[e.color%palette.length];return '<span class="avatar" style="background:'+colors[0]+';color:'+colors[1]+'">'+esc(initials(e.name))+'</span>';}
function toast(message){clearTimeout(toastTimer);$('toast').innerHTML=icon('check')+'<span>'+esc(message)+'</span>';$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,3500);}
const messages={chrome_unavailable:'Обычный Chrome не найден. Скопируйте ссылку и откройте её вручную.',chrome_open_failed:'Не удалось открыть Chrome. Скопируйте ссылку и откройте её вручную.',duplicate_email:'Сотрудник с такой почтой уже существует.',invalid_employee:'Проверьте имя и рабочую почту.',active_key_exists:'У сотрудника уже есть действующий ключ.',wrong_account:'Выбран другой аккаунт. Повторите вход в прежний аккаунт подписки.',duplicate_account:'Этот аккаунт уже подключён к окружению.',login_port_in_use:'Другой вход Codex уже использует локальный адрес возврата. Завершите его и повторите.',login_in_progress:'Вход уже открыт. Завершите его или отмените.',login_expired:'Время ожидания закончилось. Начните вход заново.',login_start_failed:'Не удалось начать вход OpenAI. Попробуйте снова.',device_login_disabled:'Для входа по коду включите Device code authorization в настройках безопасности ChatGPT, затем повторите попытку.',login_failed:'OpenAI не подтвердил вход. Попробуйте снова.',account_verification_failed:'Не удалось подтвердить аккаунт.',subscription_requires_login:'Подписка требует повторного входа.',internal_error:'Не удалось выполнить действие. Повторите попытку.'};
async function api(path,{method='GET',body}={}){const response=await fetch(path,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(method!=='GET'?{'x-mox-csrf':csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});let data;try{data=await response.json();}catch{throw new Error('Сервер вернул неожиданный ответ.');}if(response.status===401){location.assign('/login');throw new Error('Нужно войти заново.');}if(!response.ok)throw new Error(messages[data.error?.code]||'Не удалось выполнить действие.');return data;}
function showError(error){$('mvp-error').textContent=error.message;$('mvp-error').hidden=false;}
async function load(){state=await api('/api/state');if(state.health?.accountingFailed)showError(new Error('Не удалось сохранить расход. Новые запросы приостановлены до восстановления сервера.'));renderEmployees();renderConnections();renderActivity();if(!state.connections.length)$('connection-list').innerHTML='<div class="card"><h2>Подключите первую подписку</h2><p>Нажмите «Подключить подписку» и пройдите вход на официальной странице OpenAI.</p></div>';if(view==='usage')await loadUsage();}
async function loadUsage(){const selected=usagePeriod,usage=await api('/api/usage?period='+selected);if(selected===usagePeriod)renderUsage(usage);}
const mobileNav=matchMedia('(max-width: 900px)');
function setMenu(open){const visible=mobileNav.matches&&open;document.body.classList.toggle('menu-open',visible);$('nav-backdrop').hidden=!visible;$('sidebar').inert=mobileNav.matches&&!visible;document.querySelector('.shell').inert=visible;$('menu-toggle').setAttribute('aria-expanded',String(visible));$('menu-toggle').setAttribute('aria-label',visible?'Закрыть меню':'Открыть меню');if(visible)document.querySelector('.menu-close').focus();if(!visible&&mobileNav.matches&&$('sidebar').contains(document.activeElement))$('menu-toggle').focus();}
mobileNav.addEventListener('change',()=>setMenu(false));
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&document.body.classList.contains('menu-open'))setMenu(false);});
function setView(next){setMenu(false);view=next;for(const name of ['employees','subscriptions','usage','codex','activity','check'])$(name+'-view').hidden=name!==view;document.querySelectorAll('[data-view]').forEach(el=>{el.classList.toggle('active',el.dataset.view===view);if(el.dataset.view===view)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});$('breadcrumb').textContent={employees:'Сотрудники',subscriptions:'Подписки окружения',usage:'Расход токенов',codex:'Подключение Codex',activity:'История действий',check:'Проверка ключа'}[view];document.title=$('breadcrumb').textContent+' · MOX ACCESS';if(next==='usage')void loadUsage().catch(showError);}
function modalHead(title,subtitle=''){return '<div class="modal-head"><div><h2 id="modal-title">'+esc(title)+'</h2>'+(subtitle?'<p>'+esc(subtitle)+'</p>':'')+'</div><button class="close" data-action="close" aria-label="Закрыть">'+icon('x')+'</button></div>';}
function openModal(body){revealedKey=null;modal.innerHTML=body;if(!modal.open)modal.showModal();}
async function closeModal(cancel=true){authGeneration++;const previous=auth;auth=null;if(previous?.timer)clearTimeout(previous.timer);if(previous?.popup&&!previous.popup.closed)previous.popup.close();revealedKey=null;modal.close();modal.innerHTML='';if(cancel&&previous?.id)await api('/api/auth/attempts/'+previous.id,{method:'DELETE'});}
function authIntro(connectionId=null){const connection=state.connections.find(c=>c.id===connectionId);openModal(modalHead(connection?'Войти повторно':'Подключить подписку','Откроется основной Chrome на этом компьютере.')+'<div class="modal-body"><div class="auth-panel"><div class="auth-symbol">'+icon('external')+'</div><h3>Вход на сайте OpenAI</h3><p>Завершите вход вручную. MOX проверит подтверждение и добавит подписку.</p></div>'+(connection?'<div class="auth-state-note">Ожидаемый аккаунт: <strong>'+esc(connection.email||connection.name)+'</strong></div>':'')+'<button class="btn btn-primary auth-main-button" data-action="begin-auth" '+(connectionId?'data-id="'+esc(connectionId)+'"':'')+'>'+icon('external')+'Войти через OpenAI</button><button class="btn btn-secondary auth-main-button" data-action="begin-device" '+(connectionId?'data-id="'+esc(connectionId)+'"':'')+'>Войти по коду устройства</button><div class="auth-state-note">Выберите нужный профиль в Chrome и завершите вход на сайте OpenAI.</div></div><div class="modal-footer"><button class="btn btn-secondary" data-action="close">Отмена</button></div>');}
function authProgress(){const device=auth?.method==='device';openModal(modalHead(device?'Вход по коду устройства':'Завершите вход в браузере','Подписка появится после подтверждения OpenAI.')+'<div class="modal-body"><div class="auth-panel"><div class="auth-symbol"><span class="auth-spinner"></span></div><h3>'+(auth?.authUrl?'Ожидаем вашу авторизацию':'Готовим страницу входа')+'</h3><p>'+(device?'Откройте страницу OpenAI в своём обычном браузере и введите этот код.':'Войдите в нужный аккаунт на странице OpenAI. Затем вернитесь в MOX.')+'</p></div>'+(auth?.userCode?'<div class="key-display" id="device-code">'+esc(auth.userCode)+'</div><button class="btn btn-secondary auth-main-button" data-action="copy-device-code">'+icon('copy')+'Скопировать код</button>':'')+(auth?.authUrl?'<button class="btn btn-secondary auth-main-button" data-action="open-auth">'+icon('external')+'Открыть OpenAI в основном Chrome'+'</button><button class="btn btn-secondary auth-main-button" data-action="copy-auth">'+icon('copy')+'Скопировать ссылку для своего браузера</button>':'')+(auth?.browserError?'<p class="error" role="alert">'+esc(auth.browserError)+'</p>':'')+'<div class="auth-state-note">'+(device?'Если OpenAI просит разрешить вход по коду, включите его в настройках безопасности ChatGPT.':'Подтверждение входа проверяется сервером.')+'</div></div><div class="modal-footer"><button class="btn btn-secondary" data-action="close">Отменить вход</button></div>');}
async function pollAuth(generation){
  if(!auth||generation!==authGeneration)return;const current=auth;const result=await api('/api/auth/attempts/'+current.id);if(!auth||generation!==authGeneration)return;
  if(result.status==='connected'){await closeModal(false);await load();setView('subscriptions');toast('Подписка подключена и доступна всем сотрудникам');return;}
  if(['failed','cancelled'].includes(result.status)){const connectionId=current.connectionId;await closeModal(false);openModal(modalHead('Вход не завершён')+'<div class="modal-body"><p>'+esc(messages[result.code]||'Вход отменён. Подписки и ключи сохранены.')+'</p><button class="btn btn-primary auth-main-button" data-action="connect-retry" '+(connectionId?'data-id="'+esc(connectionId)+'"':'')+'>Попробовать снова</button></div><div class="modal-footer"><button class="btn btn-secondary" data-action="close">Закрыть</button></div>');return;}
  current.timer=setTimeout(()=>void pollAuth(generation).catch(showError),1200);
}
async function openAuth(){const current=auth,generation=authGeneration;if(!current?.id)return;try{await api('/api/auth/attempts/'+current.id+'/open',{method:'POST'});if(auth!==current||generation!==authGeneration)return;current.browserError=null;toast('Страница входа открыта в основном Chrome');}catch(error){if(auth!==current||generation!==authGeneration)return;current.browserError=error.message;authProgress();}}
async function beginAuth(connectionId,method='browser'){
  const generation=++authGeneration;auth={connectionId,method};authProgress();
  try{const result=await api('/api/auth/attempts',{method:'POST',body:{connectionId:connectionId||null,method}});if(generation!==authGeneration){await api('/api/auth/attempts/'+result.id,{method:'DELETE'});return;}
    auth={...auth,...result,connectionId};authProgress();if(method==='browser'&&result.authUrl)await openAuth();await pollAuth(generation);
  }catch(error){if(generation!==authGeneration)return;await closeModal(false);showError(error);}
}
function showKey(employeeId,raw){const e=employeeById(employeeId);openModal(modalHead('Ключ готов',e?e.name+' · '+e.email:'')+'<div class="modal-body"><div class="modal-success">'+icon('check')+'</div><div class="key-display" id="new-key">'+esc(raw)+'</div><button class="btn btn-primary key-copy" data-action="copy-key">'+icon('copy')+'Скопировать ключ</button><p class="one-time">'+icon('lock')+'<span>Скопируйте сейчас. После закрытия полный ключ будет недоступен.</span></p><div class="new-key-note">Ключ действует на локальном сервере MOX и открывает доступ ко всем подпискам окружения.</div></div><div class="modal-footer"><button class="btn btn-secondary" data-action="close">Готово</button></div>');revealedKey=raw;}
function addModal(){openModal(modalHead('Добавить сотрудника','Личный ключ открывает доступ ко всем подпискам окружения.')+'<form id="add-form"><div class="modal-body"><div class="field"><label for="employee-name">Имя и фамилия</label><input id="employee-name" maxlength="80" required autofocus></div><div class="field"><label for="employee-email">Рабочая почта</label><input id="employee-email" type="email" maxlength="160" required></div><label class="checkbox"><input id="issue-now" type="checkbox" checked>Сразу выдать ключ</label><div id="form-error" class="error" role="alert" hidden></div></div><div class="modal-footer"><button type="button" class="btn btn-secondary" data-action="close">Отмена</button><button class="btn btn-primary" type="submit">Добавить сотрудника</button></div></form>');}
function manageConnection(id){const c=state.connections.find(c=>c.id===id);if(!c)return;openModal(modalHead(c.name,c.email||'')+'<div class="modal-body"><div class="about-grid"><div><span>Авторизация</span><strong>'+esc(authLabels[c.auth])+'</strong></div><div><span>Новые запросы</span><strong>'+(c.enabled?'Включены':'Приостановлены')+'</strong></div></div><div class="demo-control-buttons"><button class="btn btn-secondary" data-action="toggle-connection" data-id="'+esc(id)+'">'+(c.enabled?'Приостановить запросы':'Снять паузу')+'</button><button class="btn btn-secondary" data-action="reauthorize" data-id="'+esc(id)+'">Войти повторно</button>'+(c.auth!=='disconnected'?'<button class="btn btn-danger-outline" data-action="disconnect" data-id="'+esc(id)+'">Отключить подписку</button>':'')+'</div><div class="new-key-note">Начатые чаты остаются на этой подписке. Ключи и история расхода сохраняются.</div></div><div class="modal-footer"><button class="btn btn-secondary" data-action="close">Готово</button></div>');}
      function renderEmployees(){
        const c=counts();
        for(const k of ['all','active','none','revoked'])$('filter-'+k).textContent=c[k];
        $('nav-count').textContent=c.all;$('heading-count').textContent=c.all;$('total-count').textContent=c.all;$('active-count').textContent=c.active;
        document.querySelectorAll('[data-filter]').forEach(el=>{el.classList.toggle('active',el.dataset.filter===filter);el.setAttribute('aria-pressed',String(el.dataset.filter===filter));});
        const list=state.employees.filter(e=>(filter==='all'||employeeState(e.id)===filter)&&(!query||(e.name+' '+e.email).toLocaleLowerCase('ru').includes(query)));
        $('employee-rows').innerHTML=list.map(e=>{
          const key=latestKey(e.id),status=key?.status||'none',active=status==='active';
          const label={active:'Ключ активен',none:'Нет ключа',revoked:'Ключ отозван'}[status];
          return '<tr data-employee="'+esc(e.id)+'"><td><div class="person">'+avatar(e)+'<div><span class="person-name">'+esc(e.name)+'</span><span class="person-email">'+esc(e.email)+'</span></div></div></td><td>'+
            (key?'<span class="key-mask">'+icon('key')+'mox_•••• '+esc(key.suffix)+'</span>':'<span class="no-key">Ключ ещё не выдан</span>')+'</td><td><span class="status status-'+status+'">'+label+'</span></td><td>'+
            '<button class="row-action '+(active?'revoke':'issue')+'" data-action="'+(active?'revoke':'issue')+'" data-id="'+esc(e.id)+'" aria-label="'+(active?'Отозвать ключ: ':'Выдать ключ: ')+esc(e.name)+'">'+icon(active?'ban':'key')+(active?'Отозвать ключ':'Выдать ключ')+'</button></td></tr>';
        }).join('');
        $('empty-state').hidden=list.length>0;
        $('table-summary').textContent='Показано '+list.length+' из '+c.all;
      }
      const eventTitles={added:'Сотрудник добавлен',issued:'Ключ выдан',reissued:'Новый ключ выдан',revoked:'Ключ отозван',checked:'Ключ проверен',started:'Сервер запущен',connected:'Подписка авторизована',disconnected:'Подписка отключена',connection_changed:'Состояние подписки изменено',routed:'Запрос направлен',route_blocked:'Запрос приостановлен'};
      function renderActivity(){
        $('activity-list').innerHTML=state.events.map(event=>{
          const e=employeeById(event.employeeId);
          return '<div class="activity-row"><span class="event-icon">'+icon(event.type==='revoked'?'ban':event.type==='checked'?'shield':event.type==='added'?'users':event.type==='started'?'clock':'key')+'</span><div class="activity-main"><div class="activity-title">'+esc(eventTitles[event.type])+(e?' · '+esc(e.name):'')+'</div><div class="activity-sub">'+esc(event.detail||(e?e.email:'MOX ACCESS'))+'</div></div><span class="activity-time">'+timeLabel(event.at)+'</span></div>';
        }).join('');
      }
      function quotaMarkup(c){const q=c.weeklyQuota;if(q?.status!=='known')return '<div class="quota-unknown">'+(q?.status==='stale'?'Обновляем данные':'Нет данных')+'</div>';const percent=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(q.remainingPercent),reset=q.resetsAt?new Date(q.resetsAt).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):null;return '<div class="quota-value">'+percent+'%<small>осталось</small></div><div class="quota-track" role="meter" aria-label="Остаток недельной квоты" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+q.remainingPercent+'"><span style="width:'+q.remainingPercent+'%"></span></div>'+(reset?'<div class="quota-reset">Обновится '+esc(reset)+' · МСК</div>':'');}
      function renderConnections(){
        const total=state.connections.length,available=state.connections.filter(ready).length,authorized=state.connections.filter(c=>c.auth==='connected').length;
        for(const id of ['environment-total','subscriptions-count','nav-subscriptions'])$(id).textContent=total;
        $('environment-ready').textContent=available;$('subscriptions-ready').textContent=available;$('subscriptions-authorized').textContent=authorized;
        $('connection-list').innerHTML=state.connections.map(c=>'<article class="connection-card" data-connection="'+esc(c.id)+'"><div class="connection-identity"><div class="provider-icon">'+icon('terminal')+'</div><div><div class="connection-title">'+esc(c.name)+'</div><div class="connection-email">'+esc(c.email)+' · '+esc(({pro:'Pro',plus:'Plus',business:'Business',enterprise:'Enterprise'})[c.planType]||'План не определён')+'</div></div></div><div><div class="connection-label">Авторизация</div>'+authBadge(c)+'</div><div><div class="connection-label">Доступность</div>'+availabilityBadge(c)+'</div><div class="weekly-quota"><div class="connection-label">Недельная квота</div>'+quotaMarkup(c)+'</div><div class="connection-actions">'+(c.auth!=='connected'?'<button class="btn btn-primary btn-small" data-action="reauthorize" data-id="'+esc(c.id)+'" aria-label="Авторизовать: '+esc(c.name)+'">Авторизовать</button>':'')+'<button class="btn btn-secondary btn-small" data-action="manage-connection" data-id="'+esc(c.id)+'" aria-label="Управлять: '+esc(c.name)+'">Управлять</button></div></article>').join('');
      }
      const tokenNumber=new Intl.NumberFormat('ru-RU');
      function tokenCount(value,unknown,known){
        if(unknown&&!known)return '<span class="incomplete-mark">Нет данных</span>';
        return tokenNumber.format(value)+(unknown?'<span class="incomplete-mark"> + ?</span>':'');
      }
      function combinedCount(total){
        return tokenCount(total.input+total.output,total.incompleteRequests,total.inputKnown+total.outputKnown);
      }
      function renderUsage(usage){
        document.querySelectorAll('[data-period]').forEach(el=>{el.classList.toggle('active',el.dataset.period===usagePeriod);el.setAttribute('aria-pressed',String(el.dataset.period===usagePeriod));});
        $('usage-range').textContent=usage.range.label+' · Москва';
        for(const mode of ['standard','fast','unknown']){
          const total=usage.totals.byMode[mode];
          $('usage-'+mode).innerHTML=combinedCount(total);
          $('usage-'+mode+'-detail').innerHTML='<span>Входные <b>'+tokenCount(total.input,total.inputUnknown,total.inputKnown)+'</b></span><span>Выходные <b>'+tokenCount(total.output,total.outputUnknown,total.outputKnown)+'</b></span>';
        }
        $('usage-total').innerHTML=combinedCount(usage.totals);
        const notices=[];
        if(usage.totals.byMode.unknown.requests)notices.push('Запросов с неизвестным режимом отправки: '+usage.totals.byMode.unknown.requests+'. Их расход показан отдельно.');
        if(usage.totals.incompleteRequests)notices.push('Запросов с неполными данными о токенах: '+usage.totals.incompleteRequests+'. Показана известная часть.');
        $('usage-incomplete').hidden=!notices.length;
        $('usage-incomplete').innerHTML=icon('info')+'<span>'+notices.join(' ')+'</span>';
        $('usage-rows').innerHTML=usage.rows.map(row=>'<tr data-usage-employee="'+esc(row.employee.id)+'"><td><div class="person">'+avatar(row.employee)+'<div><span class="person-name">'+esc(row.employee.name)+'</span><span class="person-email">'+esc(row.employee.email)+'</span></div></div></td>'+['standard','fast','unknown'].map(mode=>{const t=row.byMode[mode];return '<td data-mode="'+mode+'" data-token="input">'+tokenCount(t.input,t.inputUnknown,t.inputKnown)+'</td><td data-mode="'+mode+'" data-token="output">'+tokenCount(t.output,t.outputUnknown,t.outputKnown)+'</td>';}).join('')+'<td data-token="total">'+combinedCount(row)+'</td></tr>').join('');
        const modeNames={standard:'Fast не запрошен',fast:'Fast запрошен',unknown:'Режим неизвестен'};
        $('usage-mobile').innerHTML=usage.rows.map(row=>'<article class="usage-person-card" data-mobile-employee="'+esc(row.employee.id)+'"><div class="person">'+avatar(row.employee)+'<div><span class="person-name">'+esc(row.employee.name)+'</span><span class="person-email">'+esc(row.employee.email)+'</span></div></div>'+['standard','fast','unknown'].map(mode=>{const t=row.byMode[mode];return '<div class="usage-person-mode" data-mobile-mode="'+mode+'"><strong>'+modeNames[mode]+'</strong><div class="mobile-tokens"><div><span>Входные</span><b>'+tokenCount(t.input,t.inputUnknown,t.inputKnown)+'</b></div><div><span>Выходные</span><b>'+tokenCount(t.output,t.outputUnknown,t.outputKnown)+'</b></div></div></div>';}).join('')+'<div class="usage-person-total"><span>Всего токенов</span><strong>'+combinedCount(row)+'</strong></div></article>').join('');
        $('usage-request-count').textContent='Учтено запросов: '+usage.totals.requests;
      }
document.addEventListener('click',async event=>{
  const el=event.target.closest('button');if(!el||el.disabled)return;
  try{
    $('mvp-error').hidden=true;
    if(el.dataset.view){setView(el.dataset.view);return;}
    if(el.dataset.filter){filter=el.dataset.filter;renderEmployees();return;}
    if(el.dataset.period){usagePeriod=el.dataset.period;await loadUsage();return;}
    const action=el.dataset.action,id=el.dataset.id;
    if(action==='toggle-menu'){setMenu(!document.body.classList.contains('menu-open'));return;}
    if(action==='close-menu'){setMenu(false);return;}
    if(action==='close'){await closeModal();return;}
    if(action==='connect'||action==='connect-retry'||action==='reauthorize'){await closeModal();authIntro(action==='connect'?null:id);return;}
    if(action==='begin-auth'||action==='begin-device'){el.disabled=true;await beginAuth(id,action==='begin-device'?'device':'browser');return;}
    if(action==='copy-device-code'&&auth?.userCode){await navigator.clipboard.writeText(auth.userCode);toast('Код скопирован');return;}
    if(action==='copy-auth'&&auth?.authUrl){await navigator.clipboard.writeText(auth.authUrl);toast('Ссылка скопирована. Откройте её в обычном браузере.');return;}
    if(action==='open-auth'){el.disabled=true;await openAuth();return;}
    if(action==='add'){addModal();return;}
    if(action==='issue'){const e=employeeById(id);openModal(modalHead('Выдать ключ',e.name)+'<div class="modal-body"><p>Ключ предоставит доступ ко всем подпискам окружения.</p></div><div class="modal-footer"><button class="btn btn-secondary" data-action="close">Отмена</button><button class="btn btn-primary" data-action="confirm-issue" data-id="'+esc(id)+'">Выдать ключ</button></div>');return;}
    if(action==='revoke'){const e=employeeById(id);openModal(modalHead('Отозвать ключ?',e.name)+'<div class="modal-body"><p>Следующие запросы сотрудника будут отклонены. История расхода сохранится.</p></div><div class="modal-footer"><button class="btn btn-secondary" data-action="close">Сохранить доступ</button><button class="btn btn-danger" data-action="confirm-revoke" data-id="'+esc(id)+'">Отозвать ключ</button></div>');return;}
    el.disabled=true;
    if(action==='confirm-issue'){const result=await api('/api/employees/'+id+'/issue-key',{method:'POST'});await load();showKey(id,result.key);}
    if(action==='confirm-revoke'){await api('/api/employees/'+id+'/revoke-key',{method:'POST'});await closeModal();await load();toast('Ключ отозван');}
    if(action==='copy-key'&&revealedKey){await navigator.clipboard.writeText(revealedKey);toast('Ключ скопирован');}
    if(action==='manage-connection')manageConnection(id);
    if(action==='refresh-quota'){await api('/api/connections/'+id,{method:'POST',body:{action:'refresh-quota'}});await load();toast('Доступность подписки проверена');}
    if(action==='toggle-connection'){await api('/api/connections/'+id,{method:'POST',body:{action:'toggle'}});await closeModal();await load();}
    if(action==='disconnect')openModal(modalHead('Отключить подписку?')+'<div class="modal-body"><p>Запросы к ней остановятся. Ключи сотрудников и история сохранятся.</p></div><div class="modal-footer"><button class="btn btn-secondary" data-action="close">Отмена</button><button class="btn btn-danger" data-action="confirm-disconnect" data-id="'+esc(id)+'">Отключить</button></div>');
    if(action==='confirm-disconnect'){await api('/api/connections/'+id,{method:'POST',body:{action:'disconnect'}});await closeModal();await load();}
    if(action==='logout'){await closeModal();await api('/api/logout',{method:'POST'});location.assign('/login');}
    if(action==='toggle-key'){$('check-key').type=$('check-key').type==='password'?'text':'password';el.textContent=$('check-key').type==='password'?'Показать ключ':'Скрыть ключ';}
    if(action==='about')openModal(modalHead('Как работает доступ')+'<div class="modal-body"><p>Сотрудник использует свой ключ MOX в настольном Codex. Сервер проверяет ключ, выбирает доступную подписку и записывает фактический расход каждого запроса.</p></div><div class="modal-footer"><button class="btn btn-secondary" data-action="close">Понятно</button></div>');
  }catch(error){showError(error);}finally{el.disabled=false;}
});
document.addEventListener('submit',async event=>{
  if(!['add-form','check-form'].includes(event.target.id))return;event.preventDefault();const submit=event.target.querySelector('[type="submit"]');submit.disabled=true;
  try{
    if(event.target.id==='add-form'){const result=await api('/api/employees',{method:'POST',body:{name:$('employee-name').value,email:$('employee-email').value,issueNow:$('issue-now').checked}});await closeModal();await load();if(result.key)showKey(result.employee.id,result.key);else toast('Сотрудник добавлен');}
    else{const result=await api('/api/check-key',{method:'POST',body:{key:$('check-key').value.trim()}}),valid=result.status==='active';$('check-result').innerHTML='<div class="check-result '+(valid?'':'bad')+'"><div class="result-top">'+icon(valid?'check':'ban')+(valid?'Ключ активен':result.status==='revoked'?'Ключ отозван':'Ключ не найден')+'</div><div class="result-detail">'+esc(result.employee?.name||'')+(valid?'<br>Доступных подписок: '+result.available+' из '+result.total:'. Доступ закрыт.')+'</div></div>';}
  }catch(error){if(event.target.id==='add-form'&&$('form-error')){$('form-error').textContent=error.message;$('form-error').hidden=false;}else showError(error);}finally{submit.disabled=false;}
});
$('search').addEventListener('input',event=>{query=event.target.value.toLocaleLowerCase('ru').trim();renderEmployees();});
modal.addEventListener('cancel',event=>{event.preventDefault();void closeModal().catch(showError);});
async function boot(){hydrate();const session=await api('/api/session');csrf=session.csrf;gatewayUrl=session.gatewayUrl;$('gateway-url').value=gatewayUrl;$('provider-config').textContent='model_provider = "mox"\n[model_providers.mox]\nname = "MOX"\nbase_url = "'+gatewayUrl+'"\nenv_key = "MOX_ACCESS_KEY"\nwire_api = "responses"\nrequires_openai_auth = false\nsupports_websockets = false';await load();setView(state.connections.length?'employees':'subscriptions');const pending=await api('/api/auth/active');if(pending){auth=pending;authProgress();void pollAuth(++authGeneration).catch(showError);}}
void boot().catch(showError);
setInterval(()=>{if(document.hidden||refreshing)return;refreshing=true;void load().catch(showError).finally(()=>{refreshing=false;});},5000);
