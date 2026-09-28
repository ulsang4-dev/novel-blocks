import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useRef } from 'react';

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

  // 다른 기기에서 동기화된 본문을 반영한다(입력 중이 아닐 때만)
  useEffect(() => {
    if (editor && !editor.isFocused && pending.current === null && html !== editor.getHTML()) {
      editor.commands.setContent(html, { emitUpdate: false });
    }
  }, [html, editor]);

  return <EditorContent editor={editor} className="editor" />;
}
