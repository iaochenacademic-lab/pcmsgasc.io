import type { Row } from './club-store';

// D1 stores flags as integers; every JSON boundary exposes actual booleans.
export function attendanceView<T extends Row>(row:T): T & {shared:boolean} {
  return {...row,shared:!!row.shared};
}
export function participationView<T extends Row>(row:T): T & {active:boolean} {
  return {...row,active:!!row.active};
}
