import { Extension } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { ReactRenderer } from '@tiptap/react'
import tippy, { type Instance as TippyInstance } from 'tippy.js'
import SlashMenu, { type SlashItem } from './SlashMenu'

/* Notion-style "/" slash command — same interaction model as
   Notion's block insert menu: type "/", get a filtered list,
   arrow keys to navigate, Enter to insert, Esc to dismiss. */

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

export const SlashCommand = Extension.create({
  name: 'slashCommand',
  addOptions() {
    return {
      suggestion: {
        char: '/',
        startOfLine: false,
        command: ({ editor, range, props }: any) => {
          editor.chain().focus().deleteRange(range).run()
          const id = props.id as string
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
        },
      },
    }
  },
  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: '/',
        items: ({ query }: { query: string }) =>
          SLASH_ITEMS.filter(i => (i.label + i.sub).toLowerCase().includes(query.toLowerCase())).slice(0, 10),
        render: () => {
          let component: ReactRenderer
          let popup: TippyInstance[]
          return {
            onStart: (props: any) => {
              component = new ReactRenderer(SlashMenu, { props, editor: props.editor })
              popup = tippy('body', {
                getReferenceClientRect: props.clientRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: 'manual',
                placement: 'bottom-start',
                animation: 'shift-away',
                duration: 120,
              })
            },
            onUpdate: (props: any) => {
              component.updateProps(props)
              popup[0]?.setProps({ getReferenceClientRect: props.clientRect })
            },
            onKeyDown: (props: any) => {
              if (props.event.key === 'Escape') { popup[0]?.hide(); return true }
              return (component.ref as any)?.onKeyDown?.(props) ?? false
            },
            onExit: () => { popup[0]?.destroy(); component.destroy() },
          }
        },
      }),
    ]
  },
})
