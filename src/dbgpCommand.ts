// Writing a DBGp command line.
//
// A command is `name -i <transaction id> [-<key> <value>]... [-- <base64>]`,
// NUL-terminated by the transport. The data payload is always base64, which is
// what lets an argument-free blob — a PHP expression to evaluate, or the
// condition of a conditional breakpoint — carry spaces and quotes.
//
// Split out of the debug adapter so the exact bytes a breakpoint or an eval
// puts on the wire can be asserted without a live session.

export function formatDbgpCommand(
    command: string,
    transactionId: number,
    args: Readonly<Record<string, string>> = {},
    data?: string
): string {
    let line = `${command} -i ${transactionId}`;

    for (const [key, value] of Object.entries(args)) {
        line += ` -${key} ${value}`;
    }

    if (data !== undefined) {
        line += ` -- ${Buffer.from(data).toString('base64')}`;
    }

    return line;
}
