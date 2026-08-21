import { Extension } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import type { SlashItem } from './SlashMenu'

/* Notion-style "/" slash command — same interaction model as
   Notion's block insert menu: type "/", get a filtered list,
   arrow keys to navigate, Enter to insert, Esc to dismiss.

   ⚠️ v6.51 fix: 原本用 ReactRenderer + tippy 整 popup — React 19 下
   tippy 將 React-managed DOM 搬去 body，NexusEditor re-render 時 React
   commit 撞 DOM 而 crash（insertBefore not a child of this node）。
   而家改為 dispatch custom events，由 NexusEditor 用 React state 自己
   render slash menu（同 selection bubble 一致），完全唔經 tippy。 */

export const SLASH_ITEMS: SlashItem[] = [
  { id: 'h1', label: '大標題', sub: 'Heading 1', group: '基本' },
  { id: 'h2', label: '中標題', sub: 'Heading 2', group: '基本' },
  { id: 'h3', label: '小標題', sub: 'Heading 3', group: '基本' },
  { id: 'bullet', label: '項目列表', sub: 'Bulleted list', group: '基本' },
  { id: 'ordered', label: '編號列表', sub: 'Numbered list', group: '基本' },
  { id: 'task', label: '待辦清單', sub: 'Task list', group: '基本' },
  { id: 'quote', label: '引言', sub: 'Quote', group: '基本' },
  { id: 'divider', label: '分隔線', sub: 'Divider', group: '基本' },
  { id: 'table', label: '表格', sub: 'Insert table', group: '進階' },
  { id: 'image', label: '圖片', sub: 'Insert image', group: '進階' },
  { id: 'code', label: '程式碼區塊', sub: 'Code block', group: '進階' },
  { id: 'ai', label: 'AI 續寫', sub: '由 AI 接續內容', group: 'AI' },
  { id: 'ai-summarize', label: 'AI 摘要', sub: '為以上內容生成摘要', group: 'AI' },
]

export function executeSlashCommand(editor: any, id: string, range?: any) {
  if (!editor) return
  // delete "/" 字元（suggestion range）先 — 唔 delete 會殘留
  if (range) {
    editor.chain().focus().deleteRange(range).run()
  }
  const chain = editor.chain().focus()
  switch (id) {
    case 'h1': chain.setHeading({ level: 1 }).run(); break
    case 'h2': chain.setHeading({ level: 2 }).run(); break
    case 'h3': chain.setHeading({ level: 3 }).run(); break
    case 'bullet': chain.toggleBulletList().run(); break
    case 'ordered': chain.toggleOrderedList().run(); break
    case 'task': chain.toggleTaskList().run(); break
    case 'quote': chain.toggleBlockquote().run(); break
    case 'divider': chain.setHorizontalRule().run(); break
    case 'code': chain.toggleCodeBlock().run(); break
    case 'table': chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); break
    case 'image': {
      const url = window.prompt('圖片網址 (URL)：')
      if (url) chain.setImage({ src: url }).run()
      break
    }
    case 'ai':
    case 'ai-summarize':
      window.dispatchEvent(new CustomEvent('nexus-editor:ai-slash', { detail: { id } }))
      break
  }
}

export const SlashCommand = Extension.create({
  name: 'slashCommand',
  addOptions() {
    return {
      suggestion: {
        char: '/',
        startOfLine: false,
        command: ({ editor, props }: any) => {
          executeSlashCommand(editor, props.id as string)
        },
      },
    }
  },
  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: '/',
        items: ({ query }: { query: string }): SlashItem[] =>
          SLASH_ITEMS.filter(i => (i.label + i.sub).toLowerCase().includes(query.toLowerCase())).slice(0, 10),
        render: () => {
          return {
            onStart: (props: any) => {
              const rect = props.clientRect()
              window.dispatchEvent(new CustomEvent('nexus-editor:slash-open', {
                detail: { x: rect?.left ?? 0, y: (rect?.bottom ?? 0) + 6, range: props.range, editor: props.editor },
              }))
            },
            onUpdate: (props: any) => {
              const rect = props.clientRect()
              window.dispatchEvent(new CustomEvent('nexus-editor:slash-update', {
                detail: { x: rect?.left ?? 0, y: (rect?.bottom ?? 0) + 6, range: props.range, query: props.query, items: props.items },
              }))
            },
            onKeyDown: (props: any) => {
              if (props.event.key === 'Escape') {
                window.dispatchEvent(new CustomEvent('nexus-editor:slash-close'))
                return true
              }
              if (props.event.key === 'ArrowUp' || props.event.key === 'ArrowDown') {
                window.dispatchEvent(new CustomEvent('nexus-editor:slash-keydown', { detail: { key: props.event.key } }))
                return true
              }
              if (props.event.key === 'Enter') {
                window.dispatchEvent(new CustomEvent('nexus-editor:slash-enter'))
                return true
              }
              return false
            },
            onExit: () => {
              window.dispatchEvent(new CustomEvent('nexus-editor:slash-close'))
            },
          }
        },
      }),
    ]
  },
})
