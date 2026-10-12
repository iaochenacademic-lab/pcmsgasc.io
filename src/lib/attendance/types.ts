import type { SessionPayload } from "@/lib/auth/types";

export type AttendanceStatus = "present" | "late" | "excused" | "absent";
export type EffectiveStatus = AttendanceStatus | "pending";
export type MeetingPhase = "upcoming" | "open" | "closed" | "cancelled";
export type LeaveType = "personal" | "sick" | "official";
export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";
export type LeaveDecision = "approved" | "rejected";

export interface Meeting {
  id: string;
  title: string;
  location: string | null;
  startsAt: string;
  endsAt: string;
  lateAfterMinutes: number;
  cancelledAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface TeacherMeeting extends Meeting {
  checkinCode: string;
}

export interface MeetingFields {
  title: string;
  location: string | null;
  startsAt: string;
  endsAt: string;
  lateAfterMinutes: number;
}

export interface CreateMeetingData extends MeetingFields {
  checkinCode: string;
}

export type ManageMeetingAction =
  | { action: "update"; data: MeetingFields }
  | { action: "cancel" }
  | { action: "regenerate_code"; checkinCode: string };

export interface AttendanceRecord {
  id: string;
  meetingId: string;
  userId: string;
  status: AttendanceStatus;
  checkedInAt: string | null;
  source: "self" | "teacher";
  note: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeaveRequest {
  id: string;
  meetingId: string;
  userId: string;
  leaveType: LeaveType;
  reason: string;
  status: LeaveStatus;
  reviewedBy: string | null;
  reviewComment: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RosterMember {
  id: string;
  username: string;
  name: string;
  createdAt: string;
}

export type AttendanceFailureReason =
  | "not_found"
  | "forbidden"
  | "session_expired"
  | "invalid_input"
  | "not_open"
  | "not_editable"
  | "closed"
  | "cancelled"
  | "already_recorded"
  | "duplicate"
  | "already_reviewed";

export type AttendanceMutationResult =
  | { result: "created"; meetingId: string }
  | { result: "submitted"; leaveId: string; lateSubmission: boolean }
  | { result: "present" | "late" | "wrong_code" | "too_many_attempts"; remainingAttempts: number | null }
  | { result: "updated" | "meeting_cancelled" | "code_regenerated" | "saved" | "restored" | "reviewed" | "leave_cancelled" }
  | { result: AttendanceFailureReason };

export interface AttendanceRepository {
  createMeeting(actor: SessionPayload, data: CreateMeetingData): Promise<AttendanceMutationResult>;
  manageMeeting(actor: SessionPayload, meetingId: string, action: ManageMeetingAction): Promise<AttendanceMutationResult>;
  setAttendance(actor: SessionPayload, meetingId: string, userId: string, status: AttendanceStatus | null, note: string | null): Promise<AttendanceMutationResult>;
  checkIn(actor: SessionPayload, meetingId: string, code: string): Promise<AttendanceMutationResult>;
  submitLeave(actor: SessionPayload, meetingId: string, leaveType: LeaveType, reason: string): Promise<AttendanceMutationResult>;
  reviewLeave(actor: SessionPayload, leaveId: string, decision: LeaveDecision, comment: string | null): Promise<AttendanceMutationResult>;
  cancelLeave(actor: SessionPayload, leaveId: string): Promise<AttendanceMutationResult>;
  listTeacherMeetings(): Promise<TeacherMeeting[]>;
  listMemberMeetings(): Promise<Meeting[]>;
  listActiveMembers(): Promise<RosterMember[]>;
  listAttendance(meetingIds: string[], userId?: string): Promise<AttendanceRecord[]>;
  listLeaves(meetingIds?: string[], userId?: string): Promise<LeaveRequest[]>;
}

export interface AttendanceSummary {
  present: number;
  late: number;
  excused: number;
  absent: number;
  pending: number;
  total: number;
  attendanceRate: number | null;
}

export interface TeacherMeetingOverview {
  meeting: TeacherMeeting;
  phase: MeetingPhase;
  checkedInCount: number;
  rosterCount: number;
  summary: AttendanceSummary;
}

export interface LeaveView extends LeaveRequest {
  memberName: string;
  meetingTitle: string;
  meetingStartsAt: string;
  lateSubmission: boolean;
}

export interface TeacherDashboard {
  openMeetings: TeacherMeetingOverview[];
  upcomingMeetings: TeacherMeetingOverview[];
  recentMeetings: TeacherMeetingOverview[];
  pendingLeaves: LeaveView[];
}

export interface MeetingRosterEntry {
  member: RosterMember;
  status: EffectiveStatus;
  checkedInAt: string | null;
  leave: LeaveRequest | null;
  note: string | null;
}

export interface MeetingDetail {
  meeting: TeacherMeeting;
  phase: MeetingPhase;
  summary: AttendanceSummary;
  roster: MeetingRosterEntry[];
}

export interface MemberMeetingView {
  meeting: Meeting;
  phase: MeetingPhase;
  status: EffectiveStatus;
  leave: LeaveRequest | null;
  attendance: AttendanceRecord | null;
}

export interface MemberDashboard {
  openMeetings: MemberMeetingView[];
  upcomingMeetings: MemberMeetingView[];
  recentRecords: MemberMeetingView[];
  leaveRequests: LeaveView[];
  summary: AttendanceSummary;
}

