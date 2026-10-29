import type { Actor, Env } from './env';
import { all,auditAfterChange,body,cycle,fail,json,one,q,snapshot,string,studentMember,transact,writable,type Db } from './club-store';
import { getClass,publishClass } from './club-classes';

interface LeaveRequest {
  id:string;classId:string;memberId:string;kind:string;reason:string;
  status:'pending'|'approved'|'rejected'|'withdrawn';source:'student'|'admin';createdAt:number;decidedAt:number|null;decisionNote:string;
}
const kinds=['official_leave','sick_leave','personal_leave'];
const listSql=`SELECT r.id,r.class_id,r.member_id,m.name member_name,m.class_name,c.title class_title,c.date class_date,c.status class_status,
  r.kind,r.reason,r.status,r.source,r.created_at,r.decided_at,r.decision_note
  FROM leave_requests r JOIN classes c ON c.id=r.class_id JOIN members m ON m.id=r.member_id`;

function leaveKind(value:unknown) {
  const kind=string(value,'假別',40);
  if(!kinds.includes(kind)) fail('假別不正確。'); return kind;
}
async function leaveClass(db:Db,classId:unknown,member:{joinedAt:number}) {
  const item=await getClass(db,string(classId,'課次編號',100));
  writable(await cycle(db,item.cycleId));
  if(item.status==='cancelled') fail('課次已取消，不需請假。',409);
  if(member.joinedAt>item.lateAt) fail('不能為加入前的課次請假。',409);
  return item;
}
// Writes approved leave into attendance. Gated on the audit row written earlier in the
// same batch, so nothing changes when the leave row itself did not change.
function applyLeave(db:Db,actor:Actor,item:{id:string;cycleId:string},memberId:string,kind:string,note:string,why:string,now:number,changeId:string) {
  return [q(db,`INSERT INTO attendance(class_id,member_id,status,shared,note,checked_in_at,updated_at,actor_id,reason)
      SELECT ?,?,?,0,?,NULL,?,?,? WHERE EXISTS(SELECT 1 FROM club_audit WHERE id=?)
      ON CONFLICT(class_id,member_id) DO UPDATE SET status=excluded.status,note=excluded.note,updated_at=excluded.updated_at,actor_id=excluded.actor_id,reason=excluded.reason`,
      item.id,memberId,kind,note,now,actor.id,why,changeId),
    publishClass(db,item.id,actor,why,now),
    snapshot(db,{id:crypto.randomUUID(),cycleId:item.cycleId,classId:item.id,kind:'class',actorId:actor.id,now,cutoff:now,
      condition:"EXISTS(SELECT 1 FROM classes WHERE id=? AND status='closed') AND EXISTS(SELECT 1 FROM club_audit WHERE id=?)",conditionValues:[item.id,changeId]})];
}

export async function studentLeave(request:Request,env:Env,actor:Actor,path:string):Promise<Response|null> {
  const db=env.DB;
  if(actor.role!=='member') fail('只有學生可以申請請假。',403);
  if(path==='/api/leave' && request.method==='GET') {
    const config=await cycle(db,new URL(request.url).searchParams.get('cycleId'));
    return json({requests:await all(db,`${listSql} WHERE r.member_id=? AND c.cycle_id=? ORDER BY r.created_at DESC`,actor.id,config.id)});
  }
  if(path==='/api/leave' && request.method==='POST') {
    const data=await body(request),member=await studentMember(db,actor.id),kind=leaveKind(data.kind),why=string(data.reason,'請假理由',1000);
    const item=await leaveClass(db,data.classId,member),id=crypto.randomUUID();
    const result=await q(db,'INSERT INTO leave_requests(id,class_id,member_id,kind,reason,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING',
      id,item.id,member.id,kind,why,Date.now()).run();
    if(result.meta.changes===0) fail('這節課已有待審的請假申請。',409);
    return json({request:await one(db,`${listSql} WHERE r.id=?`,id)},201);
  }
  const withdraw=path.match(/^\/api\/leave\/([^/]+)\/withdraw$/);
  if(withdraw && request.method==='POST') {
    const result=await q(db,"UPDATE leave_requests SET status='withdrawn',decided_at=? WHERE id=? AND member_id=? AND status='pending'",Date.now(),withdraw[1],actor.id).run();
    if(result.meta.changes===0) fail('找不到可撤回的請假申請。',404);
    return json({ok:true});
  }
  return null;
}

export async function adminLeave(request:Request,env:Env,actor:Actor,path:string):Promise<Response|null> {
  const db=env.DB;
  if(path==='/api/admin/leave' && request.method==='GET') {
    const config=await cycle(db,new URL(request.url).searchParams.get('cycleId'));
    return json({requests:await all(db,`${listSql} WHERE c.cycle_id=? ORDER BY r.status='pending' DESC,r.created_at DESC`,config.id)});
  }
  if(path==='/api/admin/leave' && request.method==='POST') {
    const data=await body(request),member=await studentMember(db,data.memberId),kind=leaveKind(data.kind),note=string(data.note,'請假說明',1000,true);
    const item=await leaveClass(db,data.classId,member),id=crypto.randomUUID(),changeId=crypto.randomUUID(),now=Date.now(),why='管理員登記請假';
    await transact(db,[q(db,`INSERT INTO leave_requests(id,class_id,member_id,kind,reason,status,source,created_at,decided_at,decided_by)
        SELECT ?,?,?,?,?,'approved','admin',?,?,? WHERE NOT EXISTS(SELECT 1 FROM leave_requests WHERE class_id=? AND member_id=? AND status='pending')`,
        id,item.id,member.id,kind,note,now,now,actor.id,item.id,member.id),
      auditAfterChange(db,actor,item.cycleId,'leave.create',id,why,now,changeId),
      ...applyLeave(db,actor,item,member.id,kind,note,why,now,changeId)]);
    const created=await one(db,`${listSql} WHERE r.id=?`,id);
    if(!created) fail('此學生已有待審的請假申請，請直接審核該申請。',409);
    return json({request:created},201);
  }
  const decision=path.match(/^\/api\/admin\/leave\/([^/]+)\/decision$/);
  if(decision && request.method==='POST') {
    const data=await body(request);
    if(typeof data.approve!=='boolean') fail('請指定核准或退回。');
    const approve=data.approve,note=string(data.note,'審核說明',1000,approve);
    const leave=await one<LeaveRequest>(db,'SELECT * FROM leave_requests WHERE id=?',decision[1]);
    if(!leave) fail('找不到請假申請。',404);
    if(leave.status!=='pending') fail('這筆申請已處理。',409);
    const item=await getClass(db,leave.classId); writable(await cycle(db,item.cycleId));
    const now=Date.now(),changeId=crypto.randomUUID(),why=note || '核准請假申請';
    const result=await transact(db,[q(db,"UPDATE leave_requests SET status=?,decided_at=?,decided_by=?,decision_note=? WHERE id=? AND status='pending'",
        approve ? 'approved':'rejected',now,actor.id,note,leave.id),
      auditAfterChange(db,actor,item.cycleId,approve ? 'leave.approve':'leave.reject',leave.id,why,now,changeId),
      ...(approve ? applyLeave(db,actor,item,leave.memberId,leave.kind,leave.reason,why,now,changeId):[])]);
    if(result[0].meta.changes===0) fail('這筆申請已處理。',409);
    return json({request:await one(db,`${listSql} WHERE r.id=?`,leave.id)});
  }
  return null;
}
