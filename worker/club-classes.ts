import type { Actor, Env } from './env';
import { attendanceLabels, type AttendanceStatus } from '../shared/domain';
import { all,audit,auditAfterChange,body,cycle,fail,json,one,q,reason,snapshot,string,studentMember,studentMembers,transact,writable, type Row, type Db } from './club-store';
import { attendanceView } from './club-views';

interface ClubClass {
  id:string;cycleId:string;title:string;date:string;opensAt:number;lateAt:number;closesAt:number;
  status:'draft'|'open'|'closed'|'cancelled';openedAt:number|null;closedAt:number|null;closeToken:string|null;checkinClosedAt:number|null;
}
function times(data:Row) {
  const date=string(data.date,'日期',10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('日期格式應為 YYYY-MM-DD。');
  const parse=(value:unknown,fallback:string)=>{
    const text=value===undefined ? fallback : string(value,'時間',5);
    if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text)) fail('時間格式應為 HH:mm。');
    const result=Date.parse(`${date}T${text}:00+08:00`);
    if(!Number.isFinite(result) || new Date(result+8*3600_000).toISOString().slice(0,10)!==date) fail('日期不存在。');
    return result;
  };
  const opensAt=parse(data.openTime,'12:45'),lateAt=parse(data.lateTime,'12:55'),closesAt=parse(data.closeTime,'13:10');
  if(!(opensAt<lateAt && lateAt<closesAt)) fail('簽到開始、遲到、結束時間必須依序排列。');
  return {date,opensAt,lateAt,closesAt};
}
async function getClass(db:Db,id:string) {
  const value=await one<ClubClass>(db,'SELECT * FROM classes WHERE id=?',id);
  if(!value) fail('找不到課次。',404); return value;
}
export async function listClasses(db:Db,actor:Actor,cycleId:string,admin=false) {
  const classes=await all<ClubClass & {myAttendance?:Row|null;attendance?:Row[]}>(db,'SELECT * FROM classes WHERE cycle_id=? ORDER BY opens_at DESC',cycleId);
  const own=(await all<Row>(db,`SELECT a.class_id,a.status,a.shared,a.note,a.checked_in_at FROM attendance a
    JOIN classes c ON c.id=a.class_id WHERE c.cycle_id=? AND a.member_id=?`,cycleId,actor.id)).map(attendanceView);
  const records=admin ? await all<Row>(db,`SELECT a.class_id,a.member_id,m.name,m.class_name,a.status,a.shared,a.note,a.checked_in_at
    FROM attendance a JOIN classes c ON c.id=a.class_id JOIN members m ON m.id=a.member_id WHERE c.cycle_id=?`,cycleId) : [];
  return classes.map(item=>({...item,closeToken:undefined,myAttendance:own.find(row=>row.classId===item.id) || null,
    ...(admin ? {attendance:records.filter(row=>row.classId===item.id).map(attendanceView)}: {})}));
}
function publishClass(db:Db,id:string,actor:Actor,why:string,now:number,token?:string) {
  return q(db,`INSERT INTO score_sources(cycle_id,member_id,source_type,source_id,amount,reason,actor_id,updated_at)
    SELECT c.cycle_id,a.member_id,'class',c.id,
      CASE a.status WHEN 'present' THEN 50 WHEN 'late' THEN -100 WHEN 'absent' THEN -200 ELSE 0 END + a.shared*200,?,?,?
    FROM attendance a JOIN classes c ON c.id=a.class_id WHERE c.id=? AND c.status='closed' ${token ? 'AND c.close_token=?':''}
    ON CONFLICT(cycle_id,member_id,source_type,source_id) DO UPDATE SET amount=excluded.amount,reason=excluded.reason,actor_id=excluded.actor_id,updated_at=excluded.updated_at`,
    why,actor.id,now,id,...(token ? [token]:[]));
}
// One code per opening of a class, valid for its whole check-in window.
async function checkinCode(secret:string,item:ClubClass) {
  if(!secret || secret.length<24) fail('簽到服務尚未設定完成。',503);
  if(item.status!=='open' || item.openedAt===null) fail('課次尚未開啟簽到。',409);
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`club-checkin:${item.id}:${item.openedAt}`)));
  const numeric=new DataView(signature.buffer).getUint32(0) % 1_000_000;
  return {code:numeric.toString().padStart(6,'0'),classId:item.id,opensAt:item.opensAt,lateAt:item.lateAt,closesAt:item.closesAt};
}
function same(a:string,b:string) {
  if(a.length!==b.length) return false;
  let mismatch=0; for(let n=0;n<a.length;n++) mismatch |= a.charCodeAt(n)^b.charCodeAt(n);
  return mismatch===0;
}
export async function checkin(request:Request,env:Env,actor:Actor) {
  if(actor.role!=='member') fail('只有學生可以簽到。',403);
  const data=await body(request), id=string(data.classId,'課次編號',100), code=string(data.code,'簽到碼',100);
  if(!/^\d{6}$/.test(code)) fail('請輸入 6 位數字簽到碼。');
  const item=await getClass(env.DB,id), now=Date.now();
  writable(await cycle(env.DB,item.cycleId));
  if(item.status!=='open' || now<item.opensAt || now>=item.closesAt) fail('目前不在已開啟的簽到窗口內。',409);
  if(item.checkinClosedAt!==null) fail('老師已結束本課簽到，請聯絡管理員補登。',409);
  // The code stays fixed for the class, so attempts never reset within it.
  const attempt=await q(env.DB,`INSERT INTO checkin_attempts(member_id,class_id,window,attempts) VALUES(?,?,0,1)
    ON CONFLICT(member_id,class_id) DO UPDATE SET attempts=checkin_attempts.attempts+1 RETURNING attempts`,
    actor.id,id).first<{attempts:number}>();
  if(!attempt || attempt.attempts>10) fail('簽到嘗試次數已達上限，請聯絡管理員補登。',429);
  const expected=await checkinCode(env.CHECKIN_SECRET,item);
  if(!same(code,expected.code)) fail('簽到碼不正確，請向老師確認後重新輸入。');
  const result=await transact(env.DB,[q(env.DB,`INSERT INTO attendance(class_id,member_id,status,shared,note,checked_in_at,updated_at,actor_id,reason)
    SELECT c.id,m.id,CASE WHEN ?>=c.late_at THEN 'late' ELSE 'present' END,0,'',?,?,m.id,'學生簽到'
    FROM classes c JOIN cycles cy ON cy.id=c.cycle_id JOIN members m ON m.id=?
    WHERE c.id=? AND c.status='open' AND c.checkin_closed_at IS NULL AND cy.status='active' AND ?>=c.opens_at AND ?<c.closes_at
      AND m.role='member' AND m.active=1 AND m.must_change_password=0 AND m.joined_at<=? AND m.session_version=?
    ON CONFLICT(class_id,member_id) DO NOTHING`,now,now,now,actor.id,id,now,now,now,actor.sessionVersion),
    q(env.DB,`SELECT a.status,a.shared,a.note,a.checked_in_at FROM attendance a
      JOIN classes c ON c.id=a.class_id JOIN cycles cy ON cy.id=c.cycle_id JOIN members m ON m.id=a.member_id
      WHERE a.class_id=? AND a.member_id=? AND c.status='open' AND cy.status='active'
        AND m.active=1 AND m.must_change_password=0 AND m.session_version=?`,id,actor.id,actor.sessionVersion)]);
  const row=result[1].results[0];
  if(!row) fail('課次或帳號狀態已改變，請重新整理。',409);
  return json({attendance:attendanceView({...row,checkedInAt:(row as Row).checked_in_at,checked_in_at:undefined}),alreadyCheckedIn:result[0].meta.changes===0});
}
export async function adminClasses(request:Request,env:Env,actor:Actor,path:string):Promise<Response|null> {
  const db=env.DB,url=new URL(request.url);
  if(path==='/api/admin/classes' && request.method==='GET') {
    const config=await cycle(db,url.searchParams.get('cycleId')); return json({classes:await listClasses(db,actor,config.id,true)});
  }
  if(path==='/api/admin/classes' && request.method==='POST') {
    const data=await body(request),config=await cycle(db),id=crypto.randomUUID(),when=times(data),title=string(data.title,'課次名稱');
    await transact(db,[audit(db,actor,config.id,'class.create',id,'建立課次'),
      q(db,`INSERT INTO classes(id,cycle_id,title,date,opens_at,late_at,closes_at) VALUES(?,?,?,?,?,?,?)`,id,config.id,title,when.date,when.opensAt,when.lateAt,when.closesAt)]);
    return json({class:await getClass(db,id)},201);
  }
  const match=path.match(/^\/api\/admin\/classes\/([^/]+)(?:\/(code|attendance|close|signin))?$/);
  if(!match) return null;
  const item=await getClass(db,match[1]),action=match[2];
  if(action==='code' && request.method==='GET') return json(await checkinCode(env.CHECKIN_SECRET,item));
  writable(await cycle(db,item.cycleId));
  const data=await body(request),why=reason(data),now=Date.now();
  if(!action && request.method==='PATCH') {
    const nextStatus=data.status===undefined ? item.status : string(data.status,'課次狀態');
    if(data.status!==undefined && !['open','cancelled'].includes(nextStatus)) fail('課次狀態不正確。');
    if(item.status==='cancelled') fail('已取消的課次不能修改。',409);
    if(nextStatus==='open' && !['draft','open'].includes(item.status)) fail('只有尚未結課的課次可開啟。',409);
    const reschedule=['date','openTime','lateTime','closeTime'].some(key=>data[key]!==undefined);
    if(reschedule && item.status!=='draft') fail('已開啟的課次不能變更時間。',409);
    const when=reschedule ? times({...data,date:data.date ?? item.date,
      openTime:data.openTime ?? new Date(item.opensAt+8*3600_000).toISOString().slice(11,16),
      lateTime:data.lateTime ?? new Date(item.lateAt+8*3600_000).toISOString().slice(11,16),
      closeTime:data.closeTime ?? new Date(item.closesAt+8*3600_000).toISOString().slice(11,16)}) : item;
    const changeId=crypto.randomUUID();
    const statements=[q(db,`UPDATE classes SET title=?,date=?,opens_at=?,late_at=?,closes_at=?,status=?,
      opened_at=CASE WHEN ?='open' THEN COALESCE(opened_at,?) ELSE opened_at END WHERE id=? AND status=?`,
      data.title===undefined ? item.title:string(data.title,'課次名稱'),when.date,when.opensAt,when.lateAt,when.closesAt,nextStatus,nextStatus,now,item.id,item.status),
      auditAfterChange(db,actor,item.cycleId,'class.update',item.id,why,now,changeId)];
    if(nextStatus==='cancelled') statements.push(q(db,`UPDATE score_sources SET amount=0,effective=0,reason=?,actor_id=?,updated_at=?
      WHERE source_type='class' AND source_id=? AND EXISTS(SELECT 1 FROM club_audit WHERE id=?)`,why,actor.id,now,item.id,changeId));
    if(item.status==='closed') statements.push(snapshot(db,{id:crypto.randomUUID(),cycleId:item.cycleId,classId:item.id,kind:'class',actorId:actor.id,now,cutoff:now,
      condition:'EXISTS(SELECT 1 FROM club_audit WHERE id=?)',conditionValues:[changeId]}));
    const result=await transact(db,statements);
    if(result[0].meta.changes===0) fail('課次已被其他操作修改，請重新整理。',409);
    return json({class:await getClass(db,item.id)});
  }
  if(action==='signin' && request.method==='PATCH') {
    // Ends or reopens student check-in only; the class stays open for manual records and closing.
    if(typeof data.open!=='boolean') fail('請指定開放或結束簽到。');
    if(item.status!=='open') fail('只有已開啟的課次可以調整簽到。',409);
    if(data.open && now>=item.closesAt) fail('簽到時間已過，無法重新開放。',409);
    const result=await transact(db,[q(db,`UPDATE classes SET checkin_closed_at=? WHERE id=? AND status='open' AND checkin_closed_at IS ${data.open ? 'NOT NULL':'NULL'}`,
      data.open ? null:now,item.id),
      auditAfterChange(db,actor,item.cycleId,data.open ? 'class.checkin_resume':'class.checkin_stop',item.id,why,now,crypto.randomUUID())]);
    if(result[0].meta.changes===0) fail(data.open ? '簽到目前已開放。':'簽到已經結束。',409);
    return json({class:await getClass(db,item.id)});
  }
  if(action==='attendance' && request.method==='PUT' && data.memberIds!==undefined) {
    // Bulk mode changes status (and note when given) only; sharing stays as recorded.
    const members=await studentMembers(db,data.memberIds),status=string(data.status,'出勤狀態') as AttendanceStatus;
    if(!Object.hasOwn(attendanceLabels,status)) fail('出勤狀態不正確。');
    if(members.some(member=>member.joinedAt>item.lateAt)) fail('不能補登學生加入前的課次。',409);
    const note=data.note===undefined ? null:string(data.note,'備註',2000,true);
    await transact(db,[...members.flatMap(member=>[audit(db,actor,item.cycleId,'class.attendance',`${item.id}:${member.id}`,why,now),
      q(db,`INSERT INTO attendance(class_id,member_id,status,shared,note,checked_in_at,updated_at,actor_id,reason)
        VALUES(?,?,?,0,COALESCE(?,''),NULL,?,?,?) ON CONFLICT(class_id,member_id) DO UPDATE SET status=excluded.status,
        note=CASE WHEN ? IS NULL THEN attendance.note ELSE excluded.note END,updated_at=excluded.updated_at,actor_id=excluded.actor_id,reason=excluded.reason`,
        item.id,member.id,status,note,now,actor.id,why,note)]),
      publishClass(db,item.id,actor,why,now),
      snapshot(db,{id:crypto.randomUUID(),cycleId:item.cycleId,classId:item.id,kind:'class',actorId:actor.id,now,cutoff:now,
        condition:"EXISTS(SELECT 1 FROM classes WHERE id=? AND status='closed')",conditionValues:[item.id]})]);
    return json({updated:members.length});
  }
  if(action==='attendance' && request.method==='PUT') {
    const member=await studentMember(db,data.memberId),status=string(data.status,'出勤狀態') as AttendanceStatus;
    if(!Object.hasOwn(attendanceLabels,status)) fail('出勤狀態不正確。');
    if(member.joinedAt>item.lateAt) fail('不能補登學生加入前的課次。',409);
    if(data.shared!==undefined && typeof data.shared!=='boolean') fail('分享欄位必須為是或否。');
    const note=string(data.note,'備註',2000,true),shared=data.shared===true ? 1:0;
    await transact(db,[audit(db,actor,item.cycleId,'class.attendance',`${item.id}:${member.id}`,why,now),
      q(db,`INSERT INTO attendance(class_id,member_id,status,shared,note,checked_in_at,updated_at,actor_id,reason)
        VALUES(?,?,?,?,?,NULL,?,?,?) ON CONFLICT(class_id,member_id) DO UPDATE SET status=excluded.status,shared=excluded.shared,note=excluded.note,
        updated_at=excluded.updated_at,actor_id=excluded.actor_id,reason=excluded.reason`,item.id,member.id,status,shared,note,now,actor.id,why),
      publishClass(db,item.id,actor,why,now),
      snapshot(db,{id:crypto.randomUUID(),cycleId:item.cycleId,classId:item.id,kind:'class',actorId:actor.id,now,cutoff:now,
        condition:"EXISTS(SELECT 1 FROM classes WHERE id=? AND status='closed')",conditionValues:[item.id]})]);
    const attendance=await one(db,'SELECT member_id,status,shared,note,checked_in_at FROM attendance WHERE class_id=? AND member_id=?',item.id,member.id);
    return json({attendance:attendance ? attendanceView(attendance):null});
  }
  if(action==='close' && request.method==='POST') {
    if(item.status==='closed') return json({class:item,snapshotId:item.closeToken});
    if(item.status!=='open' || item.openedAt===null) fail('只有已開啟的課次可以結課。',409);
    const snapshotId=crypto.randomUUID();
    await transact(db,[audit(db,actor,item.cycleId,'class.close',item.id,why,now),
      q(db,"UPDATE classes SET status='closed',closed_at=?,close_token=? WHERE id=? AND status='open'",now,snapshotId,item.id),
      q(db,`INSERT INTO attendance(class_id,member_id,status,shared,note,checked_in_at,updated_at,actor_id,reason)
        SELECT c.id,m.id,'absent',0,'',NULL,?,?,? FROM classes c JOIN members m ON m.role='member' AND m.active=1 AND m.joined_at<=c.late_at
        WHERE c.id=? AND c.close_token=? ON CONFLICT(class_id,member_id) DO NOTHING`,now,actor.id,why,item.id,snapshotId),
      publishClass(db,item.id,actor,why,now,snapshotId),
      snapshot(db,{id:snapshotId,cycleId:item.cycleId,classId:item.id,kind:'class',actorId:actor.id,now,cutoff:now,
        condition:'EXISTS(SELECT 1 FROM classes WHERE id=? AND close_token=?)',conditionValues:[item.id,snapshotId]})]);
    const current=await getClass(db,item.id);
    if(current.status!=='closed') fail('課次狀態已改變，請重新整理。',409);
    return json({class:current,snapshotId:current.closeToken});
  }
  return null;
}
