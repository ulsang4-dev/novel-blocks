import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Novel } from '../model/types';
import { useApp } from './store';

export type Change = (fn: (n: Novel) => Novel) => void;

export function useNovel(): { novel?: Novel; change: Change } {
  const { novelId } = useParams();
  const novel = useApp((s) => (novelId ? s.novels[novelId] : undefined));
  const update = useApp((s) => s.update);
  return {
    novel,
    change: (fn) => {
      if (novelId) update(novelId, fn);
    },
  };
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}
