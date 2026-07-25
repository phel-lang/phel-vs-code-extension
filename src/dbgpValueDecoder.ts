// Reading a CDATA payload out of a DBGp element.
//
// Xdebug base64-encodes a payload only when it says so with `encoding="base64"`
// on the element. Captured from a live session:
//
//   <property name="$accented" type="string" size="5" encoding="base64">
//       <![CDATA[Y2Fmw6k=]]>
//   <property name="$number" type="int"><![CDATA[42]]>
//   <property name="$fl"     type="float"><![CDATA[3.5]]>
//   <property name="$flag"   type="bool"><![CDATA[1]]>
//
// Decoding unconditionally turned every int, float and bool into mojibake —
// `42` and `3.5` both rendered as U+FFFD, `true` as the empty string — because
// `Buffer.from(x, 'base64')` silently discards whatever is not base64.
//
// Split out of the debug adapter because that class cannot be constructed
// outside a live debug session; this part is pure, so it can be tested.

/** True when the element declares its payload base64-encoded. */
export function isBase64Encoded(elementAttributes: string): boolean {
    return /\bencoding="base64"/.test(elementAttributes);
}

/**
 * The text of a DBGp element's CDATA, decoded per the element's own
 * `encoding` attribute. `element` is the element markup (or the whole message)
 * the CDATA came from, so its attributes can be consulted.
 */
export function decodeDbgpCdata(cdata: string, element: string): string {
    if (!isBase64Encoded(element)) {
        return cdata;
    }
    return Buffer.from(cdata, 'base64').toString('utf-8');
}
