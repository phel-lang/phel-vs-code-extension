# Tracing with taps

For ad-hoc inspection without setting up a full debug session, Phel ships a Clojure-style **tap registry** in `phel\core`.

## API

| Fn | What it does |
|---|---|
| `(add-tap f)` | Register a one-arg function `f` to receive tapped values. Returns `nil`. |
| `(remove-tap f)` | Deregister a previously registered tap. Returns `nil`. |
| `(tap> x)` | Send `x` to every registered tap. Returns `true`. |

## Example

```phel
(ns my-app\core)

;; Print every tapped value (or push to a logger, atom, file, etc.)
(add-tap println)

(defn process [order]
  (tap> {:event :process-start :id (:id order)})
  (let [result (do-work order)]
    (tap> {:event :process-end :id (:id order) :result result})
    result))

;; Cleanup when done
(remove-tap println)
```

## Semantics

- **Synchronous.** Unlike Clojure, taps run inline on the calling thread — Phel has no background queue.
- **Fault-isolated.** Exceptions thrown by individual tap handlers are swallowed so a buggy tap can't take down the producer or other taps.
- **Set-based.** Adding the same function twice still registers it once (`add-tap` `conj`'s into a set).

## Idioms

**Capture into an atom for later inspection:**
```phel
(def captured (atom []))
(add-tap (fn [x] (swap! captured conj x)))
```

**Conditional tracing in production:**
```phel
(when (env "DEBUG_TRACE")
  (add-tap println))
```

**Pretty-print structured events:**
```phel
(add-tap (fn [x] (println (pprint/pprint x))))
```
