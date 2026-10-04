import { parseVideoIds, createClient, collectVideo, selectRows, toCsv } from './core.js';
const $ = id => document.getElementById(id);
const number = new Intl.NumberFormat('ko-KR');
const dates = new Intl.DateTimeFormat('ko-KR',{year:'numeric',month:'2-digit',day:'2-digit'});
const pageSize = 30;
let videos = new Map();
let rows = [];
let filtered = [];
let page = 1;
let running = false;
let sample = false;
let controller;
let renderTimer;
let searchTimer;

function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
function link(text, url) {
  const a = element('a','',text); a.href=url; a.target='_blank'; a.rel='noopener noreferrer'; return a;
}
function setStatus(text, mode='') { $('run-status').textContent=text; $('run-status').className=`run-status ${mode}`; }
function fail(message) { $('form-error').textContent=message; $('form-error').hidden=false; }
function setBusy(value) {
  running=value; $('settings').disabled=value; $('stop').hidden=!value;
  $('start').textContent=value?'댓글을 모으고 있어요…':'댓글 수집하기';
  $('results-title').setAttribute('aria-busy',String(value));
}
function renderStatuses() {
  const fragment=document.createDocumentFragment();
  for (const video of videos.values()) {
    const row=element('div','video-state'); const head=element('div');
    head.append(sample?element('span','',video.title):link(video.title,`https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`));
    head.append(element('span','badge',`${video.status} · ${number.format(video.rows.length)}개`)); row.append(head);
    if(video.error) row.append(element('p','',video.error));
    fragment.append(row);
  }
  $('video-statuses').replaceChildren(fragment);
}
function render() {
  rows=Array.from(videos.values()).flatMap(v=>v.rows);
  filtered=selectRows(rows,{query:$('search').value,sort:$('sort').value,type:$('type-filter').value});
  const pages=Math.max(1,Math.ceil(filtered.length/pageSize)); page=Math.min(page,pages);
  $('total').textContent=number.format(rows.length);
  $('visible-count').textContent=filtered.length?`${number.format(filtered.length)}개 결과 · ${number.format((page-1)*pageSize+1)}–${number.format(Math.min(page*pageSize,filtered.length))} 표시`:rows.length?'검색 조건에 맞는 댓글이 없어요':'표시할 댓글이 없어요';
  $('download').disabled=!filtered.length;
  $('empty').hidden=Boolean(filtered.length);
  $('empty').querySelector('h3').textContent=rows.length?'찾는 댓글이 없어요':running?'댓글을 가져오는 중이에요':'어떤 이야기가 오갔을까요?';
  $('empty').querySelector('p').textContent=rows.length?'다른 검색어를 입력하거나 댓글 유형을 바꿔보세요.':running?'댓글과 답글 수에 따라 시간이 걸릴 수 있어요.':'댓글을 수집하면 여기에 모아드려요. 좋아요가 많은 반응부터 차근차근 살펴보세요.';
  const fragment=document.createDocumentFragment();
  for (const row of filtered.slice((page-1)*pageSize,page*pageSize)) {
    const card=element('article','comment');
    const head=element('div','comment-head');
    const avatar=element('span','avatar',Array.from(row.author.replace(/^@/,''))[0] || '·'); avatar.setAttribute('aria-hidden','true');
    head.append(avatar,element('span','author',row.author));
    if(row.parentId) head.append(element('span','badge','답글'));
    const date=new Date(row.publishedAt);
    if(!Number.isNaN(date.getTime())) { const time=element('time','',dates.format(date)); time.dateTime=row.publishedAt; head.append(time); }
    const text=element('p','comment-body',row.text);
    const foot=element('div','comment-foot'); const meta=element('span');
    meta.append(element('span','likes',`좋아요 ${number.format(row.likes)}`),document.createTextNode(row.videoTitle));
    foot.append(meta,sample?element('span','','예시 데이터'):link('원문 보기',row.url));
    card.append(head,text,foot);fragment.append(card);
  }
  $('comment-list').replaceChildren(fragment);
  $('pagination').hidden=pages<=1;
  $('page-label').textContent=`${page} / ${pages}`;
  $('previous').disabled=page<=1; $('next').disabled=page>=pages;
  renderStatuses();
}
function queueRender() { if(!renderTimer) renderTimer=setTimeout(()=>{renderTimer=null;render();},180); }
function flushRender() { clearTimeout(renderTimer);renderTimer=null;render(); }
function resetFilters() { $('search').value='';$('type-filter').value='all';page=1; }

$('collect-form').addEventListener('submit',async event=>{
  event.preventDefault(); if(running)return;
  $('form-error').hidden=true;
  let ids;
  try { ids=parseVideoIds($('video-urls').value); } catch(error) { fail(error.message);$('video-urls').focus();return; }
  const key=$('api-key').value.trim();
  if(!key || /\s/.test(key)) { fail('공백 없이 API 키를 입력해 주세요.');$('api-key').focus();return; }
  const limit=Number($('limit').value), includeReplies=$('include-replies').checked, order=$('fetch-order').value;
  const client=createClient(key); controller=new AbortController();
  sample=false;videos=new Map();resetFilters();setBusy(true);render();
  let finished=0, fatal=false;
  try {
    for(const id of ids) {
      if(controller.signal.aborted)break;
      setStatus(`${finished+1}/${ids.length}번째 영상 수집 중 · API 요청 ${client.requests}회`,'busy');
      const video=await collectVideo(client,id,{limit,includeReplies,order,signal:controller.signal,onUpdate(video){
        videos.set(id,video);queueRender();
        setStatus(`${finished+1}/${ids.length}번째 영상 · ${number.format(Array.from(videos.values()).reduce((n,v)=>n+v.rows.length,0))}개 수집 · API 요청 ${client.requests}회`,'busy');
      }});
      if(controller.signal.aborted)break;
      finished++;
      if(video.fatal){fatal=true;break;}
    }
    const total=Array.from(videos.values()).reduce((n,v)=>n+v.rows.length,0);
    const incomplete=Array.from(videos.values()).some(v=>v.limited||v.error);
    const prefix=controller.signal.aborted?'수집을 중지했어요':fatal?'오류로 수집을 멈췄어요':incomplete?'수집 종료 · 일부 결과':'수집 완료';
    const remaining=ids.length-finished;
    setStatus(`${prefix}. ${number.format(total)}개 · 완료 처리 ${finished}/${ids.length}개 영상 · API 요청 ${client.requests}회.${remaining>0?' 미완료 영상은 다시 수집해 주세요.':''}`);
  } catch { setStatus('수집을 마치지 못했어요. 현재까지 모은 결과는 다운로드할 수 있습니다.'); }
  finally { setBusy(false);flushRender(); }
});
$('stop').addEventListener('click',()=>{controller?.abort();$('stop').disabled=true;setStatus('수집을 중지하고 있어요…');setTimeout(()=>{$('stop').disabled=false;},500);});
$('toggle-key').addEventListener('click',()=>{const show=$('api-key').type==='password';$('api-key').type=show?'text':'password';$('toggle-key').textContent=show?'숨기기':'보기';$('toggle-key').setAttribute('aria-pressed',String(show));$('toggle-key').setAttribute('aria-label',show?'API 키 숨기기':'API 키 표시');});
for(const id of ['type-filter','sort']) $(id).addEventListener('change',()=>{page=1;render();});
$('search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{page=1;render();},150);});
$('previous').addEventListener('click',()=>{page--;render();$('results-title').scrollIntoView({block:'start'});});
$('next').addEventListener('click',()=>{page++;render();$('results-title').scrollIntoView({block:'start'});});
$('download').addEventListener('click',()=>{
  // Read filters again so an export immediately after typing uses the latest query.
  render(); if(!filtered.length)return;
  const blob=new Blob([toCsv(filtered)],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;
  a.download=`${sample?'예시_':''}유튜브댓글_${new Date().toISOString().slice(0,10)}_${filtered.length}개.csv`;
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
});
$('sample').addEventListener('click',()=>{
  if(running)return;
  sample=true;resetFilters();$('form-error').hidden=true;
  const examples=[['예시 시청자 A','설명이 차근차근 이어져서 이해하기 쉬웠어요. 다음 편도 기대됩니다!',128,''],['예시 시청자 B','03:24 이 부분을 조금 더 자세히 다뤄주실 수 있나요?',86,''],['예시 시청자 C','실제 사례까지 보여주셔서 도움이 됐습니다. 저장해 두고 다시 볼게요.',54,''],['예시 제작자','좋은 질문 감사합니다. 다음 영상에서 사례를 더 소개할게요.',21,'sample-1'],['예시 시청자 D','핵심 내용을 한 번에 정리해 주셔서 감사합니다.',17,''],['예시 시청자 E','저도 같은 부분이 궁금했어요!',8,'sample-1']];
  const demo={id:'sample',title:'[예시] 시청자 반응을 읽는 방법',channel:'예시 채널',status:'예시',error:'',rows:examples.map(([author,text,likes,parentId],i)=>({id:`sample-${i}`,videoId:'sample',videoTitle:'[예시] 시청자 반응을 읽는 방법',author,text,likes,parentId,publishedAt:`2026-10-0${5-i%4}T03:00:00Z`,updatedAt:'',url:''}))};
  videos=new Map([['sample',demo]]);setStatus('예시 모드 · 실제 YouTube 댓글이 아닌 화면 체험용 데이터입니다. API 요청은 발생하지 않습니다.','sample');render();
});
render();

if(document.modelContext?.registerTool) {
  try { Promise.resolve(document.modelContext.registerTool({name:'get_collection_summary',title:'댓글 수집 현황 확인',description:'Read collection counts and video status. Does not reveal API keys or start any requests.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute(args){if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).length)throw new Error('Expected an empty object');return {running,sample,total:rows.length,filtered:filtered.length,videos:Array.from(videos.values()).map(v=>({id:v.id,title:v.title,status:v.status,count:v.rows.length,error:v.error}))};}})).catch(()=>{}); } catch { /* Optional enhancement. */ }
}
