import test from 'node:test';
import assert from 'node:assert/strict';
import {parseVideoIds,createClient,collectVideo,selectRows,toCsv,apiError} from '../core.js';
const id='abcdefghijk';
const comment=(id,text='댓글',likes=0)=>({id,snippet:{textDisplay:text,authorDisplayName:'작성자',likeCount:likes,publishedAt:'2026-10-01T00:00:00Z'}});
const thread=(id,replies=0)=>({snippet:{topLevelComment:comment(id),totalReplyCount:replies}});
const metadata={items:[{id,snippet:{title:'테스트 영상',channelTitle:'테스트 채널'}}]};
function clientFor(responses) {
  const calls=[];
  const client=createClient('TEST_ONLY_KEY',{fetchImpl:async(url,options)=>{
    calls.push({url:new URL(url),options});
    const next=responses.shift();assert.ok(next,'No unexpected API requests');
    if(next instanceof Error)throw next;
    return {ok:!next.error,status:next.status||200,json:async()=>next};
  }});
  return {client,calls};
}
test('URLs: watch, short link, Shorts, live, mobile, duplicate and plain ID',()=>{
  for(const value of [`https://www.youtube.com/watch?v=${id}&t=3`,`https://youtu.be/${id}?si=abc`,`https://youtube.com/shorts/${id}`,`youtube.com/live/${id}`,`https://m.youtube.com/watch?v=${id}`,id])assert.deepEqual(parseVideoIds(value),[id]);
  assert.deepEqual(parseVideoIds(`${id}\nhttps://youtu.be/${id}`),[id]);
});
test('Reject malicious/lookalike URLs, playlists and more than 20 videos',()=>{
  for(const value of ['','https://youtube.com.evil.test/watch?v=abcdefghijk','https://example.com/abcdefghijk','https://www.youtube.com/playlist?list=abc','javascript:alert(1)'])assert.throws(()=>parseVideoIds(value));
  assert.throws(()=>parseVideoIds(Array.from({length:21},(_,i)=>String(i).padStart(11,'a')).join('\n')));
});
test('Paginate top-level and all replies; deduplicate; API key only in header',async()=>{
  const {client,calls}=clientFor([metadata,{items:[thread('p1',3)],nextPageToken:'top2'},{items:[thread('p2'),thread('p1',3)]},{items:[comment('r1')],nextPageToken:'reply2'},{items:[comment('r1'),comment('r2'),comment('r3')]}]);
  const result=await collectVideo(client,id);
  assert.deepEqual(result.rows.map(r=>r.id),['p1','p2','r1','r2','r3']);assert.equal(result.status,'완료');
  assert.equal(result.rows[2].parentId,'p1');assert.equal(calls[2].url.searchParams.get('pageToken'),'top2');assert.equal(calls[4].url.searchParams.get('pageToken'),'reply2');
  for(const call of calls){assert.equal(call.options.headers['X-Goog-Api-Key'],'TEST_ONLY_KEY');assert.ok(!call.url.toString().includes('TEST_ONLY_KEY'));assert.equal(call.options.credentials,'omit');}
});
test('Replies included in cap and incomplete state shown',async()=>{
  const {client}=clientFor([metadata,{items:[thread('p',3)]},{items:[comment('r1')],nextPageToken:'more'}]);
  const result=await collectVideo(client,id,{limit:2});assert.equal(result.rows.length,2);assert.equal(result.status,'개수 제한');
});
test('Replies excluded makes no reply request',async()=>{
  const {client,calls}=clientFor([metadata,{items:[thread('p',100)]}]);
  const result=await collectVideo(client,id,{includeReplies:false});assert.equal(calls.length,2);assert.equal(result.status,'완료');
});
test('Top-level cap and exact completion distinguished',async()=>{
  let c=clientFor([metadata,{items:[thread('p')],nextPageToken:'more'}]);assert.equal((await collectVideo(c.client,id,{limit:1})).status,'개수 제한');
  c=clientFor([metadata,{items:[thread('p')]}]);assert.equal((await collectVideo(c.client,id,{limit:1})).status,'완료');
});
test('Retain partial rows when later API page fails',async()=>{
  const {client}=clientFor([metadata,{items:[thread('p')],nextPageToken:'more'},{status:403,error:{errors:[{reason:'quotaExceeded'}]}}]);
  const result=await collectVideo(client,id);assert.equal(result.rows.length,1);assert.equal(result.status,'일부 수집');assert.equal(result.fatal,true);assert.match(result.error,/한도/);
});
test('Stop during pagination preserves rows and cancels later requests',async()=>{
  const {client,calls}=clientFor([metadata,{items:[thread('p')],nextPageToken:'more'}]);const controller=new AbortController();
  const result=await collectVideo(client,id,{signal:controller.signal,onUpdate:v=>{if(v.rows.length)controller.abort();}});
  assert.equal(result.status,'중지됨');assert.equal(result.rows.length,1);assert.equal(calls.length,2);
});
test('Disabled comments, missing video, empty result states',async()=>{
  let c=clientFor([metadata,{status:403,error:{errors:[{reason:'commentsDisabled'}]}}]);let r=await collectVideo(c.client,id);assert.equal(r.status,'수집 실패');assert.equal(r.fatal,false);assert.match(r.error,/사용 중지/);
  c=clientFor([{items:[]}]);assert.equal((await collectVideo(c.client,id)).status,'수집 실패');
  c=clientFor([metadata,{items:[]}]);assert.equal((await collectVideo(c.client,id)).status,'댓글 없음');
});
test('Network failure and repeated page tokens cannot create infinite requests',async()=>{
  let c=clientFor([new TypeError('secret must not escape')]);let r=await collectVideo(c.client,id);assert.equal(r.fatal,true);assert.ok(!r.error.includes('secret'));
  c=clientFor([metadata,{items:[thread('p')],nextPageToken:'same'},{items:[thread('p')],nextPageToken:'same'}]);r=await collectVideo(c.client,id);assert.equal(r.status,'일부 수집');assert.equal(c.calls.length,3);
});
test('Request budget is enforced before network access',async()=>{
  const client=createClient('TEST_ONLY_KEY',{maxRequests:0,fetchImpl:()=>assert.fail('Must not fetch')});await assert.rejects(()=>client.request('videos',{}),/한도/);
});
test('Error messages do not echo Google raw message or keys',()=>{
  const error=apiError({error:{message:'SECRET',details:[{reason:'API_KEY_INVALID'}]}},400);assert.ok(!error.message.includes('SECRET'));assert.equal(error.fatal,true);
});
test('Search and sorting do not mutate original array; reply filtering',()=>{
  const rows=[{text:'한글 질문',author:'A',videoTitle:'영상',likes:1,publishedAt:'2026-01-01',parentId:''},{text:'답변',author:'B',videoTitle:'영상',likes:9,publishedAt:'2026-01-02',parentId:'a'}];
  assert.equal(selectRows(rows)[0].author,'B');assert.equal(rows[0].author,'A');assert.equal(selectRows(rows,{query:'질문'}).length,1);assert.equal(selectRows(rows,{type:'replies'}).length,1);assert.equal(selectRows(rows,{sort:'oldest'})[0].author,'A');
});
test('CSV includes BOM, quotes/newlines and defuses spreadsheet formulas',()=>{
  const csv=toCsv([{videoTitle:'한글 "영상"',videoId:id,id:'1',author:'=HYPERLINK("https://invalid")',text:'  +SUM(1,2)\n둘째 줄',likes:0,publishedAt:'',updatedAt:'',parentId:'',url:'https://youtube.com'}]);
  assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('"한글 ""영상"""'));assert.ok(csv.includes('"\'=HYPERLINK'));assert.ok(csv.includes('"\'  +SUM(1,2)\n둘째 줄"'));assert.ok(!csv.includes('TEST_ONLY_KEY'));
});
