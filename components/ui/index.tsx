'use client'
import { forwardRef, useRef } from 'react'
import { usePathname } from 'next/navigation'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as SelectPrimitive from '@radix-ui/react-select'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { X, LoaderCircle, Upload, Check, ChevronDown, ChevronUp, type LucideIcon } from 'lucide-react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))
const variants = { primary: 'button-primary', secondary: 'button-secondary', ghost: 'button-ghost', danger: 'button-danger' }
export const Button = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; busy?: boolean }>(function Button({ variant = 'secondary', busy, className, children, disabled, ...props }, ref) {
  return <button ref={ref} disabled={disabled || busy} className={cn('button', variants[variant], className)} {...props}>{busy && <LoaderCircle size={16} aria-hidden="true" className="animate-spin" />}{children}</button>
})
export const TooltipProvider = TooltipPrimitive.Provider
export function Tooltip({ content, children }: { content: string; children: React.ReactElement }) {
  return <TooltipPrimitive.Root><TooltipPrimitive.Trigger asChild onFocus={event => { if (!event.currentTarget.matches(':focus-visible')) event.preventDefault() }}>{children}</TooltipPrimitive.Trigger><TooltipPrimitive.Portal><TooltipPrimitive.Content side="bottom" sideOffset={6} collisionPadding={8} className="z-[90] max-w-xs rounded-lg bg-ink px-3 py-2 text-xs leading-relaxed text-white shadow-lg">{content}</TooltipPrimitive.Content></TooltipPrimitive.Portal></TooltipPrimitive.Root>
}
export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) { return <input ref={ref} className={cn('input', className)} {...props} /> })
export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) { return <textarea ref={ref} className={cn('input min-h-36 resize-y', className)} {...props} /> })

export interface SelectOption { value: string; label: string; icon?: LucideIcon; disabled?: boolean }
interface SelectProps extends Omit<React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>, 'value' | 'onChange' | 'children' | 'defaultValue'> {
  value: string; options: SelectOption[]; onValueChange: (value: string) => void; placeholder?: string; icon?: LucideIcon; name?: string
}
export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select({ value, options, onValueChange, placeholder, icon, name, disabled, className, ...props }, ref) {
  const selected = options.find(option => option.value === value)
  const Icon = selected?.icon || icon
  return <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled || !options.length} name={name}>
    <SelectPrimitive.Trigger ref={ref} className={cn('select-trigger', className)} title={selected?.label} {...props}>
      {Icon && <Icon size={16} className="shrink-0 text-muted" aria-hidden="true" />}
      <span className="min-w-0 flex-1 truncate text-left"><SelectPrimitive.Value placeholder={placeholder} /></span>
      <SelectPrimitive.Icon asChild><ChevronDown size={16} className="select-chevron shrink-0 text-muted" aria-hidden="true" /></SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
    <SelectPrimitive.Portal><SelectPrimitive.Content position="popper" align="start" sideOffset={6} collisionPadding={10} className="select-content">
      <SelectPrimitive.ScrollUpButton className="flex h-6 items-center justify-center text-muted"><ChevronUp size={15} aria-hidden="true" /></SelectPrimitive.ScrollUpButton>
      <SelectPrimitive.Viewport className="p-1.5">{options.filter(option => option.value !== '').map(option => {
        const ItemIcon = option.icon || icon
        return <SelectPrimitive.Item key={option.value} value={option.value} disabled={option.disabled} className="select-item">
          {ItemIcon && <ItemIcon size={16} className="shrink-0 text-muted" aria-hidden="true" />}
          <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
          <SelectPrimitive.ItemIndicator className="ml-auto flex shrink-0 items-center pl-3"><Check size={16} aria-hidden="true" /></SelectPrimitive.ItemIndicator>
        </SelectPrimitive.Item>
      })}</SelectPrimitive.Viewport>
      <SelectPrimitive.ScrollDownButton className="flex h-6 items-center justify-center text-muted"><ChevronDown size={15} aria-hidden="true" /></SelectPrimitive.ScrollDownButton>
    </SelectPrimitive.Content></SelectPrimitive.Portal>
  </SelectPrimitive.Root>
})
export function Label({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) { return <label className="mb-2 block text-sm font-medium" {...props}>{children}</label> }
interface CheckboxProps extends Omit<React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>, 'checked' | 'onCheckedChange'> { checked: boolean; onCheckedChange: (checked: boolean) => void }
export function Checkbox({ className, checked, onCheckedChange, ...props }: CheckboxProps) {
  return <CheckboxPrimitive.Root checked={checked} onCheckedChange={value => onCheckedChange(value === true)} className={cn('checkbox', className)} {...props}><CheckboxPrimitive.Indicator><Check size={14} strokeWidth={2.5} aria-hidden="true" /></CheckboxPrimitive.Indicator></CheckboxPrimitive.Root>
}
export function FileInput({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) { return <label className="button button-secondary cursor-pointer"><Upload size={16} aria-hidden="true" />{label}<input type="file" className="sr-only" {...props} /></label> }
export function Dialog({ open, onClose, title, description, children, wide = false, closeLabel, icon: Icon, className }: { open: boolean; onClose: () => void; title: string; description?: string; children: React.ReactNode; wide?: boolean; closeLabel?: string; icon?: LucideIcon; className?: string }) {
  const closeText = usePathname().startsWith('/en') ? 'Close' : '关闭'
  const returnFocus = useRef<HTMLElement | null>(typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null)
  return <DialogPrimitive.Root open={open} onOpenChange={value => { if (!value) onClose() }}><DialogPrimitive.Portal><DialogPrimitive.Overlay className="dialog-overlay" /><DialogPrimitive.Content className={cn('dialog-content', wide && 'max-w-4xl', className)} onOpenAutoFocus={event => { if (document.activeElement instanceof HTMLElement && event.currentTarget instanceof HTMLElement && !event.currentTarget.contains(document.activeElement)) returnFocus.current = document.activeElement }} onCloseAutoFocus={event => { if (returnFocus.current?.isConnected) { event.preventDefault(); returnFocus.current.focus() } }}>
    <div className="mb-6 flex shrink-0 items-start justify-between gap-4"><div><DialogPrimitive.Title className="flex items-center gap-2.5 text-xl font-bold tracking-tight">{Icon && <Icon size={22} className="shrink-0 text-primary" aria-hidden="true" />}{title}</DialogPrimitive.Title><DialogPrimitive.Description className={cn('mt-2 text-sm leading-relaxed text-muted', !description && 'sr-only')}>{description || title}</DialogPrimitive.Description></div><DialogPrimitive.Close asChild><Button variant="ghost" aria-label={closeLabel || closeText} className="size-9 shrink-0 p-0"><X size={20} aria-hidden="true" /></Button></DialogPrimitive.Close></div>
    {children}
  </DialogPrimitive.Content></DialogPrimitive.Portal></DialogPrimitive.Root>
}
export function FullScreenDialog({ open, onClose, onContinue, title, description, closeLabel, children }: { open: boolean; onClose: () => void; onContinue: () => void; title: string; description: string; closeLabel: string; children: React.ReactNode }) {
  return <DialogPrimitive.Root open={open} onOpenChange={value => { if (!value) onClose() }}><DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="celebration-overlay" />
    <DialogPrimitive.Content className="celebration-content" onClick={onContinue} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onContinue() } }}>
      <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title><DialogPrimitive.Description className="sr-only">{description}</DialogPrimitive.Description>
      {children}
      <DialogPrimitive.Close asChild><Button variant="ghost" className="celebration-close" aria-label={closeLabel} onClick={event => event.stopPropagation()}><X size={22} aria-hidden="true" /></Button></DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal></DialogPrimitive.Root>
}
export function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) { return <div><Label htmlFor={id}>{label}</Label>{children}</div> }
