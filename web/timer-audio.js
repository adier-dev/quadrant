'use strict';
window.TimerAudio = (() => {
  let current=null, context=null, buffer=null, source=null, loaded='', loading=null, nativeLoaded=null;
  let played='', playing=false, loadVersion=0;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const selection=()=>current?.alarm?.[0]?.file_id||'';
  function updateUI(){document.querySelector('#stop-alarm')?.classList.toggle('hidden',!playing);}
  async function load() {
    const selected=selection();
    if(loaded===selected&&(!window.PhoneStore||nativeLoaded===selected))return;
    if(loading)return loading;
    const version=++loadVersion;
    loading=(async()=>{
      let bytes=null;
      if(selected){const response=await fetch('/api/alarm-audio');if(!response.ok)throw new Error('提示音读取失败，请重新上传或同步');bytes=await response.arrayBuffer();}
      if(version!==loadVersion||selected!==selection())return;
      if(window.PhoneStore){await PhoneStore.native('set-alarm-audio',{data:bytes?PhoneStore.to64(new Uint8Array(bytes)):''});nativeLoaded=selected;}
      else if(context&&bytes)buffer=await context.decodeAudioData(bytes.slice(0));
      else buffer=null;
      loaded=selected;
    })().finally(()=>{loading=null;});
    return loading;
  }
  async function prepare() {
    if(!window.PhoneStore){
      if(!context){const AudioEngine=window.AudioContext||window.webkitAudioContext;if(AudioEngine)context=new AudioEngine();}
      if(context&&context.state!=='running')await context.resume();
      // A newly created context still needs to decode a previously selected file.
      if(selection()&&!buffer)loaded='';
    }
    await load();
  }
  async function stop(){if(source){try{source.stop();}catch{}source=null;}if(window.PhoneStore)await PhoneStore.native('stop-alarm-audio');playing=false;updateUI();}
  async function play(preview=false,deadline=0) {
    await prepare();
    if(window.PhoneStore){const result=await PhoneStore.native(preview?'play-alarm-audio':'fire-alarm',{deadline});playing=!!result.playing;updateUI();return;}
    if(!context||context.state!=='running')throw new Error('浏览器阻止了提示音，请在设置中点一次“试听”后再计时');
    if(source){try{source.stop();}catch{}}
    if(buffer){source=context.createBufferSource();source.buffer=buffer;source.connect(context.destination);source.onended=()=>{playing=false;updateUI();};source.start();}
    else {const oscillator=context.createOscillator(),gain=context.createGain();oscillator.frequency.value=740;gain.gain.value=.16;oscillator.connect(gain);gain.connect(context.destination);oscillator.start();oscillator.stop(context.currentTime+1);oscillator.onended=()=>{playing=false;updateUI();};source=oscillator;}
    playing=true;updateUI();
  }
  function trigger(deadline) {
    if(!deadline||played===String(deadline))return;
    played=String(deadline);
    play(false,deadline).catch(error=>{if(typeof toast==='function')toast(error.message);});
  }
  function tick(){const t=current?.timer;if(t?.status==='running'&&t.ends_at<=Date.now()+(typeof offset==='number'?offset:0))trigger(t.ends_at);}
  function stateChanged(previous,next) {
    const oldSelection=selection();current=next;
    if(oldSelection!==selection()){loaded='';buffer=null;nativeLoaded=null;loadVersion++;}
    if(window.PhoneStore&&nativeLoaded!==selection())load().catch(error=>toast(error.message));
    const oldTimer=previous?.timer;
    if(oldTimer?.status==='running'&&next.timer.status==='idle'&&oldTimer.ends_at<=Date.now()+(typeof offset==='number'?offset:0))trigger(oldTimer.ends_at);
    if(!previous&&window.PhoneStore&&next.timer.status==='running')scheduleNative(next.timer,false).catch(error=>toast(error.message));
  }
  async function scheduleNative(timer,requestPermission=false){
    if(!window.PhoneStore)return;
    await load();
    const result=await PhoneStore.native('schedule-alarm',{status:timer.status,deadline:timer.ends_at,request_permission:requestPermission});
    if(result.exact===false&&requestPermission)toast('请允许“闹钟和提醒”，锁屏时才能准时播放；当前仍会继续计时');
  }
  function settings(state) {
    const config=state.alarm?.[0],file=state.files.find(f=>f.id===config?.file_id);
    return `<section class="panel alarm-panel"><h2>到时提示音</h2><p class="settings-help">${file?`当前：${esc(file.name)}`:'当前：默认提示音'}。提示音可同步到另一端。</p><div class="alarm-actions"><label class="btn"><span>上传音频</span><input id="alarm-audio-file" type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg,.aac,.flac,.opus,.webm" class="hidden"></label><button class="btn" data-audio="preview">试听</button><button class="btn small" data-audio="stop">停止</button>${file?'<button class="danger-link" data-audio="clear">恢复默认</button>':''}</div><p class="settings-help">音频最大 20 MB。电脑需保持页面打开；手机请允许闹钟权限。</p></section>`;
  }
  document.addEventListener('change',async event=>{
    if(event.target.id!=='alarm-audio-file')return;const file=event.target.files[0];if(!file)return;
    try{if(file.size>20*1024*1024)throw new Error('提示音不能超过 20 MB');await api('/api/alarm-audio',{method:'POST',body:file,headers:{'X-File-Name':encodeURIComponent(file.name),'X-Audio-Type':file.type||'audio/mpeg','X-Alarm-Revision':String(current.alarm[0].revision)}});await refresh(true);await prepare();toast('提示音已保存，手动同步后另一端也可使用');}catch(error){toast(error.message);}finally{event.target.value='';}
  });
  document.addEventListener('click',async event=>{const button=event.target.closest('[data-audio]');if(!button)return;try{if(button.dataset.audio==='preview')await play(true);if(button.dataset.audio==='stop')await stop();if(button.dataset.audio==='clear'){await api('/api/alarm-audio',{method:'DELETE',body:{revision:current.alarm[0].revision}});await stop();await refresh(true);await load();toast('已恢复默认提示音');}}catch(error){toast(error.message);}});
  return {prepare:()=>prepare().catch(error=>{toast(error.message);}),scheduleNative,stateChanged,tick,stop,settings,updateUI};
})();
