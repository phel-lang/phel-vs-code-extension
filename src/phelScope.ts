// Lexical-scope analysis for `.phel` source. Built on the structural reader in
// `phelParedit` (`parseAll` / `pathAt`), it answers two questions the
// navigation providers need:
//
//   1. Is the symbol token at a given offset a *local* binding (a fn/defn
//      parameter, a `let`/`loop`/`binding` name, a `catch` var, an iteration
//      var, …) rather than a global `def`/core symbol?
//   2. If so, what is its declaring occurrence and lexical scope, so that
//      go-to-definition, find-references, rename, and highlight can be scoped
//      to *that* binding instead of every same-named token in the file.
//
// Design stance: only forms whose binding shape is unambiguous produce locals.
// Anything unrecognised yields no binding, so callers fall back to the existing
// global/workspace behaviour — the analyzer never makes rename *worse*, it only
// narrows it when it is certain a symbol is local.
//
// No `vscode` imports: pure and unit-testable.

import { parseAll, pathAt, type Form } from './phelParedit';
import { findOccurrences, type Occurrence } from './phelReferences';

export interface LocalBinding {
    /** The bound symbol name. */
    name: string;
    /** Offset of the declaring occurrence (start of the binding symbol). */
    declStart: number;
    /** Offset just past the declaring occurrence. */
    declEnd: number;
    /** Start of the region where the binding is visible (inclusive). */
    scopeStart: number;
    /** End of the region where the binding is visible (exclusive). */
    scopeEnd: number;
}

/** `let`-shaped forms: `(head [name init name init …] body…)`. */
const PAIR_BINDING_HEADS = new Set(['let', 'loop', 'binding', 'with-open']);
/** Single-pair conditional binding forms: `(head [name test] …)`. */
const ONE_PAIR_HEADS = new Set(['if-let', 'when-let', 'if-some', 'when-some']);
/** `fn`-shaped forms whose parameter vector(s) introduce locals. */
const FN_HEADS = new Set(['fn', 'defn', 'defn-', 'defmacro', 'defmacro-']);
/** Sequential-iteration forms: `(head [var … coll] body…)`. */
const SEQ_HEADS = new Set(['for', 'doseq', 'dofor']);

function atomText(src: string, form: Form): string {
    return src.slice(form.bodyStart, form.bodyEnd);
}

function isAtom(form: Form | undefined): form is Form {
    return !!form && form.kind === 'atom';
}

/** A plain, bindable symbol — not a keyword, rest-marker, ignore, or qualified. */
function isBindableName(name: string): boolean {
    if (!name || name === '&' || name === '_') {
        return false;
    }
    const c = name[0];
    if (c === ':' || c === '#' || c === '"' || c === '\\') {
        return false;
    }
    if (name.includes('/')) {
        return false; // qualified symbol => not a local
    }
    if (/^[-+]?\d/.test(name)) {
        return false; // number
    }
    return true;
}

/**
 * Collect the symbol names introduced by a binding *target* form, descending
 * through vector and map destructuring. Returns each name with the offset of
 * its declaring atom.
 */
function collectTargets(src: string, target: Form): { name: string; start: number; end: number }[] {
    const out: { name: string; start: number; end: number }[] = [];
    const visit = (f: Form): void => {
        if (f.kind === 'atom') {
            const name = atomText(src, f);
            if (isBindableName(name)) {
                out.push({ name, start: f.bodyStart, end: f.bodyEnd });
            }
            return;
        }
        if (f.kind === 'vector') {
            for (const child of f.children) {
                visit(child);
            }
            return;
        }
        if (f.kind === 'map') {
            // Associative destructuring: {:keys [a b]}, {:as z}, {sym :key}, {:or {…}}.
            const kids = f.children;
            for (let i = 0; i + 1 < kids.length; i += 2) {
                const key = kids[i];
                const val = kids[i + 1];
                const keyText = key.kind === 'atom' ? atomText(src, key) : '';
                if (keyText === ':keys' || keyText === ':syms' || keyText === ':strs') {
                    if (val.kind === 'vector') {
                        for (const child of val.children) {
                            visit(child);
                        }
                    }
                } else if (keyText === ':as') {
                    visit(val);
                } else if (keyText === ':or') {
                    // defaults — the keys are already bound via :keys/local pairs
                } else if (key.kind === 'atom') {
                    // {local-sym :some-key}
                    visit(key);
                }
            }
        }
    };
    visit(target);
    return out;
}

/** The binding vector of a form, i.e. `children[1]` when it is a `[...]`. */
function bindingVec(form: Form): Form | null {
    const vec = form.children[1];
    return vec && vec.kind === 'vector' ? vec : null;
}

/**
 * Extract every local binding a single form introduces, each paired with the
 * scope region in which it is visible. Unrecognised heads yield `[]`.
 */
function bindingsOf(src: string, form: Form): LocalBinding[] {
    if (form.kind !== 'list' || form.children.length === 0) {
        return [];
    }
    const head = form.children[0];
    if (!isAtom(head)) {
        return [];
    }
    const name = atomText(src, head);
    const bodyEnd = form.innerEnd;

    if (PAIR_BINDING_HEADS.has(name)) {
        const vec = bindingVec(form);
        if (!vec) {
            return [];
        }
        const out: LocalBinding[] = [];
        const pairs = vec.children;
        for (let i = 0; i + 1 < pairs.length; i += 2) {
            const target = pairs[i];
            const init = pairs[i + 1];
            // Sequential scope: a binding is visible from the end of its init
            // through the rest of the form body (later inits + body).
            const scopeStart = init.end;
            for (const t of collectTargets(src, target)) {
                out.push({
                    name: t.name,
                    declStart: t.start,
                    declEnd: t.end,
                    scopeStart,
                    scopeEnd: bodyEnd,
                });
            }
        }
        return out;
    }

    if (ONE_PAIR_HEADS.has(name)) {
        const vec = bindingVec(form);
        if (!vec || vec.children.length < 2) {
            return [];
        }
        const target = vec.children[0];
        const init = vec.children[1];
        return collectTargets(src, target).map((t) => ({
            name: t.name,
            declStart: t.start,
            declEnd: t.end,
            scopeStart: init.end,
            scopeEnd: bodyEnd,
        }));
    }

    if (name === 'catch') {
        // (catch Type e body…) — the third child binds the exception.
        const binding = form.children[2];
        if (!isAtom(binding)) {
            return [];
        }
        const bname = atomText(src, binding);
        if (!isBindableName(bname)) {
            return [];
        }
        return [
            {
                name: bname,
                declStart: binding.bodyStart,
                declEnd: binding.bodyEnd,
                scopeStart: binding.bodyEnd,
                scopeEnd: bodyEnd,
            },
        ];
    }

    if (name === 'foreach') {
        // (foreach [k v coll] body…) or (foreach [v coll] body…): every element
        // but the trailing collection expression is a binding target.
        const vec = bindingVec(form);
        if (!vec || vec.children.length < 2) {
            return [];
        }
        const targets = vec.children.slice(0, -1);
        const out: LocalBinding[] = [];
        for (const target of targets) {
            for (const t of collectTargets(src, target)) {
                out.push({
                    name: t.name,
                    declStart: t.start,
                    declEnd: t.end,
                    scopeStart: vec.end,
                    scopeEnd: bodyEnd,
                });
            }
        }
        return out;
    }

    if (SEQ_HEADS.has(name)) {
        // (for [x :in coll … :let [y (f x)] …] body): the leading element is the
        // primary loop var; `:let [pairs]` sub-vectors add more. Visible through
        // the remaining binding clauses and the body.
        const vec = bindingVec(form);
        if (!vec || vec.children.length === 0) {
            return [];
        }
        const out: LocalBinding[] = [];
        const first = vec.children[0];
        for (const t of collectTargets(src, first)) {
            out.push({
                name: t.name,
                declStart: t.start,
                declEnd: t.end,
                scopeStart: first.end,
                scopeEnd: bodyEnd,
            });
        }
        const kids = vec.children;
        for (let i = 0; i + 1 < kids.length; i++) {
            const k = kids[i];
            if (k.kind === 'atom' && atomText(src, k) === ':let') {
                const letVec = kids[i + 1];
                if (letVec.kind === 'vector') {
                    for (let j = 0; j + 1 < letVec.children.length; j += 2) {
                        const target = letVec.children[j];
                        const init = letVec.children[j + 1];
                        for (const t of collectTargets(src, target)) {
                            out.push({
                                name: t.name,
                                declStart: t.start,
                                declEnd: t.end,
                                scopeStart: init.end,
                                scopeEnd: bodyEnd,
                            });
                        }
                    }
                }
            }
        }
        return out;
    }

    if (FN_HEADS.has(name)) {
        return fnBindings(src, form, name);
    }

    return [];
}

/** Parameter (and self-name) bindings for `fn` / `defn` shaped forms. */
function fnBindings(src: string, form: Form, head: string): LocalBinding[] {
    const out: LocalBinding[] = [];
    const kids = form.children;
    // `defn`/`defmacro` name their def; the name is a global, not a local, so we
    // skip it. `fn` may carry an optional *self* name, which IS a local.
    let i = 1;
    if (head === 'fn' && isAtom(kids[i]) && isBindableName(atomText(src, kids[i]))) {
        const self = kids[i];
        out.push({
            name: atomText(src, self),
            declStart: self.bodyStart,
            declEnd: self.bodyEnd,
            scopeStart: self.bodyEnd,
            scopeEnd: form.innerEnd,
        });
        i++;
    } else if (head !== 'fn') {
        i++; // skip the def name
    }

    const addArity = (paramVec: Form, scopeEnd: number): void => {
        for (const t of collectTargets(src, paramVec)) {
            out.push({
                name: t.name,
                declStart: t.start,
                declEnd: t.end,
                scopeStart: paramVec.end,
                scopeEnd,
            });
        }
    };

    // Single-arity: the first vector child is the parameter list.
    const directVec = kids.slice(i).find((c) => c.kind === 'vector');
    if (directVec) {
        addArity(directVec, form.innerEnd);
        return out;
    }
    // Multi-arity: each `([params] body…)` list is its own scope.
    for (const arity of kids.slice(i)) {
        if (arity.kind === 'list' && arity.children[0]?.kind === 'vector') {
            addArity(arity.children[0], arity.innerEnd);
        }
    }
    return out;
}

/** Every binding introduced by any list form on `path`, innermost first. */
function bindingsOnPath(src: string, path: readonly Form[]): LocalBinding[] {
    const out: LocalBinding[] = [];
    for (let i = path.length - 1; i >= 0; i--) {
        for (const b of bindingsOf(src, path[i])) {
            out.push(b);
        }
    }
    return out;
}

/**
 * Resolve the local binding that governs the symbol token at `offset`, or null
 * when the token is not a locally-bound symbol (caller should treat it as a
 * global / core symbol).
 */
export function resolveLocalAt(src: string, offset: number): LocalBinding | null {
    const forms = parseAll(src);
    const path = pathAt(forms, offset);
    const last = path[path.length - 1];
    if (!last || last.kind !== 'atom') {
        return null;
    }
    const name = atomText(src, last);
    if (!isBindableName(name)) {
        return null;
    }
    const pos = last.bodyStart;

    // Case 1: the cursor is *on a declaration* — return that binding directly so
    // rename/refs include the decl and shadowing resolves correctly.
    const bindings = bindingsOnPath(src, path);
    for (const b of bindings) {
        if (b.declStart === pos && b.name === name) {
            return b;
        }
    }
    // Case 2: a *use* — nearest enclosing binding of the same name whose scope
    // covers the offset wins (inner shadows outer).
    for (const b of bindings) {
        if (b.name === name && b.scopeStart <= pos && pos < b.scopeEnd) {
            return b;
        }
    }
    return null;
}

/**
 * All occurrences (declaration + uses) of the local binding `b` in `src`,
 * shadow-aware: an inner binding that re-uses the same name is excluded because
 * those tokens resolve to the inner binding, not `b`.
 */
export function localOccurrences(src: string, b: LocalBinding): Occurrence[] {
    const out: Occurrence[] = [];
    for (const occ of findOccurrences(src, b.name)) {
        if (occ.start === b.declStart) {
            out.push(occ);
            continue;
        }
        if (occ.start < b.declStart || occ.start >= b.scopeEnd) {
            continue;
        }
        const resolved = resolveLocalAt(src, occ.start);
        if (resolved && resolved.declStart === b.declStart) {
            out.push(occ);
        }
    }
    return out;
}

/**
 * Names of every local binding visible at `offset`, nearest-scope first and
 * de-duplicated. Used to surface in-scope locals in completion.
 */
export function localsInScopeAt(src: string, offset: number): string[] {
    const forms = parseAll(src);
    const path = pathAt(forms, offset);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const b of bindingsOnPath(src, path)) {
        // A local is offerable once its scope has opened at the cursor, or when
        // the cursor sits inside the binding form at all (params being typed).
        if (offset >= b.scopeStart || (offset >= b.declStart && offset < b.scopeEnd)) {
            if (!seen.has(b.name)) {
                seen.add(b.name);
                out.push(b.name);
            }
        }
    }
    return out;
}
