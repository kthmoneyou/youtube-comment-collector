export function parseVideoIds(value) {
  const entries = value.trim().split(/[\s,]+/u).filter(Boolean);
  if (!entries.length) throw new Error('YouTube 영상 주소를 입력해 주세요.');
  const ids = [];
  for (const entry of entries) {
    let id = entry;
    if (!/^[\w-]{11}$/.test(id)) {
      let url;
      try { url = new URL(/^https?:\/\//i.test(entry) ? entry : `https://${entry}`); } catch { throw new Error('영상 주소 형식을 확인해 주세요.'); }
      const host = url.hostname.toLowerCase();
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('YouTube 영상 주소만 사용할 수 있어요.');
      if (host === 'youtu.be') id = url.pathname.split('/')[1];
      else if (['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','www.youtube-nocookie.com','youtube-nocookie.com'].includes(host)) {
        id = url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:shorts|live|embed)\/([\w-]{11})(?:\/|$)/.exec(url.pathname)?.[1];
      } else throw new Error('YouTube 영상 주소만 사용할 수 있어요.');
    }
    if (!id || !/^[\w-]{11}$/.test(id)) throw new Error('영상 주소를 확인해 주세요. 채널·재생목록 주소는 지원하지 않아요.');
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length > 20) throw new Error('한 번에 영상 20개까지 수집할 수 있어요.');
  return ids;
}

export class ApiError extends Error {
  constructor(message, { fatal = false, reason = '' } = {}) { super(message); this.name = 'ApiError'; this.fatal = fatal; this.reason = reason; }
}

export function apiError(data, status) {
  const reasons = [...(data?.error?.errors || []).map(x => x.reason), ...(data?.error?.details || []).map(x => x.reason)];
  if (reasons.includes('commentsDisabled')) return new ApiError('댓글이 사용 중지된 영상입니다.');
  if (reasons.some(x => ['videoNotFound','notFound'].includes(x)) || status === 404) return new ApiError('영상을 찾을 수 없거나 공개적으로 접근할 수 없습니다.');
  if (reasons.some(x => /quota|dailyLimit/i.test(x))) return new ApiError('API 사용량 한도를 초과했어요. Google Cloud의 할당량을 확인해 주세요.', { fatal:true });
  if (reasons.some(x => /accessNotConfigured|SERVICE_DISABLED/i.test(x))) return new ApiError('이 키의 프로젝트에서 YouTube Data API v3를 사용 설정해 주세요.', { fatal:true });
  if (reasons.some(x => /referer|REFERRER|IP_ADDRESS|API_KEY_SERVICE_BLOCKED/i.test(x))) return new ApiError('API 키의 웹사이트·API 제한을 확인해 주세요. 아래 키 설정 도움말을 참고하세요.', { fatal:true });
  if (status === 400 || status === 401 || reasons.some(x => /keyInvalid|API_KEY_INVALID/i.test(x))) return new ApiError('API 키 또는 요청이 유효하지 않아요. 키 설정을 확인하고 다시 시도해 주세요.', { fatal:true });
  if (status === 403) return new ApiError('접근 권한이 없어요. API 사용 설정과 키 제한을 확인해 주세요.', { fatal:true });
  return new ApiError('YouTube 응답에 문제가 있어요. 잠시 후 다시 시도해 주세요.', { fatal:status === 429 || status >= 500 });
}

export function createClient(key, { fetchImpl = globalThis.fetch, maxRequests = 500 } = {}) {
  let requests = 0;
  return {
    get requests() { return requests; },
    async request(endpoint, params, signal) {
      signal?.throwIfAborted();
      if (requests >= maxRequests) throw new ApiError('이번 수집의 API 요청 500회 한도에 도달했어요. 현재 결과는 다운로드할 수 있습니다.', { fatal:true });
      const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
      Object.entries(params).forEach(([k,v]) => { if (v !== undefined && v !== '') url.searchParams.set(k,v); });
      requests++;
      const timeout = AbortSignal.timeout(30000);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      let response;
      try { response = await fetchImpl(url.toString(), { headers:{'X-Goog-Api-Key':key}, signal:combined, credentials:'omit', cache:'no-store' }); }
      catch (error) {
        if (signal?.aborted) throw error;
        throw new ApiError(timeout.aborted ? 'YouTube 응답 시간이 초과됐어요. 현재 결과는 유지됩니다.' : '연결할 수 없어요. 인터넷 연결과 브라우저의 요청 차단 설정을 확인해 주세요.', {fatal:true});
      }
      let data;
      try { data = await response.json(); } catch { throw new ApiError('YouTube 응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요.', {fatal:true}); }
      if (!response.ok) throw apiError(data,response.status);
      return data;
    }
  };
}

export function normalizeComment(item, video, parentId = '') {
  const s = item.snippet || {};
  return { id:item.id, videoId:video.id, videoTitle:video.title, author:s.authorDisplayName || '이름 없음',
    text:s.textDisplay ?? s.textOriginal ?? '', likes:Number(s.likeCount) || 0, publishedAt:s.publishedAt || '',
    updatedAt:s.updatedAt || '', parentId:parentId || s.parentId || '',
    url:`https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}&lc=${encodeURIComponent(item.id)}` };
}

export async function collectVideo(client, id, { limit = 1000, includeReplies = true, order = 'time', signal, onUpdate = () => {} } = {}) {
  const video = {id, title:id, channel:'', rows:[], status:'수집 중', error:'', limited:false};
  const seen = new Set();
  const parents = [];
  let moreTop = false;
  let repliesIncomplete = false;
  const add = (item, parent = '') => {
    if (!item?.id || seen.has(item.id) || video.rows.length >= limit) return;
    seen.add(item.id); video.rows.push(normalizeComment(item,video,parent));
  };
  const publish = () => onUpdate(video);
  try {
    publish();
    const metadata = await client.request('videos',{part:'snippet',id},signal);
    if (!metadata.items?.length) throw new ApiError('영상을 찾을 수 없거나 공개적으로 접근할 수 없습니다.');
    video.title = metadata.items[0].snippet.title;
    video.channel = metadata.items[0].snippet.channelTitle;
    let pageToken = '';
    const tokens = new Set();
    do {
      const data = await client.request('commentThreads',{part:'snippet',videoId:id,maxResults:Math.min(100,limit-video.rows.length),order,textFormat:'plainText',pageToken},signal);
      for (const thread of data.items || []) {
        const parent = thread.snippet?.topLevelComment;
        add(parent);
        if (parent?.id && thread.snippet.totalReplyCount > 0 && !parents.includes(parent.id)) parents.push(parent.id);
      }
      pageToken = data.nextPageToken || '';
      moreTop = Boolean(pageToken);
      publish();
      if (pageToken && tokens.has(pageToken)) throw new ApiError('YouTube에서 같은 페이지를 반복해서 반환해 수집을 멈췄어요.');
      tokens.add(pageToken);
    } while (pageToken && video.rows.length < limit);
    if (includeReplies) {
      for (let i=0;i<parents.length;i++) {
        if (video.rows.length >= limit) { repliesIncomplete=true; break; }
        let replyToken = '';
        const tokens = new Set();
        do {
          const data = await client.request('comments',{part:'snippet',parentId:parents[i],maxResults:Math.min(100,limit-video.rows.length),textFormat:'plainText',pageToken:replyToken},signal);
          for (const reply of data.items || []) add(reply,parents[i]);
          replyToken = data.nextPageToken || '';
          publish();
          if (replyToken && tokens.has(replyToken)) throw new ApiError('답글 페이지가 반복되어 수집을 멈췄어요.');
          tokens.add(replyToken);
        } while (replyToken && video.rows.length < limit);
        if (replyToken || (video.rows.length >= limit && i < parents.length-1)) repliesIncomplete=true;
      }
    }
    video.limited = moreTop || repliesIncomplete;
    video.status = video.limited ? '개수 제한' : video.rows.length ? '완료' : '댓글 없음';
  } catch (error) {
    video.status = signal?.aborted ? '중지됨' : video.rows.length ? '일부 수집' : '수집 실패';
    video.error = signal?.aborted ? '' : (error instanceof ApiError ? error.message : '수집 중 예상하지 못한 오류가 발생했어요. 다시 시도해 주세요.');
    video.fatal = Boolean(error.fatal);
  }
  publish();
  return video;
}

export function selectRows(rows, {query='', sort='likes', type='all'}={}) {
  const q = query.toLocaleLowerCase('ko-KR').trim();
  return rows.filter(r => (!q || `${r.text} ${r.author} ${r.videoTitle}`.toLocaleLowerCase('ko-KR').includes(q)) && (type==='all' || (type==='replies' ? Boolean(r.parentId) : !r.parentId)))
    .sort((a,b) => sort==='likes' ? b.likes-a.likes || b.publishedAt.localeCompare(a.publishedAt) : sort==='oldest' ? a.publishedAt.localeCompare(b.publishedAt) : b.publishedAt.localeCompare(a.publishedAt));
}

function csvCell(value) {
  let s = String(value ?? '');
  if (/^[\s\uFEFF]*[=+\-@]/u.test(s) || /^[\t\r\n]/.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"','""')}"`;
}
export function toCsv(rows) {
  const headings = ['영상 제목','영상 ID','댓글 ID','유형','작성자','댓글 내용','좋아요','작성일(UTC)','수정일(UTC)','상위 댓글 ID','댓글 주소'];
  const body=rows.map(r=>[r.videoTitle,r.videoId,r.id,r.parentId?'답글':'댓글',r.author,r.text,r.likes,r.publishedAt,r.updatedAt,r.parentId,r.url]);
  return '\uFEFF'+[headings,...body].map(row=>row.map(csvCell).join(',')).join('\r\n');
}
