import type { Env } from './env';
import { attendanceLabels, type AttendanceStatus } from '../shared/domain';
import { all,cycle,fail,rankings } from './club-store';

type Cell = string | number;
// Text starting with these characters can run as a formula in Excel, so it gets a leading '.
const formulaStart=/^[=+\-@\t\r]/;
function cell(value:Cell) {
  if(typeof value==='number') return String(value);
  const text=formulaStart.test(value) ? `'${value}`:value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g,'""')}"`:text;
}
// UTF-8 BOM and CRLF rows so Excel opens Chinese text directly.
const csv=(header:string[],rows:Cell[][])=>'﻿'+[header,...rows].map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
const points=(value:number)=>value/100;
const time=(value:number|null)=>value===null ? '':new Date(value+8*3600_000).toISOString().slice(0,16).replace('T',' ');
const classStatus:Record<string,string>={draft:'尚未開啟',open:'已開啟',closed:'已結課',cancelled:'已取消'};
const sourceLabels:Record<string,string>={class:'課堂積分',event:'活動積分',adjustment:'分數修正'};

export async function exportCsv(request:Request,env:Env):Promise<Response> {
  const db=env.DB,url=new URL(request.url),table=url.searchParams.get('table');
  const config=await cycle(db,url.searchParams.get('cycleId'));
  let body:string;
  if(table==='rankings') {
    const ranks=await rankings(db,config.id);
    const studentIds=new Map((await all<{id:string;studentId:string}>(db,"SELECT id,student_id FROM members WHERE role='member'")).map(member=>[member.id,member.studentId]));
    body=csv(['名次','姓名','學號','班別','積分','待定','免面試達標'],ranks.rows.map(row=>
      [row.rank,row.name,studentIds.get(row.memberId) ?? '',row.className,points(row.score),row.pending ? '是':'',row.qualified ? '是':'']));
  } else if(table==='attendance') {
    const rows=await all<{date:string;title:string;classStatus:string;name:string;studentId:string;className:string;status:AttendanceStatus;shared:number;checkedInAt:number|null;note:string}>(db,
      `SELECT c.date,c.title,c.status class_status,m.name,m.student_id,m.class_name,a.status,a.shared,a.checked_in_at,a.note
      FROM attendance a JOIN classes c ON c.id=a.class_id JOIN members m ON m.id=a.member_id WHERE c.cycle_id=? ORDER BY c.opens_at,m.student_id`,config.id);
    body=csv(['日期','課次','課次狀態','姓名','學號','班別','出勤','分享','簽到時間','備註'],rows.map(row=>
      [row.date,row.title,classStatus[row.classStatus] ?? row.classStatus,row.name,row.studentId,row.className,attendanceLabels[row.status],row.shared ? '是':'否',time(row.checkedInAt),row.note]));
  } else if(table==='ledger') {
    const rows=await all<{createdAt:number;name:string;studentId:string;className:string;sourceType:string;reason:string;delta:number}>(db,
      `SELECT l.created_at,m.name,m.student_id,m.class_name,l.source_type,l.reason,l.delta
      FROM score_ledger l JOIN members m ON m.id=l.member_id WHERE l.cycle_id=? ORDER BY l.id`,config.id);
    body=csv(['時間','姓名','學號','班別','類別','說明','分數變動'],rows.map(row=>
      [time(row.createdAt),row.name,row.studentId,row.className,sourceLabels[row.sourceType] ?? row.sourceType,row.reason,points(row.delta)]));
  } else fail('匯出表格不正確。');
  return new Response(body,{headers:{'Content-Type':'text/csv; charset=utf-8',
    'Content-Disposition':`attachment; filename="club-${table}-${config.id.replace(/[^a-zA-Z0-9-]/g,'')}.csv"`,'Cache-Control':'no-store'}});
}
