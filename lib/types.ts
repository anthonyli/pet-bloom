import type { ShopCategory, ShopIconId } from './shop'
import type { SettingsVersion } from './garden-settings'
import type { PetStatus } from './pet-status'
export type Locale = 'zh' | 'en'
export type Localized = { zh: string; en: string }
export type Category = 'study' | 'behavior' | 'health' | 'other'
export type PetCollection = 'fairy' | 'shanhai' | 'anime' | 'cute' | 'zodiac'
export type PetKind = 'dog' | 'cat' | 'bird' | 'small' | 'farm' | 'wild' | 'mythical'
export interface Pet {
  id: string; name: Localized; description: Localized;
  sourceUrl?: string;
  collections?: PetCollection[]; kind?: PetKind;
  zodiac?: { order: number; name: Localized }; chapter?: Localized
}
export interface Rule { id: string; name: Localized; points: number; category: Category; custom?: boolean }
export type TeachingRole = 'homeroom' | 'subject' | 'other'
export interface Classroom { id: string; name: string; created_at: number; owner_id: string; role: 'owner' | 'admin' }
export interface ClassTeacher { user_id: string; display_name: string; subject: string; teaching_role: TeachingRole | null; role: 'owner' | 'admin'; joined_at: number }
export interface ClassTeachers { teachers: ClassTeacher[]; invitation: { created_at: number; expires_at: number } | null }
export interface InvitationPreview { id: string; name: string; owner_name: string; already_member: boolean; expires_at: number }
export interface OperationActor { actor_user_id: string | null; actor_name: string; actor_subject: string; undone_by_user_id: string | null; undone_by_name: string; undone_by_subject: string; can_undo: boolean }
export interface Student {
  id: string; class_id: string; name: string; student_no: string;
  points: number; pet_id: string | null; pet_exp: number; generation: number;
  badge_count: number; spent_badges: number; status?: PetStatus;
  background_id: string | null; owned_background_ids: string[];
  festival_background_id: string | null; festival_background_expires_at: number | null
}
export interface Evaluation extends OperationActor {
  id: string; batch_id: string; student_id: string; student_name: string;
  points: number; reason: Localized; category: Category; created_at: number; undone: number
}
export interface Badge { id: string; student_id: string; generation: number; level: number; pet_id: string; earned_at: number; amount: number; active: number; source_event: string | null }
export interface ShopItem { id: string; name: Localized; description: Localized; category: ShopCategory; icon: ShopIconId; image: string | null; cost: number; stock: number; active: number; background_id: string | null }
export interface Redemption extends OperationActor { id: string; student_id: string; student_name: string; item_id: string | null; item_name: Localized; cost: number; created_at: number; undone: number; stock_deducted: number; background_id: string | null }
export interface ScoreEffect { id: string; delta: number; key: string }
export interface Upgrade { id: string; name: string; level: number; previousLevel: number; petId: string; pet: string; badgesEarned: number; earnedLevels: number[] }
export interface User { id: string; username: string; display_name: string; subject: string; teaching_role: TeachingRole | null; profile_complete: boolean }
export interface FestivalBackgroundOffer { background_id: string; expires_at: number }
export interface FestivalBackgroundAvailability { server_now: number; valid_until: number; time_zone: string; backgrounds: FestivalBackgroundOffer[]; unsupported_background_ids: string[] }
export interface Snapshot { user: User; settings: SettingsVersion; classes: Classroom[]; students: Student[]; badges: Badge[]; rules: Rule[]; records: Evaluation[]; items: ShopItem[]; redemptions: Redemption[]; festival_backgrounds: FestivalBackgroundAvailability }
