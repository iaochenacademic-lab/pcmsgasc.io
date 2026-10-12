import type { Actor, Env } from './env';
import type { Cycle, RankRow } from '../shared/domain';

export type Row = Record<string, unknown>;
export type Db = Env['DB'];
export function json(value: unknown, status = 200) { return Response.json(value,{status}); }
export function fail(message: string, status = 400): never { throw json({error:message},status); }
export async function body(request: Request): Promise<Row> {
  let value: unknown;
  try { value = await request.json(); } catch { fail('請提交有效的 JSON 資料。'); }
  if (!value || typeof value!=='object' || Array.isArray(value)) fail('資料格式不正確。');
  return value as Row;
}
export function string(value: unknown, label: string, max = 200, optional = false): string {
  if (optional && (value===undefined || value===null)) return '';
  if (typeof value!=='string' || (!optional && !value.trim()) || value.length>max) fail(`${label}格式不正確。`);
  return value.trim();
}
export function integer(value: unknown, label: string, min = -1_000_000, max = 1_000_000): number {
  if (typeof value!=='number' || !Number.isSafeInteger(value) || value<min || value>max) fail(`${label}必須是範圍內的整數。`);
  return value;
}
export function timestamp(value: unknown, label: string): number { return integer(value,label,0,8_640_000_000_000_000); }
export function reason(data: Row): string { return string(data.reason,'操作原因',1000); }
export function camel<T>(value: Row): T {
  return Object.fromEntries(Object.entries(value).map(([key,item])=>[key.replace(/_([a-z])/g,(_match,letter:string)=>letter.toUpperCase()),item])) as T;
}
export const q = (db:Db,sql:string,...values:unknown[]) => db.prepare(sql).bind(...values);
export async function all<T = Row>(db:Db,sql:string,...values:unknown[]): Promise<T[]> {
  const result = await q(db,sql,...values).all<Row>(); return result.results.map(row=>camel<T>(row));
}
export async function one<T = Row>(db:Db,sql:string,...values:unknown[]): Promise<T | null> {
  const result=await q(db,sql,...values).first<Row>(); return result ? camel<T>(result):null;
}
export async function cycle(db:Db,id?:string | null): Promise<Cycle> {
  const value=await one<Cycle>(db,`SELECT * FROM cycles WHERE ${id ? 'id=?':"status='active'"}`, ...(id ? [id]:[]));
  if (!value) fail('找不到計分週期。',404); return value;
}
export function writable(value:Cycle) { if(value.status!=='active') fail('這個週期已封存，只能查閱。',409); }
export async function studentMember(db:Db,id:unknown) {
  const memberId=string(id,'成員編號',100);
  const member=await one<{id:string;joinedAt:number}>(db,"SELECT id,joined_at FROM members WHERE id=? AND role='member'",memberId);
  if(!member) fail('找不到學生。',404); return member;
}
export function audit(db:Db,actor:Actor,cycleId:string,action:string,targetId:string,why:string,now=Date.now()) {
  return q(db,'INSERT INTO club_audit(id,cycle_id,actor_id,action,target_id,reason,created_at) VALUES(?,?,?,?,?,?,?)',
    crypto.randomUUID(),cycleId,actor.id,action,targetId,why,now);
}
// Must immediately follow its conditional mutation in the same D1 batch.
// SQLite changes() excludes trigger writes. The unique audit ID then gates all
// dependent writes without mistaking another request's matching state for success.
// Audit authorization/cycle triggers still abort and roll back the entire batch.
export function auditAfterChange(db:Db,actor:Actor,cycleId:string,action:string,targetId:string,why:string,now:number,changeId:string) {
  return q(db,`INSERT INTO club_audit(id,cycle_id,actor_id,action,target_id,reason,created_at)
    SELECT ?,?,?,?,?,?,? WHERE changes()>0`,changeId,cycleId,actor.id,action,targetId,why,now);
}
export async function transact(db:Db,statements:D1PreparedStatement[]) {
  try { return await db.batch(statements); }
  catch(error) {
    const message=error instanceof Error ? error.message : '';
    if(message.includes('club_cycle_archived')) fail('這個週期已封存，只能查閱。',409);
    if(message.includes('club_admin_required')) fail('需要有效管理員帳號。',403);
    if(message.includes('club_class_unavailable')) fail('課次已取消或封存。',409);
    if(message.includes('club_threshold_overlap')) fail('紅黃線重疊，請先修正門檻再結算。',409);
    if(message.includes('club_no_scores')) fail('尚無有效計分紀錄，不可進行資格結算。',409);
    if(message.includes('UNIQUE constraint failed')) fail('資料已變更或已處理，請重新整理。',409);
    throw error;
  }
}

// Snapshot rows and thresholds are calculated within the same transaction as scores.
// No application-side read/modify/write gap can produce a partially published ranking.
export function snapshot(db:Db,args:{id:string;cycleId:string;classId?:string;kind:'class'|'settlement'|'archive';actorId:string;now:number;cutoff:number;condition?:string;conditionValues?:unknown[]}) {
  // Only settlement asks a historical question. Class/archive snapshots must see
  // every source committed before this batch, even if its request started earlier.
  const historical=args.kind==='settlement';
  const totals=historical ? `SELECT m.id member_id,m.name,m.class_name,COALESCE(SUM(l.delta),0) score
    FROM members m LEFT JOIN score_ledger l ON l.member_id=m.id AND l.cycle_id=? AND l.created_at<=?
    WHERE m.active=1 AND m.role='member' AND m.joined_at<=? GROUP BY m.id` :
    `SELECT m.id member_id,m.name,m.class_name,COALESCE(SUM(s.amount),0) score
    FROM members m LEFT JOIN score_sources s ON s.member_id=m.id AND s.cycle_id=?
    WHERE m.active=1 AND m.role='member' GROUP BY m.id`;
  const sourceStates=historical ? `SELECT member_id,effective,ROW_NUMBER() OVER(PARTITION BY member_id,source_type,source_id ORDER BY id DESC) version
    FROM score_ledger WHERE cycle_id=? AND created_at<=?` :
    `SELECT member_id,effective,1 version FROM score_sources WHERE cycle_id=?`;
  return q(db,`WITH
    totals AS (${totals}),
    scores AS (SELECT *,RANK() OVER(ORDER BY score DESC) rank FROM totals),
    source_states AS (${sourceStates}),
    limits AS (
      SELECT CASE WHEN red_mode='manual' THEN red_score ELSE
        COALESCE((SELECT score FROM totals ORDER BY score ASC,member_id LIMIT 1 OFFSET 1),(SELECT MIN(score) FROM totals)) END red,
        yellow_score yellow,
        EXISTS(SELECT 1 FROM source_states WHERE version=1 AND effective=1 AND member_id IN(SELECT member_id FROM totals)) has
      FROM cycles WHERE id=?
    )
    INSERT INTO ranking_snapshots(id,cycle_id,class_id,kind,created_at,cutoff_at,red_score,yellow_score,has_scores,overlap,rows_json,actor_id)
    SELECT ?,?,?,?,?,?,red,yellow,has,CASE WHEN red IS NOT NULL AND yellow IS NOT NULL AND red>=yellow THEN 1 ELSE 0 END,
      (SELECT COALESCE(json_group_array(json_object('memberId',member_id,'name',name,'className',class_name,'score',score,
        'rank',rank,'tieGroup','score:'||score,'pending',json(CASE WHEN has AND score<=red THEN 'true' ELSE 'false' END),
        'qualified',json(CASE WHEN has AND yellow IS NOT NULL AND score>=yellow THEN 'true' ELSE 'false' END))),'[]')
       FROM (SELECT * FROM scores ORDER BY score DESC,member_id)),?
    FROM limits WHERE ${args.condition || '1=1'}`,
    ...(historical ? [args.cycleId,args.cutoff,args.cutoff,args.cycleId,args.cutoff]:[args.cycleId,args.cycleId]),args.cycleId,
    args.id,args.cycleId,args.classId || null,args.kind,args.now,args.cutoff,args.actorId,...(args.conditionValues || []));
}
export function rank(rows:{memberId:string;name:string;className:string;score:number}[],config:Cycle,hasScores:boolean) {
  const sorted=[...rows].sort((a,b)=>b.score-a.score || a.memberId.localeCompare(b.memberId));
  const bottom=[...sorted].reverse();
  const redScore=config.redMode==='manual' ? config.redScore : bottom[Math.min(1,bottom.length-1)]?.score ?? null;
  const overlap=redScore!==null && config.yellowScore!==null && redScore>=config.yellowScore;
  let rankNumber=0;
  const ranked:RankRow[]=sorted.map((row,index)=>{
    if(index===0 || sorted[index-1].score!==row.score) rankNumber=index+1;
    return {...row,rank:rankNumber,tieGroup:`score:${row.score}`,pending:hasScores && redScore!==null && row.score<=redScore,
      qualified:hasScores && config.yellowScore!==null && row.score>=config.yellowScore};
  });
  return {rows:ranked,redScore,yellowScore:config.yellowScore,hasScores,overlap};
}
export interface Rankings {
  cycle:Cycle;rows:RankRow[];redScore:number|null;yellowScore:number|null;hasScores:boolean;overlap:boolean;snapshots:Row[];snapshotId?:string;
}
export async function rankings(db:Db,cycleId?:string|null,snapshotId?:string|null): Promise<Rankings> {
  if(snapshotId) {
    const snap=await one<Row>(db,'SELECT * FROM ranking_snapshots WHERE id=?',snapshotId);
    if(!snap) fail('找不到排行快照。',404);
    const snapshots=await all<Row>(db,'SELECT id,kind,class_id,created_at,cutoff_at FROM ranking_snapshots WHERE cycle_id=? ORDER BY created_at DESC LIMIT 100',snap.cycleId);
    return {cycle:await cycle(db,snap.cycleId as string),snapshotId:snap.id as string,rows:JSON.parse(snap.rowsJson as string) as RankRow[],
      redScore:snap.redScore as number|null,yellowScore:snap.yellowScore as number|null,hasScores:!!snap.hasScores,overlap:!!snap.overlap,snapshots};
  }
  const config=await cycle(db,cycleId);
  if(config.status==='archived') {
    const archive=await one<{id:string}>(db,"SELECT id FROM ranking_snapshots WHERE cycle_id=? AND kind='archive' ORDER BY created_at DESC LIMIT 1",config.id);
    if(archive) return rankings(db,config.id,archive.id);
  }
  const result=await db.batch([
    q(db,'SELECT * FROM cycles WHERE id=?',config.id),
    q(db,`SELECT m.id member_id,m.name,m.class_name,COALESCE(SUM(s.amount),0) score FROM members m
      LEFT JOIN score_sources s ON s.member_id=m.id AND s.cycle_id=? WHERE m.active=1 AND m.role='member' GROUP BY m.id`,config.id),
    q(db,"SELECT EXISTS(SELECT 1 FROM score_sources s JOIN members m ON m.id=s.member_id WHERE s.cycle_id=? AND s.effective=1 AND m.active=1 AND m.role='member') has",config.id),
    q(db,'SELECT id,kind,class_id,created_at,cutoff_at FROM ranking_snapshots WHERE cycle_id=? ORDER BY created_at DESC LIMIT 100',config.id),
  ]);
  const fresh=camel<Cycle>(result[0].results[0] as Row);
  const rows=(result[1].results as Row[]).map(row=>camel<{memberId:string;name:string;className:string;score:number}>(row));
  return {cycle:fresh,...rank(rows,fresh,!!(result[2].results[0] as Row).has),snapshots:(result[3].results as Row[]).map(row=>camel<Row>(row))};
}
