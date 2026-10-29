import type { Actor, Env } from './env';
import { eventLabels, type EventKind } from '../shared/domain';
import { all,audit,auditAfterChange,body,cycle,fail,integer,json,one,q,reason,string,studentMember,studentMembers,timestamp,transact,writable,type Db,type Row } from './club-store';
import { participationView } from './club-views';

interface ClubEvent {
  id:string;cycleId:string;title:string;kind:EventKind;description:string;location:string;startsAt:number;endsAt:number|null;
  points:number;status:'published'|'cancelled';
}
// Gated on the audit row written by auditAfterChange, so it only runs when participation changed.
function syncScore(db:Db,actor:Actor,eventId:string,memberId:string,why:string,now:number,changeId:string) {
  return q(db,`INSERT INTO score_sources(cycle_id,member_id,source_type,source_id,amount,effective,reason,actor_id,updated_at)
    SELECT e.cycle_id,p.member_id,'event',e.id,CASE WHEN p.active=1 THEN p.points ELSE 0 END,p.active,?,?,?
    FROM events e JOIN participation p ON p.event_id=e.id WHERE e.id=? AND p.member_id=? AND e.status='published' AND EXISTS(SELECT 1 FROM club_audit WHERE id=?)
    ON CONFLICT(cycle_id,member_id,source_type,source_id) DO UPDATE SET amount=excluded.amount,effective=excluded.effective,reason=excluded.reason,actor_id=excluded.actor_id,updated_at=excluded.updated_at`,why,actor.id,now,eventId,memberId,changeId);
}
async function getEvent(db:Db,id:string) {
  const value=await one<ClubEvent>(db,'SELECT * FROM events WHERE id=?',id);
  if(!value) fail('找不到活動。',404); return value;
}
export async function listEvents(db:Db,actor:Actor,cycleId:string,admin=false) {
  const events=await all<ClubEvent>(db,'SELECT * FROM events WHERE cycle_id=? ORDER BY starts_at DESC',cycleId);
  const participants=(await all<Row>(db,`SELECT p.event_id,p.member_id,m.name,m.class_name,p.points,p.result,p.note,p.active
    FROM participation p JOIN events e ON e.id=p.event_id JOIN members m ON m.id=p.member_id
    WHERE e.cycle_id=? ${admin ? '':'AND p.member_id=?'}`,cycleId,...(admin ? []:[actor.id]))).map(participationView);
  return events.map(item=>({...item,myParticipation:participants.find(row=>row.eventId===item.id && row.memberId===actor.id) || null,
    ...(admin ? {participants:participants.filter(row=>row.eventId===item.id)}: {})}));
}
export async function eventDetail(db:Db,actor:Actor,id:string) {
  const event=await getEvent(db,id);
  const myParticipation=await one(db,'SELECT points,result,note,active FROM participation WHERE event_id=? AND member_id=?',id,actor.id);
  return json({event:{...event,myParticipation:myParticipation ? participationView(myParticipation):null}});
}
export async function adminEvents(request:Request,env:Env,actor:Actor,path:string):Promise<Response|null> {
  const db=env.DB;
  if(path==='/api/admin/events' && request.method==='GET') {
    const config=await cycle(db,new URL(request.url).searchParams.get('cycleId'));
    return json({events:await listEvents(db,actor,config.id,true)});
  }
  if(path==='/api/admin/events' && request.method==='POST') {
    const data=await body(request),config=await cycle(db),id=crypto.randomUUID(),kind=string(data.kind,'活動類別') as EventKind;
    if(!Object.hasOwn(eventLabels,kind)) fail('活動類別不正確。');
    const title=string(data.title,'活動名稱'),description=string(data.description,'活動說明',10000,true),location=string(data.location,'地點',500,true);
    const startsAt=timestamp(data.startsAt,'開始時間'),endsAt=data.endsAt==null ? null:timestamp(data.endsAt,'結束時間');
    if(endsAt!==null && endsAt<startsAt) fail('結束時間不可早於開始時間。');
    const points=kind==='competition' ? integer(data.points ?? 0,'比賽分數') : 50;
    await transact(db,[audit(db,actor,config.id,'event.create',id,'發布活動'),
      q(db,'INSERT INTO events(id,cycle_id,title,kind,description,location,starts_at,ends_at,points) VALUES(?,?,?,?,?,?,?,?,?)',id,config.id,title,kind,description,location,startsAt,endsAt,points)]);
    return json({event:await getEvent(db,id)},201);
  }
  const match=path.match(/^\/api\/admin\/events\/([^/]+)(?:\/(participants))?$/);
  if(!match) return null;
  const item=await getEvent(db,match[1]);
  writable(await cycle(db,item.cycleId));
  const data=await body(request),why=reason(data),now=Date.now();
  if(!match[2] && request.method==='PATCH') {
    if(item.status==='cancelled') fail('活動已取消，不能修改。',409);
    if(data.status!==undefined && data.status!=='cancelled') fail('活動狀態不正確。');
    const title=data.title===undefined ? item.title:string(data.title,'活動名稱');
    const description=data.description===undefined ? item.description:string(data.description,'活動說明',10000,true);
    const location=data.location===undefined ? item.location:string(data.location,'地點',500,true);
    const startsAt=data.startsAt===undefined ? item.startsAt:timestamp(data.startsAt,'開始時間');
    const endsAt=data.endsAt===undefined ? item.endsAt:data.endsAt===null ? null:timestamp(data.endsAt,'結束時間');
    if(endsAt!==null && endsAt<startsAt) fail('結束時間不可早於開始時間。');
    const changeId=crypto.randomUUID();
    const statements=[q(db,"UPDATE events SET title=?,description=?,location=?,starts_at=?,ends_at=?,status=? WHERE id=? AND status='published'",title,description,location,startsAt,endsAt,data.status ?? item.status,item.id),
      auditAfterChange(db,actor,item.cycleId,'event.update',item.id,why,now,changeId)];
    if(data.status==='cancelled') {
      statements.push(q(db,'UPDATE participation SET active=0,reason=?,actor_id=?,updated_at=? WHERE event_id=? AND EXISTS(SELECT 1 FROM club_audit WHERE id=?)',why,actor.id,now,item.id,changeId));
      statements.push(q(db,"UPDATE score_sources SET amount=0,effective=0,reason=?,actor_id=?,updated_at=? WHERE source_type='event' AND source_id=? AND EXISTS(SELECT 1 FROM club_audit WHERE id=?)",why,actor.id,now,item.id,changeId));
    }
    const result=await transact(db,statements);
    if(result[0].meta.changes===0) fail('活動狀態已改變，請重新整理。',409);
    return json({event:await getEvent(db,item.id)});
  }
  if(match[2]==='participants' && request.method==='PUT' && data.memberIds!==undefined) {
    // Bulk mode only adds new or revoked members; existing active entries keep their points and results.
    if(item.status!=='published') fail('活動已取消。',409);
    const members=await studentMembers(db,data.memberIds);
    const points=item.kind==='competition' ? integer(data.points ?? item.points,'比賽分數'):50;
    const results=await transact(db,members.flatMap(member=>{
      const changeId=crypto.randomUUID();
      return [q(db,`INSERT INTO participation(event_id,member_id,points,result,note,active,updated_at,actor_id,reason)
          SELECT id,?,?,'','',1,?,?,? FROM events WHERE id=? AND status='published'
          ON CONFLICT(event_id,member_id) DO UPDATE SET points=excluded.points,active=1,updated_at=excluded.updated_at,actor_id=excluded.actor_id,reason=excluded.reason
          WHERE participation.active=0`,member.id,points,now,actor.id,why,item.id),
        auditAfterChange(db,actor,item.cycleId,'event.participation',`${item.id}:${member.id}`,why,now,changeId),
        syncScore(db,actor,item.id,member.id,why,now,changeId)];
    }));
    return json({added:results.filter((_,index)=>index%3===0).reduce((total,result)=>total+result.meta.changes,0)});
  }
  if(match[2]==='participants' && request.method==='PUT') {
    if(item.status!=='published') fail('活動已取消。',409);
    const member=await studentMember(db,data.memberId);
    if(typeof data.active!=='boolean') fail('請指定是否參與。');
    const points=item.kind==='competition' ? integer(data.points ?? item.points,'比賽分數'):50;
    const result=string(data.result,'成績',1000,true),note=string(data.note,'備註',2000,true);
    const changeId=crypto.randomUUID();
    const results=await transact(db,[q(db,`INSERT INTO participation(event_id,member_id,points,result,note,active,updated_at,actor_id,reason)
        SELECT id,?,?,?,?,?,?,?,? FROM events WHERE id=? AND status='published'
        ON CONFLICT(event_id,member_id) DO UPDATE SET points=excluded.points,result=excluded.result,note=excluded.note,active=excluded.active,
        updated_at=excluded.updated_at,actor_id=excluded.actor_id,reason=excluded.reason`,member.id,points,result,note,+data.active,now,actor.id,why,item.id),
      auditAfterChange(db,actor,item.cycleId,'event.participation',`${item.id}:${member.id}`,why,now,changeId),
      syncScore(db,actor,item.id,member.id,why,now,changeId)]);
    if(results[0].meta.changes===0) fail('活動狀態已改變，請重新整理。',409);
    const participation=await one(db,'SELECT member_id,points,result,note,active FROM participation WHERE event_id=? AND member_id=?',item.id,member.id);
    return json({participation:participation ? participationView(participation):null});
  }
  return null;
}

export async function adjust(request:Request,env:Env,actor:Actor) {
  const db=env.DB,data=await body(request),config=await cycle(db),member=await studentMember(db,data.memberId);
  const amount=integer(data.points,'修正分數'),key=string(data.idempotencyKey,'操作識別碼',100),why=reason(data);
  if(amount===0) fail('修正分數不可為零。');
  await transact(db,[audit(db,actor,config.id,'score.adjustment',key,why),
    q(db,`INSERT INTO score_sources(cycle_id,member_id,source_type,source_id,amount,reason,actor_id,updated_at)
      VALUES(?,?,'adjustment',?,?,?,?,?) ON CONFLICT DO NOTHING`,config.id,member.id,key,amount,why,actor.id,Date.now())]);
  const existing=await one<{cycleId:string;memberId:string;amount:number;reason:string}>(db,"SELECT cycle_id,member_id,amount,reason FROM score_sources WHERE source_type='adjustment' AND source_id=?",key);
  if(!existing || existing.cycleId!==config.id || existing.memberId!==member.id || existing.amount!==amount || existing.reason!==why) fail('同一操作識別碼已用於另一筆修正。',409);
  return json({ok:true});
}
