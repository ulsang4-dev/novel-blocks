const normalize = (html: string) => html || '<p></p>';

/**
 * 스토어에서 온 본문(동기화 결과 등)을 편집기에 반영할지 정한다.
 * 포커스 여부와 무관하게, 저장 대기 중인 입력이 없으면 반영한다 — 반영하지 않으면
 * 다음 입력이 옛 본문을 기준으로 저장되어 다른 기기의 글을 덮어쓴다.
 */
export function shouldApplyIncoming(incoming: string, editorHtml: string, hasPendingInput: boolean): boolean {
  return !hasPendingInput && normalize(incoming) !== normalize(editorHtml);
}
