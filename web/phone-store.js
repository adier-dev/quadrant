/* Android-only local API. Desktop browsers continue to use the Python API. */
'use strict';
if (window.QuadrantAndroid) (() => {
  const defaults={name:'象限',subtitle:'把时间留给重要的事',accent:'green',focus_minutes:25,break_minutes:5};
  const taskFields=['title','notes','important','urgent','done','pinned','due','id','revision','created_at','updated_at','completed_at','deleted_at'];
  const taskRecord=t=>Object.fromEntries(taskFields.filter(k=>k in t).map(k=>[k,t[k]]));
  const id=()=>crypto.randomUUID().replaceAll('-',''), enc=new TextEncoder();
  const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
  const digest=async bytes=>hex(await crypto.subtle.digest('SHA-256',bytes));
  const from64=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
  function to64(bytes){let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);}
  const request=req=>new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  const opened=new Promise((resolve,reject)=>{const req=indexedDB.open('quadrant-phone',1);req.onupgradeneeded=()=>{for(const name of ['meta','blobs','staging'])req.result.createObjectStore(name);};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  let queue=Promise.resolve(), busy=false;
  const serial=fn=>{const next=queue.then(fn);queue=next.catch(()=>{});return next;};
  async function read(){
    const db=await opened;
    const value=await request(db.transaction('meta').objectStore('meta').get('state'))||{revision:0,device_id:id(),settings:{...defaults},tasks:[],files:[],focus_logs:[],timer:blank(),auth:null,logged_in:false,peer:null,last_sync:0};
    value.purged??=[];value.alarm??=[{id:'0'.repeat(32),file_id:'',revision:1,updated_at:0}];
    const normalized=value.tasks.map(taskRecord);
    if(JSON.stringify(value.tasks)!==JSON.stringify(normalized)){value.tasks=normalized;await write(value);}
    return value;
  }
  async function write(data, files=[], removed=[], staging=false) {
    data.tasks=data.tasks.map(taskRecord);
    const db=await opened;
    return new Promise((resolve,reject)=>{const tx=db.transaction(['meta','blobs','staging'],'readwrite');tx.objectStore('meta').put(data,'state');for(const [key,value] of files)tx.objectStore(staging?'staging':'blobs').put(value,key);for(const key of removed)tx.objectStore('blobs').delete(key);tx.oncomplete=resolve;tx.onabort=()=>reject(new Error('本机数据保存失败，请检查可用存储空间'));tx.onerror=()=>{};});
  }
  async function blob(key,staging=false){const db=await opened;return request(db.transaction(staging?'staging':'blobs').objectStore(staging?'staging':'blobs').get(key));}
  const fail=(message,status=400)=>{const e=new Error(message);e.status=status;throw e;};
  function blank(revision=0){return {status:'idle',mode:'focus',task_id:'',duration:0,remaining:0,ends_at:0,revision};}
  function text(value,label,limit,required=false){if(typeof value!=='string'||value.length>limit||(required&&!value.trim()))fail(label+'格式不正确');return value.trim();}
  function taskValues(raw) {
    const t={title:text(raw.title,'标题',500,true),notes:text(raw.notes??'','备注',20000)};
    for(const k of ['important','urgent','done','pinned']){if(raw[k]!==undefined&&typeof raw[k]!=='boolean')fail('任务标记无效');t[k]=raw[k]??false;}
    t.due=raw.due||'';if(t.due&&(!/^\d{4}-\d{2}-\d{2}$/.test(t.due)||new Date(t.due).toISOString().slice(0,10)!==t.due))fail('日期无效');
    return t;
  }
  async function hashPassword(password,salt){const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);return hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:from64(salt),iterations:240000},key,256));}
  function advance(s){if(s.timer.status==='running'&&Date.now()>=s.timer.ends_at){if(['focus','custom'].includes(s.timer.mode))s.focus_logs.push({id:id(),task_id:s.timer.task_id,duration:s.timer.duration,finished_at:s.timer.ends_at});s.timer=blank(s.timer.revision+1);s.revision++;return true;}return false;}
  const publicState=s=>({revision:s.revision,settings:s.settings,tasks:s.tasks,files:s.files,timer:s.timer,focus_logs:s.focus_logs,server_time:Date.now(),addresses:[],local_phone:true,purged:s.purged,alarm:s.alarm});
  const nativeCalls=new Map();
  window.onQuadrantNative=(key,result)=>{const entry=nativeCalls.get(key);if(entry){nativeCalls.delete(key);clearTimeout(entry.timer);result.error?entry.reject(new Error(result.error)):entry.resolve(result);}};
  function native(method,args={}) {return new Promise((resolve,reject)=>{const key=id(),timer=setTimeout(()=>{nativeCalls.delete(key);reject(new Error('操作超时，请重新同步'));},method==='discover'?130000:120000);nativeCalls.set(key,{resolve,reject,timer});QuadrantAndroid.call(key,method,JSON.stringify(args));});}
  async function saveDownload(path) {const response=await localFetch(path);if(!response.ok)throw new Error((await response.json()).error);const bytes=new Uint8Array(await response.arrayBuffer());let name='quadrant-data.json',mime=response.headers.get('Content-Type');if(path==='/api/backup')name='quadrant-backup.zip';else if(path.startsWith('/api/files/')){const s=await read();name=s.files.find(f=>f.id===path.split('/').pop())?.name||'附件';}await native('save',{name,mime,data:to64(bytes)});}
  document.addEventListener('click',event=>{const a=event.target.closest('a[download]');if(a&&a.getAttribute('href')?.startsWith('/api/')){event.preventDefault();saveDownload(a.getAttribute('href')).catch(e=>window.alert(e.message));}});

  async function handle(path,init) {
    const s=await read(), method=init.method||'GET', headers=new Headers(init.headers||{});let body={};
    if(typeof init.body==='string')body=JSON.parse(init.body);
    if(path==='/api/meta')return {initialized:!!s.auth,name:s.settings.name,authenticated:s.logged_in};
    if(path==='/api/setup'||path==='/api/login') {
      const password=text(body.password,'密码',128,true);
      if(path.endsWith('setup')){if(s.auth)fail('已经完成初始化',409);if(password.length<8)fail('密码至少 8 位');const salt=to64(crypto.getRandomValues(new Uint8Array(16)));s.auth={salt,hash:await hashPassword(password,salt)};s.settings.name=text(body.name||'象限','名称',30,true);}
      else if(!s.auth||s.auth.hash!==await hashPassword(password,s.auth.salt))fail('访问密码不正确',401);
      s.logged_in=true;await write(s);return {ok:true};
    }
    if(!s.logged_in)fail('请先登录本机空间',401);
    if(path==='/api/state'){if(!busy&&advance(s))await write(s);return publicState(s);}
    if(method!=='GET'&&busy)fail('正在同步，请完成后再修改本机数据',409);
    if(path==='/api/logout'){s.logged_in=false;await write(s);return {ok:true};}
    if(path==='/api/password') {if(!s.auth||s.auth.hash!==await hashPassword(body.old_password,s.auth.salt))fail('旧密码不正确',403);const password=text(body.new_password,'新密码',128,true);if(password.length<8)fail('密码至少 8 位');const salt=to64(crypto.getRandomValues(new Uint8Array(16)));s.auth={salt,hash:await hashPassword(password,salt)};s.logged_in=false;await write(s);return {ok:true};}
    const files=[], removed=[];
    if(path==='/api/tasks'&&method==='POST') {const stamp=Date.now(),t={...taskValues(body),id:id(),revision:1,created_at:stamp,updated_at:stamp,completed_at:body.done?stamp:null,deleted_at:null};s.tasks.push(t);s.revision++;await write(s);return t;}
    if(path.startsWith('/api/tasks/')&&path.endsWith('/purge')&&method==='POST') {
      const taskId=path.split('/').at(-2),t=s.tasks.find(t=>t.id===taskId);
      if(!t)fail('任务不存在',404);if(t.revision!==body.revision)fail('任务已修改，请刷新后再永久删除',409);if(!t.deleted_at)fail('只能永久删除回收站中的任务',409);
      const removed=s.files.filter(f=>f.task_id===taskId).map(f=>f.id);
      s.tasks=s.tasks.filter(t=>t.id!==taskId);s.files=s.files.filter(f=>f.task_id!==taskId);
      s.purged=s.purged.filter(t=>t.id!==taskId);s.purged.push({id:taskId,deleted_at:Date.now()});s.revision++;
      await write(s,[],removed);return {ok:true};
    }
    if(path.startsWith('/api/tasks/')&&['PATCH','DELETE'].includes(method)) {const t=s.tasks.find(t=>t.id===path.split('/').pop());if(!t)fail('任务不存在',404);if(t.revision!==body.revision)fail('任务已修改，请重新打开后编辑',409);if(method==='DELETE')t.deleted_at=Date.now();else{Object.assign(t,taskValues({...t,...body}));if('deleted_at'in body){if(body.deleted_at!==null)fail('请使用删除操作');t.deleted_at=null;}}t.completed_at=t.done?(t.completed_at||Date.now()):null;t.updated_at=Date.now();t.revision++;s.revision++;await write(s);return t;}
    if(path==='/api/settings') {const settings={...s.settings};for(const k of ['name','subtitle'])settings[k]=text(body[k]??settings[k],k,k==='name'?30:100,k==='name');if(body.accent&&!['green','blue','purple','orange'].includes(body.accent))fail('主题无效');settings.accent=body.accent||settings.accent;for(const k of ['focus_minutes','break_minutes']){const v=body[k]??settings[k];if(!Number.isInteger(v)||v<1||v>180)fail('计时长度应为 1—180 分钟');settings[k]=v;}s.settings=settings;s.revision++;await write(s);return settings;}
    if(path==='/api/timer') {advance(s);const t=s.timer;if(t.revision!==body.revision)fail('计时状态已变化',409);if(body.action==='start'&&t.status==='idle'){const mode=body.mode||'focus';if(!['focus','break','custom'].includes(mode))fail('计时类型无效');if(body.task_id&&!s.tasks.some(v=>v.id===body.task_id&&!v.deleted_at))fail('关联任务无效');const duration=mode==='custom'?body.duration:s.settings[mode==='focus'?'focus_minutes':'break_minutes']*60;if(!Number.isInteger(duration)||duration<60||duration>86400||duration%60)fail('计时应为 1 分钟至 24 小时');Object.assign(t,{status:'running',mode,task_id:body.task_id||'',duration,remaining:duration,ends_at:Date.now()+duration*1000});}else if(body.action==='pause'&&t.status==='running'){t.remaining=Math.max(0,(t.ends_at-Date.now())/1000);t.status='paused';t.ends_at=0;}else if(body.action==='resume'&&t.status==='paused'){t.status='running';t.ends_at=Date.now()+t.remaining*1000;}else if(body.action==='cancel')s.timer=blank(t.revision);else fail('当前状态不能执行此操作',409);s.timer.revision++;s.revision++;await write(s);return s.timer;}
    if(path==='/api/alarm-audio') {
      const config=s.alarm[0],old=s.files.filter(f=>f.kind==='alarm');
      if(method==='GET'){if(!config.file_id)fail('尚未上传自定义提示音',404);const file=s.files.find(f=>f.id===config.file_id),data=await blob(config.file_id);if(!file||!data)fail('提示音文件缺失',404);return new Response(data,{headers:{'Content-Type':file.mime||'audio/mpeg'}});}
      const revision=method==='POST'?Number(headers.get('X-Alarm-Revision')):body.revision;
      if(revision!==config.revision)fail('提示音已被修改，请刷新后重试',409);
      if(method==='POST') {
        const bytes=new Uint8Array(await new Response(init.body).arrayBuffer()),name=text(decodeURIComponent(headers.get('X-File-Name')||'').split(/[\\/]/).pop(),'音频名称',200,true);
        if(!/\.(mp3|wav|ogg|m4a|aac|flac|opus|webm)$/i.test(name))fail('请选择 MP3、WAV、M4A、OGG 等音频文件');
        if(!bytes.length||bytes.length>20*1024*1024)fail('提示音应为 1 字节至 20 MB');
        const file={id:id(),task_id:'',kind:'alarm',name,size:bytes.length,mime:headers.get('X-Audio-Type')||'audio/mpeg',created_at:Date.now(),sha256:await digest(bytes)};
        s.files=s.files.filter(f=>f.kind!=='alarm');s.files.push(file);config.file_id=file.id;config.revision++;config.updated_at=Date.now();s.revision++;
        await write(s,[[file.id,bytes]],old.map(f=>f.id));return config;
      }
      if(method==='DELETE'){s.files=s.files.filter(f=>f.kind!=='alarm');config.file_id='';config.revision++;config.updated_at=Date.now();s.revision++;await write(s,[],old.map(f=>f.id));return {ok:true};}
      fail('不支持此操作',405);
    }
    if(path==='/api/upload') {const taskId=headers.get('X-Task-Id');if(!s.tasks.some(t=>t.id===taskId&&!t.deleted_at))fail('任务不存在',404);if(s.files.filter(f=>f.task_id===taskId).length>=12)fail('每任务最多 12 个附件');const bytes=new Uint8Array(await new Response(init.body).arrayBuffer());if(!bytes.length||bytes.length>20*1024*1024)fail('附件应为 1 字节至 20 MB');const f={id:id(),task_id:taskId,name:text(decodeURIComponent(headers.get('X-File-Name')||'附件').split(/[\\/]/).pop(),'文件名',200,true),size:bytes.length,created_at:Date.now(),sha256:await digest(bytes)};s.files.push(f);s.revision++;await write(s,[[f.id,bytes]]);return f;}
    if(path.startsWith('/api/files/')) {const fid=path.split('/').pop(),file=s.files.find(f=>f.id===fid);if(!file)fail('附件不存在',404);if(method==='GET'){const data=await blob(fid);if(!data)fail('附件文件缺失',404);return new Response(data,{headers:{'Content-Type':'application/octet-stream'}});}if(method==='DELETE'){s.files=s.files.filter(f=>f.id!==fid);s.revision++;await write(s,[],[fid]);return {ok:true};}}
    if(path==='/api/export')return {...publicState(s),format:'quadrant-backup-v1'};
    if(path==='/api/backup') {const entries=[['snapshot.json',enc.encode(JSON.stringify({...publicState(s),format:'quadrant-backup-v1'}))]];for(const f of s.files){const data=await blob(f.id);if(!data)fail('附件缺失，备份未生成');entries.push(['attachments/'+f.id,data]);}return new Response(ZipCodec.pack(entries),{headers:{'Content-Type':'application/zip'}});}
    if(path==='/api/import') {
      const bytes=await new Response(init.body).arrayBuffer();if(bytes.byteLength>64*1024*1024)fail('单次导入最大 64 MB');let snapshot, archive;
      if(new Uint8Array(bytes)[0]===0x50){archive=await ZipCodec.unpack(bytes);snapshot=JSON.parse(new TextDecoder().decode(archive.get('snapshot.json')));}else snapshot=JSON.parse(new TextDecoder().decode(bytes));
      if(snapshot.format!=='quadrant-backup-v1'||!Array.isArray(snapshot.tasks)||snapshot.tasks.length>10000)fail('备份格式无效');let imported=0;
      for(const raw of snapshot.tasks){taskValues(raw);if(typeof raw.id!=='string'||!raw.id||raw.id.length>100)fail('任务编号无效');if(!s.tasks.some(t=>t.id===raw.id)&&!s.purged.some(t=>t.id===raw.id)&&!(snapshot.purged||[]).some(t=>t.id===raw.id)){const stamp=Date.now(),t={...taskValues(raw),id:raw.id,revision:1,created_at:raw.created_at||stamp,updated_at:raw.updated_at||stamp,completed_at:raw.done?(raw.completed_at||stamp):null,deleted_at:raw.deleted_at||null};s.tasks.push(t);imported++;for(const f of (snapshot.files||[]).filter(f=>f.task_id===t.id)){const data=archive?.get('attachments/'+f.id);if(!data)continue;if(!data.length||data.length>20*1024*1024)fail('备份附件容量无效');const newId=id();s.files.push({id:newId,task_id:t.id,name:text(f.name,'文件名',200,true),size:data.length,created_at:f.created_at||stamp,sha256:await digest(data)});files.push([newId,data]);}}}
      for(const marker of snapshot.purged||[]){if(typeof marker.id!=='string'||!Number.isInteger(marker.deleted_at))fail('永久删除标记无效');if(!s.tasks.some(t=>t.id===marker.id)&&!s.purged.some(t=>t.id===marker.id))s.purged.push(marker);}
      const sourceAlarm=(snapshot.alarm||[])[0];
      if(!s.alarm[0].file_id&&sourceAlarm?.file_id){const file=(snapshot.files||[]).find(f=>f.id===sourceAlarm.file_id&&f.kind==='alarm'),data=archive?.get('attachments/'+sourceAlarm.file_id);if(file&&data){if(!data.length||data.length>20*1024*1024)fail('提示音容量无效');const newId=id();s.files.push({...file,id:newId,sha256:await digest(data)});files.push([newId,data]);s.alarm[0]={id:'0'.repeat(32),file_id:newId,revision:s.alarm[0].revision+1,updated_at:Date.now()};}}
      for(const log of snapshot.focus_logs||[]){if(typeof log.id!=='string'||!Number.isInteger(log.duration)||log.duration<1||log.duration>86400||!Number.isInteger(log.finished_at))fail('专注记录无效');if(!s.focus_logs.some(l=>l.id===log.id))s.focus_logs.push({id:log.id,task_id:log.task_id||'',duration:log.duration,finished_at:log.finished_at});}
      s.revision++;await write(s,files,removed);return {imported,skipped:snapshot.tasks.length-imported};
    }
    fail('本机接口不存在',404);
  }
  async function localFetch(path,init={}) {return serial(async()=>{try{const result=await handle(path,init);return result instanceof Response?result:new Response(JSON.stringify(result),{headers:{'Content-Type':'application/json'}});}catch(e){return new Response(JSON.stringify({error:e.message}),{status:e.status||400,headers:{'Content-Type':'application/json'}});}});}
  const networkFetch=window.fetch.bind(window);
  window.fetch=(path,init)=>typeof path==='string'&&path.startsWith('/api/')?localFetch(path,init):networkFetch(path,init);
  window.PhoneStore={read,write,blob,serial,id,digest,to64,from64,native,publicState,
    get busy(){return busy;},set busy(value){busy=value;},
    async stage(key,bytes){const db=await opened;await new Promise((resolve,reject)=>{const tx=db.transaction('staging','readwrite');tx.objectStore('staging').put(bytes,key);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});},
    async clearStaging(){const db=await opened;await new Promise((resolve,reject)=>{const tx=db.transaction('staging','readwrite');tx.objectStore('staging').clear();tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});}
  };
})();
