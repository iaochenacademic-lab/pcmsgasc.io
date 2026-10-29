export type AttendanceStatus = 'present' | 'late' | 'absent' | 'official_leave' | 'sick_leave' | 'personal_leave';
export type EventKind = 'lecture' | 'visit' | 'spectating' | 'competition';
export interface Cycle {
  id: string; name: string; status: 'active' | 'archived'; createdAt: number; archivedAt: number | null;
  redMode: 'automatic' | 'manual'; redScore: number | null; yellowScore: number | null; cutoffAt: number | null; redCount: number;
  scorePresent: number; scoreLate: number; scoreAbsent: number; scoreShare: number; scoreEvent: number;
}
export interface RankRow {
  memberId: string; name: string; className: string; score: number; rank: number; tieGroup: string;
  pending: boolean; qualified: boolean;
}
export const attendanceLabels: Record<AttendanceStatus,string> = {
  present:'出席', late:'遲到', absent:'缺席', official_leave:'公假', sick_leave:'病假', personal_leave:'事假',
};
export const eventLabels: Record<EventKind,string> = {lecture:'講座',visit:'參觀',spectating:'觀賽',competition:'比賽'};
export function formatPoints(points: number): string { return (points / 100).toLocaleString('zh-Hant', {maximumFractionDigits:2}); }
