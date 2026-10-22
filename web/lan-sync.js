'use strict';
window.LanSyncUI = (() => {
  let dialog, timer, cancelled=false, running=false, found=null, epoch=0;
  const phone=!!window.PhoneStore;
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function show(content) {
    if(!dialog){dialog=document.createElement('dialog');dialog.id='lan-sync-dialog';dialog.setAttribute('aria-labelledby','lan-sync-title');document.body.append(dialog);dialog.addEventListener('cancel',e=>{if(running){e.preventDefault();stop();}});dialog.addEventListener('close',()=>{clearInterval(timer);if(!phone)epoch++;});}
    dialog.innerHTML=`<div class="dialog-head"><h2 id="lan-sync-title">与${phone?'电脑':'手机'}同步</h2><button class="icon-btn" data-sync="close" aria-label="关闭同步面板">×</button></div><div class="dialog-content sync-content">${content}</div>`;
    if(!dialog.open)dialog.showModal();
  }
  function message(text,detail='',action='') {
    show(`<div class="sync-symbol" aria-hidden="true">⇄</div><h3>${escape(text)}</h3><p class="subtitle">${escape(detail)}</p>${action}<p class="settings-help">仅在两台设备保存，无云端。</p>`);
  }
  async function desktopStatus(turn=epoch) {
    try {
      const status=await api('/api/lan-sync/status');
      if(turn!==epoch)return;
      const active=['waiting','syncing','conflict'].includes(status.phase);running=active;
      message(status.message,active?`剩余等待时间 ${status.remaining} 秒；保持两端软件打开。`:'连接失败时不会上传到其他服务。请连接同一 Wi-Fi 后重试。',
        active?`${status.phase==='waiting'?`<div class="sync-pair"><span>首次连接，在手机输入配对码</span><strong>${escape(status.code)}</strong></div>`:''}${!status.discovery_available?'<p class="error">局域网发现服务未启动，请使用新版服务器，检查 UDP 8767 端口。</p>':''}<button class="btn" data-sync="cancel">停止同步</button>`:'<button class="btn primary" data-sync="start">再次同步</button>');
      if(!active){clearInterval(timer);if(status.phase==='done'){toast(status.message);await refresh(true);}}
    }catch(e){if(turn!==epoch)return;clearInterval(timer);running=false;message('无法开启同步',e.message);}
  }
  async function startDesktop(){const turn=++epoch;clearInterval(timer);await api('/api/lan-sync/start',{method:'POST',body:{}});if(turn!==epoch)return;await desktopStatus(turn);if(turn===epoch&&running)timer=setInterval(()=>desktopStatus(turn),1000);}
  async function signed(action,body={}) {
    if(cancelled)throw new Error('已停止同步');
    const s=await PhoneStore.read(), path='/api/lan-sync/peer/'+action, payload=JSON.stringify({...body,nonce:found.nonce});
    const key=await crypto.subtle.importKey('raw',Uint8Array.from(s.peer.secret.match(/../g),b=>parseInt(b,16)),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const signature=PhoneStore.to64(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(path+'\n'+payload))));
    const hex=Array.from(PhoneStore.from64(signature),b=>b.toString(16).padStart(2,'0')).join('');
    if(cancelled)throw new Error('已停止同步');
    return PhoneStore.native('request',{path,body:payload,device:s.device_id,signature:hex});
  }
  async function findDesktop() {
    if(running||PhoneStore.busy)return;const turn=++epoch;cancelled=false;running=true;
    message('正在寻找电脑…','请在同一 Wi-Fi 下点击电脑端同步。','<button class="btn" data-sync="cancel">停止寻找</button>');
    try {
      const s=await PhoneStore.read();found=await PhoneStore.native('discover',{desktop_id:s.peer?.desktop_id||''});
      if(cancelled||turn!==epoch)return;
      if(found.sync_schema!==3)throw new Error('请先更新电脑端，再同步。');
      if(!s.peer){running=false;show('<h3>首次连接这台电脑</h3><p class="subtitle">输入电脑上的 8 位配对码。</p><form id="sync-pair-form" class="stack"><label class="field"><span>配对码</span><input name="code" inputmode="numeric" pattern="[0-9]{8}" maxlength="8" autocomplete="off" required></label><button class="btn primary" type="submit">配对并同步</button></form><p class="settings-help">配对信息只保存在这两台设备。</p>');return;}
      await exchange();
    }catch(e){if(turn!==epoch)return;running=false;PhoneStore.busy=false;message(cancelled?'已停止同步':'未能同步',e.message,'<button class="btn primary" data-sync="start">重新同步</button>');}
  }
  async function pair(code) {
    running=true;PhoneStore.busy=true;const turn=epoch;
    message('正在配对…','请保持电脑同步面板打开。');
    try {
      const s=await PhoneStore.read(),response=await PhoneStore.native('request',{path:'/api/lan-sync/peer/pair',body:JSON.stringify({device_id:s.device_id,code,nonce:found.nonce})});
      await PhoneStore.serial(async()=>{const current=await PhoneStore.read();current.peer={secret:response.secret,desktop_id:response.desktop_id};await PhoneStore.write(current);});
      if(cancelled||turn!==epoch){PhoneStore.busy=false;return;}
      await exchange();
    }catch(e){running=false;PhoneStore.busy=false;if(turn===epoch)message('配对或同步未完成',e.message,'<button class="btn primary" data-sync="start">重新同步</button>');}
  }
  function chooseConflicts(conflicts) {
    return new Promise(resolve=>{
      const version=(label,t)=>`<div class="sync-version"><strong>${label}${t.deleted_at?' · 已删除':t.done?' · 已完成':''}</strong><p>${escape(t.title)}</p><small>${escape(t.notes||'无备注')}</small><small>${escape(t.due||'无日期')}</small></div>`;
      show(`<h3>${conflicts.length} 项内容在两端都有修改</h3><p class="subtitle">任务可保留两份；提示音请选择一个版本，确认后继续同步。</p><form id="sync-conflict-form">${conflicts.map(c=>`<fieldset class="sync-conflict"><legend>${c.kind==='alarm'?'到时提示音':escape(c.desktop.title)}</legend>${version('电脑',c.desktop)}${version('手机',c.phone)}<div class="sync-choices">${(c.kind==='alarm'?[['desktop','用电脑提示音'],['phone','用手机提示音']]:[['both','保留两份'],['desktop','用电脑版本'],['phone','用手机版本']]).map(([value,label])=>`<label><input type="radio" name="${escape(c.id)}" value="${value}" ${value===(c.kind==='alarm'?'phone':'both')?'checked':''}>${label}</label>`).join('')}</div></fieldset>`).join('')}<button class="btn primary" type="submit">按以上选择继续同步</button></form>`);
      const form=dialog.querySelector('form');form.onsubmit=e=>{e.preventDefault();resolve(Object.fromEntries(new FormData(form)));};
      dialog.addEventListener('close',()=>resolve(null),{once:true});
      dialog.addEventListener('sync-stop',()=>resolve(null),{once:true});
    });
  }
  async function exchange() {
    PhoneStore.busy=true;
    try {
      const local=await PhoneStore.serial(()=>PhoneStore.read()), baseRevision=local.revision;
      const snapshot={tasks:local.tasks,files:[],focus_logs:local.focus_logs,purged:local.purged,alarm:local.alarm};
      for(const file of local.files){const bytes=await PhoneStore.blob(file.id);if(!bytes)throw new Error('手机附件缺失，请恢复附件后再同步');snapshot.files.push({...file,sha256:await PhoneStore.digest(bytes)});}
      message('正在核对两端更新…','同步期间请保持软件打开。','<button class="btn" data-sync="cancel">停止同步</button>');
      let prepared=await signed('prepare',{snapshot,sync_schema:3});
      if(prepared.conflicts.length){const choices=await chooseConflicts(prepared.conflicts);if(!choices||cancelled)throw new Error('已取消冲突处理，内容没有被覆盖');prepared=await signed('prepare',{snapshot,sync_schema:3,choices,conflict_revision:prepared.conflict_revision});}
      const {plan_id}=prepared;
      for(const fid of prepared.upload){message('正在发送附件…','请勿关闭软件或切换网络。','<button class="btn" data-sync="cancel">停止同步</button>');const bytes=await PhoneStore.blob(fid);if(!bytes)throw new Error('手机附件缺失');await signed('upload',{plan_id,id:fid,data:PhoneStore.to64(bytes)});}
      for(const file of prepared.snapshot.files){const existing=local.files.find(f=>f.id===file.id);if(existing&&await PhoneStore.digest(await PhoneStore.blob(file.id))===file.sha256)continue;message('正在接收附件…','附件会校验完整性后保存。','<button class="btn" data-sync="cancel">停止同步</button>');const received=await signed('download',{plan_id,id:file.id}),bytes=PhoneStore.from64(received.data);if(bytes.length!==file.size||await PhoneStore.digest(bytes)!==file.sha256)throw new Error('接收的附件校验失败，未覆盖本机数据');await PhoneStore.stage(plan_id+':'+file.id,bytes);}
      if(cancelled)throw new Error('已停止同步');
      const latest=await PhoneStore.read();if(latest.revision!==baseRevision)throw new Error('手机数据已变化，请重新同步');
      message('正在保存同步结果…','请保持两端软件打开，等待保存完成。');
      const committed=await signed('commit',{plan_id});
      await PhoneStore.serial(async()=>{const current=await PhoneStore.read();if(current.revision!==baseRevision)throw new Error('手机数据已变化，请重新同步以接收电脑已保存的更新');const files=[];for(const f of committed.snapshot.files){const staged=await PhoneStore.blob(plan_id+':'+f.id,true);if(staged)files.push([f.id,staged]);}const live=new Set(committed.snapshot.files.map(f=>f.id)),removed=current.files.filter(f=>!live.has(f.id)).map(f=>f.id);Object.assign(current,committed.snapshot);current.revision++;current.last_sync=Date.now();await PhoneStore.write(current,files,removed);});
      await signed('ack',{plan_id});running=false;
      message('同步完成','任务、附件与专注记录已在手机和电脑分别保存。','<button class="btn primary" data-sync="close">完成</button>');
      toast('两端数据已同步');await refresh(true);
    } finally {PhoneStore.busy=false;running=false;await PhoneStore.clearStaging();}
  }
  async function stop(){cancelled=true;running=false;epoch++;if(phone){await PhoneStore.native('cancel').catch(()=>{});dialog?.dispatchEvent(new Event('sync-stop'));}else{await api('/api/lan-sync/cancel',{method:'POST',body:{}});clearInterval(timer);}message('已停止本轮同步','已保存的数据会保留。下次在两端按下按钮可以重新核对更新。','<button class="btn primary" data-sync="start">重新同步</button>');}
  async function open(){if(phone){if(running){dialog?.showModal();return;}await findDesktop();}else{const before=epoch;let s;try{s=await api('/api/lan-sync/status');}catch(e){if(e.status===404)throw new Error('请先关闭旧版服务器窗口，再重新双击 Start-Quadrant.cmd 启动新版同步功能。');throw e;}if(before!==epoch)return;if(['waiting','syncing','conflict'].includes(s.phase)){const turn=++epoch;await desktopStatus(turn);clearInterval(timer);if(turn===epoch&&running)timer=setInterval(()=>desktopStatus(turn),1000);}else await startDesktop();}}
  document.addEventListener('click',async e=>{
    const main=e.target.closest('[data-action="lan-sync"]'), button=e.target.closest('[data-sync]');
    try{if(main){await open();return;}if(!button)return;const action=button.dataset.sync;if(action==='start')await(phone?findDesktop():startDesktop());if(action==='cancel')await stop();if(action==='close'){if(running)await stop();dialog.close();}if(action==='unpair'&&phone){if(running||PhoneStore.busy)throw new Error('请先停止同步');await PhoneStore.serial(async()=>{const s=await PhoneStore.read();s.peer=null;s.device_id=PhoneStore.id();await PhoneStore.write(s);});toast('已解除设备配对，本机任务仍保留');}}
    catch(error){toast(error.message);}
  });
  document.addEventListener('submit',e=>{if(e.target.id==='sync-pair-form'){e.preventDefault();pair(new FormData(e.target).get('code'));}});
  return {open,phone,settings:()=>`<section class="panel sync-panel"><div class="row between section-title"><h2 style="margin:0">与${phone?'电脑':'手机'}同步</h2><span class="badge">仅限局域网</span></div><p class="settings-help">连接同一 Wi-Fi，2 分钟内分别点击两端的同步。</p><button class="btn primary" data-action="lan-sync">⇄ 开始同步</button>${phone?'<button class="btn small" data-sync="unpair">解除设备配对</button>':''}<p class="settings-help">任务冲突时在手机选择版本。外观与进行中的计时各端独立。</p></section>`};
})();
