import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useRef } from 'react';
import { shouldApplyIncoming } from '../editorSync';

interface Props {
  html: string;
  onChange: (html: string) => void;
}

export default function SceneEditor({ html, onChange }: Props) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const flush = () => {
    clearTimeout(timer.current);
    if (pending.current !== null) {
      onChangeRef.current(pending.current);
      pending.current = null;
    }
  };

  const editor = useEditor({
    extensions: [StarterKit],
    content: html,
    onUpdate: ({ editor: e }) => {
      pending.current = e.getHTML();
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, 400);
    },
    onBlur: () => flush(),
  });

  // 씬 이동·화면 전환 직전의 입력도 저장한다
  useEffect(() => () => flush(), []);

  // 다른 기기에서 동기화된 본문을 반영한다(저장 대기 중인 입력이 없을 때). 커서 위치는 최대한 유지한다.
  useEffect(() => {
    if (!editor || !shouldApplyIncoming(html, editor.getHTML(), pending.current !== null)) return;
    const { from, to } = editor.state.selection;
    editor.commands.setContent(html, { emitUpdate: false });
    if (editor.isFocused) {
      const max = editor.state.doc.content.size;
      editor.commands.setTextSelection({ from: Math.min(from, max), to: Math.min(to, max) });
    }
  }, [html, editor]);

  return <EditorContent editor={editor} className="editor" />;
}
