import type { Actor, Env } from './env';
import { adminClasses,checkin,listClasses } from './club-classes';
import { adminEvents,adjust,eventDetail,listEvents } from './club-events';
import { adminCycles } from './club-cycles';
import { exportCsv } from './club-export';
import { adminLeave,studentLeave } from './club-leave';
import { all,cycle,fail,json,rankings,type Rankings } from './club-store';

// Pending status is private: students only see their own flag.
function ownPending(ranks:Rankings,actor:Actor):Rankings {
  return actor.role==='admin' ? ranks : {...ranks,rows:ranks.rows.map(row=>row.memberId===actor.id ? row:{...row,pending:false})};
}

export async function handleBusiness(request: Request, env: Env, actor: Actor, path: string): Promise<Response | null> {
  if(!actor.active) fail('帳號已停用。',403);
  if(actor.mustChangePassword) fail('請先完成首次更改密碼。',403);
  const url=new URL(request.url),db=env.DB,cycleId=url.searchParams.get('cycleId');
  if(path.startsWith('/api/admin/')) {
    if(actor.role!=='admin') fail('需要管理員權限。',403);
    if(path.startsWith('/api/admin/classes')) return adminClasses(request,env,actor,path);
    if(path.startsWith('/api/admin/events')) return adminEvents(request,env,actor,path);
    if(path==='/api/admin/adjustments' && request.method==='POST') return adjust(request,env,actor);
    if(path.startsWith('/api/admin/leave')) return adminLeave(request,env,actor,path);
    if(path==='/api/admin/export.csv' && request.method==='GET') return exportCsv(request,env);
    return adminCycles(request,env,actor,path);
  }
  if(path==='/api/checkin' && request.method==='POST') return checkin(request,env,actor);
  if(path==='/api/leave' || path.startsWith('/api/leave/')) return studentLeave(request,env,actor,path);
  if(request.method!=='GET') return null;
  if(path==='/api/cycles') return json({cycles:await all(db,'SELECT * FROM cycles ORDER BY created_at DESC,id')});
  if(path==='/api/rankings') return json(ownPending(await rankings(db,cycleId,url.searchParams.get('snapshotId')),actor));
  const event=path.match(/^\/api\/events\/([^/]+)$/);
  if(event) return eventDetail(db,actor,event[1]);
  if(!['/api/classes','/api/events','/api/ledger','/api/overview'].includes(path)) return null;
  const config=await cycle(db,cycleId);
  if(path==='/api/classes') return json({classes:await listClasses(db,actor,config.id)});
  if(path==='/api/events') return json({events:await listEvents(db,actor,config.id)});
  const requestedMember=url.searchParams.get('memberId');
  if(requestedMember && actor.role!=='admin' && requestedMember!==actor.id) fail('只能查閱自己的積分紀錄。',403);
  const memberId=actor.role==='admin' && requestedMember ? requestedMember:actor.id;
  const ledger=await all<{id:number;cycleId:string;memberId:string;sourceType:string;sourceId:string;delta:number;reason:string;createdAt:number}>(db,
    'SELECT id,cycle_id,member_id,source_type,source_id,delta,reason,created_at FROM score_ledger WHERE cycle_id=? AND member_id=? ORDER BY id DESC',config.id,memberId);
  const score=ledger.reduce((total,item)=>total+item.delta,0);
  if(path==='/api/ledger') return json({ledger,score});
  const ranks=await rankings(db,config.id),classes=await listClasses(db,actor,config.id),events=await listEvents(db,actor,config.id);
  return json({cycle:config,stats:{score,rank:ranks.rows.find(row=>row.memberId===actor.id)?.rank ?? null,memberCount:ranks.rows.length,
    classCount:classes.filter(item=>item.status==='closed').length,eventCount:events.filter(item=>item.status==='published').length},
    nextClass:classes.filter(item=>['open','draft'].includes(item.status) && item.closesAt>Date.now()).sort((a,b)=>a.opensAt-b.opensAt)[0] || null,
    recentLedger:ledger.slice(0,8),rankings:ownPending(ranks,actor)});
}
