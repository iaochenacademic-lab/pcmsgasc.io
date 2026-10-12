export interface Actor { id: string; studentId: string; name: string; className: string; role: 'admin' | 'member'; active: boolean; mustChangePassword: boolean; sessionVersion: number; joinedAt: number }
export interface Cycle { id: string; name: string; status: 'active' | 'archived'; createdAt: number; archivedAt: number | null; redMode: 'automatic' | 'manual'; redScore: number | null; yellowScore: number | null; cutoffAt: number | null }
export type AttendanceStatus = 'present' | 'late' | 'absent' | 'official_leave' | 'sick_leave' | 'personal_leave';
export interface Attendance { memberId: string; name?: string; className?: string; status: AttendanceStatus; shared: boolean; note: string; checkedInAt: number | null }
export interface ClubClass { id: string; cycleId: string; title: string; date: string; opensAt: number; lateAt: number; closesAt: number; status: 'draft' | 'open' | 'closed' | 'cancelled'; openedAt: number | null; closedAt: number | null; myAttendance: Attendance | null; attendance?: Attendance[] }
export type EventKind = 'lecture' | 'visit' | 'spectating' | 'competition';
export interface Participation { memberId: string; name?: string; className?: string; points: number; result: string; note: string; active: boolean }
export interface ClubEvent { id: string; cycleId: string; title: string; kind: EventKind; description: string; location: string; startsAt: number; endsAt: number | null; points: number; status: 'published' | 'cancelled'; myParticipation: Participation | null; participants?: Participation[] }
export interface LedgerEntry { id: string; cycleId: string; memberId: string; sourceType: string; sourceId: string; delta: number; reason: string; createdAt: number }
export interface RankingRow { memberId: string; name: string; className: string; score: number; rank: number; tieGroup: string | number | null; pending: boolean; qualified: boolean; decision?: 'retain' | 'eliminate'; decisionReason?: string; decidedAt?: number }
export interface Snapshot { id: string; kind: string; classId: string | null; createdAt: number; cutoffAt: number | null; cycleId?: string; redScore?: number | null; yellowScore?: number | null; rows: RankingRow[] }
export interface Rankings { cycle: Cycle; rows: RankingRow[]; redScore: number | null; yellowScore: number | null; hasScores: boolean; overlap: boolean; snapshots: Snapshot[] }
export interface Overview { cycle: Cycle; stats: { score: number; rank: number | null; memberCount: number; classCount: number; eventCount: number }; nextClass: ClubClass | null; recentLedger: LedgerEntry[]; rankings: Rankings }
export interface Audit { id: string; actorId: string; action: string; targetId: string; reason: string; createdAt: number }
