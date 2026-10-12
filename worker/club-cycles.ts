import type { Actor, Env } from './env';
import type { RankRow } from '../shared/domain';
import { all,audit,body,cycle,fail,integer,json,one,q,reason,snapshot,string,timestamp,transact,writable,type Row } from './club-store';
import { attendanceView, participationView } from './club-views';

export async function adminCycles(request:Request,env:Env,actor:Actor,path:string):Promise<Response|null> {
  const db=env.DB,url=new URL(request.url);
  if(path==='/api/admin/settings' && request.method==='GET') return json({cycle:await cycle(db,url.searchParams.get('cycleId'))});
  if(path==='/api/admin/settings' && request.method==='PATCH') {
    const data=await body(request),config=await cycle(db),why=reason(data);
    const redMode=data.redMode===undefined ? config.redMode:string(data.redMode,'紅線模式');
    if(redMode!=='automatic' && redMode!=='manual') fail('紅線模式不正確。');
    const redScore=data.redScore===undefined ? config.redScore:data.redScore===null ? null:integer(data.redScore,'紅線');
    const yellowScore=data.yellowScore===undefined ? config.yellowScore:data.yellowScore===null ? null:integer(data.yellowScore,'黃線');
    const cutoffAt=data.cutoffAt===undefined ? config.cutoffAt:data.cutoffAt===null ? null:timestamp(data.cutoffAt,'截止時間');
    if(redMode==='manual' && redScore===null) fail('手動紅線必須填寫分數。');
    await transact(db,[audit(db,actor,config.id,'settings.update',config.id,why),
      q(db,'UPDATE cycles SET red_mode=?,red_score=?,yellow_score=?,cutoff_at=? WHERE id=?',redMode,redScore,yellowScore,cutoffAt,config.id)]);
    return json({cycle:await cycle(db,config.id)});
  }
  if(path==='/api/admin/cycles' && request.method==='POST') {
    const data=await body(request),config=await cycle(db),id=crypto.randomUUID(),name=string(data.name,'週期名稱'),why=reason(data),now=Date.now();
    await transact(db,[audit(db,actor,config.id,'cycle.archive',config.id,why,now),
      snapshot(db,{id:crypto.randomUUID(),cycleId:config.id,kind:'archive',actorId:actor.id,now,cutoff:now}),
      q(db,"UPDATE cycles SET status='archived',archived_at=? WHERE id=? AND status='active'",now,config.id),
      q(db,"INSERT INTO cycles(id,name,status,created_at) VALUES(?,?,'active',?)",id,name,now)]);
    return json({cycle:await cycle(db,id)},201);
  }
  if(path==='/api/admin/settlement' && request.method==='POST') {
    const data=await body(request),config=await cycle(db),why=reason(data),now=Date.now();
    if(config.cutoffAt===null || config.cutoffAt>now) fail('請設定已到達的截止時間後再結算。',409);
    const existing=await one<{id:string}>(db,"SELECT id FROM ranking_snapshots WHERE cycle_id=? AND kind='settlement' AND cutoff_at=?",config.id,config.cutoffAt);
    if(existing) return json({snapshotId:existing.id});
    const snapshotId=crypto.randomUUID();
    const result=await transact(db,[audit(db,actor,config.id,'settlement.create',snapshotId,why,now),
      snapshot(db,{id:snapshotId,cycleId:config.id,kind:'settlement',actorId:actor.id,now,cutoff:config.cutoffAt,
        condition:'EXISTS(SELECT 1 FROM cycles WHERE id=? AND cutoff_at=?)',conditionValues:[config.id,config.cutoffAt]})]);
    if(result[1].meta.changes===0) fail('截止設定已被更改，請重新整理。',409);
    return json({snapshotId},201);
  }
  if(path==='/api/admin/settlement' && request.method==='GET') {
    const config=await cycle(db,url.searchParams.get('cycleId'));
    const snapshots=await all<Row>(db,"SELECT id,cycle_id,created_at,cutoff_at,red_score,yellow_score,rows_json FROM ranking_snapshots WHERE cycle_id=? AND kind='settlement' ORDER BY created_at DESC",config.id);
    const decisions=await all<Row>(db,'SELECT d.* FROM settlement_decisions d JOIN ranking_snapshots s ON s.id=d.snapshot_id WHERE s.cycle_id=?',config.id);
    return json({snapshots:snapshots.map(item=>({...item,rowsJson:undefined,rows:(JSON.parse(item.rowsJson as string) as RankRow[]).map(row=>{
      const decision=decisions.find(value=>value.snapshotId===item.id && value.memberId===row.memberId);
      return {...row,...(decision ? {decision:decision.decision,decisionReason:decision.reason,decidedAt:decision.decidedAt}:{})};
    })}))});
  }
  const match=path.match(/^\/api\/admin\/settlement\/([^/]+)\/decisions$/);
  if(match && request.method==='POST') {
    const data=await body(request),memberId=string(data.memberId,'成員編號',100),decision=string(data.decision,'決定'),why=reason(data),now=Date.now();
    if(decision!=='retain' && decision!=='eliminate') fail('結算決定不正確。');
    const snap=await one<Row>(db,"SELECT * FROM ranking_snapshots WHERE id=? AND kind='settlement'",match[1]);
    if(!snap) fail('找不到結算快照。',404);
    writable(await cycle(db,snap.cycleId as string));
    const row=(JSON.parse(snap.rowsJson as string) as RankRow[]).find(value=>value.memberId===memberId);
    if(!row?.pending) fail('這位學生不在該快照的待定群組中。',409);
    const statements=[audit(db,actor,snap.cycleId as string,'settlement.decision',`${match[1]}:${memberId}`,why,now),
      q(db,'INSERT INTO settlement_decisions(snapshot_id,member_id,decision,reason,actor_id,decided_at) VALUES(?,?,?,?,?,?)',match[1],memberId,decision,why,actor.id,now)];
    if(decision==='eliminate') statements.push(q(db,"UPDATE members SET active=0,session_version=session_version+1,auth_revision=auth_revision+1 WHERE id=? AND role='member' AND active=1",memberId));
    await transact(db,statements);
    return json({ok:true});
  }
  if(path==='/api/admin/audit' && request.method==='GET') {
    const config=await cycle(db,url.searchParams.get('cycleId'));
    return json({audit:await all(db,`SELECT id,actor_id,action,target_id,reason,created_at FROM club_audit WHERE cycle_id=?
      UNION ALL SELECT id,actor_id,'account.'||action action,target_id,'' reason,created_at FROM account_audit
      WHERE created_at>=? AND created_at<=? ORDER BY created_at DESC,id DESC LIMIT 500`,config.id,config.createdAt,config.archivedAt ?? Date.now())});
  }
  if(path==='/api/admin/export' && request.method==='GET') {
    const config=await cycle(db,url.searchParams.get('cycleId'));
    // Deliberate allowlist: never SELECT * from members or any authentication table.
    const results=await db.batch([
      q(db,'SELECT id,student_id,name,class_name,role,active,joined_at FROM members'),
      q(db,'SELECT id,cycle_id,title,date,opens_at,late_at,closes_at,status,opened_at,closed_at FROM classes WHERE cycle_id=?',config.id),
      q(db,'SELECT a.* FROM attendance a JOIN classes c ON c.id=a.class_id WHERE c.cycle_id=?',config.id),
      q(db,'SELECT * FROM events WHERE cycle_id=?',config.id),
      q(db,'SELECT p.* FROM participation p JOIN events e ON e.id=p.event_id WHERE e.cycle_id=?',config.id),
      q(db,'SELECT * FROM score_ledger WHERE cycle_id=? ORDER BY id',config.id),
      q(db,'SELECT * FROM ranking_snapshots WHERE cycle_id=? ORDER BY created_at',config.id),
      q(db,'SELECT d.* FROM settlement_decisions d JOIN ranking_snapshots s ON s.id=d.snapshot_id WHERE s.cycle_id=?',config.id),
      q(db,'SELECT * FROM club_audit WHERE cycle_id=? ORDER BY created_at',config.id),
      q(db,'SELECT id,actor_id,target_id,action,created_at FROM account_audit WHERE created_at>=? AND created_at<=? ORDER BY created_at',config.createdAt,config.archivedAt ?? Date.now()),
    ]);
    const names=['members','classes','attendance','events','participation','ledger','snapshots','decisions','audit','accountAudit'];
    const exported=Object.fromEntries(results.map((result,index)=>[names[index],
      names[index]==='attendance' ? (result.results as Row[]).map(attendanceView) :
      names[index]==='participation' ? (result.results as Row[]).map(participationView):result.results]));
    return new Response(JSON.stringify({exportedAt:Date.now(),cycle:config,...exported},null,2),{
      headers:{'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="club-export-${config.id.replace(/[^a-zA-Z0-9-]/g,'')}.json"`,'Cache-Control':'no-store'},
    });
  }
  return null;
}
