export type GradeLevel = 'Low' | 'Middle' | 'High';

export interface Class {
  id: string;
  name: string;
  gradeLevel: GradeLevel;
  totalCount: number;
}

export interface Student {
  id: string;
  name: string;
  seatNumber?: string;
  classId: string;
  totalCount: number;
}

export interface JumpRecord {
  id: string;
  studentId: string;
  classId: string;
  count: number;
  date: string; // YYYY-MM-DD
}

export interface AppState {
  user: any | null;
  loading: boolean;
  isAdmin: boolean;
}
