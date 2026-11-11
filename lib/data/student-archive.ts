export const studentArchiveReasonIds = ['transfer', 'graduation', 'leave', 'other'] as const
export type StudentArchiveReason = typeof studentArchiveReasonIds[number]
export const studentArchiveReasons = {
  transfer: { zh: '转学', en: 'Transfer' },
  graduation: { zh: '毕业', en: 'Graduation' },
  leave: { zh: '休学', en: 'Leave of absence' },
  other: { zh: '其他', en: 'Other' }
} as const
export const MAX_ARCHIVE_NOTE_LENGTH = 500
