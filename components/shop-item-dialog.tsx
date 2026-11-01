'use client'
import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { AlertCircle, Check, ImagePlus, Save, ShoppingBag, Upload, X } from 'lucide-react'
import { Button, Field, Input, Textarea, cn } from '@/components/ui'
import { editableText, localizedUserText, translator } from '@/lib/i18n'
import { MAX_ITEM_IMAGE_BYTES, shopCategories, type ShopCategory, type ShopIconId } from '@/lib/shop'
import type { Locale, ShopItem } from '@/lib/types'
import { ShopIcon, shopIcons } from './shop-icon'
import { api, type GardenClient } from './use-garden'

export function ShopItemDialog({ client, locale, item, onClose, returnFocusTo }: { client: GardenClient; locale: Locale; item?: ShopItem; onClose: () => void; returnFocusTo?: HTMLElement | null }) {
  const t = translator(locale)
  const id = useId()
  const firstName = useRef<HTMLInputElement>(null)
  const iconSourceButton = useRef<HTMLButtonElement>(null)
  const reader = useRef<FileReader | null>(null)
  const [name, setName] = useState(editableText(item?.name, locale))
  const [description, setDescription] = useState(editableText(item?.description, locale))
  const [cost, setCost] = useState(String(item?.cost ?? 1))
  const [stock, setStock] = useState(String(item?.stock ?? -1))
  const [category, setCategory] = useState<ShopCategory>(item?.category || 'stationery')
  const [icon, setIcon] = useState<ShopIconId>(item?.icon || 'pencil')
  const [image, setImage] = useState<string | null>(item?.image || null)
  const [imageChanged, setImageChanged] = useState(false)
  const [source, setSource] = useState<'icon' | 'image'>(item?.image ? 'image' : 'icon')
  const [reading, setReading] = useState(false)
  const [imageError, setImageError] = useState('')
  const [previewFailed, setPreviewFailed] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const currentCategory = shopCategories.find(group => group.id === category)!

  useEffect(() => { client.setNotice(null) }, [client.setNotice])
  useEffect(() => () => {
    const pending = reader.current
    reader.current = null
    pending?.abort()
  }, [])

  function useIcon() {
    const pending = reader.current
    reader.current = null
    pending?.abort()
    setReading(false)
    setImage(null)
    setImageChanged(true)
    setImageError('')
    setPreviewFailed(false)
    setSource('icon')
    iconSourceButton.current?.focus()
  }

  function chooseCategory(next: ShopCategory) {
    setCategory(next)
    const group = shopCategories.find(value => value.id === next)!
    if (!group.icons.includes(icon)) setIcon(group.icons[0])
  }

  function chooseImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const pending = reader.current
    reader.current = null
    pending?.abort()
    setReading(false)
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setImageError(t('不支持此文件格式。请选择 PNG、JPEG 或 WebP 图片。', 'Unsupported file type. Choose a PNG, JPEG or WebP image.'))
      return
    }
    if (file.size > MAX_ITEM_IMAGE_BYTES) {
      setImageError(t('图片超过 2 MB。请选择更小的图片。', 'This image exceeds 2 MB. Choose a smaller image.'))
      return
    }
    const next = new FileReader()
    reader.current = next
    setReading(true)
    setImageError('')
    next.onload = () => {
      if (reader.current !== next) return
      reader.current = null
      setReading(false)
      if (typeof next.result !== 'string') {
        setImageError(t('无法读取图片，请重新选择文件。', 'The image could not be read. Choose the file again.'))
        return
      }
      setImage(next.result)
      setImageChanged(true)
      setPreviewFailed(false)
      setSource('image')
    }
    next.onerror = () => {
      if (reader.current !== next) return
      reader.current = null
      setReading(false)
      setImageError(t('无法读取图片，请重新选择文件。', 'The image could not be read. Choose the file again.'))
    }
    try { next.readAsDataURL(file) } catch {
      reader.current = null
      setReading(false)
      setImageError(t('无法读取图片，请重新选择文件。', 'The image could not be read. Choose the file again.'))
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!name.trim() || client.busy || reading || (source === 'image' && (!image || imageError || previewFailed))) return
    setSaveFailed(false)
    const body = {
      ...(!item ? { classId: client.classId } : {}),
      name: localizedUserText(name, locale, item?.name),
      description: localizedUserText(description, locale, item?.description),
      category, icon, cost: Number(cost), stock: Number(stock),
      ...(imageChanged ? { image } : {})
    }
    const ok = await client.run(() => api(item ? `items/${item.id}` : 'items', item ? 'PATCH' : 'POST', body), item ? t('商品已保存。', 'Reward saved.') : t('商品已添加。', 'Reward added.'))
    if (ok) onClose()
    else setSaveFailed(true)
  }

  return <DialogPrimitive.Root open onOpenChange={open => { if (!open && !client.busy) onClose() }}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="dialog-overlay" />
      <DialogPrimitive.Content
        className="dialog-content flex max-w-2xl flex-col overflow-hidden p-0 sm:p-0"
        onOpenAutoFocus={event => { event.preventDefault(); firstName.current?.focus() }}
        onCloseAutoFocus={event => { event.preventDefault(); if (returnFocusTo?.isConnected) returnFocusTo.focus() }}
        onEscapeKeyDown={event => { if (client.busy) event.preventDefault() }}
        onPointerDownOutside={event => { if (client.busy) event.preventDefault() }}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-line p-5 sm:px-7">
          <div>
            <DialogPrimitive.Title className="flex items-center gap-2.5 text-xl font-bold tracking-tight"><ShoppingBag size={22} className="shrink-0 text-primary" aria-hidden="true" />{item ? t('编辑商品', 'Edit reward') : t('添加商品', 'Add reward')}</DialogPrimitive.Title>
            <DialogPrimitive.Description className="mt-2 text-sm leading-relaxed text-muted">{t('设置当前班级的商品、所需徽章和库存，不影响其他班级。', 'Set reward details, badge cost and stock for this class only. Other classes are unchanged.')}</DialogPrimitive.Description>
          </div>
          <DialogPrimitive.Close asChild><Button variant="ghost" disabled={client.busy} className="size-10 shrink-0 p-0" aria-label={t('关闭商品编辑', 'Close reward editor')}><X size={20} aria-hidden="true" /></Button></DialogPrimitive.Close>
        </header>
        <form onSubmit={save} className="flex min-h-0 flex-1 flex-col" aria-busy={client.busy || reading}>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 sm:px-7">
            <fieldset disabled={client.busy} className="min-w-0 space-y-6">
              <div className="space-y-4">
                <Field id={`${id}-name`} label={t('商品名称', 'Reward name')}>
                  <Input ref={firstName} id={`${id}-name`} required maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder={t('例如：彩色铅笔', 'For example: Colored pencils')} />
                </Field>
                <Field id={`${id}-description`} label={t('商品描述（选填）', 'Description (optional)')}>
                  <Textarea id={`${id}-description`} className="min-h-24" rows={3} maxLength={500} value={description} onChange={event => setDescription(event.target.value)} placeholder={t('例如：一盒彩色铅笔，可用于课堂绘画', 'For example: A set of colored pencils for classroom drawing')} />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id={`${id}-cost`} label={t('所需徽章', 'Badge cost')}><Input id={`${id}-cost`} type="number" min={1} max={100} step={1} required value={cost} onChange={event => setCost(event.target.value)} /></Field>
                <Field id={`${id}-stock`} label={t('商品库存', 'Stock')}><Input id={`${id}-stock`} type="number" min={-1} step={1} required value={stock} aria-describedby={`${id}-stock-hint`} onChange={event => setStock(event.target.value)} /><p id={`${id}-stock-hint`} className="mt-2 text-xs leading-relaxed text-muted">{t('填 -1 表示不限库存；0 表示售罄。', 'Use -1 for unlimited stock, or 0 for sold out.')}</p></Field>
              </div>
              <fieldset className="min-w-0">
                <legend className="mb-3 text-sm font-medium">{t('商品分类', 'Category')}</legend>
                <div className="flex flex-wrap gap-2">{shopCategories.map(group => <Button key={group.id} type="button" aria-pressed={category === group.id} onClick={() => chooseCategory(group.id)} className={cn('px-3', category === group.id && 'border-primary bg-[#f2edff] text-primary')}><ShopIcon icon={group.icons[0]} locale={locale} size={16} decorative />{group.name[locale]}</Button>)}</div>
              </fieldset>
              <fieldset className="min-w-0 border-t border-line pt-5">
                <legend className="px-1 text-sm font-medium">{t('商品展示', 'Reward appearance')}</legend>
                <div className="section-tabs mb-4 w-fit">
                  <button ref={iconSourceButton} type="button" className={cn('tab inline-flex min-h-10 items-center gap-2', source === 'icon' && 'tab-active')} aria-pressed={source === 'icon'} onClick={useIcon}><ShopIcon icon={icon} locale={locale} size={17} decorative />{t('使用图标', 'Use an icon')}</button>
                  <button type="button" className={cn('tab inline-flex min-h-10 items-center gap-2', source === 'image' && 'tab-active')} aria-pressed={source === 'image'} onClick={() => setSource('image')}><ImagePlus size={17} aria-hidden="true" />{t('上传图片', 'Upload an image')}</button>
                </div>
                {source === 'icon' ? <div className="grid grid-cols-4 gap-2" aria-label={t(`${currentCategory.name.zh}图标`, `${currentCategory.name.en} icons`)}>
                  {currentCategory.icons.map(value => <button key={value} type="button" aria-pressed={icon === value} aria-label={shopIcons[value].name[locale]} title={shopIcons[value].name[locale]} onClick={() => setIcon(value)} className={cn('relative flex min-h-20 min-w-0 flex-col items-center justify-center gap-2 rounded-xl border border-line px-2 py-3 text-muted transition-colors hover:border-[#cfc5ec] hover:bg-[#f9f7ff] disabled:opacity-50', icon === value && 'border-primary bg-[#f2edff] text-primary')}>
                    <ShopIcon icon={value} locale={locale} size={25} decorative />
                    <span className="break-words text-center text-xs leading-snug">{shopIcons[value].name[locale]}</span>
                    {icon === value && <Check size={13} className="absolute right-1.5 top-1.5" aria-hidden="true" />}
                  </button>)}
                </div> : <div className="space-y-3">
                  {image && <div className="flex min-h-40 items-center justify-center rounded-xl border border-line bg-[#fbfaff] p-4">
                    {previewFailed ? <ShopIcon icon={icon} locale={locale} size={48} className="text-primary" /> : <img src={image} alt={name ? `${name} · ${t('商品图片预览', 'Reward image preview')}` : t('商品图片预览', 'Reward image preview')} className="h-40 w-full object-contain" onError={() => { setPreviewFailed(true); setImageError(t('无法预览图片。请替换图片，或移除后使用图标。', 'The image could not be previewed. Replace it, or remove it to use an icon.')) }} />}
                  </div>}
                  <div className="flex flex-wrap items-center gap-2">
                    <label htmlFor={`${id}-image`} className={cn('button button-secondary relative cursor-pointer focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary', client.busy && 'pointer-events-none opacity-50')}>
                      <Upload size={16} aria-hidden="true" />{image ? t('替换图片', 'Replace image') : t('选择图片', 'Choose image')}
                      <input id={`${id}-image`} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" disabled={client.busy} aria-describedby={`${id}-image-hint${imageError ? ` ${id}-image-error` : ''}`} aria-invalid={!!imageError} onChange={chooseImage} />
                    </label>
                    {image && <Button type="button" variant="ghost" onClick={useIcon}><X size={16} aria-hidden="true" />{t('移除图片，使用图标', 'Remove image and use icon')}</Button>}
                  </div>
                  <p id={`${id}-image-hint`} className="text-xs leading-relaxed text-muted">{t('仅支持 PNG、JPEG、WebP，每张最大 2 MB；当前班级处理后的商品图片总量上限为 10 MB。', 'PNG, JPEG or WebP only, up to 2 MB per original image. Processed reward images for this class have a 10 MB total limit.')}</p>
                  {reading && <p role="status" className="text-sm text-primary">{t('正在读取图片，请稍候…', 'Reading image, please wait…')}</p>}
                  {imageError && <p id={`${id}-image-error`} role="alert" className="flex items-start gap-2 text-sm leading-relaxed text-danger"><AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />{imageError}</p>}
                </div>}
              </fieldset>
            </fieldset>
          </div>
          <footer className="shrink-0 border-t border-line bg-white p-5 sm:px-7">
            {saveFailed && <p role="alert" className="mb-3 flex items-start gap-2 text-sm leading-relaxed text-danger"><AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />{client.notice?.error ? client.notice.text : t('未能保存商品。请检查输入后重试。', 'The reward could not be saved. Check your entries and try again.')}</p>}
            <div className="flex justify-end gap-3"><Button type="button" disabled={client.busy} onClick={onClose}>{t('取消', 'Cancel')}</Button><Button type="submit" variant="primary" busy={client.busy || reading} disabled={!name.trim() || (source === 'image' && (!image || !!imageError || previewFailed))}><Save size={16} aria-hidden="true" />{reading ? t('正在读取图片', 'Reading image') : t('保存商品', 'Save reward')}</Button></div>
          </footer>
        </form>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>
}
