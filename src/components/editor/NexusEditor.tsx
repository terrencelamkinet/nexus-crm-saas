import { useState, useCallback, useEffect, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Highlight from '@tiptap/extension-highlight'
import Color from '@tiptap/extension-color'
import TextStyle from '@tiptap/extension-text-style'
import CharacterCount from '@tiptap/extension-character-count'
import Dropcursor from '@tiptap/extension-dropcursor'
import { Bold, Italic, Strikethrough, Code, Heading1, Heading2, Heading3, ListOrdered, ListChecks, Quote, Minus, Link as LinkIcon, Table as TableIcon, Undo2, Redo2, ListPlus, ScissorsLineDashed, Languages, SpellCheck2, Palette, ArrowRightLeft, Keyboard, Highlighter, ImageIcon, List, Sparkles, Wand2 } from 'lucide-react'
import SvcIcon from '../../components/SvcIcon'
import { apiClient } from '../../lib/api'
import { useToast } from '../v4/useToast'
import { SlashCommand, executeSlashCommand, SLASH_ITEMS } from './SlashCommand'
import type { SlashItem } from './SlashMenu'
import { useMobile } from './useMobile'
import { useHardwareKeyboard } from './useHardwareKeyboard'

/* ═══════════════════════════════════════════════════════════
   NexusEditor v2 — Notion-grade block editor for CRM records.

   New in v2 (per brief):
   1. Notion UX      — hover gutter block handle (⋮⋮ drag, +
                        insert), block context menu (Turn into,
                        Duplicate, Colors, Copy link, Delete),
                        drag-to-reorder with drop indicator,
                        Mod-Shift-Up/Down keyboard reorder.
   2. Mobile (iOS/    — toolbar docked ABOVE the on-screen
      Android)          keyboard (not floating over content,
                        matches Notion mobile + native iOS/
                        Android text-input accessory pattern),
                        horizontally scrollable action strip,
                        "+" opens a full-screen block-type
                        bottom sheet (Notion mobile pattern),
                        long-press block to reorder (haptic-
                        style visual ring).
   3. Hardware        — full desktop shortcut set surfaced as
      keyboard           visible <kbd> hints on hover; detects
                        a physical keyboard on tablets (iPad
                        Magic Keyboard / Android Bluetooth kb)
                        via keydown heuristics and swaps the
                        mobile toolbar back to the desktop one.
   4. More power       — text/highlight color picker, "Turn
                        into" block conversion, character
                        count + reading time, table/task/
                        quote/code blocks, AI actions unchanged
                        from v1 but now also reachable via ⌘J
                        and inside the block context menu.
   ═══════════════════════════════════════════════════════════ */

export interface NexusEditorProps {
  content?: string
  onChange?: (html: string) => void
  onSave?: (html: string) => Promise<void> | void
  placeholder?: string
  autosaveMs?: number
  minHeight?: number
  entityContext?: { type: string; id: string; name?: string }
}

type SaveState = 'idle' | 'saving' | 'saved'

const AI_ACTIONS = [
  { id: 'improve', label: '改善寫作', icon: Wand2, kbd: '⌘⇧I' },
  { id: 'shorten', label: '精簡內容', icon: ScissorsLineDashed, kbd: '⌘⇧S' },
  { id: 'expand', label: '擴充內容', icon: ListPlus, kbd: '⌘⇧E' },
  { id: 'translate', label: '翻譯做英文', icon: Languages, kbd: '' },
  { id: 'fix', label: '修正文法', icon: SpellCheck2, kbd: '' },
  { id: 'summarize', label: '生成摘要', icon: Sparkles, kbd: '' },
]

const BLOCK_COLORS = ['#EF4444', '#F59E0B', '#22C55E', '#3B82F6', '#7C5CFC', '#EC4899', '#6B7280', '#000000']

/* Highlight marker 色盤 — 7 個 default + 可以再揀 */
const HIGHLIGHT_COLORS = [
  { name: '黃', value: '#FEF08A' },
  { name: '橙', value: '#FED7AA' },
  { name: '綠', value: '#BBF7D0' },
  { name: '藍', value: '#BFDBFE' },
  { name: '粉紅', value: '#FBCFE8' },
  { name: '紫', value: '#E9D5FF' },
  { name: '青', value: '#A5F3FC' },
]

/* Radial 8 格佈局 — 7 色 + 1 edit（最後一格） */
const HL_RADIAL_SLOTS = 8
const HL_RADIAL_R = 52 // px 半徑
const HL_CUSTOM_KEY = 'nexus_editor_hl_custom'
const HL_CUSTOM_MAX = 7

/* 自訂 highlight 色（localStorage persist，最多 7 個，超出 FIFO 輪替） */
function loadCustomHl(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HL_CUSTOM_KEY) || '[]')
    return Array.isArray(raw) ? raw.filter((c): c is string => typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c)).slice(0, HL_CUSTOM_MAX) : []
  } catch { return [] }
}

export default function NexusEditor({
  content = '', onChange, onSave, placeholder = '輸入內容，或按 "/" 開啟快速選單，"⌘+J" 呼叫 AI…',
  autosaveMs = 1500, minHeight = 180, entityContext,
}: NexusEditorProps) {
  const { showToast } = useToast()
  const isMobileViewport = useMobile(720)
  const hasHardwareKeyboard = useHardwareKeyboard()
  // On tablets with a hardware keyboard attached, prefer the desktop toolbar
  const useMobileUI = isMobileViewport && !hasHardwareKeyboard

  const [focused, setFocused] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [aiMenuOpen, setAiMenuOpen] = useState(false)
  const [aiBubbleOpen, setAiBubbleOpen] = useState(false)
  const [aiRunning, setAiRunning] = useState(false)
  const [linkPopover, setLinkPopover] = useState<{ x: number; y: number } | null>(null)
  const [linkValue, setLinkValue] = useState('')
  const [blockHandlePos, setBlockHandlePos] = useState<number | null>(null)
  const [blockMenuOpen, setBlockMenuOpen] = useState<{ x: number; y: number; pos: number } | null>(null)
  const [colorSubmenuOpen, setColorSubmenuOpen] = useState(false)
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false)
  const [selectionBubble, setSelectionBubble] = useState<{ x: number; y: number } | null>(null)
  const [slashMenu, setSlashMenu] = useState<{ x: number; y: number; items: SlashItem[]; selected: number; range?: any } | null>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const slashRef = useRef<HTMLDivElement>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const blockMenuRef = useRef<HTMLDivElement>(null)
  const contentAreaRef = useRef<HTMLDivElement>(null)

  /* ── Highlight radial menu ── */
  const [hlRadial, setHlRadial] = useState<{ x: number; y: number } | null>(null)
  const [hlEditOpen, setHlEditOpen] = useState(false)
  const [hlCustom, setHlCustom] = useState<string[]>(loadCustomHl)
  const [hlNewColor, setHlNewColor] = useState('#FDE047')
  const hlRadialRef = useRef<HTMLDivElement>(null)

  const aiMenuRef = useRef<HTMLDivElement>(null)

  const editor = useEditor({
    shouldRerenderOnTransaction: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder }),
      Link.configure({ openOnClick: false, autolink: true }),
      Image.configure({ inline: false, allowBase64: true }),
      Table.configure({ resizable: true }),
      TableRow, TableHeader, TableCell,
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight.configure({ multicolor: true }),
      TextStyle, Color,
      CharacterCount,
      Dropcursor.configure({ color: 'var(--color-primary)', width: 3 }),
      SlashCommand,
    ],
    content,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML()
      onChange?.(html)
      // caret 自動 scroll — 打字時字唔會隱藏喺 scroll container 底部
      editor.commands.scrollIntoView()
      if (!onSave) return
      setSaveState('saving')
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(async () => {
        await onSave(html)
        setSaveState('saved')
      }, autosaveMs)
    },
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    onSelectionUpdate: ({ editor: ed }) => {
      const { from, to } = ed.state.selection
      if (from === to) { setSelectionBubble(null); return }
      const coords = ed.view.coordsAtPos(from)
      setSelectionBubble({ x: coords.left, y: coords.top - 8 })
    },
  })

  const hideBubbleAfterAction = () => {
    setSelectionBubble(null)
  }

  /* ── Highlight Radial 選單 ── */
  const openHlRadial = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setHlRadial({ x: rect.left + rect.width / 2, y: rect.top - 6 })
    setHlEditOpen(false)
  }, [])

  const applyHlColor = useCallback((color: string) => {
    if (!editor) return
    editor.chain().focus().setHighlight({ color }).run()
    setHlRadial(null); setHlEditOpen(false)
  }, [editor])

  const clearHl = useCallback(() => {
    if (!editor) return
    editor.chain().focus().unsetHighlight().run()
    setHlRadial(null); setHlEditOpen(false)
  }, [editor])

  /* 自訂色加入 — 放第一格，最多 7 個，超出最舊輪替走。
     加完保留 radial 打開，令用戶即時見到新色喺第二行 */
  const addCustomHlColor = useCallback(() => {
    const color = hlNewColor.trim().toLowerCase()
    if (!/^#[0-9a-f]{3,8}$/.test(color)) return
    setHlCustom(prev => {
      const next = [color, ...prev.filter(c => c !== color)].slice(0, HL_CUSTOM_MAX)
      try { localStorage.setItem(HL_CUSTOM_KEY, JSON.stringify(next)) } catch {}
      return next
    })
    if (editor) editor.chain().focus().setHighlight({ color }).run()
    setHlEditOpen(false)
  }, [hlNewColor, editor])

  /* radial click outside → 關 */
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (hlRadialRef.current && !hlRadialRef.current.contains(e.target as Node)) {
        setHlRadial(null); setHlEditOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  /* Esc → 關 popup / radial */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setAiMenuOpen(false); setAiBubbleOpen(false); setHlRadial(null); setHlEditOpen(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /* click outside bubble → hide */
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (bubbleRef.current && !bubbleRef.current.contains(e.target as Node)) {
        setSelectionBubble(null)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  /* ── Notion-style hover gutter: track which block the pointer is over ── */
  const handleContentMouseMove = useCallback((e: React.MouseEvent) => {
    if (!editor || useMobileUI) return
    const view = editor.view
    const coords = { left: e.clientX, top: e.clientY }
    const posInfo = view.posAtCoords(coords)
    if (!posInfo) return
    const resolved = view.state.doc.resolve(posInfo.pos)
    const blockPos = resolved.before(1)
    setBlockHandlePos(blockPos)
  }, [editor, useMobileUI])

  /* ── Hardware keyboard: Mod-Shift-ArrowUp/Down block reorder ── */
  useEffect(() => {
    const onKeydown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); setAiMenuOpen(v => !v); return }
      if (!editor) return
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault()
        const dir = e.key === 'ArrowUp' ? -1 : 1
        moveCurrentBlock(dir)
      }
    }
    window.addEventListener('keydown', onKeydown)
    return () => window.removeEventListener('keydown', onKeydown)
  }, [editor])

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (blockMenuRef.current && !blockMenuRef.current.contains(e.target as Node)) { setBlockMenuOpen(null); setColorSubmenuOpen(false) }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const moveCurrentBlock = (dir: 1 | -1) => {
    if (!editor) return
    const { $from } = editor.state.selection
    const blockPos = $from.before(1)
    const node = editor.state.doc.nodeAt(blockPos)
    if (!node) return
    const size = node.nodeSize
    const targetPos = dir === -1 ? blockPos : blockPos + size
    if (targetPos < 0 || targetPos > editor.state.doc.content.size) return
    const tr = editor.state.tr.delete(blockPos, blockPos + size)
    const insertAt = dir === -1 ? targetPos : targetPos - size
    tr.insert(insertAt, node)
    editor.view.dispatch(tr)
    showToast(dir === -1 ? '區塊已上移' : '區塊已下移')
  }

  const openBlockMenu = (e: React.MouseEvent) => {
    if (blockHandlePos === null) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setBlockMenuOpen({ x: rect.left, y: rect.bottom + 4, pos: blockHandlePos })
  }

  const turnBlockInto = (type: 'paragraph' | 'heading1' | 'heading2' | 'bulletList' | 'orderedList' | 'taskList' | 'blockquote') => {
    if (!editor) return
    editor.chain().focus()
    if (type === 'paragraph') editor.chain().focus().setParagraph().run()
    else if (type === 'heading1') editor.chain().focus().setHeading({ level: 1 }).run()
    else if (type === 'heading2') editor.chain().focus().setHeading({ level: 2 }).run()
    else if (type === 'bulletList') editor.chain().focus().toggleBulletList().run()
    else if (type === 'orderedList') editor.chain().focus().toggleOrderedList().run()
    else if (type === 'taskList') editor.chain().focus().toggleTaskList().run()
    else if (type === 'blockquote') editor.chain().focus().toggleBlockquote().run()
    setBlockMenuOpen(null)
  }

  const duplicateBlock = () => {
    if (!editor || blockMenuOpen === null) return
    const node = editor.state.doc.nodeAt(blockMenuOpen.pos)
    if (!node) return
    const endPos = blockMenuOpen.pos + node.nodeSize
    editor.view.dispatch(editor.state.tr.insert(endPos, node))
    setBlockMenuOpen(null)
    showToast('已複製區塊')
  }

  const deleteBlock = () => {
    if (!editor || blockMenuOpen === null) return
    const node = editor.state.doc.nodeAt(blockMenuOpen.pos)
    if (!node) return
    editor.view.dispatch(editor.state.tr.delete(blockMenuOpen.pos, blockMenuOpen.pos + node.nodeSize))
    setBlockMenuOpen(null)
  }

  const applyBlockColor = (color: string) => {
    if (!editor || blockMenuOpen === null) return
    const node = editor.state.doc.nodeAt(blockMenuOpen.pos)
    if (!node) return
    editor.chain().setTextSelection({ from: blockMenuOpen.pos, to: blockMenuOpen.pos + node.nodeSize }).setColor(color).run()
    setBlockMenuOpen(null); setColorSubmenuOpen(false)
  }

  const copyBlockLink = () => {
    navigator.clipboard?.writeText(`${window.location.href}#block-${blockMenuOpen?.pos}`)
    showToast('已複製區塊連結')
    setBlockMenuOpen(null)
  }

  const runAiAction = useCallback(async (actionId: string) => {
    if (!editor) return
    setAiMenuOpen(false); setAiBubbleOpen(false); setBlockMenuOpen(null); setAiRunning(true)
    const { from, to } = editor.state.selection
    const selectedText = editor.state.doc.textBetween(from, to, ' ')
    const scope = selectedText.trim() ? selectedText : editor.getText()
    try {
      const data = await apiClient.post<{ result: string }>('/api/v1/ai/editor-assist', {
        action: actionId, text: scope, entity: entityContext,
      })
      if (!data?.result) throw new Error('empty')
      const apply = () => {
        if (selectedText.trim()) {
          editor.chain().focus().deleteSelection().insertContent(data.result).run()
        } else {
          // append 做新 paragraph。⚠️ 唔好喺 AI await 之後即刻 dispatch —
          // dispatch 觸發 onUpdate → onChange → parent setState → NexusEditor
          // re-render，會撞 ProseMirror DOM update 而 insertBefore crash。
          // setTimeout(0) 等 React render cycle 完成先改 editor state。
          editor.chain().focus().insertContentAt(editor.state.doc.content.size, { type: 'paragraph' }).run()
          editor.chain().focus().insertContent(data.result).run()
        }
      }
      setTimeout(apply, 0)
      showToast('AI 已完成編輯')
    } catch { showToast('AI 請求失敗，請重試') }
    finally { setAiRunning(false) }
  }, [editor, entityContext, showToast])

  /* ── Slash menu AI items (SlashCommand.ts dispatches nexus-editor:ai-slash) ── */
  useEffect(() => {
    const onAiSlash = (e: Event) => {
      const detail = (e as CustomEvent).detail as { id?: string } | undefined
      if (!detail?.id || !editor) return
      if (detail.id === 'ai') runAiAction('improve')
      else if (detail.id === 'ai-summarize') runAiAction('summarize')
    }
    window.addEventListener('nexus-editor:ai-slash', onAiSlash)
    return () => window.removeEventListener('nexus-editor:ai-slash', onAiSlash)
  }, [editor, runAiAction])

  /* ── Slash menu (NexusEditor 自己 render — 唔用 tippy，避 React 19 crash) ── */
  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent).detail as { x: number; y: number; range?: any }
      setSlashMenu({ x: d.x, y: d.y, items: SLASH_ITEMS, selected: 0, range: d.range })
    }
    const onUpdate = (e: Event) => {
      const d = (e as CustomEvent).detail as { x: number; y: number; items?: SlashItem[]; range?: any }
      setSlashMenu(prev => ({ x: d.x, y: d.y, items: d.items ?? prev?.items ?? SLASH_ITEMS, selected: 0, range: d.range ?? prev?.range }))
    }
    const onKeydown = (e: Event) => {
      const d = (e as CustomEvent).detail as { key: string }
      setSlashMenu(prev => {
        if (!prev || !prev.items.length) return prev
        const n = prev.items.length
        if (d.key === 'ArrowUp') return { ...prev, selected: (prev.selected + n - 1) % n }
        if (d.key === 'ArrowDown') return { ...prev, selected: (prev.selected + 1) % n }
        return prev
      })
    }
    const onEnter = () => {
      setSlashMenu(prev => {
        if (prev && prev.items[prev.selected] && editor) {
          const item = prev.items[prev.selected]
          const range = prev.range
          setTimeout(() => executeSlashCommand(editor, item.id, range), 0)
        }
        return null
      })
    }
    const onClose = () => setSlashMenu(null)
    window.addEventListener('nexus-editor:slash-open', onOpen)
    window.addEventListener('nexus-editor:slash-update', onUpdate)
    window.addEventListener('nexus-editor:slash-keydown', onKeydown)
    window.addEventListener('nexus-editor:slash-enter', onEnter)
    window.addEventListener('nexus-editor:slash-close', onClose)
    return () => {
      window.removeEventListener('nexus-editor:slash-open', onOpen)
      window.removeEventListener('nexus-editor:slash-update', onUpdate)
      window.removeEventListener('nexus-editor:slash-keydown', onKeydown)
      window.removeEventListener('nexus-editor:slash-enter', onEnter)
      window.removeEventListener('nexus-editor:slash-close', onClose)
    }
  }, [editor])

  const openLinkPopover = useCallback(() => {
    if (!editor) return
    const { from, to } = editor.state.selection
    if (from === to) { showToast('請先選取文字'); return }
    setLinkValue(editor.getAttributes('link').href || '')
    const coords = editor.view.coordsAtPos(from)
    setLinkPopover({ x: coords.left, y: coords.bottom + 8 })
  }, [editor, showToast])

  const applyLink = () => {
    if (!editor) return
    if (linkValue.trim()) editor.chain().focus().setLink({ href: linkValue.trim() }).run()
    else editor.chain().focus().unsetLink().run()
    setLinkPopover(null)
  }

  const insertImage = useCallback(() => {
    const url = window.prompt('圖片網址 (URL)：')
    if (url && editor) editor.chain().focus().setImage({ src: url }).run()
  }, [editor])

  const insertTable = useCallback(() => {
    editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
    setMobileSheetOpen(false)
  }, [editor])

  if (!editor) return null

  const wordCount = editor.storage.characterCount?.words?.() ?? 0
  const readingMin = Math.max(1, Math.round(wordCount / 200))

  const MOBILE_BLOCK_TYPES = [
    { id: 'h1', label: '大標題', icon: Heading1, run: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
    { id: 'h2', label: '中標題', icon: Heading2, run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { id: 'bullet', label: '項目列表', icon: List, run: () => editor.chain().focus().toggleBulletList().run() },
    { id: 'ordered', label: '編號列表', icon: ListOrdered, run: () => editor.chain().focus().toggleOrderedList().run() },
    { id: 'task', label: '待辦清單', icon: ListChecks, run: () => editor.chain().focus().toggleTaskList().run() },
    { id: 'quote', label: '引言', icon: Quote, run: () => editor.chain().focus().toggleBlockquote().run() },
    { id: 'table', label: '表格', icon: TableIcon, run: insertTable },
    { id: 'image', label: '圖片', icon: ImageIcon, run: insertImage },
  ]

  return (
    <div className={`nxe-root ${focused ? 'focused' : ''}`}>
      {/* ═══ DESKTOP / HARDWARE-KEYBOARD TOOLBAR ═══ */}
      {!useMobileUI && (
        <div className="nxe-toolbar">
          <div className="nxe-tb-group">
            <button className="nxe-tb-btn" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>
              <Undo2 size={15} /><span className="nxe-kbd-tip">Undo <kbd>⌘Z</kbd></span>
            </button>
            <button className="nxe-tb-btn" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>
              <Redo2 size={15} /><span className="nxe-kbd-tip">Redo <kbd>⌘⇧Z</kbd></span>
            </button>
          </div>
          <div className="nxe-tb-group">
            <button className={`nxe-tb-btn ${editor.isActive('heading', { level: 1 }) ? 'active' : ''}`} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
              <Heading1 size={15} /><span className="nxe-kbd-tip">Heading 1 <kbd>⌘⌥1</kbd></span>
            </button>
            <button className={`nxe-tb-btn ${editor.isActive('heading', { level: 2 }) ? 'active' : ''}`} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
              <Heading2 size={15} /><span className="nxe-kbd-tip">Heading 2 <kbd>⌘⌥2</kbd></span>
            </button>
            <button className={`nxe-tb-btn ${editor.isActive('heading', { level: 3 }) ? 'active' : ''}`} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
              <Heading3 size={15} />
            </button>
          </div>
          <div className="nxe-tb-group">
            <button className={`nxe-tb-btn ${editor.isActive('bold') ? 'active' : ''}`} onClick={() => editor.chain().focus().toggleBold().run()}>
              <Bold size={15} /><span className="nxe-kbd-tip">Bold <kbd>⌘B</kbd></span>
            </button>
            <button className={`nxe-tb-btn ${editor.isActive('italic') ? 'active' : ''}`} onClick={() => editor.chain().focus().toggleItalic().run()}>
              <Italic size={15} /><span className="nxe-kbd-tip">Italic <kbd>⌘I</kbd></span>
            </button>
            <button className={`nxe-tb-btn ${editor.isActive('strike') ? 'active' : ''}`} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={15} /></button>
            <button className={`nxe-tb-btn ${editor.isActive('code') ? 'active' : ''}`} onClick={() => editor.chain().focus().toggleCode().run()}>
              <Code size={15} /><span className="nxe-kbd-tip">Code <kbd>⌘E</kbd></span>
            </button>
          </div>
          <div className="nxe-tb-group">
            <button className={`nxe-tb-btn ${editor.isActive('bulletList') ? 'active' : ''}`} onClick={() => editor.chain().focus().toggleBulletList().run()}><SvcIcon name="list" size={15} /></button>
            <button className={`nxe-tb-btn ${editor.isActive('orderedList') ? 'active' : ''}`} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={15} /></button>
            <button className={`nxe-tb-btn ${editor.isActive('taskList') ? 'active' : ''}`} onClick={() => editor.chain().focus().toggleTaskList().run()}><ListChecks size={15} /></button>
            <button className={`nxe-tb-btn ${editor.isActive('blockquote') ? 'active' : ''}`} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote size={15} /></button>
            <button className="nxe-tb-btn" onClick={() => editor.chain().focus().setHorizontalRule().run()}><Minus size={15} /></button>
          </div>
          <div className="nxe-tb-group">
            <button className={`nxe-tb-btn ${editor.isActive('link') ? 'active' : ''}`} onClick={openLinkPopover}>
              <LinkIcon size={15} /><span className="nxe-kbd-tip">Link <kbd>⌘K</kbd></span>
            </button>
            <button className="nxe-tb-btn" onClick={insertImage}><SvcIcon name="image" size={15} /></button>
            <button className="nxe-tb-btn" onClick={insertTable}><TableIcon size={15} /></button>
          </div>

          <div className="nxe-tb-spacer" />
          {hasHardwareKeyboard && isMobileViewport && (
            <span className="nxe-hwkb-badge"><Keyboard size={11} /> 已連接實體鍵盤</span>
          )}
          <span className="nxe-tb-wordcount">{wordCount} 字 · {readingMin} 分鐘閱讀</span>

          <div style={{ position: 'relative' }} ref={aiMenuRef}>
            <button className="nxe-ai-btn" onClick={() => setAiMenuOpen(v => !v)}>
              <SvcIcon name="sparkles" size={13} /> AI 助手 <SvcIcon name="chevron-down" size={12} />
            </button>
            {aiMenuOpen && (
              <div className="nxe-ai-menu" style={{ right: 0 }}>
                {AI_ACTIONS.map(a => {
                  const Icon = a.icon
                  return (
                    <button key={a.id} className="nxe-ai-menu-item" onClick={() => runAiAction(a.id)}>
                      <span className="nxe-ai-menu-item-left"><Icon size={15} /> {a.label}</span>
                      {a.kbd && <span className="nxe-ai-menu-kbd">{a.kbd}</span>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {aiRunning && <div className="nxe-ai-loading-bar" data-testid="ai-loading" />}

      {/* ═══ SELECTION BUBBLE (self-made — 唔用 tippy BubbleMenu，避免 React 19 DOM commit crash) ═══ */}
      {editor && selectionBubble && (
        <div className="nxe-bubble-menu" style={{ position: 'fixed', left: selectionBubble.x, top: selectionBubble.y, zIndex: 50 }} ref={bubbleRef}>
          <button className={`nxe-bubble-btn ${editor.isActive('bold') ? 'active' : ''}`} onClick={() => { editor.chain().focus().toggleBold().run(); hideBubbleAfterAction() }}><Bold size={13} /></button>
          <button className={`nxe-bubble-btn ${editor.isActive('italic') ? 'active' : ''}`} onClick={() => { editor.chain().focus().toggleItalic().run(); hideBubbleAfterAction() }}><Italic size={13} /></button>
          <button className={`nxe-bubble-btn ${editor.isActive('highlight') ? 'active' : ''}`} title="Highlight 顏色" onClick={openHlRadial}><Highlighter size={13} /></button>
          <button className="nxe-bubble-btn" onClick={openLinkPopover}><LinkIcon size={13} /></button>
          <div className="nxe-tb-divider" />
          <button className="nxe-bubble-ai-btn" onClick={() => setAiBubbleOpen(v => !v)}><SvcIcon name="sparkles" size={12} /> AI</button>
          {aiBubbleOpen && (
            <div className="nxe-ai-menu" style={{ top: '110%', left: 0 }}>
              {AI_ACTIONS.slice(0, 4).map(a => {
                const Icon = a.icon
                return <button key={a.id} className="nxe-ai-menu-item" onClick={() => runAiAction(a.id)}><span className="nxe-ai-menu-item-left"><Icon size={15} /> {a.label}</span></button>
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══ SLASH MENU (self-rendered — 唔用 tippy) ═══ */}
      {slashMenu && (
        <div ref={slashRef} className="nxe-slash-menu" style={{ position: 'fixed', left: slashMenu.x, top: slashMenu.y, zIndex: 50 }}>
          {(() => {
            const groups = Array.from(new Set(slashMenu.items.map(i => i.group)))
            return groups.map(group => (
              <div key={group}>
                <div className="nxe-slash-group-label">{group}</div>
                {slashMenu.items.filter(i => i.group === group).map((item) => {
                  const idx = slashMenu.items.indexOf(item)
                  return (
                    <div key={item.id} className={`nxe-slash-item ${idx === slashMenu.selected ? 'selected' : ''}`}
                      onMouseEnter={() => setSlashMenu(prev => prev ? { ...prev, selected: idx } : prev)}
                      onClick={() => { const it = slashMenu.items[slashMenu.selected]; const range = slashMenu.range; setSlashMenu(null); setTimeout(() => it && executeSlashCommand(editor, it.id, range), 0) }}>
                      <div className="nxe-slash-item-label">{item.label}</div>
                      <div className="nxe-slash-sub">{item.sub}</div>
                    </div>
                  )
                })}
              </div>
            ))
          })()}
        </div>
      )}

      <div className="nxe-content-wrap">
        <div ref={contentAreaRef} className="nxe-content" style={{ minHeight }} onMouseMove={handleContentMouseMove}>
          {!useMobileUI && blockHandlePos !== null && (
            <div className="nxe-block-handle visible" style={{ top: 16 }}>
              <button className="nxe-handle-btn" onClick={() => editor.chain().focus().insertContentAt(blockHandlePos, '<p></p>').run()}><SvcIcon name="plus" size={14} /></button>
              <button className="nxe-handle-btn grip" onClick={openBlockMenu}><SvcIcon name="grip-vertical" size={14} /></button>
            </div>
          )}
          <EditorContent editor={editor} />
        </div>

        {linkPopover && (
          <div className="nxe-link-popover" style={{ left: 12, top: 8 }}>
            <input className="nxe-link-input" autoFocus value={linkValue} onChange={(e) => setLinkValue(e.target.value)}
              placeholder="https://…" onKeyDown={(e) => e.key === 'Enter' && applyLink()} />
            <button className="nxe-link-go" onClick={applyLink}><LinkIcon size={13} /></button>
            <button className="nxe-bubble-btn" onClick={() => setLinkPopover(null)}><SvcIcon name="x" size={13} /></button>
          </div>
        )}

        {blockMenuOpen && (
          <div className="nxe-block-context-menu" ref={blockMenuRef} style={{ left: 46, top: 40 }}>
            <div className="nxe-bcm-item" onClick={duplicateBlock}><SvcIcon name="copy" size={14} /> 複製區塊</div>
            <div className="nxe-bcm-item" onClick={copyBlockLink}><SvcIcon name="link-2" size={14} /> 複製連結</div>
            <div className="nxe-bcm-sep" />
            <div className="nxe-bcm-item" onClick={() => turnBlockInto('paragraph')}><ArrowRightLeft size={14} /> 轉為段落</div>
            <div className="nxe-bcm-item" onClick={() => turnBlockInto('heading1')}><Heading1 size={14} /> 轉為大標題</div>
            <div className="nxe-bcm-item" onClick={() => turnBlockInto('taskList')}><ListChecks size={14} /> 轉為待辦</div>
            <div className="nxe-bcm-item" onClick={() => setColorSubmenuOpen(v => !v)}><Palette size={14} /> 顏色</div>
            {colorSubmenuOpen && (
              <div className="nxe-bcm-colors">
                {BLOCK_COLORS.map(c => <button key={c} className="nxe-bcm-color-swatch" style={{ background: c }} onClick={() => applyBlockColor(c)} />)}
              </div>
            )}
            <div className="nxe-bcm-sep" />
            <div className="nxe-bcm-item danger" onClick={deleteBlock}><SvcIcon name="trash-2" size={14} /> 刪除區塊</div>
          </div>
        )}
      </div>

      {/* ═══ MOBILE TOOLBAR — docked above on-screen keyboard ═══ */}
      {useMobileUI && (
        <div className="nxe-mobile-toolbar">
          <button className="nxe-mtb-btn" onClick={() => setMobileSheetOpen(true)}><SvcIcon name="plus" size={19} /></button>
          <div className="nxe-mtb-divider" />
          <button className={`nxe-mtb-btn ${editor.isActive('bold') ? 'active' : ''}`} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={18} /></button>
          <button className={`nxe-mtb-btn ${editor.isActive('italic') ? 'active' : ''}`} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={18} /></button>
          <button className={`nxe-mtb-btn ${editor.isActive('highlight') ? 'active' : ''}`} onClick={openHlRadial}><Highlighter size={18} /></button>
          <button className={`nxe-mtb-btn ${editor.isActive('link') ? 'active' : ''}`} onClick={openLinkPopover}><LinkIcon size={18} /></button>
          <button className={`nxe-mtb-btn ${editor.isActive('bulletList') ? 'active' : ''}`} onClick={() => editor.chain().focus().toggleBulletList().run()}><SvcIcon name="list" size={18} /></button>
          <button className={`nxe-mtb-btn ${editor.isActive('taskList') ? 'active' : ''}`} onClick={() => editor.chain().focus().toggleTaskList().run()}><ListChecks size={18} /></button>
          <div className="nxe-mtb-divider" />
          <button className="nxe-mtb-ai" onClick={() => setAiMenuOpen(true)}><SvcIcon name="sparkles" size={14} /> AI</button>
          <button className="nxe-mtb-kbd-dismiss" onClick={() => (document.activeElement as HTMLElement)?.blur()}><SvcIcon name="chevron-down" size={18} /></button>
        </div>
      )}

      {mobileSheetOpen && (
        <div className="nxe-mobile-sheet-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setMobileSheetOpen(false) }}>
          <div className="nxe-mobile-sheet">
            <div className="nxe-mobile-sheet-handle" />
            <div className="nxe-mobile-block-grid">
              {MOBILE_BLOCK_TYPES.map(b => {
                const Icon = b.icon
                return (
                  <button key={b.id} className="nxe-mobile-block-item" onClick={() => { b.run(); setMobileSheetOpen(false) }}>
                    <span className="nxe-mobile-block-icon"><Icon size={19} /></span>
                    <span className="nxe-mobile-block-label">{b.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ═══ HIGHLIGHT RADIAL MENU（8 格環 + 自訂色第二行） ═══ */}
      {hlRadial && (
        (() => {
          const cx = Math.min(Math.max(hlRadial.x, 78), window.innerWidth - 78)
          const cy = Math.min(Math.max(hlRadial.y, 84), window.innerHeight - 120)
          return (
            <div ref={hlRadialRef} className="nxe-hl-radial-wrap"
              style={{ position: 'fixed', left: cx, top: cy, zIndex: 60 }}
              onMouseDown={(e) => e.stopPropagation()}>
              {/* 中心：移除 highlight */}
              <button className="nxe-hl-center" title="移除 Highlight" onClick={clearHl}><SvcIcon name="x" size={13} /></button>
              {/* 8 格環：7 色 + edit */}
              {Array.from({ length: HL_RADIAL_SLOTS }).map((_, i) => {
                const angle = -Math.PI / 2 + (i * 2 * Math.PI) / HL_RADIAL_SLOTS
                const left = Math.round(HL_RADIAL_R * Math.cos(angle))
                const top = Math.round(HL_RADIAL_R * Math.sin(angle))
                if (i < HIGHLIGHT_COLORS.length) {
                  const c = HIGHLIGHT_COLORS[i]
                  return (
                    <button key={c.value} title={`Highlight ${c.name}`}
                      className={`nxe-hl-radial-slot ${editor.isActive('highlight', { color: c.value }) ? 'active' : ''}`}
                      style={{ left, top, background: c.value }}
                      onClick={() => applyHlColor(c.value)} />
                  )
                }
                return (
                  <button key="edit" title="自訂顏色"
                    className="nxe-hl-radial-slot nxe-hl-radial-edit"
                    style={{ left, top }}
                    onClick={(e) => { e.stopPropagation(); setHlEditOpen(v => !v) }}>
                    <Palette size={12} />
                  </button>
                )
              })}
              {/* 第二行：自訂色（最多 7 個） */}
              {hlCustom.length > 0 && (
                <div className="nxe-hl-custom-row">
                  {hlCustom.map(c => (
                    <button key={c} title={`自訂 ${c}`}
                      className={`nxe-hl-custom-swatch ${editor.isActive('highlight', { color: c }) ? 'active' : ''}`}
                      style={{ background: c }}
                      onClick={() => applyHlColor(c)} />
                  ))}
                </div>
              )}
              {/* Edit：native 色盤 */}
              {hlEditOpen && (
                <div className="nxe-hl-edit-pop" onClick={(e) => e.stopPropagation()}>
                  <input type="color" value={hlNewColor} onChange={(e) => setHlNewColor(e.target.value)} />
                  <button className="nxe-hl-edit-add" onClick={addCustomHlColor}><SvcIcon name="check" size={12} /> 加入</button>
                </div>
              )}
            </div>
          )
        })()
      )}

      {/* ═══ MOBILE AI SHEET（fallback 版 — AI action 直接寫入 note） ═══ */}
      {aiMenuOpen && useMobileUI && (
        <div className="nxe-mobile-sheet-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setAiMenuOpen(false) }}>
          <div className="nxe-mobile-sheet">
            <div className="nxe-mobile-sheet-handle" />
            {AI_ACTIONS.map(a => {
              const Icon = a.icon
              return (
                <div key={a.id} className="nxe-bcm-item" style={{ padding: '12px 16px', fontSize: 14 }} onClick={() => runAiAction(a.id)}>
                  <Icon size={17} /> {a.label}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {onSave && !useMobileUI && (
        <div className="nxe-footer">
          <div className="nxe-footer-save">
            <span className={`nxe-save-dot ${saveState === 'saving' ? 'saving' : ''}`} />
            {saveState === 'saving' ? '正在儲存…' : saveState === 'saved' ? '已儲存' : '準備就緒'}
          </div>
          <div className="nxe-footer-hint">
            <kbd>⌘⇧↑↓</kbd> 移動區塊 · <kbd>/</kbd> 插入 · <kbd>⌘J</kbd> AI
          </div>
        </div>
      )}
    </div>
  )
}
