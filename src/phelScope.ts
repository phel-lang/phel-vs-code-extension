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
    /** True when this binding is a function parameter (vs a let/loop/… name). */
    param?: boolean;
}

/** `let`-shaped forms: `(head [name init name init …] body…)`. */
const PAIR_BINDING_HEADS = new Set(['let', 'loop', 'binding', 'with-open']);
/** Single-pair binding forms: `(head [name test] …)`. */
const ONE_PAIR_HEADS = new Set([
    'if-let',
    'when-let',
    'if-some',
    'when-some',
    'when-first',
    'dotimes',
]);
/** `for`-clause verbs: `binding :verb expr`. */
const SEQ_VERBS = new Set([':range', ':in', ':keys', ':pairs']);
/** `fn`-shaped forms whose parameter vector(s) introduce locals. */
const FN_HEADS = new Set(['fn', 'defn', 'defn-', 'defmacro', 'defmacro-']);
/** Sequential-iteration forms: `(head [var … coll] body…)`. */
const SEQ_HEADS = new Set(['for', 'doseq', 'dofor']);
/**
 * Forms carrying a tail of protocol-method *implementations*,
 * `(method-name [params] body…)`. `defprotocol` / `definterface` are absent on
 * purpose: their method forms are signatures with no body, so their parameter
 * names are not locals and must not be reported as unused.
 */
const METHOD_IMPL_HEADS = new Set([
    'defrecord',
    'deftype',
    'extend-type',
    'extend-protocol',
    'reify',
    'reify*',
]);

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
        return seqBindings(src, form, bodyEnd);
    }

    if (name === 'as->') {
        // (as-> expr name form…): `name` is rebound to each form's result and is
        // visible from after its own atom through the rest of the form.
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

    if (name === 'letfn') {
        return letfnBindings(src, form, bodyEnd);
    }

    if (METHOD_IMPL_HEADS.has(name)) {
        return methodImplBindings(src, form);
    }

    if (name === 'defmethod') {
        // (defmethod multi-name dispatch-val [params] body…) — the fn tail
        // starts after the dispatch value.
        return fnTailBindings(src, form, 3, form.innerEnd);
    }

    if (FN_HEADS.has(name)) {
        return fnBindings(src, form, name);
    }

    return [];
}

/**
 * Bindings introduced by the head vector of `for` / `doseq` / `dofor`:
 *
 *   (for [x :in xs y :in ys :let [z (f x)] :when (p z) :reduce [acc 0]] body…)
 *
 * The head is a flat sequence of `binding :verb expr` clauses, interleaved with
 * the `:while` / `:when` / `:let` modifiers and the `:reduce` option. Every
 * loop binding, every `:let` pair, and the `:reduce` accumulator is a local.
 */
function seqBindings(src: string, form: Form, bodyEnd: number): LocalBinding[] {
    const vec = bindingVec(form);
    if (!vec || vec.children.length === 0) {
        return [];
    }
    const kids = vec.children;
    const out: LocalBinding[] = [];

    const push = (target: Form, scopeStart: number): void => {
        for (const t of collectTargets(src, target)) {
            out.push({
                name: t.name,
                declStart: t.start,
                declEnd: t.end,
                scopeStart,
                scopeEnd: bodyEnd,
            });
        }
    };

    let i = 0;
    while (i < kids.length) {
        const kid = kids[i];
        const text = kid.kind === 'atom' ? atomText(src, kid) : '';

        if (text === ':let' || text === ':reduce') {
            const vecArg = kids[i + 1];
            if (vecArg?.kind === 'vector') {
                if (text === ':let') {
                    // `:let [a 1 b 2]` — the same sequential pairs as `let`.
                    for (let j = 0; j + 1 < vecArg.children.length; j += 2) {
                        push(vecArg.children[j], vecArg.children[j + 1].end);
                    }
                } else {
                    // `:reduce [acc init]` — the accumulator is visible in the body.
                    push(vecArg.children[0], vecArg.end);
                }
            }
            i += 2;
            continue;
        }

        if (text === ':when' || text === ':while') {
            i += 2;
            continue;
        }

        // `binding :verb expr` — anything else followed by a loop verb.
        const verb = kids[i + 1];
        if (verb?.kind === 'atom' && SEQ_VERBS.has(atomText(src, verb))) {
            const expr = kids[i + 2];
            push(kid, expr ? expr.end : verb.end);
            i += 3;
            continue;
        }

        // `(doseq [x coll] …)` shorthand, or an unrecognised clause: treat a
        // leading target followed by a single expression as one binding, then
        // stop rather than guess at the rest.
        if (i === 0 && kids.length >= 2) {
            push(kid, kids[1].end);
        }
        break;
    }

    return out;
}

/**
 * `(letfn [(f [a] …) (g [b] …)] body…)`. The function names are visible across
 * every spec and the body (they are mutually recursive); each spec's parameters
 * are visible only inside that spec.
 */
function letfnBindings(src: string, form: Form, bodyEnd: number): LocalBinding[] {
    const vec = bindingVec(form);
    if (!vec) {
        return [];
    }
    const out: LocalBinding[] = [];
    for (const spec of vec.children) {
        if (spec.kind !== 'list' || spec.children.length === 0) {
            continue;
        }
        const fnName = spec.children[0];
        if (isAtom(fnName) && isBindableName(atomText(src, fnName))) {
            out.push({
                name: atomText(src, fnName),
                declStart: fnName.bodyStart,
                declEnd: fnName.bodyEnd,
                scopeStart: vec.innerStart,
                scopeEnd: bodyEnd,
            });
        }
        const params = spec.children[1];
        if (params?.kind === 'vector') {
            for (const param of params.children) {
                for (const t of collectTargets(src, param)) {
                    out.push({
                        name: t.name,
                        declStart: t.start,
                        declEnd: t.end,
                        scopeStart: params.end,
                        scopeEnd: spec.innerEnd,
                    });
                }
            }
        }
    }
    return out;
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

    out.push(...fnTailBindings(src, form, i, form.innerEnd));
    return out;
}

/**
 * Parameter bindings for an `fn` tail — everything from `children[start]` on,
 * which is either `[params] body…` or a run of `([params] body…)` arities.
 */
function fnTailBindings(src: string, form: Form, start: number, scopeEnd: number): LocalBinding[] {
    const out: LocalBinding[] = [];
    const rest = form.children.slice(start);

    const addArity = (paramVec: Form, end: number): void => {
        for (const t of collectTargets(src, paramVec)) {
            out.push({
                name: t.name,
                declStart: t.start,
                declEnd: t.end,
                scopeStart: paramVec.end,
                scopeEnd: end,
                param: true,
            });
        }
    };

    // Single-arity: the first vector is the parameter list.
    const directVec = rest.find((c) => c.kind === 'vector');
    if (directVec) {
        addArity(directVec, scopeEnd);
        return out;
    }
    // Multi-arity: each `([params] body…)` list is its own scope.
    for (const arity of rest) {
        if (arity.kind === 'list' && arity.children[0]?.kind === 'vector') {
            addArity(arity.children[0], arity.innerEnd);
        }
    }
    return out;
}

/**
 * Parameters of the protocol-method implementations in a `defrecord` /
 * `deftype` / `extend-type` / `extend-protocol` / `reify` tail. Each
 * `(method-name [params] body…)` list is its own scope.
 *
 * A method form with no body is a *signature*, not an implementation, so its
 * parameters bind nothing — that keeps `defprotocol`-style declarations out of
 * the unused-local hints even when they appear in one of these tails.
 *
 * The field vector of `defrecord` / `deftype` is not a binding: those fields
 * are struct keys, reached with `get` or destructuring, not locals in scope.
 */
function methodImplBindings(src: string, form: Form): LocalBinding[] {
    const out: LocalBinding[] = [];
    for (const spec of form.children.slice(1)) {
        if (spec.kind !== 'list' || spec.children.length < 3) {
            continue;
        }
        if (!isAtom(spec.children[0]) || spec.children[1].kind !== 'vector') {
            continue;
        }
        out.push(...fnTailBindings(src, spec, 1, spec.innerEnd));
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
        // A reference is in range from wherever the binding first becomes
        // visible. That is the declaration for every sequential form, but a
        // `letfn` name is visible from the start of the binding vector, so a
        // mutually recursive call *precedes* its own declaration.
        const refStart = Math.min(b.declStart, b.scopeStart);
        if (occ.start < refStart || occ.start >= b.scopeEnd) {
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
        // A local is offerable once its scope has opened at the cursor and has
        // not closed again (a `letfn` spec's parameters are visible only inside
        // that spec), or when the cursor sits on the binding itself (params
        // being typed).
        const inScope = offset >= b.scopeStart && offset < b.scopeEnd;
        if (inScope || (offset >= b.declStart && offset < b.scopeEnd)) {
            if (!seen.has(b.name)) {
                seen.add(b.name);
                out.push(b.name);
            }
        }
    }
    return out;
}

/**
 * Every local binding declared anywhere in `src`, de-duplicated by declaration
 * site. Used by whole-document consumers (semantic highlighting, unused-local
 * analysis) that need every binding rather than the one under a cursor.
 */
export function collectAllBindings(src: string): LocalBinding[] {
    const out: LocalBinding[] = [];
    const seen = new Set<number>();
    const walk = (form: Form): void => {
        if (form.kind === 'list') {
            for (const b of bindingsOf(src, form)) {
                if (!seen.has(b.declStart)) {
                    seen.add(b.declStart);
                    out.push(b);
                }
            }
        }
        for (const child of form.children) {
            walk(child);
        }
    };
    for (const form of parseAll(src)) {
        walk(form);
    }
    return out;
}

export interface UnusedLocal {
    name: string;
    start: number;
    end: number;
}

/**
 * Local bindings that are declared but never read within their scope.
 * Parameters and `_`-prefixed names are exempt (an unused parameter is often
 * required by a callback/arity contract; `_` is the conventional ignore).
 */
export function findUnusedLocals(src: string): UnusedLocal[] {
    const out: UnusedLocal[] = [];
    for (const b of collectAllBindings(src)) {
        if (b.param || b.name.startsWith('_')) {
            continue;
        }
        // A single occurrence is the declaration itself with no reads.
        if (localOccurrences(src, b).length <= 1) {
            out.push({ name: b.name, start: b.declStart, end: b.declEnd });
        }
    }
    return out;
}
