import type { TaskFile } from './task.js';

type QueryNode = ComparisonNode | AndNode | OrNode;

interface ComparisonNode {
  type: 'comparison';
  field: string;
  operator: '=' | '!=';
  value: string;
}

interface AndNode {
  type: 'and';
  left: QueryNode;
  right: QueryNode;
}

interface OrNode {
  type: 'or';
  left: QueryNode;
  right: QueryNode;
}

type Token =
  | { type: 'word'; value: string }
  | { type: 'quoted'; value: string }
  | { type: 'and' }
  | { type: 'or' }
  | { type: 'eq' }
  | { type: 'eq2' }
  | { type: 'ne' }
  | { type: 'lparen' }
  | { type: 'rparen' };

export function matchesTaskQuery(task: TaskFile, query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) {
    return true;
  }

  const ast = parseTaskQuery(trimmed);
  return evaluateQuery(ast, task);
}

export function parseTaskQuery(query: string): QueryNode {
  const tokens = tokenize(query);
  const parser = new Parser(tokens);
  const node = parser.parseExpression();

  if (!parser.isAtEnd()) {
    throw new Error(`Unexpected token: ${describeToken(parser.peek())}`);
  }

  return node;
}

class Parser {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  parseExpression(): QueryNode {
    return this.parseOr();
  }

  private parseOr(): QueryNode {
    let node = this.parseAnd();

    while (this.match('or')) {
      const right = this.parseAnd();
      node = { type: 'or', left: node, right };
    }

    return node;
  }

  private parseAnd(): QueryNode {
    let node = this.parsePrimary();

    while (true) {
      if (this.match('and')) {
        node = { type: 'and', left: node, right: this.parsePrimary() };
        continue;
      }

      if (this.canStartPrimary(this.peek())) {
        node = { type: 'and', left: node, right: this.parsePrimary() };
        continue;
      }

      break;
    }

    return node;
  }

  private parsePrimary(): QueryNode {
    if (this.match('lparen')) {
      const node = this.parseExpression();
      this.expect('rparen');
      return node;
    }

    return this.parseComparison();
  }

  private parseComparison(): ComparisonNode {
    const field = this.expectWord('field name');
    const operatorToken = this.advance();

    if (!operatorToken || (operatorToken.type !== 'eq' && operatorToken.type !== 'eq2' && operatorToken.type !== 'ne')) {
      throw new Error(`Expected =, ==, or != after ${field}`);
    }

    const valueToken = this.advance();
    if (!valueToken || (valueToken.type !== 'word' && valueToken.type !== 'quoted')) {
      throw new Error(`Expected value after ${field} ${operatorToken.type === 'eq' ? '=' : '!='}`);
    }

    return {
      type: 'comparison',
      field,
      operator: operatorToken.type === 'ne' ? '!=' : '=',
      value: valueToken.value
    };
  }

  private canStartPrimary(token: Token | undefined): boolean {
    return token?.type === 'word' || token?.type === 'quoted' || token?.type === 'lparen';
  }

  private match(type: Token['type']): boolean {
    if (this.peek()?.type !== type) {
      return false;
    }
    this.index += 1;
    return true;
  }

  private expect(type: Token['type']): Token {
    const token = this.advance();
    if (!token || token.type !== type) {
      throw new Error(`Expected ${type}`);
    }
    return token;
  }

  private expectWord(label: string): string {
    const token = this.advance();
    if (!token || (token.type !== 'word' && token.type !== 'quoted')) {
      throw new Error(`Expected ${label}`);
    }
    return token.value;
  }

  private advance(): Token | undefined {
    const token = this.tokens[this.index];
    if (token) {
      this.index += 1;
    }
    return token;
  }

  isAtEnd(): boolean {
    return this.index >= this.tokens.length;
  }

  peek(): Token | undefined {
    return this.tokens[this.index];
  }
}

function evaluateQuery(node: QueryNode, task: TaskFile): boolean {
  switch (node.type) {
    case 'comparison': {
      const actual = getTaskField(task, node.field);
      return node.operator === '=' ? actual === node.value : actual !== node.value;
    }
    case 'and':
      return evaluateQuery(node.left, task) && evaluateQuery(node.right, task);
    case 'or':
      return evaluateQuery(node.left, task) || evaluateQuery(node.right, task);
  }
}

function getTaskField(task: TaskFile, field: string): string {
  if (field === 'id') {
    return task.id;
  }
  if (field === 'title') {
    return task.title;
  }

  const value = task.frontmatter[field];
  if (value === undefined || value === null) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.map((item) => stringifyValue(item)).join(', ');
  }
  return stringifyValue(value);
}

function stringifyValue(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

function tokenize(query: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < query.length) {
    const char = query[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (char === '(') {
      tokens.push({ type: 'lparen' });
      index += 1;
      continue;
    }

    if (char === ')') {
      tokens.push({ type: 'rparen' });
      index += 1;
      continue;
    }

    if (char === '=' && query[index + 1] === '=') {
      tokens.push({ type: 'eq2' });
      index += 2;
      continue;
    }

    if (char === '=' && query[index + 1] !== '=') {
      tokens.push({ type: 'eq' });
      index += 1;
      continue;
    }

    if (char === '!' && query[index + 1] === '=') {
      tokens.push({ type: 'ne' });
      index += 2;
      continue;
    }

    if (char === '&' && query[index + 1] === '&') {
      tokens.push({ type: 'and' });
      index += 2;
      continue;
    }

    if (char === '|' && query[index + 1] === '|') {
      tokens.push({ type: 'or' });
      index += 2;
      continue;
    }

    if (char === '"' || char === '\'') {
      const { value, nextIndex } = readQuotedValue(query, index);
      tokens.push({ type: 'quoted', value });
      index = nextIndex;
      continue;
    }

    const { value, nextIndex } = readWordValue(query, index);
    const lower = value.toLowerCase();
    if (lower === 'and') {
      tokens.push({ type: 'and' });
    } else if (lower === 'or') {
      tokens.push({ type: 'or' });
    } else {
      tokens.push({ type: 'word', value });
    }
    index = nextIndex;
  }

  return tokens;
}

function readQuotedValue(query: string, startIndex: number): { value: string; nextIndex: number } {
  const quote = query[startIndex];
  let index = startIndex + 1;
  let value = '';

  while (index < query.length) {
    const char = query[index];

    if (char === '\\' && index + 1 < query.length) {
      value += query[index + 1];
      index += 2;
      continue;
    }

    if (char === quote) {
      return { value, nextIndex: index + 1 };
    }

    value += char;
    index += 1;
  }

  throw new Error('Unterminated quoted string');
}

function readWordValue(query: string, startIndex: number): { value: string; nextIndex: number } {
  let index = startIndex;
  let value = '';

  while (index < query.length) {
    const char = query[index];
    if (/\s/.test(char) || char === '(' || char === ')' || char === '=' || char === '!') {
      break;
    }
    value += char;
    index += 1;
  }

  return { value, nextIndex: index };
}

function describeToken(token: Token | undefined): string {
  if (!token) {
    return 'end of input';
  }
  switch (token.type) {
    case 'word':
    case 'quoted':
      return token.value;
    default:
      return token.type;
  }
}
