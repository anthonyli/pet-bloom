export interface AdminClassSummary {
  id: string
  name: string
  owner_id: string
  owner_name: string
  owner_subject: string
  created_at: number
  active_students: number
  archived_students: number
  teacher_count: number
  teachers: { user_id: string; display_name: string; subject: string; role: 'owner' | 'admin' }[]
}

export interface AdminClassPage {
  classes: AdminClassSummary[]
  total: number
  page: number
  pageSize: number
  archiveSupported: boolean
}

export interface AdminClassDetail {
  classroom: AdminClassSummary
  archiveSupported: boolean
}
