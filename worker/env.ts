export interface Actor {
  id: string;
  studentId: string;
  name: string;
  className: string;
  role: 'admin' | 'member';
  active: boolean;
  mustChangePassword: boolean;
  sessionVersion: number;
  joinedAt: number;
}
export type Env = Cloudflare.Env;
