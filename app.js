import { Client, handle_file } from './gradio-client.js';
import { HF_TOKEN } from './config.js';
const $ = id => document.getElementById(id);
$('token').value = HF_TOKEN;
const tokenNotice = $('token').parentElement.querySelector('p.muted');
if (tokenNotice) tokenNotice.textContent = 'Тестовая сборка: токен загружается из публичного config.js. Он доступен посетителям сайта и восстанавливается после перезагрузки. Чтобы удалить его постоянно, очистите config.js и отзовите токен в Hugging Face.';
$('forgetToken').textContent = 'Очистить до перезагрузки';
const el = (tag, text, cls) => { const n = document.createElement(tag); if(text !== undefined) n.textContent = text; if(cls) n.className = cls; return n; };
const seeds = ['black-forest-labs/FLUX.1-schnell','black-forest-labs/FLUX.1-dev'];
let favorites = []; try { const f = JSON.parse(localStorage.getItem('studio-favorites') || '[]'); if(Array.isArray(f)) favorites = f.filter(x => typeof x === 'string').slice(0,100); } catch {}
let selected, client, api, job, readers = [], busy = false, selectionVersion = 0, searchVersion = 0;
function status(id, text, error=false) { $(id).textContent = String(text).replace(/hf_[A-Za-z0-9]+/g, '[TOKEN REDACTED]'); $(id).classList.toggle('error',error); }
function normalizeId(value) {
 const id = value.trim().replace(/^https:\/\/huggingface\.co\/spaces\//,'').replace(/[?#].*$/,'').replace(/\/$/,'');
 if(!/^[\w.-]+\/[\w.-]+$/.test(id)) throw Error('Нужен ID вида owner/space или ссылка https://huggingface.co/spaces/owner/space');
 return id;
}
async function jsonFetch(url) { const r = await fetch(url,{signal:AbortSignal.timeout(25000)}); if(!r.ok) throw Error(`HTTP ${r.status}: ресурс недоступен`); return r.json(); }
function card(id, note='') { const b = el('button',undefined,'spaceCard'); b.type='button'; b.append(el('strong',id.split('/').pop()),el('small',id),el('small',note)); b.onclick=()=>selectSpace(id); return b; }
function renderFavorites() { $('favorites').replaceChildren(...favorites.map(id=>card(id))); if(!favorites.length) $('favorites').append(el('p','Добавляйте любимые инструменты кнопкой ☆.','muted')); updateFavorite(); }
function updateFavorite() { $('favoriteButton').textContent = selected && favorites.includes(selected.id) ? '★ Убрать' : '☆ В избранное'; }
async function search(query) {
 const v=++searchVersion; status('searchStatus','Ищем публичные Spaces…');
 try { const data=await jsonFetch(`https://huggingface.co/api/spaces?search=${encodeURIComponent(query)}&limit=40&sort=likes&direction=-1`); if(v!==searchVersion)return;
 $('catalog').replaceChildren(...data.map(s=>card(s.id,`${s.sdk || 'Space'} · ♥ ${s.likes || 0}`))); status('searchStatus',`Найдено: ${data.length}. Это поиск по названию, не проверка бесплатности.`);
 } catch(e) { if(v!==searchVersion)return; $('catalog').replaceChildren(...seeds.map(id=>card(id,'Стартовый инструмент'))); status('searchStatus',`${e.message}. Показан стартовый список.`,true); }
}
function disconnect() { if(client) { try { client.close(); } catch {} } client=null; api=null; $('apiControls').hidden=true; $('fields').replaceChildren(); }
async function selectSpace(value) {
 if(busy) { alert('Сначала завершите или отмените текущую операцию.'); return; }
 const v=++selectionVersion;
 try {
 const id=normalizeId(value); disconnect(); selected=null;
 $('frameArea').replaceChildren(); $('frameArea').className='empty'; $('frameArea').textContent='Загрузка информации…'; $('results').replaceChildren(); $('rawResult').textContent='Пока нет результатов';
 for(const name of ['loadEmbed','connectButton','favoriteButton','shareButton']) $(name).disabled=true;
 $('original').hidden=true; $('selectedTitle').textContent=id; status('spaceStatus','Проверяем Space…'); status('apiStatus','');
 const info=await jsonFetch(`https://huggingface.co/api/spaces/${id}`); if(v!==selectionVersion)return;
 const host=new URL(info.host || `https://${info.subdomain}.hf.space`);
 if(host.protocol!=='https:' || !host.hostname.endsWith('.hf.space')) throw Error('Неожиданный адрес Space. Используйте оригинальную страницу HF.');
 selected={id:info.id || id, host:host.origin, sdk:info.sdk};
 $('selectedTitle').textContent=selected.id; $('spaceId').value=selected.id;
 $('original').href=`https://huggingface.co/spaces/${selected.id}`; $('original').hidden=false;
 status('spaceStatus',`${info.sdk || 'Space'} · ${info.runtime?.stage || 'состояние неизвестно'} · ♥ ${info.likes || 0}. Условия использования смотрите у автора.`);
 for(const name of ['loadEmbed','favoriteButton','shareButton']) $(name).disabled=false;
 $('connectButton').disabled=info.sdk!=='gradio';
 $('frameArea').textContent='Нажмите «Загрузить интерфейс». Подключение происходит только по вашему действию.';
 history.replaceState(null,'',`${location.pathname}?space=${encodeURIComponent(selected.id)}`); updateFavorite();
 } catch(e) { if(v===selectionVersion) {status('spaceStatus',e.message+' Для закрытых Spaces используйте сайт Hugging Face.',true); $('frameArea').textContent='Не удалось загрузить Space.';} }
}
function switchTab(apiMode) { $('apiPanel').hidden=!apiMode; $('embedPanel').hidden=apiMode; $('apiTab').classList.toggle('active',apiMode); $('embedTab').classList.toggle('active',!apiMode); }
$('apiTab').onclick=()=>switchTab(true); $('embedTab').onclick=()=>switchTab(false);
$('loadEmbed').onclick=()=>{ if(!selected)return; const f=el('iframe'); f.title=selected.id; f.src=selected.host; f.referrerPolicy='no-referrer'; f.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox'); f.allow='fullscreen'; $('frameArea').className=''; $('frameArea').replaceChildren(f); };
$('connectButton').onclick=async()=>{
 if(!selected || busy)return; busy=true; $('connectButton').disabled=true; disconnect(); status('apiStatus','Подключаемся к Gradio. Пробуждение Space может занять время…');
 try {
 const token=$('token').value.trim(); if(token && !/^hf_[A-Za-z0-9]+$/.test(token))throw Error('Токен должен начинаться с hf_ и не содержать пробелов.');
 if(token && !confirm(`Разрешить авторизацию токеном для ${selected.id}? Используйте только доверенные Spaces.`)) {status('apiStatus','Подключение отменено.');return;}
 client=await Client.connect(selected.id,{...(token?{token}:{}),events:['data','status'],record_history:false});
 api=await client.view_api(); const names=Object.keys(api.named_endpoints || {}); if(!names.length)throw Error('Нет доступных именованных API-операций. Используйте интерфейс Space.');
 $('endpoint').replaceChildren(...names.map(name=>{const o=el('option',name);o.value=name;return o;}));
 $('endpoint').value=names.find(n=>/infer|generate|predict/.test(n)) || names[0]; $('apiControls').hidden=false; buildFields(); status('apiStatus','API подключён. Проверьте параметры перед запуском.');
 } catch(e) {disconnect(); status('apiStatus',explain(e),true);} finally {busy=false;$('connectButton').disabled=false;}
};
function explain(e) { return `${e?.message || String(e)}\nЕсли Space спит, требует входа, исчерпал квоту или блокирует CORS, откройте оригинальный интерфейс. Токен не снимает лимиты; OAuth-операции могут не работать через этот клиент.`; }
function buildFields() {
 const schema=api.named_endpoints[$('endpoint').value]; $('fields').replaceChildren(); readers=[]; $('schema').textContent=JSON.stringify(schema,null,2);
 schema.parameters.forEach((p,i)=>{
 const wrap=el('div',undefined,'field'); const label=el('label',`${p.label || p.parameter_name} · ${p.parameter_name}`); label.htmlFor=`param-${i}`;
 const component=(p.component || '').toLowerCase(); const type=typeof p.type==='string'?p.type:p.type?.type;
 let input, read; const def=p.parameter_has_default?p.parameter_default:undefined;
 if(['image','file','audio','video'].includes(component)) {
 input=el('input');input.type='file'; if(component==='image')input.accept='image/*'; if(component==='audio')input.accept='audio/*'; if(component==='video')input.accept='video/*';
 read=()=>input.files[0]?handle_file(input.files[0]):(def ?? null);
 } else if(component==='checkbox' || type==='boolean') {input=el('input');input.type='checkbox';input.checked=def===true;read=()=>input.checked;
 } else if(['number','slider'].includes(component) || ['number','integer'].includes(type)) {
 input=el('input');input.type='number';input.step=type==='integer'?'1':'any';input.value=def ?? '';input.required=!p.parameter_has_default;
 read=()=>{if(input.value==='')return def ?? null;const n=Number(input.value);if(!Number.isFinite(n))throw Error('Некорректное число: '+p.parameter_name);return n;};
 } else if(component==='textbox' || type==='string') {
 input=el('textarea');input.value=def ?? '';input.placeholder=p.description || p.parameter_name; wrap.classList.add('wide');read=()=>input.value;
 } else {
 input=el('textarea'); input.value=JSON.stringify(def ?? p.example_input ?? null,null,2);wrap.classList.add('wide');label.textContent+=' (JSON)';
 read=()=>{try{return JSON.parse(input.value);}catch{throw Error('Некорректный JSON: '+p.parameter_name);}};
 }
 input.id=`param-${i}`;wrap.append(label,input);if(p.description)wrap.append(el('small',p.description,'muted'));$('fields').append(wrap);readers.push(read);
 });
}
$('endpoint').onchange=buildFields;
function safeURL(value) {try {const u=new URL(value,selected.host);return u.protocol==='https:'?u.href:null;}catch{return null;}}
function showResult(data) {
 $('rawResult').textContent=JSON.stringify(data,null,2); $('results').replaceChildren(); const files=new Map();
 function walk(x) { if(!x)return; if(Array.isArray(x)){x.forEach(walk);return;} if(typeof x==='object') { if(x.url){const u=safeURL(x.url);if(u)files.set(u,x);} Object.values(x).forEach(walk); } else if(typeof x==='string' && /^https:\/\//.test(x) && /\.(png|jpe?g|webp|gif)(?:\?|$)/i.test(x)) {const u=safeURL(x);if(u)files.set(u,{});} }
 walk(data);
 for(const [url,meta] of files) {
 const box=el('div',undefined,'resultCard'); const isImage=meta.mime_type?.startsWith('image/') || /\.(png|jpe?g|webp|gif)(?:\?|$)/i.test(meta.orig_name || url);
 if(isImage){const img=el('img');img.src=url;img.alt='Результат генерации';img.loading='lazy';img.referrerPolicy='no-referrer';box.append(img);}
 const a=el('a','Открыть / сохранить файл ↗');a.href=url;a.target='_blank';a.rel='noopener noreferrer';box.append(a);$('results').append(box);
 }
 if(!files.size)$('results').append(el('p','Ответ получен. Смотрите данные результата ниже.','muted'));
}
function setGenerating(value) {busy=value; $('generateButton').disabled=value;$('cancelButton').disabled=!value;$('endpoint').disabled=value;$('connectButton').disabled=value; for(const x of $('fields').querySelectorAll('input,textarea,select'))x.disabled=value;}
$('generateForm').onsubmit=async e=>{
 e.preventDefault();if(!client || busy)return;
 try {
 const values=readers.map(read=>read());setGenerating(true); status('apiStatus','Отправляем запрос…'); $('results').replaceChildren(); $('rawResult').textContent='Ожидание ответа…';
 job=client.submit($('endpoint').value,values); let gotData=false;
 for await(const event of job) {
 if(event.type==='status') { const s=event; if(s.stage==='error')throw Error(s.message || 'Ошибка генерации'); status('apiStatus',`${s.stage || 'Ожидание'}${s.position!=null?' · место в очереди: '+s.position:''}${s.eta!=null?' · примерно '+Math.round(s.eta)+' с':''}${s.message?' · '+s.message:''}`); }
 if(event.type==='data'){gotData=true;showResult(event.data);}
 }
 status('apiStatus',gotData?'Готово. Сохраните нужные файлы: ссылки Space могут быть временными.':'Операция завершена без результата или отменена.');
 }catch(err){status('apiStatus',explain(err),true);}finally{job=null;setGenerating(false);}
};
$('cancelButton').onclick=async()=>{if(job){try{await job.cancel();status('apiStatus','Запрошена отмена. Сервер может продолжить уже начатое вычисление.');}catch(e){status('apiStatus',e.message,true);}}};
$('searchForm').onsubmit=e=>{e.preventDefault();search($('search').value);};
for(const b of document.querySelectorAll('[data-query]'))b.onclick=()=>{$('search').value=b.dataset.query;search(b.dataset.query);};
$('addForm').onsubmit=e=>{e.preventDefault();selectSpace($('spaceId').value);};
$('favoriteButton').onclick=()=>{if(!selected)return;favorites=favorites.includes(selected.id)?favorites.filter(x=>x!==selected.id):[...favorites,selected.id];try{localStorage.setItem('studio-favorites',JSON.stringify(favorites));}catch{alert('Браузер запретил сохранение избранного.');}renderFavorites();};
$('shareButton').onclick=async()=>{try{await navigator.clipboard.writeText(location.href);status('spaceStatus','Ссылка скопирована. В ней только ID Space, без токена и промпта.');}catch{status('spaceStatus','Скопируйте адрес страницы из адресной строки.');}};
$('settingsButton').onclick=()=>{if(busy){alert('Дождитесь завершения операции.');return;}$('settings').showModal();};
$('forgetToken').onclick=()=>{$('token').value='';disconnect();status('apiStatus','Токен удалён, API отключён.');};
$('settings').addEventListener('close',()=>{disconnect();status('apiStatus','Настройки доступа обновлены. Подключите API заново.');});
renderFavorites();$('catalog').replaceChildren(...seeds.map(id=>card(id,'Стартовый инструмент')));
const initial=new URLSearchParams(location.search).get('space');if(initial)selectSpace(initial);else selectSpace(seeds[0]);
