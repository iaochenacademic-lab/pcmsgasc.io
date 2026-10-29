import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleBusiness } from '../worker/business';
import type { Actor } from '../worker/env';
import { clubDatabase } from './club-db';
interface TestData {
  class: {id:string};attendance:{status:string;shared:boolean};code:string;score:number;event:{id:string;points:number;myParticipation:{active:boolean}};
  classes:{myAttendance:{note:string;shared:boolean};attendance:{shared:boolean}[]}[];cycle:{id:string};members:{name:string}[];accountAudit:object[];
  events:{myParticipation:{active:boolean};participants:{active:boolean}[]}[];participation:{active:boolean};nextClass:{myAttendance:{shared:boolean}};
  rows:{memberId:string;score:number;rank:number;pending:boolean}[];snapshots:{id:string}[];hasScores:boolean;redScore:number|null;snapshotId:string;
}

describe('club rules through HTTP and actual SQLite', () => {
  let fixture: ReturnType<typeof clubDatabase>;
  let admin: Actor;
  let student: Actor;
  const at = (time: string) => vi.setSystemTime(new Date(`2026-10-16T${time}+08:00`));
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] }); at('12:50:00');
    fixture = clubDatabase(); admin = fixture.member('admin', { role: 'admin' }); student = fixture.member('a');
  });
  afterEach(() => { fixture?.sqlite.close(); vi.useRealTimers(); });
  async function call<T = TestData>(path: string, method = 'GET', body?: object, actor = admin) {
    const request = new Request(`https://club.test${path}`, { method, ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) });
    let response: Response | null;
    try { response = await handleBusiness(request, fixture.env, actor, new URL(request.url).pathname); }
    catch (error) { if (!(error instanceof Response)) throw error; response = error; }
    expect(response).not.toBeNull();
    return { status: response!.status, data: await response!.json() as T };
  }
  async function createClass(open = true) {
    const made = await call('/api/admin/classes', 'POST', { title: '議題討論', date: '2026-10-16' });
    expect(made.status).toBe(201);
    if (open) expect((await call(`/api/admin/classes/${made.data.class.id}`, 'PATCH', { status: 'open', reason: '開始課堂' })).status).toBe(200);
    return made.data.class.id as string;
  }
  async function code(id: string) { return (await call(`/api/admin/classes/${id}/code`)).data.code; }
  async function close(id: string) { return call(`/api/admin/classes/${id}/close`, 'POST', { reason: '核對完成' }); }
  async function adjustment(memberId: string, points: number, key = crypto.randomUUID()) {
    return call('/api/admin/adjustments', 'POST', { memberId, points, idempotencyKey: key, reason: '核定修正' });
  }

  it('blocks member administration, inactive actors and mandatory password change', async () => {
    expect((await call('/api/admin/settings', 'GET', undefined, student)).status).toBe(403);
    expect((await call('/api/overview', 'GET', undefined, { ...student, active: false })).status).toBe(403);
    expect((await call('/api/overview', 'GET', undefined, { ...student, mustChangePassword: true })).status).toBe(403);
  });
  it('uses 12:55 inclusive for lateness and publishes attendance plus one share only on close', async () => {
    const b = fixture.member('b'); const id = await createClass();
    at('12:54:59');
    expect((await call('/api/checkin', 'POST', { classId: id, code: await code(id) }, student)).data.attendance.status).toBe('present');
    at('12:55:00');
    expect((await call('/api/checkin', 'POST', { classId: id, code: await code(id) }, b)).data.attendance.status).toBe('late');
    for (const [memberId, status] of [['a','present'],['b','late']]) {
      await call(`/api/admin/classes/${id}/attendance`, 'PUT', { memberId, status, shared: true, reason: '完成分享' });
    }
    expect((await call('/api/ledger', 'GET', undefined, student)).data.score).toBe(0);
    expect((await close(id)).status).toBe(200);
    expect((await call('/api/ledger', 'GET', undefined, student)).data.score).toBe(250);
    expect((await call('/api/ledger', 'GET', undefined, b)).data.score).toBe(100);
    await close(id);
    expect((await call('/api/ledger', 'GET', undefined, student)).data.score).toBe(250);
  });
  it('keeps one six-digit code valid for the whole check-in window', async () => {
    const id = await createClass(); const first = await code(id);
    expect(first).toMatch(/^\d{6}$/);
    at('13:05:00');
    expect(await code(id)).toBe(first);
    expect((await call('/api/checkin','POST',{classId:id,code:first},student)).data.attendance.status).toBe('late');
  });
  it('only reveals the code of an opened class and rejects non-numeric codes', async () => {
    const draft = await createClass(false);
    expect((await call(`/api/admin/classes/${draft}/code`)).status).toBe(409);
    const id = await createClass();
    expect((await call('/api/checkin','POST',{classId:id,code:'1.abcdef'},student)).status).toBe(400);
  });
  it('rejects wrong-code, out-of-window, wrong-class and unopened check-ins', async () => {
    const id = await createClass(); const current = await code(id);
    const wrong = current === '000000' ? '000001' : '000000';
    expect((await call('/api/checkin','POST',{classId:id,code:wrong},student)).status).toBe(400);
    const other = await createClass(false);
    expect((await call('/api/checkin','POST',{classId:other,code:await code(id)},student)).status).toBe(409);
    at('13:10:00');
    expect((await call('/api/checkin','POST',{classId:id,code:await code(id)},student)).status).toBe(409);
  });
  it('keeps 100 concurrent duplicate check-ins unique and one score per member', async () => {
    const people = [student, ...Array.from({ length: 99 }, (_, n) => fixture.member(`p${n}`))];
    const id = await createClass(); const current = await code(id);
    const results = await Promise.all(people.flatMap(actor => [1,2].map(() => call('/api/checkin','POST',{classId:id,code:current},actor))));
    expect(results.every(result => result.status === 200)).toBe(true);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) n FROM attendance').get()!.n).toBe(100);
    await close(id);
    const ranks = (await call('/api/rankings')).data;
    expect(ranks.rows).toHaveLength(100);
    expect(ranks.rows.every((row: {score:number}) => row.score === 50)).toBe(true);
  });
  it('does not penalize drafts, cancellations or students who joined after the class', async () => {
    const id = await createClass(false);
    expect((await close(id)).status).toBe(409);
    await call(`/api/admin/classes/${id}`, 'PATCH', { status:'open',reason:'開啟' });
    const newStudent = fixture.member('new', {joinedAt: Date.parse('2026-10-16T13:00:00+08:00')});
    await close(id);
    expect((await call('/api/ledger','GET',undefined,student)).data.score).toBe(-200);
    expect((await call('/api/ledger','GET',undefined,newStudent)).data.score).toBe(0);
    await call(`/api/admin/classes/${id}`,'PATCH',{status:'cancelled',reason:'因故取消'});
    expect((await call('/api/ledger','GET',undefined,student)).data.score).toBe(0);
  });
  it('distinguishes valid zero-point class work from revoked sources at the cutoff', async () => {
    const id=await createClass();
    await call(`/api/admin/classes/${id}/attendance`,'PUT',{memberId:'a',status:'absent',shared:true,reason:'補充分享已核定'});
    await close(id);
    const ranks=(await call('/api/rankings')).data;
    expect(ranks.rows[0].score).toBe(0);
    expect(ranks.hasScores).toBe(true);
    await call('/api/admin/settings','PATCH',{cutoffAt:Date.now(),reason:'設定截止'});
    at('12:51:00');
    await call(`/api/admin/classes/${id}`,'PATCH',{status:'cancelled',reason:'課次取消'});
    expect((await call('/api/rankings')).data.hasScores).toBe(false);
    const settlement=await call('/api/admin/settlement','POST',{reason:'依截止時的有效紀錄審查'});
    expect(settlement.status).toBe(201);
    expect((await call(`/api/rankings?snapshotId=${settlement.data.snapshotId}`)).data.hasScores).toBe(true);
  });
  it('corrects closed attendance without residual points and hides leave/note from other students', async () => {
    const id = await createClass(); const other = fixture.member('b');
    await close(id);
    await call(`/api/admin/classes/${id}/attendance`,'PUT',{memberId:student.id,status:'sick_leave',shared:false,note:'PRIVATE-MEDICAL-NOTE',reason:'核准補登'});
    expect((await call('/api/ledger','GET',undefined,student)).data.score).toBe(0);
    const mine = await call('/api/classes','GET',undefined,student);
    expect(mine.data.classes[0].myAttendance.note).toBe('PRIVATE-MEDICAL-NOTE');
    expect(JSON.stringify((await call('/api/classes','GET',undefined,other)).data)).not.toContain('PRIVATE-MEDICAL-NOTE');
    expect(JSON.stringify((await call('/api/rankings','GET',undefined,other)).data)).not.toContain('sick_leave');
    expect((await call('/api/ledger?memberId=a','GET',undefined,other)).status).toBe(403);
  });
  it('rolls back closing and points when snapshot persistence fails', async () => {
    const id = await createClass();
    fixture.sqlite.exec("CREATE TRIGGER break_snapshot BEFORE INSERT ON ranking_snapshots BEGIN SELECT RAISE(ABORT,'synthetic storage failure'); END");
    await expect(close(id)).rejects.toThrow('synthetic storage failure');
    expect(fixture.sqlite.prepare('SELECT status FROM classes WHERE id=?').get(id)!.status).toBe('open');
    expect(fixture.sqlite.prepare('SELECT COUNT(*) n FROM score_ledger').get()!.n).toBe(0);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) n FROM attendance').get()!.n).toBe(0);
  });
  it('enforces fixed event points and reverses corrected/revoked participation', async () => {
    const event = (await call('/api/admin/events','POST',{title:'議題講座',kind:'lecture',startsAt:Date.now(),points:900})).data.event;
    expect(event.points).toBe(50);
    const path = `/api/admin/events/${event.id}/participants`;
    await call(path,'PUT',{memberId:'a',active:true,points:999,reason:'已出席'});
    expect((await call('/api/ledger','GET',undefined,student)).data.score).toBe(50);
    await call(path,'PUT',{memberId:'a',active:false,reason:'登記錯誤'});
    expect((await call('/api/ledger','GET',undefined,student)).data.score).toBe(0);
    const competition = (await call('/api/admin/events','POST',{title:'模擬峰會',kind:'competition',startsAt:Date.now(),points:300})).data.event;
    await call(`/api/admin/events/${competition.id}/participants`,'PUT',{memberId:'a',active:true,points:450,result:'第一名',reason:'已核定'});
    await call(`/api/admin/events/${competition.id}/participants`,'PUT',{memberId:'a',active:true,points:200,result:'更正',reason:'評分更正'});
    expect((await call('/api/ledger','GET',undefined,student)).data.score).toBe(200);
    await call(`/api/admin/events/${competition.id}`,'PATCH',{status:'cancelled',reason:'比賽取消'});
    expect((await call('/api/ledger','GET',undefined,student)).data.score).toBe(0);
  });
  it('uses one adjustment for idempotent retry and rejects conflicting key reuse', async () => {
    const key=crypto.randomUUID(); await adjustment('a',50,key); await adjustment('a',50,key);
    expect((await call('/api/ledger','GET',undefined,student)).data.score).toBe(50);
    expect((await adjustment('a',100,key)).status).toBe(409);
  });
  it('keeps ties intact, excludes inactive/admin, and has no warning before effective scores', async () => {
    fixture.member('b'); fixture.member('c'); fixture.member('d'); fixture.member('inactive',{active:false});
    expect((await call('/api/rankings')).data.hasScores).toBe(false);
    await adjustment('a',100); await adjustment('b',50); await adjustment('c',50); await adjustment('d',-100);
    const ranks = (await call('/api/rankings')).data;
    expect(ranks.rows.map((row: {rank:number})=>row.rank)).toEqual([1,2,2,4]);
    expect(ranks.redScore).toBe(50);
    expect(ranks.rows.filter((row:{pending:boolean})=>row.pending).map((row:{memberId:string})=>row.memberId)).toEqual(['b','c','d']);
  });
  it('freezes cutoff scores, rejects threshold overlap and decisions never cascade', async () => {
    fixture.member('b'); fixture.member('c');
    await adjustment('a',100); await adjustment('b',50); await adjustment('c',-100);
    await call('/api/admin/settings','PATCH',{yellowScore:50,cutoffAt:Date.now(),reason:'設定結算'});
    expect((await call('/api/admin/settlement','POST',{reason:'結算'})).status).toBe(409);
    await call('/api/admin/settings','PATCH',{yellowScore:200,reason:'修正門檻'});
    at('12:51:00'); await adjustment('c',1000);
    const settlement=await call('/api/admin/settlement','POST',{reason:'截止審查'});
    expect(settlement.status).toBe(201);
    const snapshotId=settlement.data.snapshotId;
    const frozen=(await call(`/api/rankings?snapshotId=${snapshotId}`)).data;
    expect(frozen.rows.find((row:{memberId:string})=>row.memberId==='c')!.score).toBe(-100);
    expect(frozen.snapshots.some(snapshot=>snapshot.id===snapshotId)).toBe(true);
    expect((await call(`/api/admin/settlement/${snapshotId}/decisions`,'POST',{memberId:'c',decision:'eliminate',reason:'老師審核'})).status).toBe(200);
    expect(fixture.sqlite.prepare("SELECT active,session_version FROM members WHERE id='c'").get()).toMatchObject({active:0,session_version:2});
    expect((await call(`/api/rankings?snapshotId=${snapshotId}`)).data.rows).toHaveLength(3);
    expect((await call(`/api/admin/settlement/${snapshotId}/decisions`,'POST',{memberId:'a',decision:'eliminate',reason:'不可連鎖'})).status).toBe(409);
  });
  it('archives a cycle read-only, starts at zero and exports no credential fields', async () => {
    fixture.sqlite.prepare("INSERT INTO account_audit(id,actor_id,target_id,action,created_at) VALUES('test-audit','admin','a','update',?)").run(Date.now());
    const id = await createClass(); await close(id);
    const oldCycle=(await call('/api/admin/settings')).data.cycle.id;
    await call('/api/admin/cycles','POST',{name:'新學期',reason:'完成封存'});
    expect((await call('/api/ledger','GET',undefined,student)).data.score).toBe(0);
    expect((await call(`/api/ledger?cycleId=${oldCycle}`,'GET',undefined,student)).data.score).toBe(-200);
    expect((await call(`/api/admin/classes/${id}/attendance`,'PUT',{memberId:'a',status:'present',reason:'不能更動'})).status).toBe(409);
    const exported=await call(`/api/admin/export?cycleId=${oldCycle}`);
    const raw=JSON.stringify(exported.data);
    expect(raw).not.toMatch(/password|hash|session|SYNTHETIC-SECRET/i);
    expect(exported.data.members[0]).toHaveProperty('name');
    expect(exported.data.accountAudit).toHaveLength(1);
  });
  it('limits code guessing to ten attempts per member for the whole class', async () => {
    const id=await createClass(); const current=await code(id);
    const wrong=current==='000000' ? '000001':'000000';
    for(let attempt=0;attempt<10;attempt++) expect((await call('/api/checkin','POST',{classId:id,code:wrong},student)).status).toBe(400);
    expect((await call('/api/checkin','POST',{classId:id,code:current},student)).status).toBe(429);
    at('13:05:00');
    expect((await call('/api/checkin','POST',{classId:id,code:current},student)).status).toBe(429);
    expect((await call('/api/checkin','POST',{classId:id,code:current},fixture.member('b'))).status).toBe(200);
  });
  it('does not claim successful check-in when closing wins the race', async () => {
    const id=await createClass();const current=await code(id);
    const [checked,closed]=await Promise.all([call('/api/checkin','POST',{classId:id,code:current},student),close(id)]);
    expect(closed.status).toBe(200);
    const score=(await call('/api/ledger','GET',undefined,student)).data.score;
    expect(checked.status===200 ? checked.data.attendance.status : checked.status).not.toBe('absent');
    expect(checked.status===200 ? score : checked.status).toBe(checked.status===200 ? 50:409);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) n FROM score_sources').get()!.n).toBe(1);
  });
  it('keeps SQL ledger and snapshots immutable and rolls back replay after archive', async () => {
    const id=await createClass();await close(id);
    expect(()=>fixture.sqlite.exec('UPDATE score_ledger SET delta=10000')).toThrow('club_keep_history');
    expect(()=>fixture.sqlite.exec('DELETE FROM ranking_snapshots')).toThrow('club_keep_history');
    await call('/api/admin/cycles','POST',{name:'下一期',reason:'學期結束'});
    expect(()=>fixture.sqlite.exec('UPDATE score_sources SET amount=0')).toThrow('club_cycle_archived');
    expect((await close(id)).status).toBe(409);
  });
  it('rejects an in-flight correction when archiving commits between validation and its transaction', async () => {
    const id=await createClass();await close(id);
    const oldCycle=(await call('/api/admin/settings')).data.cycle.id;
    const realBatch=fixture.env.DB.batch.bind(fixture.env.DB);
    vi.spyOn(fixture.env.DB,'batch').mockImplementationOnce(async statements=>{
      await call('/api/admin/cycles','POST',{name:'切換週期',reason:'並發封存'});
      return realBatch(statements);
    });
    expect((await call(`/api/admin/classes/${id}/attendance`,'PUT',{memberId:'a',status:'present',reason:'並發更正'})).status).toBe(409);
    expect((await call(`/api/ledger?cycleId=${oldCycle}`,'GET',undefined,student)).data.score).toBe(-200);
    expect((await call('/api/ledger','GET',undefined,student)).data.score).toBe(0);
  });
  it('does not create a settlement for stale cutoff settings during a concurrent edit', async () => {
    await adjustment('a',50);
    await call('/api/admin/settings','PATCH',{cutoffAt:Date.now(),reason:'先定截止'});
    const realBatch=fixture.env.DB.batch.bind(fixture.env.DB);
    vi.spyOn(fixture.env.DB,'batch').mockImplementationOnce(async statements=>{
      await call('/api/admin/settings','PATCH',{cutoffAt:Date.now()+60_000,reason:'更正截止'});
      return realBatch(statements);
    });
    expect((await call('/api/admin/settlement','POST',{reason:'較早的結算請求'})).status).toBe(409);
    expect(fixture.sqlite.prepare("SELECT COUNT(*) n FROM ranking_snapshots WHERE kind='settlement'").get()!.n).toBe(0);
  });
  it('preserves closed scores when closing wins against a stale cancellation', async () => {
    const id=await createClass();
    await call('/api/checkin','POST',{classId:id,code:await code(id)},student);
    const realBatch=fixture.env.DB.batch.bind(fixture.env.DB);
    vi.spyOn(fixture.env.DB,'batch').mockImplementationOnce(async statements=>{
      expect((await close(id)).status).toBe(200);
      return realBatch(statements);
    });
    expect((await call(`/api/admin/classes/${id}`,'PATCH',{status:'cancelled',reason:'STALE-CANCEL'})).status).toBe(409);
    expect(fixture.sqlite.prepare('SELECT status FROM classes WHERE id=?').get(id)!.status).toBe('closed');
    expect((await call('/api/ledger','GET',undefined,student)).data.score).toBe(50);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) n FROM ranking_snapshots WHERE class_id=?').get(id)!.n).toBe(1);
    expect(fixture.sqlite.prepare("SELECT COUNT(*) n FROM club_audit WHERE reason='STALE-CANCEL'").get()!.n).toBe(0);
  });
  it('does not replace cancellation reasons or add a snapshot after another cancellation wins', async () => {
    const id=await createClass();await close(id);
    const realBatch=fixture.env.DB.batch.bind(fixture.env.DB);
    vi.spyOn(fixture.env.DB,'batch').mockImplementationOnce(async statements=>{
      expect((await call(`/api/admin/classes/${id}`,'PATCH',{status:'cancelled',reason:'FIRST-CANCEL'})).status).toBe(200);
      return realBatch(statements);
    });
    expect((await call(`/api/admin/classes/${id}`,'PATCH',{status:'cancelled',reason:'STALE-CANCEL'})).status).toBe(409);
    expect(fixture.sqlite.prepare("SELECT reason,effective FROM score_sources WHERE source_type='class' AND source_id=?").get(id)).toMatchObject({reason:'FIRST-CANCEL',effective:0});
    expect(fixture.sqlite.prepare('SELECT COUNT(*) n FROM ranking_snapshots WHERE class_id=?').get(id)!.n).toBe(2);
    expect(fixture.sqlite.prepare("SELECT COUNT(*) n FROM club_audit WHERE reason='STALE-CANCEL'").get()!.n).toBe(0);
  });
  it('does not let a stale event cancellation overwrite the winning audit reason', async () => {
    const event=(await call('/api/admin/events','POST',{title:'測試活動',kind:'lecture',startsAt:Date.now()})).data.event;
    await call(`/api/admin/events/${event.id}/participants`,'PUT',{memberId:'a',active:true,reason:'核定參與'});
    const realBatch=fixture.env.DB.batch.bind(fixture.env.DB);
    vi.spyOn(fixture.env.DB,'batch').mockImplementationOnce(async statements=>{
      expect((await call(`/api/admin/events/${event.id}`,'PATCH',{status:'cancelled',reason:'FIRST-CANCEL'})).status).toBe(200);
      return realBatch(statements);
    });
    expect((await call(`/api/admin/events/${event.id}`,'PATCH',{status:'cancelled',reason:'STALE-CANCEL'})).status).toBe(409);
    expect(fixture.sqlite.prepare('SELECT active,reason FROM participation WHERE event_id=?').get(event.id)).toMatchObject({active:0,reason:'FIRST-CANCEL'});
    expect((await call('/api/ledger','GET',undefined,student)).data.score).toBe(0);
    expect(fixture.sqlite.prepare("SELECT COUNT(*) n FROM club_audit WHERE reason='STALE-CANCEL'").get()!.n).toBe(0);
  });
  it('does not publish or record successful participation if cancellation wins first', async () => {
    const event=(await call('/api/admin/events','POST',{title:'測試活動',kind:'lecture',startsAt:Date.now()})).data.event;
    const realBatch=fixture.env.DB.batch.bind(fixture.env.DB);
    vi.spyOn(fixture.env.DB,'batch').mockImplementationOnce(async statements=>{
      await call(`/api/admin/events/${event.id}`,'PATCH',{status:'cancelled',reason:'先取消活動'});
      return realBatch(statements);
    });
    expect((await call(`/api/admin/events/${event.id}/participants`,'PUT',{memberId:'a',active:true,reason:'STALE-PARTICIPATION'})).status).toBe(409);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) n FROM participation WHERE event_id=?').get(event.id)!.n).toBe(0);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) n FROM score_sources WHERE source_id=?').get(event.id)!.n).toBe(0);
    expect(fixture.sqlite.prepare("SELECT COUNT(*) n FROM club_audit WHERE reason='STALE-PARTICIPATION'").get()!.n).toBe(0);
  });
  it('archives every score committed before its transaction even when the request began earlier', async () => {
    await adjustment('a',100);
    const oldCycle=(await call('/api/admin/settings')).data.cycle.id;
    const realBatch=fixture.env.DB.batch.bind(fixture.env.DB);
    vi.spyOn(fixture.env.DB,'batch').mockImplementationOnce(async statements=>{
      at('12:51:00');
      await adjustment('a',50);
      return realBatch(statements);
    });
    expect((await call('/api/admin/cycles','POST',{name:'封存一致性',reason:'結束週期'})).status).toBe(201);
    expect((await call(`/api/ledger?cycleId=${oldCycle}`,'GET',undefined,student)).data.score).toBe(150);
    expect((await call(`/api/rankings?cycleId=${oldCycle}`)).data.rows[0].score).toBe(150);
  });
  it('publishes a class snapshot from all committed sources at closing, independent of request start time', async () => {
    const id=await createClass();
    const realBatch=fixture.env.DB.batch.bind(fixture.env.DB);
    vi.spyOn(fixture.env.DB,'batch').mockImplementationOnce(async statements=>{
      at('12:51:00');
      await adjustment('a',50);
      return realBatch(statements);
    });
    const result=await close(id);
    expect(result.status).toBe(200);
    expect((await call('/api/ledger','GET',undefined,student)).data.score).toBe(-150);
    expect((await call(`/api/rankings?snapshotId=${result.data.snapshotId}`)).data.rows[0].score).toBe(-150);
  });
  it('rolls back a conditional update if the database revoked its administrator before commit', async () => {
    fixture.member('backup-admin',{role:'admin'});
    const id=await createClass();await close(id);
    const realBatch=fixture.env.DB.batch.bind(fixture.env.DB);
    vi.spyOn(fixture.env.DB,'batch').mockImplementationOnce(async statements=>{
      fixture.sqlite.prepare("UPDATE members SET active=0,session_version=session_version+1 WHERE id='admin'").run();
      return realBatch(statements);
    });
    expect((await call(`/api/admin/classes/${id}`,'PATCH',{status:'cancelled',reason:'管理員已被停用'})).status).toBe(403);
    expect(fixture.sqlite.prepare('SELECT status FROM classes WHERE id=?').get(id)!.status).toBe('closed');
    expect(fixture.sqlite.prepare('SELECT SUM(delta) score FROM score_ledger').get()!.score).toBe(-200);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) n FROM ranking_snapshots WHERE class_id=?').get(id)!.n).toBe(1);
  });
  it.each([false,true])('returns actual booleans for shared attendance and participation active=%s across API responses', async flag => {
    const id=await createClass();
    const recorded=await call(`/api/admin/classes/${id}/attendance`,'PUT',{memberId:'a',status:'present',shared:flag,reason:'核對分享'});
    expect(recorded.data.attendance.shared).toBe(flag);
    expect((await call('/api/classes','GET',undefined,student)).data.classes[0].myAttendance.shared).toBe(flag);
    expect((await call('/api/admin/classes')).data.classes[0].attendance[0].shared).toBe(flag);
    expect((await call('/api/overview','GET',undefined,student)).data.nextClass.myAttendance.shared).toBe(flag);
    expect((await call('/api/checkin','POST',{classId:id,code:await code(id)},student)).data.attendance.shared).toBe(flag);

    const event=(await call('/api/admin/events','POST',{title:'布林契約測試',kind:'lecture',startsAt:Date.now()})).data.event;
    expect((await call(`/api/events/${event.id}`,'GET',undefined,student)).data.event.myParticipation).toBeNull();
    const participated=await call(`/api/admin/events/${event.id}/participants`,'PUT',{memberId:'a',active:flag,reason:'核對參與'});
    expect(participated.data.participation.active).toBe(flag);
    expect((await call('/api/events','GET',undefined,student)).data.events[0].myParticipation.active).toBe(flag);
    expect((await call('/api/admin/events')).data.events[0].participants[0].active).toBe(flag);
    expect((await call(`/api/events/${event.id}`,'GET',undefined,student)).data.event.myParticipation.active).toBe(flag);
    const exported=await call<{attendance:{shared:boolean}[];participation:{active:boolean}[]}>('/api/admin/export');
    expect(exported.data.attendance[0].shared).toBe(flag);
    expect(exported.data.participation[0].active).toBe(flag);
  });
  it('bulk-records attendance status, keeps existing sharing and republishes a closed class', async () => {
    fixture.member('b'); const c = fixture.member('c'); const id = await createClass();
    const path = `/api/admin/classes/${id}/attendance`;
    await call(path,'PUT',{memberId:'a',status:'present',shared:true,reason:'完成分享'});
    const bulk = await call<{updated:number}>(path,'PUT',{memberIds:['a','b','a'],status:'sick_leave',note:'集體病假',reason:'批量請假'});
    expect(bulk).toEqual({status:200,data:{updated:2}});
    const rows = fixture.sqlite.prepare('SELECT member_id,status,shared,note FROM attendance WHERE class_id=? ORDER BY member_id').all(id);
    expect(rows).toEqual([{member_id:'a',status:'sick_leave',shared:1,note:'集體病假'},{member_id:'b',status:'sick_leave',shared:0,note:'集體病假'}]);
    expect((await close(id)).status).toBe(200);
    expect((await call('/api/ledger','GET',undefined,student)).data.score).toBe(200);
    expect((await call('/api/ledger','GET',undefined,c)).data.score).toBe(-200);
    expect((await call(path,'PUT',{memberIds:['c'],status:'official_leave',reason:'補登公假'})).status).toBe(200);
    expect((await call('/api/ledger','GET',undefined,c)).data.score).toBe(0);
    expect(fixture.sqlite.prepare("SELECT note FROM attendance WHERE class_id=? AND member_id='c'").get(id)!.note).toBe('');
    expect(fixture.sqlite.prepare("SELECT COUNT(*) n FROM club_audit WHERE action='class.attendance'").get()!.n).toBe(4);
  });
  it('rejects invalid bulk attendance without writing anything', async () => {
    const late = fixture.member('late',{joinedAt:Date.parse('2026-10-20T00:00:00+08:00')}); const id = await createClass();
    const path = `/api/admin/classes/${id}/attendance`;
    expect((await call(path,'PUT',{memberIds:[],status:'present',reason:'批量補登'})).status).toBe(400);
    expect((await call(path,'PUT',{memberIds:['a','missing'],status:'present',reason:'批量補登'})).status).toBe(404);
    expect((await call(path,'PUT',{memberIds:['a','admin'],status:'present',reason:'批量補登'})).status).toBe(404);
    expect((await call(path,'PUT',{memberIds:['a',late.id],status:'present',reason:'批量補登'})).status).toBe(409);
    expect((await call(path,'PUT',{memberIds:['a'],status:'unknown',reason:'批量補登'})).status).toBe(400);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) n FROM attendance').get()!.n).toBe(0);
  });
  it('bulk-registers event participation without overwriting existing entries', async () => {
    fixture.member('b'); fixture.member('c');
    const event = (await call('/api/admin/events','POST',{title:'模擬峰會',kind:'competition',startsAt:Date.now(),points:300})).data.event;
    const path = `/api/admin/events/${event.id}/participants`;
    await call(path,'PUT',{memberId:'a',active:true,points:500,result:'冠軍',reason:'登記成績'});
    await call(path,'PUT',{memberId:'b',active:true,points:300,reason:'登記參與'});
    await call(path,'PUT',{memberId:'b',active:false,points:300,reason:'誤登撤銷'});
    const bulk = await call<{added:number}>(path,'PUT',{memberIds:['a','b','c'],points:200,reason:'批量登記'});
    expect(bulk).toEqual({status:200,data:{added:2}});
    const rows = fixture.sqlite.prepare('SELECT member_id,points,result,active FROM participation WHERE event_id=? ORDER BY member_id').all(event.id);
    expect(rows).toEqual([{member_id:'a',points:500,result:'冠軍',active:1},{member_id:'b',points:200,result:'',active:1},{member_id:'c',points:200,result:'',active:1}]);
    const scores = (await call('/api/rankings')).data.rows.map(row => [row.memberId,row.score]).sort();
    expect(scores).toEqual([['a',500],['b',200],['c',200]]);
    expect(fixture.sqlite.prepare("SELECT COUNT(*) n FROM club_audit WHERE action='event.participation'").get()!.n).toBe(5);
    expect((await call(path,'PUT',{memberIds:['a'],points:200,reason:'重送'})).data).toEqual({added:0});
  });
  it('fixes non-competition bulk points and refuses cancelled events', async () => {
    const event = (await call('/api/admin/events','POST',{title:'議題講座',kind:'lecture',startsAt:Date.now()})).data.event;
    const path = `/api/admin/events/${event.id}/participants`;
    expect((await call(path,'PUT',{memberIds:['a'],points:999,reason:'批量登記'})).data).toEqual({added:1});
    expect((await call('/api/ledger','GET',undefined,student)).data.score).toBe(50);
    await call(`/api/admin/events/${event.id}`,'PATCH',{status:'cancelled',reason:'活動取消'});
    expect((await call(path,'PUT',{memberIds:['a'],reason:'批量登記'})).status).toBe(409);
  });
});
