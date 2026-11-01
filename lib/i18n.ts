import type { Locale, Localized, OperationActor, Pet, Student } from './types'
import { growthProgress } from './growth'
import type { GrowthStep } from './garden-settings'
import catalog from './data/pets.json'
export const pets = catalog as Pet[]
export const petById = (id: string | null) => pets.find(pet => pet.id === id)
export const petImage = (id: string | null, level = 1) => id ? `/pets/${id}/lv${Math.min(8, Math.max(1, level))}.webp` : '/pets/egg.webp'
export const translator = (locale: Locale) => (zh: string, en: string) => locale === 'zh' ? zh : en
export const editableText = (value: Localized | undefined, locale: Locale) => value?.[locale] || value?.zh || value?.en || ''
export function localizedUserText(value: string, locale: Locale, original?: Localized): Localized {
  const text = value.trim()
  return original && text === editableText(original, locale).trim() ? original : { zh: text, en: text }
}
export const categories = ['study', 'behavior', 'health', 'other'] as const
export const categoryName = (category: string, locale: Locale) => ({ study: ['学习', 'Learning'], behavior: ['行为', 'Behavior'], health: ['健康', 'Wellbeing'], other: ['其他', 'Other'] }[category]?.[locale === 'zh' ? 0 : 1] || category)
export const operationActorName = (actor: OperationActor, locale: Locale, undone = false) => {
  const name = undone ? actor.undone_by_name : actor.actor_name
  const subject = undone ? actor.undone_by_subject : actor.actor_subject
  return name ? `${name}${subject ? ` · ${subject}` : ''}` : translator(locale)('历史记录', 'Historical record')
}
const errors: Record<string, [string, string]> = {
  profileRequired: ['请先完善教师称呼、学科与教学身份，再操作班级。', 'Complete your teacher name, subject and teaching role before managing classes.'],
  invalidInvitation: ['邀请码无效，可能已过期、停用或更新，请向班级教师索取新码。', 'This invitation is invalid, expired, disabled or replaced. Ask a class teacher for a new code.'],
  invitationUnavailable: ['邀请码已过期、停用或更新，请向班级教师索取新码。', 'This invitation has expired or been disabled or replaced. Ask a class teacher for a new code.'],
  alreadyClassOwner: ['你已经是这个班级的负责人，可以直接切换进入。', 'You already own this class. Switch to it to continue.'],
  transferRequired: ['负责人不能直接退出，请先将班级转让给已加入的教师。', 'Owners must transfer the class to an existing teacher before leaving.'],
  cannotRemoveOwner: ['不能移除班级负责人，请先完成负责人转让。', 'The class owner cannot be removed. Transfer ownership first.'],
  memberNotFound: ['这位教师已不在班级中，请重新打开教师名单。', 'This teacher no longer belongs to the class. Reopen the teacher list.'],
  cannotTransferSelf: ['你已是班级负责人，请选择另一位已加入的教师。', 'You already own this class. Choose another existing teacher.'],
  operationNotOwned: ['共同管理员只能撤回自己提交的评价或兑换，请联系班级负责人。', 'Co-admins can undo only their own evaluations or redemptions. Contact the class owner.'],
  classAccessLost: ['此班级已删除或你已不再是成员，已清除旧班级数据并切换到可访问的班级。', 'This class was deleted or you no longer belong to it. Its data has been cleared and an available class selected.'],
  unauthorized: ['请先登录，或重新登录后再试。', 'Please sign in to continue.'],
  invalidCredentials: ['用户名或密码不正确。', 'The username or password is incorrect.'],
  usernameTaken: ['这个用户名已被使用，请换一个。', 'This username is already taken.'],
  invalidInput: ['请检查输入内容。用户名需 3–30 个字符，密码至少 8 位。', 'Please check your input. Use a 3–30 character username and a password of at least 8 characters.'],
  notFound: ['找不到该数据，或你没有访问权限，请刷新后重试。', 'This item is unavailable. Please refresh and try again.'],
  petNotGraduated: ['当前宠物还未毕业，达到 8 级后可以领养新宠物。', 'Your current pet must reach level 8 before you adopt another.'],
  badgeAlreadySpent: ['这次撤回会收回已用于兑换的徽章，请先撤销对应兑换。', 'This undo would remove badges already spent. Undo the corresponding redemption first.'],
  previousPetCycle: ['这条记录属于已结束的宠物成长周期，不能撤回。', 'This record belongs to a completed pet cycle and cannot be undone.'],
  settingsChanged: ['设置已在其他窗口修改，请重新打开后再保存。', 'Settings changed in another window. Reopen this dialog before saving.'],
  petChangeDisabled: ['教师已关闭更换宠物功能。', 'Changing pets is disabled by your teacher.'],
  growthHistoryTooLarge: ['成长记录超出处理上限，未修改数据。', 'The growth history exceeds the processing limit. No data was changed.'],
  invalidSettings: ['请检查升级经验、徽章数量、提醒时长和日期范围。', 'Check experience, badge rewards, reminder duration and date ranges.'],
  invalidEvaluation: ['请选择学生和有效规则，或输入可准确保存的非零整数分数，原因最多 80 字。', 'Choose students and a valid rule, or enter a non-zero safe whole score with a reason of up to 80 characters.'],
  scoreLimitExceeded: ['分数或累计成长值过大，无法准确保存。请减小分数后重试，未修改数据。', 'The score or accumulated growth is too large to save accurately. Use a smaller score and try again. No data was changed.'],
  backgroundAlreadyOwned: ['这位学生已拥有该背景，无需再次兑换。请重新加载后前往装扮。', 'This student already owns this background. Reload and choose it in Dress up.'],
  backgroundNotOwned: ['该背景尚未兑换，或节日免费使用已结束。请重新加载并选择可用背景。', 'This background is not owned, or festival access has ended. Reload and choose an available background.'],
  invalidBackground: ['请选择有效的宠物背景。', 'Choose a valid pet background.'],
  insufficientBadges: ['可用徽章不足，升级奖励数量由成长设置决定。', 'Not enough badges. Level rewards follow your growth settings.'],
  outOfStock: ['这件商品已售罄，请选择其他奖励。', 'This reward is sold out. Please choose another.'],
  invalidImage: ['图片无效，请选择有效的单帧 PNG、JPEG 或 WebP 图片，尺寸不超过 2000 万像素。', 'Choose a valid single-frame PNG, JPEG or WebP image with no more than 20 million pixels.'],
  imageTooLarge: ['原图不能超过 2 MB，处理后的图片不能超过 256 KB，请换一张较小的图片。', 'The original image must be under 2 MB and the processed image under 256 KB. Please use a smaller image.'],
  imageStorageFull: ['当前班级的商品图片总量超过 10 MB，请移除或替换部分图片后重试。', 'Reward images for this class exceed the 10 MB storage limit. Remove or replace some images and try again.'],
  backupTooLarge: ['备份大小或记录数量超过可恢复上限（文件最大 50 MB），请减少商品图片或数据量后重试。', 'The backup exceeds the size or record limits for restoring (50 MB maximum). Reduce reward images or data and try again.'],
  stockLimitExceeded: ['库存与待退回商品数量超出系统上限，请降低库存后重试。', 'Stock plus pending returns exceeds the system limit. Reduce stock and try again.'],
  invalidBackup: ['备份数据不完整或记录不一致，未修改现有数据。', 'The backup is incomplete or inconsistent. Your current data is unchanged.'],
  fileTooLarge: ['文件超过 5 MB，请使用较小的备份。', 'This file exceeds the 5 MB limit.'],
  rateLimited: ['尝试次数过多，请 15 分钟后再试。', 'Too many attempts. Please try again in 15 minutes.'],
  forbidden: ['你没有权限执行此操作，请刷新班级权限或从应用页面重新操作。', 'You do not have permission for this action. Refresh class access or try again from the app.'],
  serverError: ['服务器暂时无法完成操作，请稍后重试。', 'The server could not complete this action. Please try again.'],
  networkError: ['连接失败，请检查网络后重试。', 'Connection failed. Please check your network and try again.']
}
export const errorMessage = (code: string, locale: Locale) => (errors[code] || errors.serverError)[locale === 'zh' ? 0 : 1]
export const growth = (exp: number, steps?: GrowthStep[]) => growthProgress(exp, steps)
export const studentPetImage = (student: Student, steps?: GrowthStep[]) => student.status?.form === 'egg' ? '/pets/egg.webp' : petImage(student.pet_id, growth(student.pet_exp, steps).level)
export const formatGrowth = (value: number, locale: Locale) => new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en', { maximumFractionDigits: 2 }).format(value)
