import type { Node } from '../model/types';

export interface Conflict {
  nodeId: string;
  local: Node;
  remote: Node;
}
