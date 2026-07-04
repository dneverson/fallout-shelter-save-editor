import { jsonLanguage } from '@codemirror/lang-json';

// Pure (no-React) JSON structure model for the Advanced raw editor.
// Parses raw text with CodeMirror's JSON Lezer grammar so every node carries its exact
// character span (`from`/`to`) in the source. Two consumers share this:
//   • JsonTree - the VSCode-style explorer (build a collapsible node tree, reveal a node's
//     span in the editor on click).
//   • JsonEditor's schema linter - map a zod issue PATH back to the offending text span so
//     errors land on the actual token instead of a flat list at the top.
// Working from the Lezer tree (not JSON.parse) means spans come for free and the model
// stays usable on text that parses structurally even while a value is being typed.

const parser = jsonLanguage.parser;
// Derive the SyntaxNode type from the parser return rather than importing @lezer/common
// directly (it is only a transitive dep - importing it would be a phantom dependency).
type Tree = ReturnType<typeof parser.parse>;
type SyntaxNode = NonNullable<Tree['topNode']>;
/** Re-exported so consumers (e.g. the editor breadcrumb) can annotate Lezer nodes without
 *  importing @lezer/common directly (it is only a transitive dependency). */
export type JsonSyntaxNode = SyntaxNode;

/** Lezer node names that represent an actual JSON value (vs. punctuation/property-name). */
const VALUE_NAMES = new Set(['Object', 'Array', 'String', 'Number', 'True', 'False', 'Null']);

export type JsonValueType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';

export interface JsonNode {
  /** Stable id == the node's JSONPath, used as the React key and expand-state key. */
  id: string;
  /** Object property name, or null for array elements and the root. */
  key: string | null;
  /** Array index, or null for object members and the root. */
  index: number | null;
  /** Nesting depth from the root value (root = 0). */
  depth: number;
  /** Character span of the VALUE in the source text. */
  from: number;
  to: number;
  type: JsonValueType;
  /** Short one-line summary: leaf literal (truncated) or "{n keys}" / "[n items]". */
  preview: string;
  children: JsonNode[];
}

function typeOfNode(name: string): JsonValueType {
  switch (name) {
    case 'Object':
      return 'object';
    case 'Array':
      return 'array';
    case 'Number':
      return 'number';
    case 'True':
    case 'False':
      return 'boolean';
    case 'Null':
      return 'null';
    default:
      return 'string';
  }
}

/** Unescape a `"quoted"` PropertyName/String slice; falls back to the raw slice. */
function parseQuoted(raw: string): string {
  try {
    const v = JSON.parse(raw) as unknown;
    return typeof v === 'string' ? v : raw;
  } catch {
    return raw;
  }
}

const PREVIEW_MAX = 80;

function leafPreview(text: string, node: SyntaxNode): string {
  const raw = text.slice(node.from, node.to);
  return raw.length > PREVIEW_MAX ? `${raw.slice(0, PREVIEW_MAX)}…` : raw;
}

/** The top JSON value under the `JsonText` root, or null for empty/unparseable text. */
function rootValue(tree: Tree): SyntaxNode | null {
  let child = tree.topNode.firstChild;
  while (child) {
    if (VALUE_NAMES.has(child.name)) return child;
    child = child.nextSibling;
  }
  return null;
}

/** The value node of an object Property (the part after the colon), or null if incomplete. */
function propertyValue(prop: SyntaxNode): SyntaxNode | null {
  let child = prop.firstChild;
  let value: SyntaxNode | null = null;
  while (child) {
    if (VALUE_NAMES.has(child.name)) value = child; // last value child = the property's value
    child = child.nextSibling;
  }
  return value;
}

/** Ordered value children of an Array node. */
function arrayElements(arr: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  let child = arr.firstChild;
  while (child) {
    if (VALUE_NAMES.has(child.name)) out.push(child);
    child = child.nextSibling;
  }
  return out;
}

/** Append the next path segment to a JSONPath base (e.g. `$` + `caps` → `$.caps`). */
function joinPath(base: string, key: string | null, index: number | null): string {
  if (index !== null) return `${base}[${index}]`;
  // Bracket-quote keys that are not plain identifiers so the path stays unambiguous.
  if (key !== null && /^[A-Za-z_$][\w$]*$/.test(key)) return `${base}.${key}`;
  return `${base}[${JSON.stringify(key)}]`;
}

function build(
  text: string,
  node: SyntaxNode,
  key: string | null,
  index: number | null,
  depth: number,
  path: string,
): JsonNode {
  const type = typeOfNode(node.name);
  const base: Omit<JsonNode, 'preview' | 'children'> = {
    id: path,
    key,
    index,
    depth,
    from: node.from,
    to: node.to,
    type,
  };

  if (type === 'object') {
    const props = node.getChildren('Property');
    const children: JsonNode[] = [];
    for (const prop of props) {
      const nameNode = prop.getChild('PropertyName');
      const value = propertyValue(prop);
      if (!nameNode || !value) continue;
      const k = parseQuoted(text.slice(nameNode.from, nameNode.to));
      children.push(build(text, value, k, null, depth + 1, joinPath(path, k, null)));
    }
    const n = children.length;
    return { ...base, preview: `{${n} ${n === 1 ? 'key' : 'keys'}}`, children };
  }

  if (type === 'array') {
    const elements = arrayElements(node);
    const children = elements.map((el, i) =>
      build(text, el, null, i, depth + 1, joinPath(path, null, i)),
    );
    const n = children.length;
    return { ...base, preview: `[${n} ${n === 1 ? 'item' : 'items'}]`, children };
  }

  return { ...base, preview: leafPreview(text, node), children: [] };
}

/** Build the full node tree for the editor text, or null when there is no top value. */
export function buildJsonTree(text: string): JsonNode | null {
  const tree = parser.parse(text);
  const root = rootValue(tree);
  if (!root) return null;
  return build(text, root, null, null, 0, '$');
}

export interface Span {
  from: number;
  to: number;
}

/**
 * Resolve zod-style paths (array of object keys / array indices) to text spans, parsing the
 * source ONCE. Used by the schema linter to place every issue on its real token. Returns
 * null for a path that does not exist in the current (possibly mid-edit) text.
 */
export function createPathResolver(text: string): {
  resolve: (path: ReadonlyArray<string | number>) => Span | null;
} {
  const tree = parser.parse(text);
  const root = rootValue(tree);

  const objectChild = (node: SyntaxNode, key: string): SyntaxNode | null => {
    for (const prop of node.getChildren('Property')) {
      const nameNode = prop.getChild('PropertyName');
      if (nameNode && parseQuoted(text.slice(nameNode.from, nameNode.to)) === key) {
        return propertyValue(prop);
      }
    }
    return null;
  };

  return {
    resolve(path) {
      let node: SyntaxNode | null = root;
      for (const segment of path) {
        if (!node) return null;
        if (typeof segment === 'number' && node.name === 'Array') {
          node = arrayElements(node)[segment] ?? null;
        } else if (node.name === 'Object') {
          node = objectChild(node, String(segment));
        } else if (node.name === 'Array') {
          // A string segment into an array (rare) - fall back to numeric coercion.
          const i = Number(segment);
          node = Number.isInteger(i) ? (arrayElements(node)[i] ?? null) : null;
        } else {
          return null;
        }
      }
      return node ? { from: node.from, to: node.to } : null;
    },
  };
}
