// Copyright (c) 2026 DeepSeek. MIT License; see docs/licenses/deepseek-harness-MIT.txt.
// Ported without algorithm changes from DeepSeek Harness @ ce7073d, terminal-bash/src/session.ts:39–163.
const COALESCED_CHUNK_UNITS = 4096;
class BoundedTextBuffer {
    maxBytes;
    maxLines;
    head;
    tail;
    bytes = 0;
    newlines = 0;
    lastCodeUnit = 0;
    dropped = false;
    constructor(maxBytes, maxLines){
        this.maxBytes = maxBytes;
        this.maxLines = maxLines;
    }
    get truncated() {
        return this.dropped;
    }
    get isEmpty() {
        return this.head === undefined;
    }
    append(text) {
        if (text.length === 0) return;
        text = Buffer.from(text, 'utf16le').toString('utf16le');
        this.bytes += Buffer.byteLength(text);
        const tail = this.tail;
        if (tail !== undefined) {
            const last = this.lastCodeUnit;
            const first = text.charCodeAt(0);
            if (last >= 0xd800 && last <= 0xdbff && first >= 0xdc00 && first <= 0xdfff) this.bytes -= 2;
        }
        for(let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)){
            this.newlines += 1;
        }
        this.lastCodeUnit = text.charCodeAt(text.length - 1);
        if (tail !== undefined && tail !== this.head && tail.text.length + text.length <= COALESCED_CHUNK_UNITS) {
            tail.text += text;
        } else {
            if (tail !== undefined && tail.text.length <= COALESCED_CHUNK_UNITS) {
                tail.text = Buffer.from(tail.text, 'utf16le').toString('utf16le');
            }
            const chunk = {
                text,
                start: 0,
                next: undefined
            };
            if (tail === undefined) this.head = chunk;
            else tail.next = chunk;
            this.tail = chunk;
        }
        while(this.head !== undefined && (this.bytes > this.maxBytes || this.maxLines !== undefined && this.newlines >= this.maxLines)){
            const head = this.head;
            const first = head.text.charCodeAt(head.start);
            const second = head.start + 1 < head.text.length ? head.text.charCodeAt(head.start + 1) : head.next?.text.charCodeAt(0);
            const paired = first >= 0xd800 && first <= 0xdbff && second !== undefined && second >= 0xdc00 && second <= 0xdfff;
            this.bytes -= paired ? 4 : first < 0x80 ? 1 : first < 0x800 ? 2 : 3;
            if (first === 10) this.newlines -= 1;
            this.advance(paired ? 2 : 1);
            this.dropped = true;
        }
        const head = this.head;
        if (head !== undefined && head.start >= head.text.length / 2) {
            head.text = Buffer.from(head.text.slice(head.start), 'utf16le').toString('utf16le');
            head.start = 0;
        }
    }
    advance(units) {
        while(units > 0 && this.head !== undefined){
            const head = this.head;
            const count = Math.min(units, head.text.length - head.start);
            head.start += count;
            units -= count;
            if (head.start === head.text.length) this.head = head.next;
        }
        if (this.head === undefined) this.tail = undefined;
    }
    consume() {
        const { text: delta, truncated } = this.snapshot();
        this.head = undefined;
        this.tail = undefined;
        this.bytes = 0;
        this.newlines = 0;
        this.dropped = false;
        return {
            delta,
            truncated
        };
    }
    snapshot() {
        const chunks = [];
        for(let chunk = this.head; chunk !== undefined; chunk = chunk.next){
            chunks.push(chunk.text.slice(chunk.start));
        }
        return {
            text: chunks.join(''),
            truncated: this.dropped
        };
    }
}
export { BoundedTextBuffer };
